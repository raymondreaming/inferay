use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use futures_util::future::join_all;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use url::Url;

use super::{MAX_PROXY_BODY_BYTES, ServerState, json_response, request_json, resolve_lexically};

const ACCOUNTS_CACHE_TTL_MS: u64 = 30_000;
const REPOS_CACHE_TTL_MS: u64 = 120_000;
const COMMAND_MAX_BUFFER: usize = 1024 * 1024;
const TOOL_PATHS: [&str; 6] = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

#[derive(Default)]
pub(super) struct ForgeState {
    accounts_cache: tokio::sync::Mutex<Option<AccountsCache>>,
    repos_cache: tokio::sync::Mutex<Option<ReposCache>>,
    commit_avatar_cache: tokio::sync::Mutex<HashMap<String, Option<String>>>,
}

struct AccountsCache {
    value: Vec<ForgeAccount>,
    cached_at: u64,
}

struct ReposCache {
    limit: f64,
    value: Vec<GithubRepo>,
    cached_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForgeAccount {
    provider: &'static str,
    host: String,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
    email: Option<String>,
    active: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct GithubRepo {
    name: String,
    full_name: String,
    description: Option<String>,
    html_url: String,
    language: Option<String>,
    stargazers_count: f64,
    updated_at: String,
    private: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGithubRepo {
    name: String,
    name_with_owner: String,
    description: Option<String>,
    url: String,
    primary_language: Option<RawPrimaryLanguage>,
    stargazer_count: f64,
    updated_at: String,
    is_private: bool,
}

#[derive(Deserialize)]
struct RawPrimaryLanguage {
    name: Option<String>,
}

#[derive(Debug)]
struct CommandError {
    message: String,
    stderr: String,
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub(super) fn is_route(path: &str, method: &Method) -> bool {
    matches!(
        (path, method),
        ("/api/forge/accounts", &Method::GET)
            | ("/api/forge/repos", &Method::GET)
            | ("/api/forge/commit-avatars", &Method::POST)
            | ("/api/forge/clone", &Method::POST)
            | ("/api/forge/connect", &Method::POST)
    )
}

pub(super) async fn handle_request(state: &ServerState, path: &str, request: Request) -> Response {
    let headers = request.headers().clone();
    match path {
        "/api/forge/accounts" => {
            if query_has_key(&request, "refresh") {
                *state.forge_state.accounts_cache.lock().await = None;
            }
            match list_github_accounts(state).await {
                Ok(accounts) => {
                    json_response(StatusCode::OK, json!({ "accounts": accounts }), &headers)
                }
                Err(error) => route_error(error.to_string(), &headers),
            }
        }
        "/api/forge/repos" => {
            let limit = javascript_minimum(
                query_value(&request, "limit").map_or(30.0, |value| javascript_number(&value)),
                100.0,
            );
            let repos = list_github_repos(state, limit).await;
            json_response(StatusCode::OK, json!({ "repos": repos }), &headers)
        }
        "/api/forge/commit-avatars" => {
            let body: Value = match request_json(request, &headers).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let cwd = body.get("cwd").and_then(Value::as_str).unwrap_or_default();
            let hashes = body
                .get("hashes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|hash| {
                    (7..=64).contains(&hash.len())
                        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .take(100)
                .map(str::to_string)
                .collect::<Vec<_>>();
            let Some(cwd) = state
                .allowed_paths
                .resolve_allowed_local_path(PathBuf::from(cwd))
            else {
                return bad_request("Repository is outside allowed local roots", &headers);
            };
            let avatars = resolve_commit_avatars(state, &cwd, &hashes)
                .await
                .unwrap_or_default();
            json_response(StatusCode::OK, json!({ "avatars": avatars }), &headers)
        }
        "/api/forge/clone" => {
            let body: Value = match request_json(request, &headers).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let Some(git_url) = body.get("gitUrl").and_then(Value::as_str) else {
                return bad_request("Missing Git URL", &headers);
            };
            if git_url.trim().is_empty() {
                return bad_request("Missing Git URL", &headers);
            }
            let Some(clone_directory) = body.get("cloneDirectory").and_then(Value::as_str) else {
                return bad_request("Missing clone location", &headers);
            };
            if clone_directory.trim().is_empty() {
                return bad_request("Missing clone location", &headers);
            }
            match clone_repository(state, git_url, clone_directory).await {
                Ok((path, display_path)) => json_response(
                    StatusCode::OK,
                    json!({ "ok": true, "path": path, "displayPath": display_path }),
                    &headers,
                ),
                Err(error) => route_error(error, &headers),
            }
        }
        "/api/forge/connect" => {
            let body = request_json_lenient(request).await;
            if let Some(provider) = body.get("provider")
                && javascript_truthy(provider)
                && provider.as_str() != Some("github")
            {
                return bad_request("Only GitHub connect is supported right now", &headers);
            }
            match open_github_login(state).await {
                Ok(ok) => json_response(StatusCode::OK, json!({ "ok": ok }), &headers),
                Err(error) => route_error(error.to_string(), &headers),
            }
        }
        _ => unreachable!("forge handler called for an unknown route"),
    }
}

async fn resolve_commit_avatars(
    state: &ServerState,
    cwd: &Path,
    hashes: &[String],
) -> Result<HashMap<String, Option<String>>, CommandError> {
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    let remote = run_git(&["remote", "get-url", "origin"], Some(cwd), 5_000).await?;
    let (host, owner, repository) =
        parse_github_remote(remote.trim()).ok_or_else(|| CommandError {
            message: "Origin is not a GitHub repository".into(),
            stderr: String::new(),
        })?;
    let prefix = format!("{host}/{owner}/{repository}:");
    let mut result = HashMap::new();
    let mut missing = Vec::new();
    {
        let cache = state.forge_state.commit_avatar_cache.lock().await;
        for hash in hashes {
            if let Some(avatar) = cache.get(&format!("{prefix}{hash}")) {
                result.insert(hash.clone(), avatar.clone());
            } else {
                missing.push(hash.clone());
            }
        }
    }
    if missing.is_empty() {
        return Ok(result);
    }
    let selections = missing
        .iter()
        .enumerate()
        .map(|(index, hash)| {
            format!("c{index}: object(oid: \"{hash}\") {{ ... on Commit {{ author {{ user {{ avatarUrl }} }} }} }}")
        })
        .collect::<Vec<_>>()
        .join(" ");
    let query = format!(
        "query {{ repository(owner: \"{owner}\", name: \"{repository}\") {{ {selections} }} }}"
    );
    let output = run_gh(
        &[
            "api",
            "graphql",
            "--hostname",
            &host,
            "-f",
            &format!("query={query}"),
        ],
        20_000,
    )
    .await?;
    let value: Value = serde_json::from_str(&output).map_err(parse_error)?;
    let repository_data = value.pointer("/data/repository");
    let mut cache = state.forge_state.commit_avatar_cache.lock().await;
    for (index, hash) in missing.iter().enumerate() {
        let avatar = repository_data
            .and_then(|repo| repo.pointer(&format!("/c{index}/author/user/avatarUrl")))
            .and_then(Value::as_str)
            .map(str::to_string);
        cache.insert(format!("{prefix}{hash}"), avatar.clone());
        result.insert(hash.clone(), avatar);
    }
    Ok(result)
}

fn parse_github_remote(remote: &str) -> Option<(String, String, String)> {
    let normalized = if remote.starts_with("git@") {
        remote
            .replacen(':', "/", 1)
            .replacen("git@", "ssh://git@", 1)
    } else {
        remote.to_string()
    };
    let url = Url::parse(&normalized).ok()?;
    let host = url.host_str()?.to_string();
    if host != "github.com" && !host.ends_with(".ghe.com") {
        return None;
    }
    let mut parts = url.path().trim_matches('/').split('/');
    let owner = parts.next()?.to_string();
    let repository = parts.next()?.trim_end_matches(".git").to_string();
    (!owner.is_empty() && !repository.is_empty()).then_some((host, owner, repository))
}

async fn request_json_lenient(request: Request) -> Value {
    let Ok(bytes) = axum::body::to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES).await else {
        return json!({});
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}))
}

async fn list_github_accounts(state: &ServerState) -> Result<Vec<ForgeAccount>, CommandError> {
    let now = epoch_millis();
    if let Some(cache) = state.forge_state.accounts_cache.lock().await.as_ref()
        && now.saturating_sub(cache.cached_at) < ACCOUNTS_CACHE_TTL_MS
    {
        return Ok(cache.value.clone());
    }

    let output = run_gh(&["auth", "status", "--json", "hosts"], 15_000).await;
    let output = match output {
        Ok(output) => output,
        Err(error) if is_logged_out(&error.stderr) => {
            *state.forge_state.accounts_cache.lock().await = Some(AccountsCache {
                value: Vec::new(),
                cached_at: epoch_millis(),
            });
            return Ok(Vec::new());
        }
        Err(error) => return Err(error),
    };
    let entries = parse_auth_entries(&output).map_err(parse_error)?;
    let profiles = join_all(
        entries
            .iter()
            .map(|entry| fetch_github_profile(entry.host.clone(), entry.login.clone())),
    )
    .await;
    let mut accounts = entries
        .into_iter()
        .zip(profiles)
        .map(|(entry, profile)| ForgeAccount {
            provider: "github",
            host: entry.host,
            login: entry.login,
            name: profile.name,
            avatar_url: profile.avatar_url,
            email: profile.email,
            active: entry.active,
        })
        .collect::<Vec<_>>();
    accounts.sort_by(|left, right| {
        locale_compare(&left.host, &right.host)
            .then_with(|| right.active.cmp(&left.active))
            .then_with(|| locale_compare(&left.login, &right.login))
    });
    *state.forge_state.accounts_cache.lock().await = Some(AccountsCache {
        value: accounts.clone(),
        cached_at: epoch_millis(),
    });
    Ok(accounts)
}

#[derive(Debug, PartialEq, Eq)]
struct AuthEntry {
    host: String,
    login: String,
    active: bool,
}

fn parse_auth_entries(output: &str) -> Result<Vec<AuthEntry>, String> {
    let value: Value = serde_json::from_str(output).map_err(|error| error.to_string())?;
    let Some(hosts) = value.get("hosts").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();
    for (host, accounts) in hosts {
        let accounts = accounts
            .as_array()
            .ok_or_else(|| "GitHub auth hosts must contain account arrays".to_string())?;
        for account in accounts {
            if account.get("state").and_then(Value::as_str) != Some("success") {
                continue;
            }
            let login = account
                .get("login")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if login.is_empty() {
                continue;
            }
            entries.push(AuthEntry {
                host: host.clone(),
                login: login.to_string(),
                active: account.get("active").is_some_and(javascript_truthy),
            });
        }
    }
    Ok(entries)
}

#[derive(Default)]
struct GithubProfile {
    name: Option<String>,
    avatar_url: Option<String>,
    email: Option<String>,
}

async fn fetch_github_profile(host: String, login: String) -> GithubProfile {
    let endpoint = format!("/users/{login}");
    let Ok(output) = run_gh(
        &[
            "api",
            "--hostname",
            &host,
            "-H",
            "Accept: application/vnd.github+json",
            &endpoint,
        ],
        15_000,
    )
    .await
    else {
        return GithubProfile::default();
    };
    let Ok(value) = serde_json::from_str::<Value>(&output) else {
        return GithubProfile::default();
    };
    GithubProfile {
        name: trimmed_optional_string(value.get("name")),
        avatar_url: value
            .get("avatar_url")
            .and_then(Value::as_str)
            .map(str::to_string),
        email: trimmed_optional_string(value.get("email")),
    }
}

async fn list_github_repos(state: &ServerState, limit: f64) -> Vec<GithubRepo> {
    let now = epoch_millis();
    if let Some(cache) = state.forge_state.repos_cache.lock().await.as_ref()
        && cache.limit >= limit
        && now.saturating_sub(cache.cached_at) < REPOS_CACHE_TTL_MS
    {
        return javascript_slice(&cache.value, limit);
    }

    let result = async {
        let accounts = list_github_accounts(state).await?;
        let active = accounts
            .iter()
            .find(|account| account.active)
            .or_else(|| accounts.first());
        let mut arguments = vec!["repo".to_string(), "list".to_string()];
        if let Some(login) = active.map(|account| account.login.clone()) {
            arguments.push(login);
        }
        arguments.extend([
            "--json".into(),
            "name,description,url,primaryLanguage,stargazerCount,updatedAt,isPrivate,nameWithOwner"
                .into(),
            "--limit".into(),
            javascript_number_string(limit),
        ]);
        let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let output = run_gh(&references, 20_000).await?;
        let raw = serde_json::from_str::<Vec<RawGithubRepo>>(&output).map_err(parse_error)?;
        Ok::<_, CommandError>(
            raw.into_iter()
                .map(|repo| GithubRepo {
                    name: repo.name,
                    full_name: repo.name_with_owner,
                    description: repo.description,
                    html_url: repo.url,
                    language: repo.primary_language.and_then(|language| language.name),
                    stargazers_count: repo.stargazer_count,
                    updated_at: repo.updated_at,
                    private: repo.is_private,
                })
                .collect::<Vec<_>>(),
        )
    }
    .await;
    let Ok(repos) = result else {
        return Vec::new();
    };
    *state.forge_state.repos_cache.lock().await = Some(ReposCache {
        limit,
        value: repos.clone(),
        cached_at: epoch_millis(),
    });
    repos
}

async fn open_github_login(state: &ServerState) -> Result<bool, CommandError> {
    *state.forge_state.accounts_cache.lock().await = None;
    *state.forge_state.repos_cache.lock().await = None;

    #[cfg(target_os = "macos")]
    {
        let gh = resolve_gh_binary().to_string_lossy().into_owned();
        let script = [
            "tell application \"Terminal\"".to_string(),
            "activate".to_string(),
            format!(
                "do script \"{} \"",
                quote_apple_script(&format!("{gh} auth login"))
            ),
            "end tell".to_string(),
        ]
        .join("\n");
        run_command(
            Path::new("osascript"),
            &["-e", &script],
            None,
            10_000,
            tool_environment(),
        )
        .await?;
        Ok(true)
    }

    #[cfg(target_os = "windows")]
    let (program, arguments) = (
        "cmd.exe",
        vec!["/c", "start", "cmd.exe", "/k", "gh auth login"],
    );
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (program, arguments) = ("x-terminal-emulator", vec!["-e", "gh auth login"]);
    #[cfg(not(target_os = "macos"))]
    {
        let status = Command::new(program)
            .args(arguments)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(io_error)?;
        Ok(status.success())
    }
}

async fn clone_repository(
    state: &ServerState,
    git_url: &str,
    clone_directory: &str,
) -> Result<(String, String), String> {
    let url = git_url.trim();
    let parent = expand_home(state.allowed_paths.home_directory(), clone_directory.trim())
        .and_then(|path| state.allowed_paths.resolve_allowed_local_path(path));
    if url.is_empty() {
        return Err("Git URL is required".into());
    }
    if clone_directory.trim().is_empty() {
        return Err("Clone location is required".into());
    }
    if !is_github_clone_url(url) {
        return Err("Only GitHub clone URLs are supported".into());
    }
    let Some(parent) = parent else {
        return Err("Clone location is outside allowed local roots".into());
    };

    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|error| error.to_string())?;
    let repository_name = infer_repo_name(url);
    if repository_name.is_empty() {
        return Err("Unable to determine repository name".into());
    }
    let target = parent.join(repository_name);
    if target.exists() {
        return Err(format!(
            "Target already exists: {}",
            target.to_string_lossy()
        ));
    }
    let parent_text = parent.to_string_lossy().into_owned();
    let target_text = target.to_string_lossy().into_owned();
    run_git(
        &["clone", "--", url, &target_text],
        Some(Path::new(&parent_text)),
        120_000,
    )
    .await
    .map_err(|error| error.to_string())?;
    add_search_folder(state, &parent).await?;
    *state.forge_state.repos_cache.lock().await = None;
    Ok((
        target_text,
        display_path(state.allowed_paths.home_directory(), &target),
    ))
}

async fn add_search_folder(state: &ServerState, folder: &Path) -> Result<(), String> {
    let config = state.config_manager.lock().await.load();
    let current = config
        .get("search_folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let folder_text = folder.to_string_lossy().into_owned();
    let shown = display_path(state.allowed_paths.home_directory(), folder);
    if current.contains(&shown) || current.contains(&folder_text) {
        return Ok(());
    }
    let mut next = current;
    next.push(shown);
    state.config_manager.lock().await.update(
        json!({ "search_folders": next })
            .as_object()
            .expect("search folder update is an object")
            .clone(),
    )?;
    Ok(())
}

fn expand_home(home: &Path, path: &str) -> Option<PathBuf> {
    let path = if path == "~" {
        home.to_path_buf()
    } else if let Some(path) = path.strip_prefix("~/") {
        home.join(path)
    } else {
        PathBuf::from(path)
    };
    resolve_lexically(&path).ok()
}

fn display_path(home: &Path, path: &Path) -> String {
    let path = path.to_string_lossy();
    let home = home.to_string_lossy();
    path.strip_prefix(&format!("{home}/"))
        .map_or_else(|| path.to_string(), |path| format!("~/{path}"))
}

fn infer_repo_name(url: &str) -> String {
    let cleaned = url.trim().trim_end_matches('/');
    let cleaned = cleaned.strip_suffix(".git").unwrap_or(cleaned);
    cleaned
        .replace(':', "/")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn is_github_clone_url(value: &str) -> bool {
    if let Ok(url) = Url::parse(value) {
        return matches!(url.scheme(), "https" | "ssh")
            && url.host_str().is_some_and(|hostname| {
                hostname == "github.com" || hostname.ends_with(".ghe.com")
            });
    }
    Regex::new(r"(?i)^git@(?:github\.com|[\w.-]+\.ghe\.com):[\w.-]+/[\w.-]+(?:\.git)?$")
        .expect("static GitHub clone URL regex must compile")
        .is_match(value)
}

fn quote_apple_script(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

async fn run_gh(arguments: &[&str], timeout_ms: u64) -> Result<String, CommandError> {
    run_command(
        &resolve_gh_binary(),
        arguments,
        None,
        timeout_ms,
        tool_environment(),
    )
    .await
}

async fn run_git(
    arguments: &[&str],
    cwd: Option<&Path>,
    timeout_ms: u64,
) -> Result<String, CommandError> {
    run_command(
        Path::new("git"),
        arguments,
        cwd,
        timeout_ms,
        tool_environment(),
    )
    .await
}

async fn run_command(
    program: &Path,
    arguments: &[&str],
    cwd: Option<&Path>,
    timeout_ms: u64,
    environment: HashMap<OsString, OsString>,
) -> Result<String, CommandError> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = tokio::time::timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .map_err(|_| CommandError {
            message: format!("{} timed out", program.to_string_lossy()),
            stderr: String::new(),
        })?
        .map_err(io_error)?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if output.stdout.len() > COMMAND_MAX_BUFFER || output.stderr.len() > COMMAND_MAX_BUFFER {
        return Err(CommandError {
            message: "stdout maxBuffer length exceeded".into(),
            stderr,
        });
    }
    if !output.status.success() {
        return Err(CommandError {
            message: if stderr.trim().is_empty() {
                format!(
                    "{} exited with {}",
                    program.to_string_lossy(),
                    output.status
                )
            } else {
                stderr.trim().to_string()
            },
            stderr,
        });
    }
    Ok(stdout)
}

fn resolve_gh_binary() -> PathBuf {
    TOOL_PATHS
        .into_iter()
        .map(|directory| Path::new(directory).join("gh"))
        .chain([
            PathBuf::from("/opt/homebrew/bin/gh"),
            PathBuf::from("/usr/local/bin/gh"),
        ])
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| PathBuf::from("gh"))
}

fn tool_environment() -> HashMap<OsString, OsString> {
    let mut environment = std::env::vars_os().collect::<HashMap<_, _>>();
    let existing_path = environment
        .get(OsStr::new("PATH"))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut entries = TOOL_PATHS
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if !existing_path.is_empty() {
        entries.push(existing_path);
    }
    environment.insert(OsString::from("PATH"), OsString::from(entries.join(":")));
    environment
}

fn javascript_number(value: &str) -> f64 {
    let value = value.trim();
    if value.is_empty() {
        0.0
    } else if value == "Infinity" || value == "+Infinity" {
        f64::INFINITY
    } else if value == "-Infinity" {
        f64::NEG_INFINITY
    } else {
        value.parse().unwrap_or(f64::NAN)
    }
}

fn javascript_number_string(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value == f64::INFINITY {
        "Infinity".into()
    } else if value == f64::NEG_INFINITY {
        "-Infinity".into()
    } else if value == 0.0 {
        "0".into()
    } else {
        value.to_string()
    }
}

fn javascript_minimum(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else {
        left.min(right)
    }
}

fn javascript_slice(values: &[GithubRepo], end: f64) -> Vec<GithubRepo> {
    let end = if end.is_nan() {
        0
    } else if end == f64::INFINITY {
        values.len()
    } else if end == f64::NEG_INFINITY {
        0
    } else if end < 0.0 {
        values.len().saturating_sub(end.abs().trunc() as usize)
    } else {
        (end.trunc() as usize).min(values.len())
    };
    values[..end].to_vec()
}

fn javascript_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn query_has_key(request: &Request, key: &str) -> bool {
    url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .any(|(name, _)| name == key)
}

fn query_value(request: &Request, key: &str) -> Option<String> {
    url::form_urlencoded::parse(request.uri().query()?.as_bytes())
        .find_map(|(name, value)| (name == key).then(|| value.into_owned()))
}

fn trimmed_optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn locale_compare(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right))
}

fn is_logged_out(stderr: &str) -> bool {
    let stderr = stderr.to_lowercase();
    stderr.contains("not logged in")
        || stderr.contains("no authentication")
        || stderr.contains("gh auth login")
}

fn parse_error(error: impl ToString) -> CommandError {
    CommandError {
        message: error.to_string(),
        stderr: String::new(),
    }
}

fn io_error(error: std::io::Error) -> CommandError {
    CommandError {
        message: error.to_string(),
        stderr: String::new(),
    }
}

fn bad_request(message: &str, headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        json!({ "error": message }),
        headers,
    )
}

fn route_error(message: String, headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": message }),
        headers,
    )
}

fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_filters_github_auth_accounts() {
        let entries = parse_auth_entries(
            r#"{
                "hosts": {
                    "github.com": [
                        { "state": "success", "login": " ray ", "active": true },
                        { "state": "failed", "login": "ignored", "active": true },
                        { "state": "success", "login": "", "active": false }
                    ],
                    "company.ghe.com": [
                        { "state": "success", "login": "team", "active": 1 }
                    ]
                }
            }"#,
        )
        .unwrap();
        assert_eq!(
            entries,
            vec![
                AuthEntry {
                    host: "github.com".into(),
                    login: "ray".into(),
                    active: true,
                },
                AuthEntry {
                    host: "company.ghe.com".into(),
                    login: "team".into(),
                    active: true,
                },
            ]
        );
    }

    #[test]
    fn preserves_github_clone_url_and_repository_name_rules() {
        for valid in [
            "https://github.com/owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
            "git@github.com:owner/repo.git",
            "git@company.ghe.com:owner/repo",
        ] {
            assert!(is_github_clone_url(valid), "{valid}");
        }
        for invalid in [
            "http://github.com/owner/repo",
            "https://gitlab.com/owner/repo",
            "git@company.example:owner/repo",
            "file:///tmp/repo",
        ] {
            assert!(!is_github_clone_url(invalid), "{invalid}");
        }
        assert_eq!(
            infer_repo_name(" git@github.com:owner/repository.git/// "),
            "repository"
        );
        assert_eq!(
            infer_repo_name("https://github.com/owner/repository.git"),
            "repository"
        );
    }

    #[test]
    fn matches_javascript_limit_conversion_and_cached_slice_behavior() {
        assert_eq!(javascript_number(""), 0.0);
        assert!(javascript_number("invalid").is_nan());
        assert_eq!(
            javascript_minimum(javascript_number("Infinity"), 100.0),
            100.0
        );
        assert!(javascript_minimum(javascript_number("invalid"), 100.0).is_nan());
        assert_eq!(javascript_number_string(f64::NAN), "NaN");
        assert_eq!(javascript_number_string(f64::NEG_INFINITY), "-Infinity");

        let repos = (0..4)
            .map(|index| GithubRepo {
                name: index.to_string(),
                full_name: index.to_string(),
                description: None,
                html_url: String::new(),
                language: None,
                stargazers_count: 0.0,
                updated_at: String::new(),
                private: false,
            })
            .collect::<Vec<_>>();
        assert_eq!(javascript_slice(&repos, 2.9).len(), 2);
        assert_eq!(javascript_slice(&repos, -1.0).len(), 3);
        assert!(javascript_slice(&repos, f64::NAN).is_empty());
    }

    #[test]
    fn detects_logged_out_errors_and_quotes_applescript() {
        assert!(is_logged_out("You are not logged in to any GitHub hosts"));
        assert!(is_logged_out("Run gh auth login"));
        assert!(!is_logged_out("network unavailable"));
        assert_eq!(quote_apple_script("a\\b\"c"), "a\\\\b\\\"c");
    }
}
