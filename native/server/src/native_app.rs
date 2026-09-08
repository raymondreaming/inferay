use crate::unix_millis as epoch_millis;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};

use super::{ServerState, json_response};

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInfo {
    available: bool,
    current_version: String,
    latest_version: Option<String>,
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    error: Option<String>,
}

#[derive(Debug, Serialize, ts_rs::TS)]
pub(super) struct AppInfo {
    name: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    hash: Option<String>,
    channel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    identifier: Option<String>,
    production: bool,
    update: AppUpdateInfo,
}

pub(super) async fn load_app_info(state: &ServerState) -> AppInfo {
    let root = state.allowed_paths.project_root();
    let mut metadata = None;
    for path in [
        root.join("version.json"),
        root.parent().unwrap_or(root).join("version.json"),
    ] {
        metadata = read_app_info_json(&path).await;
        if metadata.is_some() {
            break;
        }
    }
    let metadata = match metadata {
        Some(value) => value,
        None => {
            let package = read_app_info_json(&root.join("packages/inferay/package.json"))
                .await
                .unwrap_or(Value::Null);
            json!({"version":package["version"]})
        }
    };
    let text = |key: &str, fallback: &str| {
        metadata[key]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
            .to_owned()
    };
    let version = text("version", "dev");
    let channel = text("channel", "stable");
    let identifier = metadata["identifier"].as_str().map(str::to_owned);
    let update = load_update_info(state, &version, &channel).await;
    AppInfo {
        name: text("name", "inferay"),
        version,
        channel,
        update,
        production: identifier.as_deref() == Some("com.inferay.app"),
        hash: metadata["hash"].as_str().map(str::to_owned),
        identifier,
    }
}

async fn read_app_info_json(path: &Path) -> Option<Value> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    value.is_object().then_some(value)
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

    let result = fetch_release_info(state, current_version, channel).await;
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
            error: None,
        },
        Err(error) => AppUpdateInfo {
            available: false,
            current_version: current_version.to_string(),
            latest_version: None,
            url: None,
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

struct UpdateJob {
    child: Child,
    log_path: PathBuf,
}

static UPDATE_JOB: OnceLock<Mutex<Option<UpdateJob>>> = OnceLock::new();

fn update_jobs() -> &'static Mutex<Option<UpdateJob>> {
    UPDATE_JOB.get_or_init(|| Mutex::new(None))
}

fn job_status(job: &mut UpdateJob) -> Value {
    match job.child.try_wait() {
        Ok(None) => json!({ "status": "updating" }),
        Ok(Some(exit)) if exit.success() => json!({ "status": "complete" }),
        result => {
            let reason = match result {
                Ok(Some(exit)) => format!("Updater exited with {exit}"),
                Err(error) => format!("Could not check updater: {error}"),
                _ => unreachable!(),
            };
            let mut log = String::new();
            if let Ok(mut file) = std::fs::File::open(&job.log_path) {
                let _ = file
                    .seek(SeekFrom::End(-8192))
                    .or_else(|_| file.seek(SeekFrom::Start(0)));
                let mut bytes = Vec::new();
                let _ = file.take(8192).read_to_end(&mut bytes);
                let text = String::from_utf8_lossy(&bytes);
                log = text
                    .lines()
                    .find(|line| line.starts_with("inferay:"))
                    .or_else(|| text.lines().rev().find(|line| !line.trim().is_empty()))
                    .unwrap_or_default()
                    .chars()
                    .take(800)
                    .collect();
            }
            json!({
                "status": "error",
                "error": if log.is_empty() { reason } else { log },
                "logPath": job.log_path,
            })
        }
    }
}

pub(super) fn update_status_route(headers: &HeaderMap) -> Response {
    let mut jobs = update_jobs().lock().unwrap_or_else(|e| e.into_inner());
    let status = jobs
        .as_mut()
        .map(job_status)
        .unwrap_or_else(|| json!({ "status": "idle" }));
    json_response(StatusCode::OK, status, headers)
}

pub(super) fn update_route(headers: &HeaderMap) -> Response {
    let mut jobs = update_jobs().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(job) = jobs.as_mut()
        && job_status(job)["status"] == "updating"
    {
        return json_response(StatusCode::OK, json!({ "status": "updating" }), headers);
    }
    match run_inferay_update() {
        Ok(job) => {
            *jobs = Some(job);
            json_response(StatusCode::OK, json!({ "status": "updating" }), headers)
        }
        Err(error) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "status": "error", "error": error }),
            headers,
        ),
    }
}

fn run_inferay_update() -> Result<UpdateJob, String> {
    let path = create_inferay_update_path(std::env::vars_os().map(|(key, value)| {
        (
            key.to_string_lossy().into_owned(),
            value.to_string_lossy().into_owned(),
        )
    }));
    let log_path = std::env::temp_dir().join(format!("inferay-update-{}.log", epoch_millis()));
    let log = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    // Keep the real updater child so the UI can observe its exit status. nohup
    // lets the relaunch helper survive the old app exiting after installation.
    let child = std::process::Command::new("nohup")
        .args([
            "/bin/zsh",
            "-lc",
            &create_update_command(std::process::id()),
        ])
        .env("PATH", &path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(UpdateJob { child, log_path })
}

fn create_update_command(app_pid: u32) -> String {
    // Choose an available runner once. An install failure must not trigger a
    // second download through an older cached CLI or masquerade as missing npm.
    format!(
        "if command -v npx >/dev/null 2>&1; then npx --yes inferay@latest update --no-launch; elif command -v bunx >/dev/null 2>&1; then bunx inferay@latest update --no-launch; else echo 'npx or bunx is required to update Inferay' >&2; exit 127; fi; result=$?; if [ \"$result\" -ne 0 ]; then exit \"$result\"; fi; kill -TERM {app_pid} 2>/dev/null || true; for attempt in {{1..100}}; do if ! kill -0 {app_pid} 2>/dev/null; then exec open /Applications/inferay.app; fi; sleep 0.1; done; echo 'Installed Inferay, but the old app did not quit. Quit and reopen Inferay.' >&2; exit 1;"
    )
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
        values.extend(
            [".bun/bin", ".local/bin", ".npm-global/bin"]
                .map(|suffix| Path::new(home).join(suffix).to_string_lossy().into_owned()),
        );
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

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn failed_updater_reports_its_exit_and_log() {
        let log_path =
            std::env::temp_dir().join(format!("inferay-update-test-{}.log", uuid::Uuid::new_v4()));
        let log = std::fs::File::create(&log_path).unwrap();
        let child = std::process::Command::new("/bin/sh")
            .args(["-c", "echo 'Install failed: disk full' >&2; exit 7"])
            .stderr(Stdio::from(log))
            .spawn()
            .unwrap();
        let mut job = UpdateJob {
            child,
            log_path: log_path.clone(),
        };
        job.child.wait().unwrap();
        let status = job_status(&mut job);
        assert_eq!(status["status"], "error");
        assert!(status["error"].as_str().unwrap().contains("disk full"));
        std::fs::remove_file(log_path).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn failed_install_does_not_retry_or_relaunch() {
        use std::os::unix::fs::PermissionsExt;
        let root =
            std::env::temp_dir().join(format!("inferay-update-runner-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        for (name, script) in [
            (
                "npx",
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$UPDATE_TEST_DIR/args\"\nexit 17\n",
            ),
            ("bunx", "#!/bin/sh\ntouch \"$UPDATE_TEST_DIR/retried\"\n"),
            ("open", "#!/bin/sh\ntouch \"$UPDATE_TEST_DIR/opened\"\n"),
        ] {
            let path = root.join(name);
            std::fs::write(&path, script).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let run = || {
            std::process::Command::new("/bin/zsh")
                .args(["-c", &create_update_command(999_999_999)])
                .env("PATH", format!("{}:/usr/bin:/bin", root.display()))
                .env("UPDATE_TEST_DIR", &root)
                .status()
                .unwrap()
        };
        assert_eq!(run().code(), Some(17));
        assert!(!root.join("retried").exists());
        assert!(!root.join("opened").exists());
        let args = std::fs::read_to_string(root.join("args")).unwrap();
        assert!(args.contains("inferay@latest\nupdate\n--no-launch"));
        std::fs::write(root.join("npx"), "#!/bin/sh\nexit 0\n").unwrap();
        assert!(run().success());
        assert!(root.join("opened").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
