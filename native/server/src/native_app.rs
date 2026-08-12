use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};

use super::{ServerState, json_response, request_json};

const DEFAULT_RELEASE_REPO: &str = "raymondreaming/inferay";
const RELEASE_CHECK_TIMEOUT: Duration = Duration::from_millis(1_500);
const RELEASE_CHECK_CACHE_TTL_MS: u64 = 15 * 60 * 1_000;
const RELEASE_CHECK_ERROR_TTL_MS: u64 = 60 * 1_000;

#[derive(Clone)]
pub(super) struct ReleaseCheckCache {
    key: String,
    expires_at: u64,
    info: AppUpdateInfo,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInfo {
    available: bool,
    current_version: String,
    latest_version: Option<String>,
    url: Option<String>,
    checked_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct AppInfo {
    name: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<String>,
    channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    identifier: Option<String>,
    production: bool,
    update: AppUpdateInfo,
}

pub(super) fn is_route(path: &str, method: &Method) -> bool {
    matches!(
        (path, method),
        ("/api/app-info", &Method::GET)
            | ("/api/native/open-path", &Method::POST)
            | ("/api/native/update", &Method::POST)
    )
}

pub(super) async fn handle_request(state: &ServerState, path: &str, request: Request) -> Response {
    let headers = request.headers().clone();
    match path {
        "/api/app-info" => {
            let info = load_app_info(state).await;
            json_response(StatusCode::OK, json!(info), &headers)
        }
        "/api/native/open-path" => open_path_route(state, request, &headers).await,
        "/api/native/update" => update_route(&headers),
        _ => unreachable!("native application handler called for an unknown route"),
    }
}

async fn load_app_info(state: &ServerState) -> AppInfo {
    let app_root = state.allowed_paths.project_root();
    let version_candidates = [
        app_root.join("version.json"),
        app_root.parent().unwrap_or(app_root).join("version.json"),
    ];
    let mut version_info = None;
    for path in version_candidates {
        version_info = read_app_info_json(&path).await;
        if version_info.is_some() {
            break;
        }
    }

    if let Some(version_info) = version_info {
        let version = value_or_default(version_info.get("version"), "dev");
        let channel = value_or_default(version_info.get("channel"), "stable");
        let name = value_or_default(version_info.get("name"), "inferay");
        let hash = version_info
            .get("hash")
            .and_then(Value::as_str)
            .map(str::to_string);
        let identifier = version_info
            .get("identifier")
            .and_then(Value::as_str)
            .map(str::to_string);
        let production = identifier.as_deref() == Some("com.inferay.app");
        let update = load_update_info(state, &version, &channel).await;
        return AppInfo {
            name,
            version,
            hash,
            channel,
            identifier,
            production,
            update,
        };
    }

    let package = read_app_info_json(&app_root.join("packages/inferay/package.json")).await;
    let version = package
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("dev")
        .to_string();
    let channel = "stable".to_string();
    let update = load_update_info(state, &version, &channel).await;
    AppInfo {
        name: "inferay".into(),
        version,
        hash: None,
        channel,
        identifier: None,
        production: false,
        update,
    }
}

async fn read_app_info_json(path: &Path) -> Option<Value> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    value.is_object().then_some(value)
}

fn value_or_default(value: Option<&Value>, fallback: &str) -> String {
    value
        .filter(|value| javascript_truthy(value))
        .map(javascript_string)
        .unwrap_or_else(|| fallback.to_string())
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

fn javascript_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| match value {
                Value::Null => String::new(),
                _ => javascript_string(value),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

async fn load_update_info(
    state: &ServerState,
    current_version: &str,
    channel: &str,
) -> AppUpdateInfo {
    let cache_key = format!("{current_version}:{channel}");
    let now = epoch_millis();
    if let Some(cache) = state.release_check_cache.lock().await.as_ref()
        && cache.key == cache_key
        && cache.expires_at > now
    {
        return cache.info.clone();
    }

    let checked_at = now;
    let result = fetch_release_info(state, current_version, channel, checked_at).await;
    let ttl = if result.error.is_some() {
        RELEASE_CHECK_ERROR_TTL_MS
    } else {
        RELEASE_CHECK_CACHE_TTL_MS
    };
    *state.release_check_cache.lock().await = Some(ReleaseCheckCache {
        key: cache_key,
        expires_at: epoch_millis().saturating_add(ttl),
        info: result.clone(),
    });
    result
}

async fn fetch_release_info(
    state: &ServerState,
    current_version: &str,
    channel: &str,
    checked_at: u64,
) -> AppUpdateInfo {
    let result = async {
        let response = state
            .client
            .get(release_api_url(state, channel))
            .header("accept", "application/vnd.github+json")
            .header("user-agent", "inferay-app")
            .timeout(RELEASE_CHECK_TIMEOUT)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "release check failed ({})",
                response.status().as_u16()
            ));
        }
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        let release: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        let latest_version = release
            .get("tag_name")
            .and_then(Value::as_str)
            .map(|version| version.strip_prefix('v').unwrap_or(version).to_string());
        let url = release
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_string);
        Ok((latest_version, url))
    }
    .await;

    match result {
        Ok((latest_version, url)) => AppUpdateInfo {
            available: latest_version
                .as_deref()
                .is_some_and(|candidate| is_newer_version(candidate, current_version)),
            current_version: current_version.to_string(),
            latest_version,
            url,
            checked_at,
            error: None,
        },
        Err(error) => AppUpdateInfo {
            available: false,
            current_version: current_version.to_string(),
            latest_version: None,
            url: None,
            checked_at,
            error: Some(error),
        },
    }
}

fn release_api_url(state: &ServerState, channel: &str) -> String {
    state
        .release_api_url
        .clone()
        .or_else(|| {
            std::env::var("INFERAY_RELEASE_URL")
                .ok()
                .filter(|url| !url.is_empty())
        })
        .unwrap_or_else(|| {
            let repository = std::env::var("INFERAY_RELEASE_REPO")
                .ok()
                .filter(|repository| !repository.is_empty())
                .unwrap_or_else(|| DEFAULT_RELEASE_REPO.to_string());
            if channel == "stable" {
                format!("https://api.github.com/repos/{repository}/releases/latest")
            } else {
                format!("https://api.github.com/repos/{repository}/releases/tags/{channel}")
            }
        })
}

fn parse_version(value: &str) -> Option<[u64; 3]> {
    let regex = Regex::new(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")
        .expect("static semantic-version regex must compile");
    let captures = regex.captures(value.trim())?;
    Some([
        captures.get(1)?.as_str().parse().ok()?,
        captures.get(2)?.as_str().parse().ok()?,
        captures.get(3)?.as_str().parse().ok()?,
    ])
}

fn is_newer_version(candidate: &str, current: &str) -> bool {
    let (Some(candidate), Some(current)) = (parse_version(candidate), parse_version(current))
    else {
        return false;
    };
    candidate > current
}

async fn open_path_route(state: &ServerState, request: Request, headers: &HeaderMap) -> Response {
    let body: Value = match request_json(request, headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(path) = body.get("path").and_then(Value::as_str) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing path" }),
            headers,
        );
    };
    if path.trim().is_empty() {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing path" }),
            headers,
        );
    }
    let Some(path) = state.allowed_paths.resolve_allowed_local_path(path) else {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Access denied" }),
            headers,
        );
    };
    let reveal = body.get("reveal").is_some_and(javascript_truthy);
    match open_native_path(&path, reveal).await {
        Ok(ok) => json_response(StatusCode::OK, json!({ "ok": ok }), headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            headers,
        ),
    }
}

async fn open_native_path(path: &Path, reveal: bool) -> Result<bool, String> {
    let path = path.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    let (program, args) = if reveal {
        ("open", vec!["-R".to_string(), path])
    } else {
        ("open", vec![path])
    };

    #[cfg(target_os = "windows")]
    let (program, args) = if reveal {
        ("explorer.exe", vec![format!("/select,{path}")])
    } else {
        ("explorer.exe", vec![path])
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (program, args) = if reveal {
        let parent = Path::new(&path)
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .filter(|parent| !parent.is_empty())
            .unwrap_or(path);
        ("xdg-open", vec![parent])
    } else {
        ("xdg-open", vec![path])
    };

    let status = tokio::process::Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| error.to_string())?;
    Ok(status.success())
}

fn update_route(headers: &HeaderMap) -> Response {
    match run_inferay_update() {
        Ok(log_path) => json_response(
            StatusCode::OK,
            json!({
                "ok": true,
                "logPath": log_path,
                "message": "Updating Inferay. The app will relaunch when installation finishes.",
            }),
            headers,
        ),
        Err(error) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "ok": false, "error": error }),
            headers,
        ),
    }
}

fn run_inferay_update() -> Result<String, String> {
    let environment = update_environment();
    let probe = std::process::Command::new("/bin/zsh")
        .args([
            "-lc",
            "command -v npx >/dev/null 2>&1 || command -v bunx >/dev/null 2>&1",
        ])
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .status();
    if !probe.is_ok_and(|status| status.success()) {
        return Err("npx or bunx is required to update Inferay".into());
    }

    let log_path = std::env::temp_dir().join(format!("inferay-update-{}.log", epoch_millis()));
    let update_command = create_update_command(std::process::id());
    let command = format!(
        "nohup /bin/zsh -lc {} >{} 2>&1 </dev/null &",
        shell_quote(&update_command),
        shell_quote(&log_path.to_string_lossy())
    );
    std::process::Command::new("/bin/zsh")
        .args(["-lc", &command])
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(log_path.to_string_lossy().into_owned())
}

fn create_update_command(app_pid: u32) -> String {
    let relaunch = format!(
        "(kill -TERM {app_pid} 2>/dev/null || true; while kill -0 {app_pid} 2>/dev/null; do sleep 0.1; done; open /Applications/inferay.app)"
    );
    format!(
        "if command -v npx >/dev/null 2>&1; then npx --yes inferay update && {relaunch} && exit 0; fi; if command -v bunx >/dev/null 2>&1; then bunx inferay update && {relaunch} && exit 0; fi; echo 'npx or bunx is required to update Inferay' >&2; exit 127;"
    )
}

fn update_environment() -> Vec<(OsString, OsString)> {
    let mut environment = std::env::vars_os().collect::<Vec<_>>();
    let path = create_inferay_update_path(environment.iter().map(|(key, value)| {
        (
            key.to_string_lossy().into_owned(),
            value.to_string_lossy().into_owned(),
        )
    }));
    if let Some((_, value)) = environment
        .iter_mut()
        .find(|(key, _)| key == OsStr::new("PATH"))
    {
        *value = OsString::from(path);
    } else {
        environment.push((OsString::from("PATH"), OsString::from(path)));
    }
    environment
}

fn create_inferay_update_path<I, K, V>(env: I) -> String
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<str>,
    V: AsRef<str>,
{
    let env = env
        .into_iter()
        .map(|(key, value)| (key.as_ref().to_string(), value.as_ref().to_string()))
        .collect::<std::collections::HashMap<_, _>>();
    let home = ["HOME", "USERPROFILE", "HOMEPATH"]
        .into_iter()
        .filter_map(|key| env.get(key).map(String::as_str))
        .find(|value| !value.is_empty());
    let delimiter = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let mut values = env
        .get("PATH")
        .map(String::as_str)
        .unwrap_or_default()
        .split(delimiter)
        .map(str::to_string)
        .collect::<Vec<_>>();
    values.extend(env.get("NVM_BIN").map(String::as_str).map(str::to_string));
    if let Some(home) = home {
        values.extend([
            Path::new(home)
                .join(".bun/bin")
                .to_string_lossy()
                .into_owned(),
            Path::new(home)
                .join(".local/bin")
                .to_string_lossy()
                .into_owned(),
            Path::new(home)
                .join(".npm-global/bin")
                .to_string_lossy()
                .into_owned(),
        ]);
        values.extend(nvm_bin_directories(home));
    }
    values.extend([
        "/opt/homebrew/bin".into(),
        "/opt/homebrew/sbin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
    ]);
    unique_strings(values).join(delimiter)
}

fn nvm_bin_directories(home: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(Path::new(home).join(".nvm/versions/node")) else {
        return Vec::new();
    };
    let mut versions = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    versions.sort();
    versions.reverse();
    versions
        .into_iter()
        .map(|version| {
            Path::new(home)
                .join(".nvm/versions/node")
                .join(version)
                .join("bin")
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

fn unique_strings(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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
    fn compares_versions_with_the_existing_three_part_contract() {
        assert!(is_newer_version("v1.2.4", "1.2.3"));
        assert!(is_newer_version("1.3.0-nightly", "1.2.99"));
        assert!(!is_newer_version("1.2.3+build", "v1.2.3"));
        assert!(!is_newer_version("1.2", "1.1.9"));
        assert!(!is_newer_version("dev", "0.1.0"));
    }

    #[test]
    fn creates_the_same_update_path_and_safe_relaunch_command() {
        let path = create_inferay_update_path([("HOME", "/Users/ray"), ("PATH", "/usr/bin:/bin")]);
        let entries = path.split(':').collect::<Vec<_>>();
        assert!(entries.contains(&"/Users/ray/.bun/bin"));
        assert!(entries.contains(&"/Users/ray/.local/bin"));
        assert!(entries.contains(&"/Users/ray/.npm-global/bin"));
        assert!(entries.contains(&"/opt/homebrew/bin"));
        assert!(entries.contains(&"/usr/local/bin"));
        assert!(entries.contains(&"/usr/bin"));

        let command = create_update_command(42);
        assert!(command.contains("command -v npx"));
        assert!(command.contains("npx --yes inferay update"));
        assert!(command.contains("command -v bunx"));
        assert!(command.contains("bunx inferay update"));
        assert!(command.contains("kill -TERM 42"));
        assert!(command.contains("while kill -0 42"));
        assert!(command.contains("open /Applications/inferay.app"));
        assert!(command.find("npx --yes inferay update") < command.find("bunx inferay update"));
        assert!(command.find("npx --yes inferay update") < command.find("kill -TERM 42"));
    }

    #[test]
    fn quotes_update_commands_like_the_typescript_launcher() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
