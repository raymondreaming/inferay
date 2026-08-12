use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{
    MAX_PROXY_BODY_BYTES, ServerState, SimulatorBuildTarget, expand_simulator_home,
    find_simulator_build_targets, json_response, simulator_error_response,
    simulator_workspace_paths,
};
use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::process::Command;

const BAGUETTE_PORT: u16 = 8421;
const BAGUETTE_HOST: &str = "127.0.0.1";
const BAGUETTE_BASE_URL: &str = "http://127.0.0.1:8421";

const ROUTES: [(&str, Method); 9] = [
    ("/api/simulator/list", Method::GET),
    ("/api/simulator/projects", Method::GET),
    ("/api/simulator/baguette/status", Method::GET),
    ("/api/simulator/baguette/start", Method::POST),
    ("/api/simulator/boot", Method::POST),
    ("/api/simulator/shutdown", Method::POST),
    ("/api/simulator/open", Method::POST),
    ("/api/simulator/open-xcode", Method::POST),
    ("/api/simulator/build-launch", Method::POST),
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorDevice {
    pub udid: String,
    pub name: String,
    pub state: String,
    pub runtime: String,
    pub is_available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct InstalledSimulatorApp {
    bundle_id: String,
    display_name: Option<String>,
    name: Option<String>,
    executable: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorProject {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ios_path: Option<String>,
    pub schemes: Vec<String>,
    pub default_scheme: String,
    pub bundle_id: Option<String>,
    pub booted_device_udid: Option<String>,
    pub installed: bool,
    pub running: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildLaunchResult {
    pub project_path: String,
    pub scheme: String,
    pub bundle_id: Option<String>,
    pub app_bundle_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaguetteStatus {
    pub installed: bool,
    pub running: bool,
    pub port: u16,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SimulatorError(String);

impl SimulatorError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SimulatorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for SimulatorError {}

pub type SimulatorFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, SimulatorError>> + Send + 'a>>;

/// Transport-free seam over the existing simulator command and process owner.
pub trait SimulatorBackend: Send + Sync + 'static {
    fn list_devices(&self) -> SimulatorFuture<'_, Vec<SimulatorDevice>>;
    fn list_projects(&self) -> SimulatorFuture<'_, Vec<SimulatorProject>>;
    fn baguette_status(&self) -> SimulatorFuture<'_, BaguetteStatus>;
    fn start_baguette(&self) -> SimulatorFuture<'_, BaguetteStatus>;
    fn boot(&self, udid: String) -> SimulatorFuture<'_, ()>;
    fn shutdown(&self, udid: String) -> SimulatorFuture<'_, ()>;
    fn open(&self, udid: Option<String>) -> SimulatorFuture<'_, ()>;
    fn open_xcode(&self, app_path: String) -> SimulatorFuture<'_, Option<String>>;
    fn build_launch(
        &self,
        app_path: String,
        udid: String,
        scheme: Option<String>,
    ) -> SimulatorFuture<'_, BuildLaunchResult>;
}

/// Cloneable simulator facade used directly by native clients and the HTTP adapter.
/// Every operation is dispatched onto the server-owned Tokio runtime because
/// Direct client tasks do not themselves run inside that runtime.
#[derive(Clone)]
pub struct SimulatorService {
    backend: Arc<dyn SimulatorBackend>,
    owner: tokio::runtime::Handle,
}

impl SimulatorService {
    pub fn new(backend: Arc<dyn SimulatorBackend>) -> Self {
        Self {
            backend,
            owner: tokio::runtime::Handle::current(),
        }
    }

    async fn dispatch<T, F>(&self, future: F) -> Result<T, SimulatorError>
    where
        T: Send + 'static,
        F: Future<Output = Result<T, SimulatorError>> + Send + 'static,
    {
        self.owner
            .spawn(future)
            .await
            .map_err(|error| SimulatorError::new(format!("simulator runtime stopped: {error}")))?
    }

    pub async fn list_devices(&self) -> Result<Vec<SimulatorDevice>, SimulatorError> {
        let backend = self.backend.clone();
        self.dispatch(async move { backend.list_devices().await })
            .await
    }

    pub async fn list(&self) -> Result<Vec<SimulatorDevice>, SimulatorError> {
        self.list_devices().await
    }

    pub async fn list_projects(&self) -> Result<Vec<SimulatorProject>, SimulatorError> {
        let backend = self.backend.clone();
        self.dispatch(async move { backend.list_projects().await })
            .await
    }

    pub async fn baguette_status(&self) -> Result<BaguetteStatus, SimulatorError> {
        let backend = self.backend.clone();
        self.dispatch(async move { backend.baguette_status().await })
            .await
    }

    pub async fn status(&self) -> Result<BaguetteStatus, SimulatorError> {
        self.baguette_status().await
    }

    pub async fn start_baguette(&self) -> Result<BaguetteStatus, SimulatorError> {
        let backend = self.backend.clone();
        self.dispatch(async move { backend.start_baguette().await })
            .await
    }

    pub async fn boot(&self, udid: impl Into<String>) -> Result<(), SimulatorError> {
        let backend = self.backend.clone();
        let udid = udid.into();
        self.dispatch(async move { backend.boot(udid).await }).await
    }

    pub async fn shutdown(&self, udid: impl Into<String>) -> Result<(), SimulatorError> {
        let backend = self.backend.clone();
        let udid = udid.into();
        self.dispatch(async move { backend.shutdown(udid).await })
            .await
    }

    pub async fn open(&self, udid: Option<String>) -> Result<(), SimulatorError> {
        let backend = self.backend.clone();
        self.dispatch(async move { backend.open(udid).await }).await
    }

    pub async fn open_xcode(
        &self,
        app_path: impl Into<String>,
    ) -> Result<Option<String>, SimulatorError> {
        let backend = self.backend.clone();
        let app_path = app_path.into();
        self.dispatch(async move { backend.open_xcode(app_path).await })
            .await
    }

    pub async fn build_launch(
        &self,
        app_path: impl Into<String>,
        udid: impl Into<String>,
        scheme: Option<String>,
    ) -> Result<BuildLaunchResult, SimulatorError> {
        let backend = self.backend.clone();
        let app_path = app_path.into();
        let udid = udid.into();
        self.dispatch(async move { backend.build_launch(app_path, udid, scheme).await })
            .await
    }
}

#[derive(Clone)]
pub(crate) struct ServerSimulatorBackend {
    state: ServerState,
}

impl ServerSimulatorBackend {
    pub(crate) fn new(state: ServerState) -> Self {
        Self { state }
    }
}

impl SimulatorBackend for ServerSimulatorBackend {
    fn list_devices(&self) -> SimulatorFuture<'_, Vec<SimulatorDevice>> {
        Box::pin(async { list_simulators().await.map_err(SimulatorError::new) })
    }

    fn list_projects(&self) -> SimulatorFuture<'_, Vec<SimulatorProject>> {
        Box::pin(async {
            list_simulator_projects(&self.state)
                .await
                .map_err(SimulatorError::new)
        })
    }

    fn baguette_status(&self) -> SimulatorFuture<'_, BaguetteStatus> {
        Box::pin(async { Ok(baguette_status(&self.state).await) })
    }

    fn start_baguette(&self) -> SimulatorFuture<'_, BaguetteStatus> {
        Box::pin(async { Ok(start_baguette_server(&self.state).await) })
    }

    fn boot(&self, udid: String) -> SimulatorFuture<'_, ()> {
        Box::pin(async move { boot_simulator(&udid).await.map_err(SimulatorError::new) })
    }

    fn shutdown(&self, udid: String) -> SimulatorFuture<'_, ()> {
        Box::pin(async move { shutdown_simulator(&udid).await.map_err(SimulatorError::new) })
    }

    fn open(&self, udid: Option<String>) -> SimulatorFuture<'_, ()> {
        Box::pin(async move {
            open_simulator_app(udid.as_deref())
                .await
                .map_err(SimulatorError::new)
        })
    }

    fn open_xcode(&self, app_path: String) -> SimulatorFuture<'_, Option<String>> {
        Box::pin(async move {
            open_xcode_project(&self.state, &app_path)
                .await
                .map_err(SimulatorError::new)
        })
    }

    fn build_launch(
        &self,
        app_path: String,
        udid: String,
        scheme: Option<String>,
    ) -> SimulatorFuture<'_, BuildLaunchResult> {
        Box::pin(async move {
            build_install_launch_project(&self.state, &app_path, &udid, scheme.as_deref())
                .await
                .map_err(SimulatorError::new)
        })
    }
}

pub(super) fn is_route(path: &str, method: &Method) -> bool {
    ROUTES
        .iter()
        .any(|(route_path, route_method)| path == *route_path && method == route_method)
}

pub(super) async fn handle_request(
    service: &SimulatorService,
    path: &str,
    request: Request,
) -> Response {
    let headers = request.headers().clone();
    match path {
        "/api/simulator/list" => match service.list_devices().await {
            Ok(devices) => json_response(
                StatusCode::OK,
                json!({ "ok": true, "devices": devices }),
                &headers,
            ),
            Err(error) => simulator_error_response(
                error.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
                &headers,
            ),
        },
        "/api/simulator/projects" => match service.list_projects().await {
            Ok(projects) => json_response(
                StatusCode::OK,
                json!({ "ok": true, "projects": projects }),
                &headers,
            ),
            Err(error) => simulator_error_response(
                error.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
                &headers,
            ),
        },
        "/api/simulator/baguette/status" => match service.baguette_status().await {
            Ok(status) => json_response(StatusCode::OK, json!(status), &headers),
            Err(error) => simulator_error_response(
                error.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
                &headers,
            ),
        },
        "/api/simulator/baguette/start" => match service.start_baguette().await {
            Ok(status) => json_response(StatusCode::OK, json!(status), &headers),
            Err(error) => simulator_error_response(
                error.to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
                &headers,
            ),
        },
        "/api/simulator/boot" => {
            let body = match required_body(request, &headers, &["udid"]).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let udid = body["udid"].as_str().expect("validated string body field");
            match service.boot(udid).await {
                Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &headers),
                Err(error) => simulator_error_response(
                    error.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &headers,
                ),
            }
        }
        "/api/simulator/shutdown" => {
            let body = match required_body(request, &headers, &["udid"]).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let udid = body["udid"].as_str().expect("validated string body field");
            match service.shutdown(udid).await {
                Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &headers),
                Err(error) => simulator_error_response(
                    error.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &headers,
                ),
            }
        }
        "/api/simulator/open" => {
            let body = match simulator_request_json(request).await {
                Ok(body) => body,
                Err(error) => {
                    return simulator_error_response(
                        error,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        &headers,
                    );
                }
            };
            let udid = body.get("udid").and_then(Value::as_str);
            match service.open(udid.map(str::to_string)).await {
                Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &headers),
                Err(error) => simulator_error_response(
                    error.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &headers,
                ),
            }
        }
        "/api/simulator/open-xcode" => {
            let body = match required_body(request, &headers, &["appPath"]).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let app_path = body["appPath"]
                .as_str()
                .expect("validated string body field");
            match service.open_xcode(app_path).await {
                Ok(Some(project_path)) => json_response(
                    StatusCode::OK,
                    json!({ "ok": true, "projectPath": project_path }),
                    &headers,
                ),
                Ok(None) => simulator_error_response(
                    "No .xcodeproj found".into(),
                    StatusCode::NOT_FOUND,
                    &headers,
                ),
                Err(error) => simulator_error_response(
                    error.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &headers,
                ),
            }
        }
        "/api/simulator/build-launch" => {
            let body = match required_body(request, &headers, &["udid", "appPath"]).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            let udid = body["udid"].as_str().expect("validated string body field");
            let app_path = body["appPath"]
                .as_str()
                .expect("validated string body field");
            let scheme = body
                .get("scheme")
                .and_then(Value::as_str)
                .map(str::to_string);
            match service.build_launch(app_path, udid, scheme).await {
                Ok(result) => json_response(
                    StatusCode::OK,
                    json!({
                        "ok": true,
                        "projectPath": result.project_path,
                        "scheme": result.scheme,
                        "bundleId": result.bundle_id,
                        "appBundlePath": result.app_bundle_path,
                    }),
                    &headers,
                ),
                Err(error) => simulator_error_response(
                    error.to_string(),
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &headers,
                ),
            }
        }
        _ => unreachable!("simulator handler called for an unknown route"),
    }
}

async fn required_body(
    request: Request,
    headers: &HeaderMap,
    keys: &[&str],
) -> Result<Value, Response> {
    let body = simulator_request_json(request).await.map_err(|error| {
        simulator_error_response(error, StatusCode::INTERNAL_SERVER_ERROR, headers)
    })?;
    for key in keys {
        if body
            .get(*key)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(simulator_error_response(
                format!("{key} required"),
                StatusCode::BAD_REQUEST,
                headers,
            ));
        }
    }
    Ok(body)
}

async fn simulator_request_json(request: Request) -> Result<Value, String> {
    let bytes = to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES)
        .await
        .map_err(|_| "Payload too large".to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn baguette_candidates() -> Vec<String> {
    std::env::var("BAGUETTE_BIN")
        .ok()
        .filter(|candidate| !candidate.is_empty())
        .into_iter()
        .chain([
            "/opt/homebrew/bin/baguette".to_string(),
            "/usr/local/bin/baguette".to_string(),
            "baguette".to_string(),
        ])
        .collect()
}

async fn resolve_baguette_binary() -> Option<String> {
    for candidate in baguette_candidates() {
        let status = Command::new(&candidate)
            .arg("--help")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
        if status.is_ok_and(|status| status.success()) {
            return Some(candidate);
        }
    }
    None
}

async fn is_baguette_server_running(state: &ServerState) -> bool {
    tokio::time::timeout(
        Duration::from_millis(800),
        state
            .client
            .get(format!("{BAGUETTE_BASE_URL}/simulators.json"))
            .send(),
    )
    .await
    .is_ok_and(|result| result.is_ok_and(|response| response.status().is_success()))
}

fn baguette_status_from(binary: Option<&str>, running: bool) -> BaguetteStatus {
    BaguetteStatus {
        installed: binary.is_some(),
        running: binary.is_some() && running,
        port: BAGUETTE_PORT,
        base_url: BAGUETTE_BASE_URL.to_string(),
        error: binary
            .is_none()
            .then(|| "baguette is not installed".to_string()),
    }
}

async fn baguette_status(state: &ServerState) -> BaguetteStatus {
    let binary = resolve_baguette_binary().await;
    let running = if binary.is_some() {
        is_baguette_server_running(state).await
    } else {
        false
    };
    baguette_status_from(binary.as_deref(), running)
}

async fn start_baguette_server(state: &ServerState) -> BaguetteStatus {
    let binary = resolve_baguette_binary().await;
    let running = if binary.is_some() {
        is_baguette_server_running(state).await
    } else {
        false
    };
    let status = baguette_status_from(binary.as_deref(), running);
    if binary.is_none() || running {
        return status;
    }

    // The TypeScript service resolves the candidate again immediately before
    // spawning it. Preserve that behavior in case the executable changed.
    let Some(binary) = resolve_baguette_binary().await else {
        return status;
    };
    let child = Command::new(binary)
        .args([
            "serve",
            "--host",
            BAGUETTE_HOST,
            "--port",
            &BAGUETTE_PORT.to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Ok(child) = child {
        *state.simulator_baguette_process.lock().await = Some(child);
    } else {
        return BaguetteStatus {
            installed: true,
            running: false,
            port: BAGUETTE_PORT,
            base_url: BAGUETTE_BASE_URL.to_string(),
            error: Some("baguette serve did not become ready".to_string()),
        };
    }

    for _ in 0..15 {
        if is_baguette_server_running(state).await {
            return baguette_status(state).await;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    BaguetteStatus {
        installed: true,
        running: false,
        port: BAGUETTE_PORT,
        base_url: BAGUETTE_BASE_URL.to_string(),
        error: Some("baguette serve did not become ready".to_string()),
    }
}

fn parse_simctl_devices(data: &Value) -> Vec<SimulatorDevice> {
    let Some(runtimes) = data.get("devices").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut devices = Vec::new();
    for (runtime, entries) in runtimes {
        let Some(entries) = entries.as_array() else {
            continue;
        };
        for entry in entries {
            let Some(udid) = entry.get("udid").and_then(Value::as_str) else {
                continue;
            };
            let Some(name) = entry.get("name").and_then(Value::as_str) else {
                continue;
            };
            if udid.is_empty()
                || name.is_empty()
                || entry.get("isAvailable").and_then(Value::as_bool) == Some(false)
            {
                continue;
            }
            devices.push(SimulatorDevice {
                udid: udid.to_string(),
                name: name.to_string(),
                state: entry
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("Unknown")
                    .to_string(),
                runtime: runtime.replace("com.apple.CoreSimulator.SimRuntime.", ""),
                is_available: true,
            });
        }
    }
    devices
}

async fn list_simulators() -> Result<Vec<SimulatorDevice>, String> {
    let output = Command::new("xcrun")
        .args(["simctl", "list", "devices", "-j"])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(command_failure(&output, "Failed to list simulators"));
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    Ok(parse_simctl_devices(&value))
}

async fn boot_simulator(udid: &str) -> Result<(), String> {
    let output = Command::new("xcrun")
        .args(["simctl", "boot", udid])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let error = command_failure(&output, "Failed to boot simulator");
    if error.contains("Unable to boot device in current state: Booted") {
        Ok(())
    } else {
        Err(error)
    }
}

async fn shutdown_simulator(udid: &str) -> Result<(), String> {
    // `.nothrow()` made every completed simctl invocation a successful route,
    // regardless of its exit code. Only process-spawn failures reach the catch.
    Command::new("xcrun")
        .args(["simctl", "shutdown", udid])
        .output()
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn open_simulator_app(udid: Option<&str>) -> Result<(), String> {
    if let Some(udid) = udid {
        let _ = Command::new("xcrun")
            .args(["simctl", "boot", udid])
            .output()
            .await;
    }
    let output = Command::new("open")
        .args(["-a", "Simulator"])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_failure(&output, "Failed to open Simulator"))
    }
}

async fn project_search_roots(state: &ServerState) -> Vec<PathBuf> {
    let config = state.config_manager.lock().await.load();
    let simulator_folders = config
        .get("simulator_project_folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string);
    let search_folders = config
        .get("search_folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string);
    let workspace_paths = simulator_workspace_paths(state).await;
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for root in simulator_folders
        .chain(search_folders)
        .chain(workspace_paths)
    {
        let root = expand_simulator_home(state.allowed_paths.home_directory(), &root);
        if root.is_dir() && seen.insert(root.clone()) {
            roots.push(root);
        }
    }
    roots
}

async fn list_simulator_projects(state: &ServerState) -> Result<Vec<SimulatorProject>, String> {
    let roots = project_search_roots(state).await;
    let mut targets = Vec::<SimulatorBuildTarget>::new();
    for root in roots {
        for target in find_simulator_build_targets(&root, 4) {
            if let Some(index) = targets.iter().position(|item| item.path == target.path) {
                targets[index] = target;
            } else {
                targets.push(target);
            }
        }
    }

    let devices = list_simulators().await?;
    let booted_device = devices.iter().find(|device| device.state == "Booted");
    let installed_apps = if let Some(device) = booted_device {
        get_installed_apps(&device.udid).await
    } else {
        Vec::new()
    };
    let installed_apps_by_bundle_id = installed_apps
        .iter()
        .map(|app| (app.bundle_id.as_str(), app))
        .collect::<HashMap<_, _>>();
    let installed = installed_apps
        .iter()
        .map(|app| app.bundle_id.as_str())
        .collect::<HashSet<_>>();
    let running_snapshot = if let Some(device) = booted_device {
        get_running_bundle_snapshot(&device.udid).await
    } else {
        String::new()
    };

    let mut projects = Vec::new();
    for target in targets {
        let target_identity = target
            .workspace_path
            .as_ref()
            .or(target.project_path.as_ref())
            .unwrap_or(&target.path);
        let suffix = if target.workspace_path.is_some() {
            ".xcworkspace"
        } else {
            ".xcodeproj"
        };
        let fallback_name = basename_without_suffix(target_identity, suffix);
        let project_name = path_basename(&target.path);
        let project_bundle_id = get_bundle_id_from_project(&target, None).await;
        let installed_app = project_bundle_id
            .as_deref()
            .and_then(|bundle_id| installed_apps_by_bundle_id.get(bundle_id).copied())
            .or_else(|| find_installed_app_for_project(&installed_apps, &project_name));
        let bundle_id = installed_app
            .map(|app| app.bundle_id.clone())
            .or(project_bundle_id);
        let is_installed = bundle_id
            .as_deref()
            .is_some_and(|bundle_id| installed.contains(bundle_id));
        let is_running = bundle_id
            .as_deref()
            .is_some_and(|bundle_id| running_snapshot.contains(bundle_id));
        projects.push(SimulatorProject {
            id: path_text(target_identity),
            name: project_name,
            kind: if target.ios_path.is_some() {
                "react-native"
            } else {
                "xcode"
            },
            path: path_text(&target.path),
            project_path: target.project_path.as_deref().map(path_text),
            workspace_path: target.workspace_path.as_deref().map(path_text),
            ios_path: target.ios_path.as_deref().map(path_text),
            schemes: Vec::new(),
            default_scheme: fallback_name,
            bundle_id,
            booted_device_udid: booted_device.map(|device| device.udid.clone()),
            installed: is_installed,
            running: is_running,
        });
    }
    projects.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(projects)
}

async fn get_installed_apps(udid: &str) -> Vec<InstalledSimulatorApp> {
    let Ok(output) = Command::new("xcrun")
        .args(["simctl", "listapps", udid])
        .output()
        .await
    else {
        return Vec::new();
    };
    parse_installed_apps(&String::from_utf8_lossy(&output.stdout))
}

fn parse_installed_apps(text: &str) -> Vec<InstalledSimulatorApp> {
    let block_regex = Regex::new(r#"(?s)"([^"]+)" =\s+\{(.*?)\n {4}\};"#)
        .expect("static installed-app regex must compile");
    block_regex
        .captures_iter(text)
        .filter_map(|capture| {
            let bundle_id = capture.get(1)?.as_str().to_string();
            let block = capture.get(2).map_or("", |value| value.as_str());
            Some(InstalledSimulatorApp {
                bundle_id,
                display_name: simulator_app_value(block, "CFBundleDisplayName"),
                name: simulator_app_value(block, "CFBundleName"),
                executable: simulator_app_value(block, "CFBundleExecutable"),
            })
        })
        .collect()
}

fn simulator_app_value(block: &str, key: &str) -> Option<String> {
    let regex = Regex::new(&format!(
        r#"{} = (?:"([^"]+)"|([^;\n]+));"#,
        regex::escape(key)
    ))
    .expect("escaped simulator app key regex must compile");
    let captures = regex.captures(block)?;
    captures
        .get(1)
        .or_else(|| captures.get(2))
        .map(|value| value.as_str().trim().to_string())
}

fn normalize_app_name(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

fn find_installed_app_for_project<'a>(
    apps: &'a [InstalledSimulatorApp],
    project_name: &str,
) -> Option<&'a InstalledSimulatorApp> {
    let normalized_project = normalize_app_name(project_name);
    apps.iter().find(|app| {
        [
            app.display_name.as_deref(),
            app.name.as_deref(),
            app.executable.as_deref(),
            Some(app.bundle_id.as_str()),
        ]
        .into_iter()
        .flatten()
        .any(|value| normalize_app_name(value) == normalized_project)
    })
}

async fn get_running_bundle_snapshot(udid: &str) -> String {
    Command::new("xcrun")
        .args(["simctl", "spawn", udid, "launchctl", "print", "system"])
        .output()
        .await
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default()
}

async fn open_xcode_project(state: &ServerState, app_path: &str) -> Result<Option<String>, String> {
    let Some(safe_app_path) = state.allowed_paths.resolve_allowed_local_path(app_path) else {
        return Ok(None);
    };
    let target = find_simulator_build_targets(&safe_app_path, 2)
        .into_iter()
        .next()
        .or_else(|| direct_build_target(&safe_app_path));
    let Some(open_path) = target.as_ref().and_then(|target| {
        target
            .workspace_path
            .as_ref()
            .or(target.project_path.as_ref())
    }) else {
        return Ok(None);
    };
    let output = Command::new("open")
        .arg(open_path)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(Some(path_text(open_path)))
    } else {
        Err(command_failure(&output, "Failed to open Xcode project"))
    }
}

fn direct_build_target(path: &Path) -> Option<SimulatorBuildTarget> {
    let parent = path.parent().unwrap_or(path).to_path_buf();
    let text = path.to_string_lossy();
    if text.ends_with(".xcodeproj") {
        Some(SimulatorBuildTarget {
            path: parent,
            project_path: Some(path.to_path_buf()),
            workspace_path: None,
            ios_path: None,
        })
    } else if text.ends_with(".xcworkspace") {
        Some(SimulatorBuildTarget {
            path: parent,
            project_path: None,
            workspace_path: Some(path.to_path_buf()),
            ios_path: None,
        })
    } else {
        None
    }
}

async fn get_schemes(target: &SimulatorBuildTarget) -> Vec<String> {
    let mut command = Command::new("xcodebuild");
    if let Some(workspace_path) = &target.workspace_path {
        command.args(["-workspace", &path_text(workspace_path)]);
    } else if let Some(project_path) = &target.project_path {
        command.args(["-project", &path_text(project_path)]);
    }
    let Ok(output) = command.args(["-list", "-json"]).output().await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return Vec::new();
    };
    value
        .pointer("/project/schemes")
        .and_then(Value::as_array)
        .or_else(|| {
            value
                .pointer("/workspace/schemes")
                .and_then(Value::as_array)
        })
        .map(|schemes| {
            schemes
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

async fn get_bundle_id_from_project(
    target: &SimulatorBuildTarget,
    scheme: Option<&str>,
) -> Option<String> {
    if let Some(scheme) = scheme {
        let mut command = Command::new("xcodebuild");
        if let Some(workspace_path) = &target.workspace_path {
            command.args(["-workspace", &path_text(workspace_path)]);
        } else if let Some(project_path) = &target.project_path {
            command.args(["-project", &path_text(project_path)]);
        }
        if let Ok(output) = command
            .args(["-scheme", scheme, "-showBuildSettings"])
            .output()
            .await
            && let Some(bundle_id) =
                parse_build_settings_bundle_id(&String::from_utf8_lossy(&output.stdout))
        {
            return Some(bundle_id);
        }
    }

    let project_path = target.project_path.clone().unwrap_or_default();
    let text = tokio::fs::read_to_string(project_path.join("project.pbxproj"))
        .await
        .ok()?;
    parse_pbxproj_bundle_id(&text)
}

fn parse_build_settings_bundle_id(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        line.strip_prefix("    PRODUCT_BUNDLE_IDENTIFIER = ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn parse_pbxproj_bundle_id(text: &str) -> Option<String> {
    let regex = Regex::new(r#"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);"#)
        .expect("static bundle-id regex must compile");
    regex
        .captures(text)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().replace('"', "").trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn build_app(
    target: &SimulatorBuildTarget,
    scheme: &str,
    udid: &str,
) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let derived_data_path = std::env::temp_dir().join(format!("inferay-sim-build-{timestamp}"));
    let mut command = Command::new("xcodebuild");
    if let Some(workspace_path) = &target.workspace_path {
        command.args(["-workspace", &path_text(workspace_path)]);
    } else if let Some(project_path) = &target.project_path {
        command.args(["-project", &path_text(project_path)]);
    }
    let output = command
        .args([
            "-scheme",
            scheme,
            "-sdk",
            "iphonesimulator",
            "-destination",
            &format!("id={udid}"),
            "-configuration",
            "Debug",
            "-derivedDataPath",
            &path_text(&derived_data_path),
            "build",
        ])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let stderr = truncate_output(&String::from_utf8_lossy(&output.stderr), 1200);
        return Err(if stderr.is_empty() {
            "Build failed".into()
        } else {
            stderr
        });
    }
    let products_dir = derived_data_path.join("Build/Products/Debug-iphonesimulator");
    let mut entries = tokio::fs::read_dir(&products_dir)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        if entry.file_name().to_string_lossy().ends_with(".app") {
            return Ok(entry.path());
        }
    }
    Err("Build succeeded but .app not found".into())
}

async fn build_install_launch_project(
    state: &ServerState,
    app_path: &str,
    udid: &str,
    scheme: Option<&str>,
) -> Result<BuildLaunchResult, String> {
    let Some(safe_app_path) = state.allowed_paths.resolve_allowed_local_path(app_path) else {
        return Err("Project path is outside allowed local roots".into());
    };
    let target = find_simulator_build_targets(&safe_app_path, 2)
        .into_iter()
        .next()
        .or_else(|| direct_build_target(&safe_app_path))
        .ok_or_else(|| "No Xcode project found".to_string())?;
    let schemes = get_schemes(&target).await;
    let resolved_scheme = scheme
        .and_then(|requested| {
            schemes
                .iter()
                .find(|candidate| candidate.eq_ignore_ascii_case(requested))
                .cloned()
        })
        .or_else(|| schemes.first().cloned())
        .unwrap_or_else(|| {
            let path = target
                .workspace_path
                .as_ref()
                .or(target.project_path.as_ref())
                .unwrap_or(&target.path);
            let basename = basename_without_suffix(path, ".xcworkspace");
            basename
                .strip_suffix(".xcodeproj")
                .unwrap_or(&basename)
                .to_string()
        });
    let app_bundle_path = build_app(&target, &resolved_scheme, udid).await?;

    let install = Command::new("xcrun")
        .args(["simctl", "install", udid, &path_text(&app_bundle_path)])
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !install.status.success() {
        let stderr = truncate_output(&String::from_utf8_lossy(&install.stderr), 1200);
        return Err(if stderr.is_empty() {
            "Install failed".into()
        } else {
            stderr
        });
    }

    let bundle_id = get_bundle_id_from_project(&target, Some(&resolved_scheme)).await;
    let bundle_id = if bundle_id.is_some() {
        bundle_id
    } else {
        read_built_bundle_id(&app_bundle_path).await
    };
    if let Some(bundle_id) = &bundle_id {
        let _ = Command::new("xcrun")
            .args(["simctl", "terminate", udid, bundle_id])
            .output()
            .await;
        let launch = Command::new("xcrun")
            .args(["simctl", "launch", udid, bundle_id])
            .output()
            .await
            .map_err(|error| error.to_string())?;
        if !launch.status.success() {
            let stderr = truncate_output(&String::from_utf8_lossy(&launch.stderr), 1200);
            return Err(if stderr.is_empty() {
                "Launch failed".into()
            } else {
                stderr
            });
        }
    }

    let project_path = target
        .project_path
        .as_ref()
        .or(target.workspace_path.as_ref())
        .map(|path| path_text(path))
        .unwrap_or_default();
    Ok(BuildLaunchResult {
        project_path,
        scheme: resolved_scheme,
        bundle_id,
        app_bundle_path: path_text(&app_bundle_path),
    })
}

async fn read_built_bundle_id(app_bundle_path: &Path) -> Option<String> {
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args([
            "-c",
            "Print CFBundleIdentifier",
            &path_text(&app_bundle_path.join("Info.plist")),
        ])
        .output()
        .await
        .ok()?;
    let bundle_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!bundle_id.is_empty()).then_some(bundle_id)
}

fn command_failure(output: &std::process::Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.to_string()
    } else {
        stderr
    }
}

fn truncate_output(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_basename(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn basename_without_suffix(path: &Path, suffix: &str) -> String {
    let name = path_basename(path);
    name.strip_suffix(suffix).unwrap_or(&name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simctl_devices_like_the_typescript_service() {
        let devices = parse_simctl_devices(&json!({
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
                    {
                        "udid": "available-without-flag",
                        "name": "iPhone 17",
                        "state": "Shutdown"
                    },
                    {
                        "udid": "unavailable",
                        "name": "iPhone 15",
                        "state": "Shutdown",
                        "isAvailable": false
                    },
                    {
                        "udid": "booted",
                        "name": "iPad Pro",
                        "state": "Booted",
                        "isAvailable": true
                    }
                ]
            }
        }));
        assert_eq!(
            devices,
            vec![
                SimulatorDevice {
                    udid: "available-without-flag".into(),
                    name: "iPhone 17".into(),
                    state: "Shutdown".into(),
                    runtime: "iOS-26-0".into(),
                    is_available: true,
                },
                SimulatorDevice {
                    udid: "booted".into(),
                    name: "iPad Pro".into(),
                    state: "Booted".into(),
                    runtime: "iOS-26-0".into(),
                    is_available: true,
                },
            ]
        );
    }

    #[test]
    fn parses_installed_apps_and_project_bundle_identifiers() {
        let apps = parse_installed_apps(
            r#"{
    "com.example.MobileApp" =     {
        CFBundleDisplayName = "Mobile App";
        CFBundleExecutable = MobileApp;
        CFBundleName = MobileApp;
    };
}"#,
        );
        assert_eq!(
            apps,
            vec![InstalledSimulatorApp {
                bundle_id: "com.example.MobileApp".into(),
                display_name: Some("Mobile App".into()),
                name: Some("MobileApp".into()),
                executable: Some("MobileApp".into()),
            }]
        );
        assert_eq!(
            parse_build_settings_bundle_id(
                "OTHER = value\n    PRODUCT_BUNDLE_IDENTIFIER = com.example.Settings\n"
            ),
            Some("com.example.Settings".into())
        );
        assert_eq!(
            parse_pbxproj_bundle_id("PRODUCT_BUNDLE_IDENTIFIER = \"com.example.Project\";"),
            Some("com.example.Project".into())
        );
    }

    #[test]
    fn matches_installed_apps_using_the_existing_normalization() {
        let apps = vec![InstalledSimulatorApp {
            bundle_id: "com.example.mobile-app".into(),
            display_name: Some("Mobile App".into()),
            name: None,
            executable: None,
        }];
        assert_eq!(
            find_installed_app_for_project(&apps, "MobileApp"),
            Some(&apps[0])
        );
        assert_eq!(find_installed_app_for_project(&apps, "Other"), None);
    }

    #[test]
    fn preserves_baguette_http_shape() {
        assert_eq!(
            serde_json::to_value(baguette_status_from(Some("baguette"), false)).unwrap(),
            json!({
                "installed": true,
                "running": false,
                "port": 8421,
                "baseUrl": "http://127.0.0.1:8421"
            })
        );
        assert_eq!(
            serde_json::to_value(baguette_status_from(None, true)).unwrap(),
            json!({
                "installed": false,
                "running": false,
                "port": 8421,
                "baseUrl": "http://127.0.0.1:8421",
                "error": "baguette is not installed"
            })
        );
    }
}
