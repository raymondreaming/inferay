use crate::unix_millis as epoch_millis;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::extract::Request;
use futures_util::future::join_all;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use url::Url;

use super::{
    ApiResult, ServerState, api_body, query_value, required, resolve_lexically, safe_limit,
};

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
    limit: usize,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
struct GithubRepo {
    #[serde(rename(deserialize = "nameWithOwner"))]
    full_name: String,
    description: Option<String>,
    #[serde(rename(deserialize = "url"))]
    html_url: String,
    #[serde(
        default,
        rename(deserialize = "primaryLanguage"),
        deserialize_with = "primary_language"
    )]
    language: Option<String>,
    #[serde(rename(deserialize = "isPrivate"))]
    private: bool,
}

fn primary_language<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    #[derive(Deserialize)]
    struct Language {
        name: Option<String>,
    }
    Option::<Language>::deserialize(deserializer)
        .map(|language| language.and_then(|language| language.name))
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

pub(super) async fn handle_request(state: &ServerState, path: &str, request: Request) -> ApiResult {
    match path {
        "/api/forge/accounts" => {
            if query_has_key(&request, "refresh") {
                *state.forge_state.accounts_cache.lock().await = None;
            }
            let accounts = list_github_accounts(state)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({"accounts":accounts}))
        }
        "/api/forge/repos" => {
            let limit = safe_limit(
                query_value(&request, "limit").as_deref().unwrap_or("30"),
                30,
                100,
            );
            Ok(json!({"repos":list_github_repos(state, limit).await}))
        }
        "/api/forge/commit-avatars" => {
            let body: Value = api_body(request).await?;
            let hashes = body["hashes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|hash| {
                    (7..=64).contains(&hash.len())
                        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .take(100)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let cwd = required(
                state
                    .allowed_paths
                    .resolve_allowed_local_path(body["cwd"].as_str().unwrap_or_default()),
                "Repository is outside allowed local roots",
            )?;
            let avatars = resolve_commit_avatars(state, &cwd, &hashes)
                .await
                .unwrap_or_default();
            Ok(json!({"avatars":avatars}))
        }
        "/api/forge/clone" => {
            let body: Value = api_body(request).await?;
            let git_url = required(
                body["gitUrl"].as_str().filter(|s| !s.trim().is_empty()),
                "Missing Git URL",
            )?;
            let directory = required(
                body["cloneDirectory"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty()),
                "Missing clone location",
            )?;
            let (path, display_path) = clone_repository(state, git_url, directory).await?;
            Ok(json!({"ok":true, "path":path, "displayPath":display_path}))
        }
        "/api/forge/connect" => {
            let body: Value = api_body(request).await?;
            if body
                .get("provider")
                .is_some_and(|value| !value.is_null() && value != "github")
            {
                return Err(super::api_error(
                    super::StatusCode::BAD_REQUEST,
                    "Only GitHub connect is supported right now",
                ));
            }
            let ok = open_github_login(state).await.map_err(|e| e.to_string())?;
            Ok(json!({"ok":ok}))
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
    let mut accounts = parse_auth_entries(&output).map_err(parse_error)?;
    join_all(accounts.iter_mut().map(fetch_github_profile)).await;
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

fn parse_auth_entries(output: &str) -> Result<Vec<ForgeAccount>, String> {
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
            entries.push(ForgeAccount {
                provider: "github",
                name: None,
                avatar_url: None,
                email: None,
                host: host.clone(),
                login: login.to_string(),
                active: account["active"].as_bool().unwrap_or(false),
            });
        }
    }
    Ok(entries)
}

async fn fetch_github_profile(account: &mut ForgeAccount) {
    let endpoint = format!("/users/{}", account.login);
    let Ok(output) = run_gh(
        &[
            "api",
            "--hostname",
            &account.host,
            "-H",
            "Accept: application/vnd.github+json",
            &endpoint,
        ],
        15_000,
    )
    .await
    else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&output) else {
        return;
    };
    account.name = trimmed_optional_string(value.get("name"));
    account.avatar_url = value
        .get("avatar_url")
        .and_then(Value::as_str)
        .map(str::to_string);
    account.email = trimmed_optional_string(value.get("email"));
}

async fn list_github_repos(state: &ServerState, limit: usize) -> Vec<GithubRepo> {
    let now = epoch_millis();
    if let Some(cache) = state.forge_state.repos_cache.lock().await.as_ref()
        && cache.limit >= limit
        && now.saturating_sub(cache.cached_at) < REPOS_CACHE_TTL_MS
    {
        return cache.value.iter().take(limit).cloned().collect();
    }

    let result = async {
        let accounts = list_github_accounts(state).await?;
        let active = accounts
            .iter()
            .find(|account| account.active)
            .or_else(|| accounts.first());
        let mut arguments = vec!["repo", "list"];
        if let Some(account) = active {
            arguments.push(&account.login);
        }
        let limit = limit.to_string();
        arguments.extend([
            "--json",
            "description,url,primaryLanguage,isPrivate,nameWithOwner",
            "--limit",
            &limit,
        ]);
        let output = run_gh(&arguments, 20_000).await?;
        serde_json::from_str::<Vec<GithubRepo>>(&output).map_err(parse_error)
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
        run_command(Path::new("osascript"), &["-e", &script], None, 10_000).await?;
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
            .map_err(parse_error)?;
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
    let manager = state.config_manager.lock().await;
    let current = manager.search_folders()?;
    let folder_text = folder.to_string_lossy().into_owned();
    let shown = display_path(state.allowed_paths.home_directory(), folder);
    if current.contains(&shown) || current.contains(&folder_text) {
        return Ok(());
    }
    let mut next = current;
    next.push(shown);
    manager.set_search_folders(next)?;
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
    run_command(&resolve_gh_binary(), arguments, None, timeout_ms).await
}

async fn run_git(
    arguments: &[&str],
    cwd: Option<&Path>,
    timeout_ms: u64,
) -> Result<String, CommandError> {
    run_command(Path::new("git"), arguments, cwd, timeout_ms).await
}

async fn run_command(
    program: &Path,
    arguments: &[&str],
    cwd: Option<&Path>,
    timeout_ms: u64,
) -> Result<String, CommandError> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .env("PATH", tool_path())
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
        .map_err(parse_error)?;
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
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| PathBuf::from("gh"))
}

fn tool_path() -> OsString {
    let existing = std::env::var_os("PATH").unwrap_or_default();
    std::env::join_paths(
        TOOL_PATHS
            .iter()
            .map(PathBuf::from)
            .chain(std::env::split_paths(&existing)),
    )
    .unwrap_or(existing)
}

fn query_has_key(request: &Request, key: &str) -> bool {
    url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .any(|(name, _)| name == key)
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
