use native_files::{image_content_type, is_image_extension};
mod git_changes;
mod workspace_panels;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ws::{Message as AxumMessage, WebSocket};
use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Request, State, WebSocketUpgrade};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    CACHE_CONTROL, CONTENT_TYPE, COOKIE, HOST, ORIGIN, SET_COOKIE, VARY,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use futures_util::{SinkExt, StreamExt, future::join_all};
use inferay_core::agent_command::{AgentCommandResolver, AgentKind};
use inferay_core::agent_context::AgentContextStore;
use inferay_core::agent_protocol::{
    AgentProtocolContext, CodexInvocationContext, CodexProtocolState, ProtocolEmission,
};
use inferay_core::agent_state::AgentStateStore;
use inferay_core::config::ConfigManager;
use inferay_core::path_security::{
    AllowedPaths, is_safe_relative_path, is_within_directory, resolve_lexically,
};
use inferay_core::prompts::{PromptError, PromptStore};
use inferay_native_diff::{
    GitInteractiveRebaseStep, checkout_git_branch, commit_git, finish_git_ref_operation,
    get_git_branches, get_git_commit_details_for_parent, get_git_commit_hunk_diff_for_parent,
    get_git_comparison_details, get_git_comparison_hunk_diff, get_git_status,
    get_git_worktree_comparison_details, get_git_worktree_comparison_hunk_diff,
    perform_git_graph_action_with_targets, perform_git_interactive_rebase,
    perform_git_ref_operation, preflight_git_ref_operation, stage_git, unstage_git,
};
use percent_encoding::percent_decode_str;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{broadcast, oneshot};
use url::Url;
use uuid::Uuid;

mod agent_account;
mod agent_runner;
mod atomic_write;
pub mod chat_persistence;
mod chat_runtime;
pub mod checkpoint;
mod forge;
mod markdown;
mod native_app;
pub mod native_directories;
pub mod native_files;
pub mod native_git;
pub mod native_project_files;
pub mod native_prompts;
mod one_shot;
mod pid_tracker;
mod provider_history;
mod render_jobs;

const LOCAL_AUTH_COOKIE: &str = "inferay_local_auth";
const MAX_PROXY_BODY_BYTES: usize = 32 * 1024 * 1024;
const CORS_METHODS: &str = "GET,POST,PUT,DELETE,OPTIONS";
const CORS_HEADERS: &str = "Content-Type,X-Inferay-Auth";
const MAX_TEMP_UPLOAD_BYTES: usize = 20 * 1024 * 1024;
const MAX_SERVED_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub listen_addr: SocketAddr,
    pub app_root: PathBuf,
    pub home_directory: PathBuf,
    pub user_data_dir: PathBuf,
    pub auth_token: String,
    pub release_api_url: Option<String>,
    pub live_reload: bool,
}

impl ServerConfig {
    pub fn new(listen_addr: SocketAddr, app_root: PathBuf) -> Self {
        Self {
            listen_addr,
            app_root,
            home_directory: home_directory(),
            user_data_dir: default_user_data_directory(),
            auth_token: Uuid::new_v4().to_string(),
            release_api_url: None,
            live_reload: false,
        }
    }
}

#[derive(Clone)]
struct ServerState {
    dist_dir: PathBuf,
    public_dir: PathBuf,
    allowed_paths: AllowedPaths,
    agent_command_resolver: Arc<AgentCommandResolver>,
    agent_state_store: Arc<Mutex<AgentStateStore>>,
    background_dir: PathBuf,
    client_storage_path: PathBuf,
    client_storage_write: Arc<tokio::sync::Mutex<()>>,
    chat_persistence: chat_persistence::ChatPersistence,
    chat_runtime: chat_runtime::ChatRuntime,
    checkpoint_service: checkpoint::CheckpointService,
    config_manager: Arc<tokio::sync::Mutex<ConfigManager>>,
    native_project_files: native_project_files::NativeProjectFiles,
    forge_state: Arc<forge::ForgeState>,
    native_files: native_files::NativeFiles,
    next_client_id: Arc<AtomicU64>,
    native_directories: native_directories::NativeAgentDirectories,
    agent_context_store: Arc<tokio::sync::Mutex<AgentContextStore>>,
    native_prompts: native_prompts::NativePrompts,
    release_api_url: Option<String>,
    release_check_cache: Arc<tokio::sync::Mutex<Option<native_app::ReleaseCheckCache>>>,
    temp_dir: PathBuf,
    auth_token: String,
    client: Client,
    connection_reset: broadcast::Sender<()>,
    live_reload: bool,
}

#[derive(Clone)]
struct DirectAgentExecutor {
    pid_tracker: pid_tracker::RuntimePidTracker,
    resolver: Arc<AgentCommandResolver>,
}

impl chat_runtime::AgentExecutor for DirectAgentExecutor {
    fn run<'a>(
        &'a self,
        request: chat_runtime::AgentRunRequest,
        handle: agent_runner::AgentProcessHandle,
        emissions: tokio::sync::mpsc::UnboundedSender<ProtocolEmission>,
    ) -> chat_runtime::AgentFuture<'a> {
        Box::pin(async move {
            let mut protocol = AgentProtocolContext::new(request.cwd.clone());
            protocol.reference_paths = request.reference_paths.clone();
            protocol.session_id = request.session_id.clone();
            let result = if request.agent_kind == "codex" {
                let binary = self.resolver.resolve_agent_binary(AgentKind::Codex);
                let environment = self.resolver.create_agent_env(AgentKind::Codex);
                let invocation = CodexInvocationContext {
                    cwd: request.cwd,
                    reference_paths: request.reference_paths,
                    images: request.images,
                    model: request.model,
                    reasoning_level: request.reasoning_level,
                    developer_instructions: request.developer_instructions,
                    session_id: request.session_id,
                };
                let mut state = CodexProtocolState::default();
                agent_runner::run_codex(
                    agent_runner::CodexRun {
                        binary: &binary,
                        prompt: &request.prompt,
                        invocation: &invocation,
                        env: &environment,
                    },
                    &handle,
                    &self.pid_tracker,
                    &mut protocol,
                    &mut state,
                    Some(&emissions),
                )
                .await
            } else {
                let binary = self.resolver.resolve_agent_binary(AgentKind::Claude);
                let environment = self.resolver.create_agent_env(AgentKind::Claude);
                agent_runner::run_claude(
                    agent_runner::ClaudeRun {
                        binary: &binary,
                        prompt: &request.prompt,
                        developer_instructions: request.developer_instructions.as_deref(),
                        cwd: &request.cwd,
                        model: request.model.as_deref(),
                        session_id: request.session_id.as_deref(),
                        env: &environment,
                    },
                    &handle,
                    &mut protocol,
                    Some(&emissions),
                )
                .await
            };
            Ok(result)
        })
    }

    fn stop(&self, agent_kind: &str, handle: &agent_runner::AgentProcessHandle) {
        if agent_kind == "codex" {
            if !handle.stop_codex() {
                handle.kill(&self.pid_tracker);
            }
        } else {
            handle.stop_claude();
        }
    }

    fn kill(&self, handle: &agent_runner::AgentProcessHandle) {
        handle.kill(&self.pid_tracker);
    }
}

#[derive(Deserialize)]
struct NativeDiffBody {
    before: Option<String>,
    after: Option<String>,
    #[serde(default)]
    edits: Vec<inferay_native_diff::SequentialEdit>,
}

#[derive(Deserialize)]
struct GitStatusesBody {
    #[serde(default)]
    cwds: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct GitBranchBody {
    cwd: Option<String>,
    branch: Option<String>,
}

#[derive(Deserialize)]
struct GitRefOperationBody {
    cwd: Option<String>,
    operation: Option<String>,
    action: Option<String>,
    source: Option<String>,
    target: Option<String>,
    #[serde(default)]
    steps: Vec<GitInteractiveRebaseStep>,
}

#[derive(Deserialize)]
struct GitGraphActionBody {
    cwd: Option<String>,
    action: Option<String>,
    target: Option<String>,
    targets: Option<Vec<String>>,
    name: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct GitFileBody {
    cwd: Option<String>,
    file: Option<String>,
}

#[derive(Deserialize)]
struct GitCommitBody {
    cwd: Option<String>,
    message: Option<String>,
}

pub struct ServerHandle {
    local_addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl ServerHandle {
    pub fn start(config: ServerConfig) -> Result<Self, String> {
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let thread = thread::Builder::new()
            .name("inferay-rust-server".into())
            .spawn(move || run_server(config, ready_tx, shutdown_rx))
            .map_err(|error| format!("failed to start Rust server thread: {error}"))?;

        let local_addr = ready_rx
            .recv()
            .map_err(|_| "Rust server stopped before becoming ready".to_string())??;

        Ok(Self {
            local_addr,
            shutdown: Some(shutdown_tx),
            thread: Some(thread),
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(thread) = self.thread.take() {
            // Connections receive the shutdown broadcast before Axum begins
            // graceful shutdown. Keep this bounded as a final safeguard for
            // platform WebView/network stacks that retain a socket.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while !thread.is_finished() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn run_server(
    config: ServerConfig,
    ready: std::sync::mpsc::SyncSender<Result<SocketAddr, String>>,
    shutdown: oneshot::Receiver<()>,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("inferay-server-worker")
        .build()
        .map_err(|error| format!("failed to create Rust server runtime: {error}"))?;

    runtime.block_on(async move {
        let listener = match tokio::net::TcpListener::bind(config.listen_addr).await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("failed to bind Rust server: {error}");
                let _ = ready.send(Err(message.clone()));
                return Err(message);
            }
        };
        let local_addr = listener
            .local_addr()
            .map_err(|error| format!("failed to read Rust server address: {error}"))?;
        let (connection_reset, _) = broadcast::channel(8);
        let app = build_router_with_connection_reset(config, connection_reset.clone());
        let _ = ready.send(Ok(local_addr));

        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown.await;
                let _ = connection_reset.send(());
            })
            .await
            .map_err(|error| format!("Rust server failed: {error}"))
    })
}

#[cfg(test)]
fn router(config: ServerConfig) -> Router {
    let (connection_reset, _) = broadcast::channel(8);
    build_router_with_connection_reset(config, connection_reset)
}

fn build_router_with_connection_reset(
    config: ServerConfig,
    connection_reset: broadcast::Sender<()>,
) -> Router {
    let dist_dir = if config.app_root.join("dist").is_dir() {
        config.app_root.join("dist")
    } else {
        config.app_root.join("views")
    };
    let allowed_paths = AllowedPaths::new(&config.app_root, &config.home_directory)
        .expect("server path roots must resolve");
    let bundled_prompts = config.app_root.join("data/prompts.json");
    let agent_state_path = config.user_data_dir.join("agent-state.json");
    let checkpoints_path = config.user_data_dir.join("checkpoints.json");
    let checkpoint_service =
        checkpoint::CheckpointService::new(allowed_paths.clone(), checkpoints_path);
    let pid_tracker =
        pid_tracker::RuntimePidTracker::new(config.user_data_dir.join("runtime-pids.json"));
    let orphan_cleaner = pid_tracker.clone();
    tokio::spawn(async move { orphan_cleaner.cleanup_orphans().await });
    let agent_command_resolver = Arc::new(AgentCommandResolver::new(config.home_directory.clone()));
    let agent_context_store = Arc::new(tokio::sync::Mutex::new(AgentContextStore::new(
        config.user_data_dir.join("agent-context.json"),
    )));
    let prompt_store = Arc::new(tokio::sync::Mutex::new(PromptStore::new(
        bundled_prompts,
        config.user_data_dir.join("prompts.json"),
    )));
    let native_prompts = native_prompts::NativePrompts::new(prompt_store.clone());
    let config_manager = Arc::new(tokio::sync::Mutex::new(ConfigManager::new(
        config.user_data_dir.join("settings.json"),
    )));
    let native_directories = native_directories::NativeAgentDirectories::with_config_manager(
        allowed_paths.clone(),
        config_manager.clone(),
    );
    let chat_persistence = chat_persistence::ChatPersistence::new(config.user_data_dir.clone());
    let agent_state_store = Arc::new(Mutex::new(AgentStateStore::new(agent_state_path.clone())));
    let native_project_files = native_project_files::NativeProjectFiles::new(
        allowed_paths.clone(),
        agent_state_store.clone(),
    );
    let native_files = native_files::NativeFiles::from_app_root(&config.app_root);
    let client_storage_write = Arc::new(tokio::sync::Mutex::new(()));
    let chat_runtime = chat_runtime::ChatRuntime::new(
        chat_persistence.clone(),
        checkpoint_service.clone(),
        Arc::new(DirectAgentExecutor {
            resolver: agent_command_resolver.clone(),
            pid_tracker: pid_tracker.clone(),
        }),
        agent_context_store.clone(),
        prompt_store.clone(),
    );
    let state = ServerState {
        dist_dir,
        public_dir: config.app_root.join("public"),
        allowed_paths,
        agent_command_resolver,
        agent_state_store,
        background_dir: config.user_data_dir.join("backgrounds"),
        client_storage_path: config.user_data_dir.join("client-storage.json"),
        client_storage_write,
        chat_persistence,
        chat_runtime,
        checkpoint_service,
        config_manager,
        native_project_files: native_project_files.clone(),
        forge_state: Arc::new(forge::ForgeState::default()),
        native_files,
        next_client_id: Arc::new(AtomicU64::new(1)),
        native_directories,
        agent_context_store,
        native_prompts,
        release_api_url: config.release_api_url,
        release_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
        temp_dir: config.app_root.join("data/.tmp"),
        auth_token: config.auth_token,
        client: Client::new(),
        connection_reset,
        live_reload: config.live_reload,
    };
    Router::new()
        .route("/ws", any(native_websocket))
        .fallback(any(dispatch_request))
        .layer(DefaultBodyLimit::max(MAX_TEMP_UPLOAD_BYTES + 1024 * 1024))
        .with_state(state)
}

async fn dispatch_request(State(state): State<ServerState>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    let request_headers = request.headers().clone();
    let head_only = request.method() == Method::HEAD;
    if path.starts_with("/api/") || path == "/api" {
        if !is_trusted_local_request(request.headers(), &state.auth_token) {
            return text_response(StatusCode::FORBIDDEN, "Forbidden");
        }
        if request.method() == Method::OPTIONS && path.starts_with("/api/") {
            let mut response = Response::new(Body::empty());
            *response.status_mut() = StatusCode::NO_CONTENT;
            add_cors_headers(response.headers_mut(), &request_headers);
            return response;
        }
        let result = match (path.as_str(), request.method().as_str()) {
            ("/api/client-storage", "GET") => get_client_storage(&state, request).await,
            ("/api/client-storage", "POST" | "PUT") => update_client_storage(&state, request).await,
            ("/api/config/search-folders", "GET") => get_search_folders(&state, request).await,
            ("/api/prompts", "GET") => list_prompts(&state, request).await,
            ("/api/prompts", "POST") => create_prompt(&state, request).await,
            ("/api/agent-context", "GET") => get_agent_context(&state, request).await,
            ("/api/agent-context", "PUT") => update_agent_context(&state, request).await,
            ("/api/agent/state/initialize", "POST") => {
                initialize_agent_state(&state, request).await
            }
            ("/api/agent/state", "GET") => get_agent_state(&state, request).await,
            ("/api/agent/state/workspace-action", "POST") => {
                apply_agent_workspace_action(&state, request).await
            }
            ("/api/agent/directories", "GET") => get_agent_directories(&state, request).await,
            ("/api/forge/accounts", "GET") => forge::handle_request(&state, &path, request).await,
            ("/api/forge/repos", "GET") => forge::handle_request(&state, &path, request).await,
            ("/api/forge/commit-avatars", "POST") => {
                forge::handle_request(&state, &path, request).await
            }
            ("/api/forge/clone", "POST") => forge::handle_request(&state, &path, request).await,
            ("/api/forge/connect", "POST") => forge::handle_request(&state, &path, request).await,
            ("/api/git/status", "GET") => git_status(&state, request).await,
            ("/api/git/statuses", "POST") => git_statuses(&state, request).await,
            ("/api/git/branches", "GET") => git_branches(&state, request).await,
            ("/api/git/branches", "POST") => git_checkout_branch(&state, request).await,
            ("/api/git/ref-operation", "POST") => git_ref_operation(&state, request).await,
            ("/api/git/ref-operation-preflight", "POST") => {
                git_ref_operation_preflight(&state, request).await
            }
            ("/api/git/graph-action", "POST") => git_graph_action(&state, request).await,
            ("/api/git/commit-details", "GET") => git_commit_details(&state, request).await,
            ("/api/git/comparison-details", "GET" | "POST") => {
                git_comparison_details(&state, request).await
            }
            ("/api/git/stage", "POST") => git_stage_change(&state, request, true).await,
            ("/api/git/unstage", "POST") => git_stage_change(&state, request, false).await,
            ("/api/git/commit", "POST") => git_commit(&state, request).await,

            ("/api/native/provider-config", "GET") => {
                Ok(inferay_core::provider_config::catalog().clone())
            }
            ("/api/native/provider-config", "POST") => to_bytes(request.into_body(), 64 * 1024)
                .await
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .map(|input| inferay_core::provider_config::resolve(&input))
                .ok_or_else(|| {
                    api_error(StatusCode::BAD_REQUEST, "Invalid provider configuration")
                }),
            ("/api/native/markdown", "POST") => {
                return api_http_response(native_markdown(request).await, &request_headers);
            }
            ("/api/native/diff", "POST") => {
                return api_http_response(native_diff(request).await, &request_headers);
            }
            ("/api/config/search-folders", "PUT") => update_search_folders(&state, request).await,
            ("/api/config/background-image", "GET") => {
                return api_http_response(
                    get_background_image(&state, request).await,
                    &request_headers,
                );
            }
            ("/api/config/background-image", "POST") => {
                update_background_image(&state, request).await
            }
            ("/api/config/pick-folder", "POST") => {
                Ok(json!({"folder": selected_folder_path().await}))
            }

            ("/api/agents/account-status", "GET") => agent_account::account_status(&state).await,
            ("/api/workspace/panels", "POST") => workspace_panels::handle(&state, request).await,

            ("/api/files/search", "GET") => search_files(&state, request).await,
            ("/api/files/list", "GET") => list_project_files(&state, request).await,
            ("/api/files/content", "GET") => get_file_content(&state, request).await,
            ("/api/upload-temp", "POST") => upload_temp_file(&state, request).await,
            ("/api/images/chat-message", "POST") => {
                prepare_image_chat_message(&state, request).await
            }

            ("/api/images", "GET") => list_temp_images(&state, request).await,
            ("/api/delete-temp", "DELETE") => delete_temp_file(&state, request).await,
            ("/api/file", "GET") => {
                return api_http_response(
                    serve_local_image(&state, request).await,
                    &request_headers,
                );
            }
            ("/api/git/graph", "GET") => {
                return api_http_response(git_graph(&state, request).await, &request_headers);
            }
            ("/api/git/commit-diff", "GET") => {
                return api_http_response(git_commit_diff(&state, request).await, &request_headers);
            }
            ("/api/git/comparison-diff", "GET") => {
                return api_http_response(
                    git_comparison_diff(&state, request).await,
                    &request_headers,
                );
            }
            ("/api/git/full-diff", "GET") => {
                return api_http_response(git_full_diff(&state, request).await, &request_headers);
            }
            ("/api/generate-title", "POST") => {
                one_shot::generate_title_route(&state, request).await
            }
            ("/api/git/generate-commit-message", "POST") => {
                one_shot::generate_commit_message_route(&state, request).await
            }
            ("/api/app-info", "GET") => Ok(json!(native_app::load_app_info(&state).await)),
            ("/api/native/update", "POST") => return native_app::update_route(&request_headers),
            _ => dynamic_json_route(&state, &path, request).await,
        };
        return api_response(result, &request_headers);
    }
    if let Some(filename) = public_asset(&path) {
        return serve_file(
            &state.public_dir.join(filename),
            "image/png",
            "no-cache",
            true,
            &request_headers,
            &state.auth_token,
            head_only,
        )
        .await;
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return text_response(StatusCode::NOT_FOUND, "Not found");
    }
    if let Some(response) = serve_dist_path(&state, &path, &request_headers, head_only).await {
        return response;
    }
    if !path.starts_with("/api/") {
        return serve_renderer_index(&state, &request_headers, head_only).await;
    }
    text_response(StatusCode::NOT_FOUND, "Not found")
}
async fn dynamic_json_route(state: &ServerState, path: &str, request: Request) -> ApiResult {
    if let Some((id, usage)) = prompt_path(path) {
        return match (request.method().as_str(), usage) {
            ("POST", true) => increment_prompt_usage(state, request, id).await,
            ("PUT", false) => update_prompt(state, request, id).await,
            ("DELETE", false) => delete_prompt(state, request, id).await,
            _ => Err(api_error(StatusCode::NOT_FOUND, "Not found")),
        };
    }
    if let Some(pane_id) = route_parameter(path, "/api/chat-queues/") {
        return match request.method().as_str() {
            "GET" => get_chat_queue(state, request, &pane_id).await,
            "PATCH" => patch_chat_queue(state, request, &pane_id).await,
            "DELETE" => delete_chat_queue(state, request, &pane_id).await,
            _ => Err(api_error(StatusCode::NOT_FOUND, "Not found")),
        };
    }
    Err(api_error(StatusCode::NOT_FOUND, "Not found"))
}

fn route_parameter(path: &str, prefix: &str) -> Option<String> {
    let value = path.strip_prefix(prefix)?;
    if value.is_empty() || value.contains('/') {
        return None;
    }
    percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
}

async fn get_chat_queue(state: &ServerState, _request: Request, pane_id: &str) -> ApiResult {
    Ok(json!({"queue": state.chat_persistence.read_queue(pane_id).await?}))
}

async fn patch_chat_queue(state: &ServerState, request: Request, pane_id: &str) -> ApiResult {
    let body: Value = api_body(request).await?;
    let id = required(
        body["id"].as_str().filter(|id| !id.is_empty()),
        "Expected queued message ID",
    )?;
    let text = match body["action"].as_str() {
        Some("remove") => None,
        Some("edit") => Some(required(
            body["text"].as_str().filter(|text| !text.trim().is_empty()),
            "Expected nonempty message text",
        )?),
        _ => return Err(api_error(StatusCode::BAD_REQUEST, "Unknown queue action")),
    };
    let queue = state
        .chat_persistence
        .mutate_queue_item(pane_id, id, text)
        .await?;
    state.chat_runtime.broadcast_queue(pane_id).await;
    Ok(json!({"queue":queue}))
}

async fn delete_chat_queue(state: &ServerState, _request: Request, pane_id: &str) -> ApiResult {
    state.chat_persistence.delete_queue(pane_id).await?;
    state.chat_runtime.broadcast_queue(pane_id).await;
    Ok(json!({"ok":true}))
}

async fn prepare_image_chat_message(state: &ServerState, request: Request) -> ApiResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ImageSelection {
        paths: Vec<String>,
        pane_id: Option<String>,
        request_id: Option<String>,
    }
    let selection: ImageSelection = api_body(request).await?;
    let text = state
        .native_files
        .prepare_chat_message(&selection.paths)
        .await
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
    if let Some(pane_id) = selection.pane_id {
        let request_id = required(selection.request_id, "Expected requestId")?;
        let receipt = receive_image_handoff(state, &pane_id, &request_id, text)
            .await
            .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
        Ok(json!({"requestId":receipt["requestId"], "status":receipt["status"]}))
    } else {
        Ok(json!({"text":text}))
    }
}

async fn receive_image_handoff(
    state: &ServerState,
    pane_id: &str,
    request_id: &str,
    text: String,
) -> Result<Value, String> {
    let _admission = state.chat_runtime.handoff_admission_guard().await;
    if text.len() > 256 * 1024 {
        return Err("Image chat request is too large".into());
    }
    if let Some(receipt) = state
        .chat_persistence
        .handoff_receipts(pane_id)
        .await?
        .into_iter()
        .find(|receipt| receipt["requestId"] == request_id)
    {
        if receipt["request"]["text"] != text {
            return Err("Request ID was already used for a different image selection".into());
        }
        return Ok(receipt);
    }
    let pane = state
        .agent_state_store
        .lock()
        .map_err(|e| e.to_string())?
        .pane(pane_id)?
        .ok_or("Chat pane was not found")?;
    let kind = pane.agent_kind.as_str();
    if !matches!(kind, "claude" | "codex") {
        return Err("Selected pane does not support chat".into());
    }
    let entries = {
        let _guard = state.client_storage_write.lock().await;
        read_client_storage(&state.client_storage_path).await?
    };
    let defaults = entries
        .get("inferay-default-chat-settings")
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or(Value::Null);
    let config = inferay_core::provider_config::resolve(
        &json!({"agentKind":kind,"model":entries.get(&format!("inferay-chat-model-{pane_id}")),"reasoningLevel":entries.get(&format!("inferay-chat-reasoning-{pane_id}")),"defaults":defaults}),
    );
    let request = json!({"text":text,"agentKind":kind,"cwd":normalize_chat_cwd(state, pane.cwd.as_deref().map(Path::new)),"referencePaths":normalize_chat_paths(state, &pane.reference_paths),"model":config["model"],"reasoningLevel":config["reasoningLevel"]});
    state
        .chat_persistence
        .receive_handoff(pane_id, request_id, request)
        .await
}

async fn default_chat_kind(state: &ServerState) -> &'static str {
    let _guard = state.client_storage_write.lock().await;
    let entries = read_json_object(&state.client_storage_path).await;
    let defaults = entries
        .get("inferay-default-chat-settings")
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or(Value::Null);
    if defaults["agentKind"] == "claude" {
        "claude"
    } else {
        "codex"
    }
}

async fn initialize_agent_state(state: &ServerState, _request: Request) -> ApiResult {
    let kind = default_chat_kind(state).await;
    let value = state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .initialize(kind)?;
    Ok(json!({"state":value}))
}

async fn get_agent_state(state: &ServerState, _request: Request) -> ApiResult {
    state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .read()
        .map_err(Into::into)
}

async fn apply_agent_workspace_action(state: &ServerState, request: Request) -> ApiResult {
    let body: serde_json::Value = api_body(request).await?;
    let mut action = body.get("action").cloned().unwrap_or(Value::Null);
    if let Some(object) = action.as_object_mut() {
        object
            .entry("defaultAgentKind")
            .or_insert(json!(default_chat_kind(state).await));
    }
    ((state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .apply_workspace_action(&action))
    .map(|value| json!({ "state": value })))
    .map(|value| json!(value))
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))
}

async fn get_agent_directories(state: &ServerState, request: Request) -> ApiResult {
    let query = query_value(&request, "q").unwrap_or_default();
    let requested_path = query_value(&request, "path");

    if let Some(path) = requested_path.filter(|path| !path.is_empty()) {
        return (state.native_directories.browse(path))
            .map(|value| json!(value))
            .map_err(|error| api_error(StatusCode::FORBIDDEN, error));
    }

    if !query.is_empty() {
        let listing = state.native_directories.search(&query).await;
        return Ok(json!(listing));
    }

    if query_value(&request, "quickPicks").as_deref() == Some("true") {
        let quick_picks = state.native_directories.quick_picks().await;
        return Ok(json!(quick_picks));
    }

    Ok(json!(state.native_directories.home()))
}

#[derive(Debug)]
struct ApiError(StatusCode, String);
type ApiResult<T = Value> = Result<T, ApiError>;

fn api_error(status: StatusCode, message: impl ToString) -> ApiError {
    ApiError(status, message.to_string())
}
impl From<tokio::task::JoinError> for ApiError {
    fn from(error: tokio::task::JoinError) -> Self {
        api_error(StatusCode::INTERNAL_SERVER_ERROR, error)
    }
}
fn api_response(result: ApiResult, headers: &HeaderMap) -> Response {
    match result {
        Ok(value) => json_response(StatusCode::OK, value, headers),
        Err(ApiError(status, message)) => json_response(status, json!({"error":message}), headers),
    }
}
fn api_http_response(result: ApiResult<Response>, headers: &HeaderMap) -> Response {
    result.unwrap_or_else(|error| api_response(Err(error), headers))
}
impl From<native_files::NativeFilesError> for ApiError {
    fn from(error: native_files::NativeFilesError) -> Self {
        use native_files::NativeFilesError::*;
        let status = match error {
            AccessDenied => StatusCode::FORBIDDEN,
            FileTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            UnsupportedFileType => StatusCode::BAD_REQUEST,
            Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        api_error(status, error)
    }
}
impl From<native_project_files::NativeProjectFilesError> for ApiError {
    fn from(error: native_project_files::NativeProjectFilesError) -> Self {
        use native_project_files::NativeProjectFilesError::*;
        let status = match error {
            AccessDenied => StatusCode::FORBIDDEN,
            NotFound => StatusCode::NOT_FOUND,
            FileTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Runtime(_) => StatusCode::INTERNAL_SERVER_ERROR,
            _ => StatusCode::BAD_REQUEST,
        };
        api_error(status, error)
    }
}
impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        api_error(StatusCode::INTERNAL_SERVER_ERROR, error)
    }
}
impl From<String> for ApiError {
    fn from(error: String) -> Self {
        api_error(StatusCode::INTERNAL_SERVER_ERROR, error)
    }
}
impl From<PromptError> for ApiError {
    fn from(error: PromptError) -> Self {
        api_error(
            StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            error.message,
        )
    }
}
async fn api_body<T: for<'de> Deserialize<'de>>(request: Request) -> Result<T, ApiError> {
    let bytes = to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES)
        .await
        .map_err(|_| api_error(StatusCode::PAYLOAD_TOO_LARGE, "Payload too large"))?;
    serde_json::from_slice(&bytes).map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}
fn required<T>(value: Option<T>, message: &str) -> Result<T, ApiError> {
    value.ok_or_else(|| api_error(StatusCode::BAD_REQUEST, message))
}
fn request_cwd(state: &ServerState, value: Option<&str>) -> Result<String, ApiError> {
    let cwd = required(value.filter(|cwd| !cwd.is_empty()), "Missing cwd parameter")?;
    safe_cwd(state, cwd).ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "Access to this repository is not allowed",
        )
    })
}

async fn git_status(state: &ServerState, request: Request) -> ApiResult {
    let cwd = request_cwd(state, query_value(&request, "cwd").as_deref())
        .map_err(|ApiError(_, message)| api_error(StatusCode::BAD_REQUEST, message))?;
    let status = tokio::task::spawn_blocking(move || get_git_status(&cwd))
        .await?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Not a git repository"))?;
    Ok(json!(status))
}
async fn git_statuses(state: &ServerState, request: Request) -> ApiResult {
    let body: GitStatusesBody = api_body(request).await?;
    let mut seen = std::collections::HashSet::new();
    let tasks = body
        .cwds
        .unwrap_or_default()
        .into_iter()
        .filter_map(|cwd| safe_cwd(state, &cwd))
        .filter(|cwd| seen.insert(cwd.clone()))
        .map(|cwd| {
            tokio::task::spawn_blocking(move || {
                get_git_status(&cwd).map(|status| git_changes::prepare(json!(status)))
            })
        });
    Ok(json!(
        join_all(tasks)
            .await
            .into_iter()
            .filter_map(|result| result.ok().flatten())
            .collect::<Vec<_>>()
    ))
}
async fn git_branches(state: &ServerState, request: Request) -> ApiResult {
    let cwd = request_cwd(state, query_value(&request, "cwd").as_deref())?;
    Ok(json!({"branches":tokio::task::spawn_blocking(move || get_git_branches(&cwd)).await?}))
}
async fn git_checkout_branch(state: &ServerState, request: Request) -> ApiResult {
    let body: GitBranchBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let branch = required(
        body.branch.filter(|s| !s.is_empty()),
        "Missing branch parameter",
    )?;
    Ok(json!(
        tokio::task::spawn_blocking(move || checkout_git_branch(&cwd, &branch)).await?
    ))
}
async fn git_ref_operation(state: &ServerState, request: Request) -> ApiResult {
    let body: GitRefOperationBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let operation = body.operation.unwrap_or_default();
    let action = body.action.unwrap_or_else(|| "start".into());
    let result = if action == "start" {
        let source = required(body.source, "Missing source branch")?;
        let target = required(body.target, "Missing target branch")?;
        tokio::task::spawn_blocking(move || {
            if operation == "interactiveRebase" {
                perform_git_interactive_rebase(&cwd, &source, &target, &body.steps)
            } else {
                perform_git_ref_operation(&cwd, &operation, &source, &target)
            }
        })
        .await?
    } else {
        tokio::task::spawn_blocking(move || finish_git_ref_operation(&cwd, &operation, &action))
            .await?
    };
    Ok(json!(result))
}
async fn git_ref_operation_preflight(state: &ServerState, request: Request) -> ApiResult {
    let body: GitRefOperationBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let source = required(body.source, "Missing source branch")?;
    let target = required(body.target, "Missing target branch")?;
    Ok(json!(
        tokio::task::spawn_blocking(move || preflight_git_ref_operation(&cwd, &source, &target))
            .await?
    ))
}
async fn git_graph_action(state: &ServerState, request: Request) -> ApiResult {
    let body: GitGraphActionBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    Ok(json!(
        tokio::task::spawn_blocking(move || perform_git_graph_action_with_targets(
            &cwd,
            body.action.as_deref().unwrap_or_default(),
            body.target.as_deref(),
            body.targets.as_deref().unwrap_or_default(),
            body.name.as_deref(),
            body.message.as_deref(),
        ))
        .await?
    ))
}
async fn git_stage_change(state: &ServerState, request: Request, stage: bool) -> ApiResult {
    let body: GitFileBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let file = body.file.filter(|file| !file.is_empty());
    if file
        .as_deref()
        .is_some_and(|file| !is_safe_relative_path(file))
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "Invalid file parameter"));
    }
    let success = tokio::task::spawn_blocking(move || {
        if stage {
            stage_git(&cwd, file.as_deref())
        } else {
            unstage_git(&cwd, file.as_deref())
        }
    })
    .await?;
    Ok(json!({"success":success}))
}
async fn git_commit(state: &ServerState, request: Request) -> ApiResult {
    let body: GitCommitBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let message = required(
        body.message.filter(|s| !s.is_empty()),
        "Missing message parameter",
    )?;
    let task = tokio::task::spawn_blocking(move || commit_git(&cwd, &message));
    match tokio::time::timeout(std::time::Duration::from_secs(30), task).await {
        Ok(result) => Ok(json!(result?)),
        Err(_) => Ok(json!({"success":false,"error":"Commit failed"})),
    }
}
async fn git_graph(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let requested_cwd = query_value(&request, "cwd");
    let Some(requested_cwd) = requested_cwd.as_deref() else {
        return Err(api_error(StatusCode::BAD_REQUEST, "Missing cwd parameter"));
    };
    let Some(cwd) = safe_cwd(state, requested_cwd) else {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Access to this repository is not allowed",
        ));
    };
    let limit = query_value(&request, "limit")
        .as_deref()
        .map(|value| safe_limit(value, 1000, 100000))
        .unwrap_or(1000);
    let query = query_value(&request, "query").unwrap_or_default();
    if query.len() > 4096 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Graph search query is too long",
        ));
    }
    let started = std::time::Instant::now();
    let task = async move {
        let input_cwd = cwd.clone();
        let input =
            render_jobs::run(move || inferay_native_diff::prepare_git_graph(&input_cwd)).await?;
        let key = format!("graph-v3\0{cwd}\0{limit}\0{}\0{query}", input.revision);
        render_jobs::cached(key, std::time::Duration::from_secs(30), move || {
            let snapshot =
                inferay_native_diff::get_git_graph_snapshot_with_query(&cwd, limit, input, &query);
            serde_json::to_vec(&git_changes::prepare(json!(snapshot))).ok()
        })
        .await
    };
    await_cached_render(
        task,
        started,
        &request_headers,
        None,
        "Git history request timed out",
    )
    .await
}

async fn git_commit_details(state: &ServerState, request: Request) -> ApiResult {
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let hash = query_value(&request, "hash").filter(|hash| safe_hash(hash));
    let parent = query_value(&request, "parent").filter(|hash| safe_hash(hash));
    let (Some(cwd), Some(hash)) = (cwd, hash) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Missing cwd or hash parameter",
        ));
    };
    match tokio::task::spawn_blocking(move || {
        git_changes::prepare(
            json!({ "details": get_git_commit_details_for_parent(&cwd, &hash, parent.as_deref()) }),
        )
    })
    .await
    {
        Ok(details) => Ok(details),
        Err(error) => Err(api_error(StatusCode::INTERNAL_SERVER_ERROR, error)),
    }
}

async fn git_commit_diff(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let hash = query_value(&request, "hash").filter(|hash| safe_hash(hash));
    let parent = query_value(&request, "parent").filter(|hash| safe_hash(hash));
    let file = query_value(&request, "file").filter(|file| is_safe_relative_path(file));
    let review = query_value(&request, "view").as_deref() == Some("review");
    let (Some(cwd), Some(hash), Some(file)) = (cwd, hash, file) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Missing cwd, hash, or file parameter",
        ));
    };
    let started = std::time::Instant::now();
    let revision = query_value(&request, "revision").unwrap_or_default();
    let key = format!("commit-diff-v3\0{cwd}\0{hash}\0{parent:?}\0{file}\0{review}\0{revision}");
    let task = render_jobs::cached(key, std::time::Duration::from_secs(2), move || {
        get_git_commit_hunk_diff_for_parent(&cwd, &hash, parent.as_deref(), &file, review)
            .map(render_jobs::diff_bytes)
    });
    await_cached_render(
        task,
        started,
        &request_headers,
        Some("File is not changed in this commit"),
        "Commit diff unavailable",
    )
    .await
}

async fn git_comparison_details(state: &ServerState, request: Request) -> ApiResult {
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    if cwd.is_none() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid comparison directory",
        ));
    }
    let explicit_from = query_value(&request, "from").unwrap_or_default();
    let explicit_to = query_value(&request, "to").unwrap_or_default();
    let selection = if request.method() == Method::POST {
        let body: Value = api_body(request).await?;
        Some(body.get("selection").unwrap_or(&Value::Null).to_string())
    } else {
        query_value(&request, "selection")
    };
    let plan = if let Some(selection) = selection {
        let items = serde_json::from_str::<Vec<native_git::ComparisonSelection>>(&selection);
        match (cwd.as_deref(), items) {
            (Some(cwd), Ok(items)) if items.len() <= 1000 => {
                native_git::plan_comparison(cwd, &items)
            }
            _ => {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "Invalid comparison selection",
                ));
            }
        }
    } else {
        cwd.map(|cwd| native_git::ComparisonPlan {
            cwd,
            from: explicit_from,
            to: explicit_to,
        })
    };
    let Some(plan) = plan else {
        return Ok(json!({"details":null, "plan":null}));
    };
    let Some(cwd) = safe_cwd(state, &plan.cwd) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid comparison directory",
        ));
    };
    if !safe_hash(&plan.from) || (plan.to != "WORKTREE" && !safe_hash(&plan.to)) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Invalid comparison revisions",
        ));
    }
    let from = plan.from.clone();
    let to = plan.to.clone();
    let allowed_paths = state.allowed_paths.clone();
    let task = tokio::task::spawn_blocking(move || {
        let details = if to == "WORKTREE" {
            get_git_worktree_comparison_details(&allowed_paths, &cwd, &from)
        } else {
            get_git_comparison_details(&cwd, &from, &to)
        };
        details.map(|details| git_changes::prepare(json!(details)))
    });
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok(Some(details))) => Ok(json!({ "details": details, "plan": plan })),
        Ok(Ok(None)) => Err(api_error(
            StatusCode::NOT_FOUND,
            "Commits cannot be compared",
        )),
        Ok(Err(error)) => Err(api_error(StatusCode::INTERNAL_SERVER_ERROR, error)),
        Err(_) => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Comparison unavailable",
        )),
    }
}

async fn git_comparison_diff(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let from = query_value(&request, "from").filter(|hash| safe_hash(hash));
    let to = query_value(&request, "to").filter(|value| value == "WORKTREE" || safe_hash(value));
    let file = query_value(&request, "file").filter(|file| is_safe_relative_path(file));
    let review = query_value(&request, "view").as_deref() == Some("review");
    let (Some(cwd), Some(from), Some(to), Some(file)) = (cwd, from, to, file) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Missing cwd, from, to, or file parameter",
        ));
    };
    let allowed_paths = state.allowed_paths.clone();
    let started = std::time::Instant::now();
    let revision = query_value(&request, "revision").unwrap_or_default();
    let key = format!("comparison-diff-v3\0{cwd}\0{from}\0{to}\0{file}\0{review}\0{revision}");
    let ttl = if to == "WORKTREE" {
        std::time::Duration::ZERO
    } else {
        std::time::Duration::from_secs(2)
    };
    let task = render_jobs::cached(key, ttl, move || {
        let diff = if to == "WORKTREE" {
            get_git_worktree_comparison_hunk_diff(&allowed_paths, &cwd, &from, &file, review)
        } else {
            get_git_comparison_hunk_diff(&cwd, &from, &to, &file, review)
        };
        diff.map(render_jobs::diff_bytes)
    });
    await_cached_render(
        task,
        started,
        &request_headers,
        Some("File is not changed between these commits"),
        "Comparison diff unavailable",
    )
    .await
}

struct GitDiffParams {
    cwd: String,
    file: String,
    staged: bool,
}

fn git_diff_params(state: &ServerState, request: &Request) -> Option<GitDiffParams> {
    let cwd = query_value(request, "cwd")?;
    let cwd = safe_cwd(state, &cwd)?;
    let file = query_value(request, "file")?;
    if !is_safe_relative_path(&file) {
        return None;
    }
    Some(GitDiffParams {
        cwd,
        file,
        staged: query_value(request, "staged").as_deref() == Some("true"),
    })
}

async fn git_full_diff(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let review = query_value(&request, "view").as_deref() == Some("review");
    let Some(params) = git_diff_params(state, &request) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Missing cwd or file parameter",
        ));
    };
    let body = native_git::full_diff(
        state.allowed_paths.clone(),
        params.cwd,
        params.file,
        params.staged,
        review,
    )
    .await?
    .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "File is not changed"))?;
    Ok(json_bytes_response(StatusCode::OK, body, &request_headers))
}

fn prompt_path(path: &str) -> Option<(&str, bool)> {
    let remainder = path.strip_prefix("/api/prompts/")?;
    let mut parts = remainder.split('/');
    let id = parts.next().filter(|id| !id.is_empty())?;
    match (parts.next(), parts.next()) {
        (None, None) => Some((id, false)),
        (Some("usage"), None) => Some((id, true)),
        _ => None,
    }
}

async fn list_prompts(state: &ServerState, _request: Request) -> ApiResult {
    Ok(json!(state.native_prompts.list().await?))
}

async fn create_prompt(state: &ServerState, request: Request) -> ApiResult {
    let body: serde_json::Map<String, Value> = api_body(request).await?;
    Ok(json!(
        state
            .native_prompts
            .create_json(body, unix_millis())
            .await?
    ))
}

async fn update_prompt(state: &ServerState, request: Request, id: &str) -> ApiResult {
    let body: serde_json::Map<String, Value> = api_body(request).await?;
    Ok(json!(
        state
            .native_prompts
            .update_json(id, body, unix_millis())
            .await?
    ))
}

async fn delete_prompt(state: &ServerState, _request: Request, id: &str) -> ApiResult {
    state.native_prompts.delete(id).await?;
    Ok(json!({"ok":true}))
}

async fn increment_prompt_usage(state: &ServerState, _request: Request, id: &str) -> ApiResult {
    state
        .native_prompts
        .increment_usage_at(id, unix_millis())
        .await?;
    Ok(json!({"ok":true}))
}

async fn get_agent_context(state: &ServerState, request: Request) -> ApiResult {
    let cwd = query_value(&request, "cwd");
    let pane_id = query_value(&request, "paneId");
    let skills = state.native_prompts.list().await?;
    Ok(json!(state.agent_context_store.lock().await.resolve(
        cwd.as_deref(),
        pane_id.as_deref(),
        &skills
    )))
}

async fn update_agent_context(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let instructions = required(body["instructions"].as_str(), "instructions is required")?;
    let scope = required(
        body["scope"]
            .as_str()
            .filter(|scope| matches!(*scope, "global" | "project" | "chat")),
        "scope is invalid",
    )?;
    state.agent_context_store.lock().await.update(
        inferay_core::agent_context::AgentContextUpdate {
            scope: scope.into(),
            instructions: instructions.into(),
            cwd: body["cwd"].as_str().map(str::to_owned),
            pane_id: body["paneId"].as_str().map(str::to_owned),
            mode: body["mode"].as_str().map(str::to_owned),
        },
        unix_millis(),
    )?;
    Ok(json!({"ok":true}))
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn search_files(state: &ServerState, request: Request) -> ApiResult {
    let cwds = match query_value(&request, "cwd").filter(|cwd| !cwd.is_empty()) {
        Some(cwd) => vec![cwd],
        None => state
            .native_project_files
            .active_cwds()
            .await
            .unwrap_or_else(|_| vec![project_root_cwd(state)]),
    };
    let invalid_directory = |_| api_error(StatusCode::BAD_REQUEST, "Invalid directory");
    let cwds = cwds
        .iter()
        .map(|cwd| state.native_project_files.resolve_cwd(cwd))
        .collect::<Result<Vec<_>, _>>()
        .map_err(invalid_directory)?;
    let query = query_value(&request, "q")
        .unwrap_or_default()
        .to_lowercase();
    let limit = safe_limit(
        query_value(&request, "limit").as_deref().unwrap_or("20"),
        20,
        50,
    );
    let searches = cwds
        .iter()
        .map(|cwd| state.native_project_files.search(cwd, &query, limit));
    let per_cwd = join_all(searches)
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(invalid_directory)?;
    // Round-robin across repositories so one large repository cannot hide the others.
    let rows = per_cwd.iter().map(Vec::len).max().unwrap_or(0);
    let results = (0..rows)
        .flat_map(|row| per_cwd.iter().filter_map(move |entries| entries.get(row)))
        .take(limit)
        .collect::<Vec<_>>();
    Ok(
        json!({"cwd":cwds.first().cloned().unwrap_or_else(|| project_root_cwd(state)), "cwds":cwds, "results":results}),
    )
}

fn project_root_cwd(state: &ServerState) -> String {
    state
        .allowed_paths
        .project_root()
        .to_string_lossy()
        .into_owned()
}

async fn list_project_files(state: &ServerState, request: Request) -> ApiResult {
    let cwd = required(
        query_value(&request, "cwd").filter(|cwd| !cwd.is_empty()),
        "Invalid directory",
    )?;
    let path = query_value(&request, "path").unwrap_or_default();
    let entries = state
        .native_project_files
        .list(&cwd, &path)
        .await
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
    Ok(json!({"entries":entries}))
}

async fn get_file_content(state: &ServerState, request: Request) -> ApiResult {
    let cwd = match query_value(&request, "cwd").filter(|cwd| !cwd.is_empty()) {
        Some(cwd) => cwd,
        None => state
            .native_project_files
            .active_cwds()
            .await
            .unwrap_or_default()
            .into_iter()
            .next()
            .unwrap_or_else(|| project_root_cwd(state)),
    };
    let path = required(
        query_value(&request, "path").filter(|path| !path.is_empty()),
        "No path provided",
    )?;
    Ok(json!(state.native_project_files.read(&cwd, &path).await?))
}

async fn uploaded_file(
    request: Request,
    missing: &str,
) -> Result<(String, String, axum::body::Bytes), ApiError> {
    let mut multipart = Multipart::from_request(request, &())
        .await
        .map_err(|error| error.to_string())?;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| error.to_string())?
    {
        if field.name() != Some("file") || field.file_name().is_none() {
            continue;
        }
        let name = field.file_name().unwrap().to_owned();
        let content_type = field.content_type().unwrap_or_default().to_owned();
        let bytes = field.bytes().await.map_err(|error| error.to_string())?;
        return Ok((name, content_type, bytes));
    }
    Err(api_error(StatusCode::BAD_REQUEST, missing))
}

async fn upload_temp_file(state: &ServerState, request: Request) -> ApiResult {
    let (name, _, bytes) = uploaded_file(request, "No file provided").await?;
    let file = state.native_files.store_image(&name, &bytes).await?;
    Ok(json!({"path":file.path}))
}

async fn list_temp_images(state: &ServerState, _request: Request) -> ApiResult {
    Ok(json!({"images":state.native_files.list().await?}))
}

async fn delete_temp_file(state: &ServerState, request: Request) -> ApiResult {
    let path = required(
        query_value(&request, "path").filter(|path| !path.is_empty()),
        "No path provided",
    )?;
    state.native_files.delete(Path::new(&path)).await?;
    Ok(json!({"ok":true}))
}

async fn serve_local_image(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) else {
        return Err(api_error(StatusCode::BAD_REQUEST, "No path provided"));
    };
    let Some(path) = resolve_serveable_image_path(state, &path).await else {
        return Err(api_error(StatusCode::FORBIDDEN, "Access denied"));
    };
    if !is_image_extension(&path.to_string_lossy()) {
        return Err(api_error(StatusCode::BAD_REQUEST, "Unsupported file type"));
    }
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(api_error(StatusCode::NOT_FOUND, "File not found"));
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.len() > MAX_SERVED_FILE_BYTES {
        return Err(api_error(StatusCode::PAYLOAD_TOO_LARGE, "File too large"));
    }
    let bytes = tokio::fs::read(&path).await?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static(image_content_type(&path)),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_cors_headers(response.headers_mut(), &request_headers);
    Ok(response)
}

async fn resolve_serveable_image_path(state: &ServerState, path: &str) -> Option<PathBuf> {
    let resolved = resolve_lexically(Path::new(path)).ok()?;
    let real = tokio::fs::canonicalize(resolved).await.ok()?;
    (is_within_directory(&real, state.allowed_paths.project_root())
        || is_within_directory(&real, &state.temp_dir))
    .then_some(real)
}

async fn get_search_folders(state: &ServerState, _request: Request) -> ApiResult {
    Ok(json!({ "folders": state.config_manager.lock().await.search_folders()? }))
}

async fn update_search_folders(state: &ServerState, request: Request) -> ApiResult {
    #[derive(Deserialize)]
    struct Input {
        folders: Vec<String>,
    }
    let body: Input = api_body(request).await?;
    state
        .config_manager
        .lock()
        .await
        .set_search_folders(body.folders.clone())?;
    Ok(json!({ "folders": body.folders }))
}

fn is_background_content_type(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

async fn get_background_image(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let file_path = state.background_dir.join("custom-background");
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut response = text_response(StatusCode::NOT_FOUND, "Not found");
            add_cors_headers(response.headers_mut(), &request_headers);
            return Ok(response);
        }
        Err(error) => return Err(error.into()),
    };
    let metadata = read_json_object(&state.background_dir.join("custom-background.json")).await;
    let content_type = metadata
        .get("contentType")
        .and_then(serde_json::Value::as_str)
        .filter(|value| is_background_content_type(value))
        .unwrap_or("image/jpeg");
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_str(content_type).expect("known image type must be a valid header"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_cors_headers(response.headers_mut(), &request_headers);
    Ok(response)
}

async fn update_background_image(state: &ServerState, request: Request) -> ApiResult {
    let (name, content_type, bytes) =
        uploaded_file(request, "No background image provided").await?;
    if bytes.len() > MAX_TEMP_UPLOAD_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Image must be 20 MB or smaller",
        ));
    }
    if !is_background_content_type(&content_type) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Use a PNG, JPEG, WebP, or GIF image",
        ));
    }
    tokio::fs::create_dir_all(&state.background_dir).await?;
    tokio::fs::write(state.background_dir.join("custom-background"), &bytes).await?;
    let revision = unix_millis();
    write_json_object(
        &state.background_dir.join("custom-background.json"),
        json!({"contentType":content_type,"name":name,"revision":revision})
            .as_object()
            .unwrap(),
    )
    .await?;
    Ok(json!({"ok":true,"revision":revision}))
}

async fn selected_folder_path() -> Option<String> {
    #[cfg(target_os = "macos")]
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::process::Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose folder with prompt \"Select a folder to add\")",
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    #[cfg(target_os = "windows")]
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::process::Command::new("powershell")
            .args([
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}",
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return None;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        if !output.status.success() {
            return None;
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return None;
        }
        Some(display_folder_path(&selected))
    }
}

fn display_folder_path(folder: &str) -> String {
    let home = home_directory().to_string_lossy().into_owned();
    let display = folder
        .strip_prefix(&format!("{home}/"))
        .map(|relative| format!("~/{relative}"))
        .unwrap_or_else(|| folder.to_string());
    display.trim_end_matches('/').to_string()
}

const AGENT_STATE_STORAGE_KEY: &str = "inferay-agent-state";
const SYNCED_STORAGE_KEYS: &[&str] = &[
    "commit-graph-columns-v5",
    "editor-selected-pane",
    "git-watched-dirs",
    "main-sidebar-width",
    "sidebar-collapsed",
    "agent-editor-zen",
    "agent-layout-mode",
    "agent-main-view",
];
const SYNCED_STORAGE_PREFIXES: &[&str] = &[
    "agent-workspace-",
    "git-change-checkpoint:",
    "inferay-",
    "inferay.",
];
const CHAT_NON_MESSAGE_STORAGE_PREFIXES: &[&str] = &[
    "inferay-chat-session-",
    "inferay-chat-input-",
    "inferay-checkpoints-",
    "inferay-chat-model-",
    "inferay-chat-reasoning-",
    "inferay-chat-pending-send-",
    "inferay-chat-summary-",
    "inferay-chat-pending-workspace-",
    "inferay-chat-queue-",
    "inferay-chat-loading-",
    "inferay-chat-composer-context-",
    "inferay-chat-worktree-",
];

fn is_chat_message_storage_key(key: &str) -> bool {
    key.starts_with("inferay-chat-")
        && !CHAT_NON_MESSAGE_STORAGE_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
}

fn should_sync_client_storage_key(key: &str) -> bool {
    if key == AGENT_STATE_STORAGE_KEY
        || is_chat_message_storage_key(key)
        || key.starts_with("inferay-chat-queue-")
        || key.starts_with("inferay-chat-loading-")
    {
        return false;
    }
    SYNCED_STORAGE_KEYS.contains(&key)
        || SYNCED_STORAGE_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
}

fn normalize_client_storage_entries(
    value: &serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    let Some(raw_entries) = value.as_object() else {
        return serde_json::Map::new();
    };
    raw_entries
        .iter()
        .filter(|(key, value)| {
            should_sync_client_storage_key(key) && (value.is_string() || value.is_null())
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn is_chat_preference_key(key: &str) -> bool {
    [
        "inferay-chat-session-",
        "inferay-chat-input-",
        "inferay-checkpoints-",
        "inferay-chat-model-",
        "inferay-chat-reasoning-",
        "inferay-chat-pending-send-",
        "inferay-chat-summary-",
        "inferay-chat-pending-workspace-",
    ]
    .iter()
    .any(|prefix| key.starts_with(prefix))
}

async fn read_client_storage(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Map::new()),
        Err(error) => Err(error.to_string()),
    }
}

async fn get_client_storage(state: &ServerState, request: Request) -> ApiResult {
    let requested_key = query_value(&request, "key");
    let _guard = state.client_storage_write.lock().await;
    let mut entries = read_client_storage(&state.client_storage_path).await?;
    if let Some(key) = requested_key {
        entries.retain(|entry_key, _| entry_key == &key);
    }
    Ok(json!({"entries":entries}))
}

async fn update_client_storage(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let entries = normalize_client_storage_entries(&body["entries"]);
    let _guard = state.client_storage_write.lock().await;
    let mut snapshot = read_client_storage(&state.client_storage_path).await?;
    let mut changed = false;
    for (key, value) in entries {
        if value.is_null() && !is_chat_preference_key(&key) {
            changed |= snapshot.remove(&key).is_some();
        } else if snapshot.get(&key) != Some(&value) {
            snapshot.insert(key, value);
            changed = true;
        }
    }
    if changed {
        write_json_object(&state.client_storage_path, &snapshot).await?;
    }
    Ok(json!({"ok":true}))
}

async fn read_json_object(path: &Path) -> serde_json::Map<String, serde_json::Value> {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return serde_json::Map::new();
    };
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

async fn write_json_object(
    path: &Path,
    entries: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(entries).map_err(|error| error.to_string())?;
    atomic_write::overwrite(path, &bytes).await
}

fn query_value(request: &Request, key: &str) -> Option<String> {
    url::form_urlencoded::parse(request.uri().query()?.as_bytes())
        .find_map(|(name, value)| (name == key).then(|| value.into_owned()))
}

fn safe_cwd(state: &ServerState, value: &str) -> Option<String> {
    if value.trim().is_empty() {
        return None;
    }
    state
        .allowed_paths
        .resolve_allowed_local_path(value)
        .map(|path| path.to_string_lossy().into_owned())
}

fn safe_limit(value: &str, fallback: usize, max: usize) -> usize {
    let parsed = if value.trim().is_empty() {
        Some(0.0)
    } else {
        value.parse::<f64>().ok()
    };
    parsed
        .filter(|value| value.is_finite())
        .map(|value| value.trunc().clamp(1.0, max as f64) as usize)
        .unwrap_or(fallback)
}

fn safe_hash(value: &str) -> bool {
    (7..=40).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn home_directory() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_os = "macos")]
fn default_user_data_directory() -> PathBuf {
    home_directory()
        .join("Library")
        .join("Application Support")
        .join("Inferay")
}

#[cfg(target_os = "windows")]
fn default_user_data_directory() -> PathBuf {
    std::env::var_os("APPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(home_directory)
        .join("Inferay")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn default_user_data_directory() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_directory().join(".local").join("share"))
        .join("inferay")
}

async fn native_markdown(request: Request) -> ApiResult<Response> {
    const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
    const MAX_LINES: usize = 50_000;
    #[derive(Deserialize)]
    struct Input {
        text: String,
        #[serde(default)]
        streaming: bool,
        #[serde(default)]
        chat: bool,
    }
    let headers = request.headers().clone();
    // A JSON escape can expand one input byte into six wire bytes.
    let bytes = match to_bytes(request.into_body(), MAX_TEXT_BYTES * 6 + 1024).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return Err(api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Markdown request exceeds the payload limit",
            ));
        }
    };
    let input: Input = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "Expected text and optional streaming/chat booleans",
            ));
        }
    };
    if input.text.len() > MAX_TEXT_BYTES
        || input.text.split('\n').take(MAX_LINES + 1).count() > MAX_LINES
    {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Markdown exceeds the 2 MiB or 50,000 line preparation limit",
        ));
    }
    // Store exact source identity, including parser version and both dialect options.
    // The shared cache accounts for the key bytes as well as the response bytes.
    let key = format!(
        "markdown:1:{}:{}:{}",
        input.streaming, input.chat, input.text
    );
    let job = render_jobs::cached(key, std::time::Duration::from_secs(300), move || {
        serde_json::to_vec(&markdown::prepare(&input.text, input.streaming, input.chat)).ok()
    });
    match tokio::time::timeout(std::time::Duration::from_secs(10), job).await {
        Ok(Ok((Some(body), hit))) => {
            let mut response = json_bytes_response(StatusCode::OK, body, &headers);
            response.headers_mut().insert(
                "x-render-cache",
                HeaderValue::from_static(if hit { "hit" } else { "miss" }),
            );
            Ok(response)
        }
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Markdown preparation unavailable",
        )),
    }
}

async fn native_diff(request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let body: NativeDiffBody = api_body(request).await?;
    let before = body.before.unwrap_or_default();
    let after = body.after.unwrap_or_default();
    let bytes = body
        .edits
        .iter()
        .fold(before.len().saturating_add(after.len()), |total, edit| {
            total
                .saturating_add(edit.old_string.len())
                .saturating_add(edit.new_string.len())
        });
    if bytes > 2 * 1024 * 1024 || body.edits.len() > 1024 {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Edit diff exceeds the preparation limit",
        ));
    }
    let task = render_jobs::run(move || {
        #[derive(Serialize)]
        struct PreparedResponse {
            prepared: inferay_native_diff::PreparedEditDiff,
        }
        inferay_native_diff::prepare_edit_diff(&before, &after, &body.edits).map(|prepared| {
            serde_json::to_vec(&PreparedResponse { prepared }).expect("prepared diff serialization")
        })
    });
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok(Ok(bytes))) => Ok(json_bytes_response(
            StatusCode::OK,
            bytes.into(),
            &request_headers,
        )),
        Ok(Ok(Err(error))) => Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, error)),
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Edit diff preparation unavailable",
        )),
    }
}

async fn await_cached_render(
    task: impl std::future::Future<Output = Result<(Option<axum::body::Bytes>, bool), String>>,
    started: std::time::Instant,
    headers: &HeaderMap,
    not_found: Option<&str>,
    unavailable: &str,
) -> ApiResult<Response> {
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok((Some(body), hit))) => Ok(cached_render_response(body, hit, started, headers)),
        Ok(Ok((None, _))) if not_found.is_some() => {
            Err(api_error(StatusCode::NOT_FOUND, not_found.unwrap()))
        }
        _ => Err(api_error(StatusCode::SERVICE_UNAVAILABLE, unavailable)),
    }
}

fn cached_render_response(
    body: axum::body::Bytes,
    hit: bool,
    started: std::time::Instant,
    headers: &HeaderMap,
) -> Response {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    body.hash(&mut hash);
    let etag = format!("\"{:x}\"", hash.finish());
    let unchanged =
        headers.get("if-none-match").and_then(|h| h.to_str().ok()) == Some(etag.as_str());
    let mut response = json_bytes_response(
        if unchanged {
            StatusCode::NOT_MODIFIED
        } else {
            StatusCode::OK
        },
        if unchanged {
            axum::body::Bytes::new()
        } else {
            body
        },
        headers,
    );
    response
        .headers_mut()
        .insert("etag", HeaderValue::from_str(&etag).unwrap());
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    response.headers_mut().insert(
        "server-timing",
        HeaderValue::from_str(&format!(
            "render;dur={:.2}, cache;desc=\"{}\"",
            started.elapsed().as_secs_f64() * 1000.0,
            if hit { "hit" } else { "miss" }
        ))
        .unwrap(),
    );
    response
}

fn json_bytes_response(
    status: StatusCode,
    body: axum::body::Bytes,
    request_headers: &HeaderMap,
) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json;charset=utf-8"),
    );
    add_cors_headers(response.headers_mut(), request_headers);
    response
}

fn json_response(
    status: StatusCode,
    value: serde_json::Value,
    request_headers: &HeaderMap,
) -> Response {
    let body = serde_json::to_vec(&value).expect("JSON value serialization cannot fail");
    json_bytes_response(status, body.into(), request_headers)
}

async fn serve_dist_path(
    state: &ServerState,
    path: &str,
    request_headers: &HeaderMap,
    head_only: bool,
) -> Option<Response> {
    let relative = path.strip_prefix('/').unwrap_or(path);
    if relative.is_empty() || relative.split('/').any(|part| part == "..") {
        return None;
    }
    let file = state.dist_dir.join(relative);
    if !file.is_file() {
        return None;
    }
    let content_type = content_type(&file);
    let cache = if path.starts_with("/assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Some(
        serve_file(
            &file,
            content_type,
            cache,
            content_type == "text/html",
            request_headers,
            &state.auth_token,
            head_only,
        )
        .await,
    )
}

async fn serve_renderer_index(
    state: &ServerState,
    headers: &HeaderMap,
    head_only: bool,
) -> Response {
    let index = state.dist_dir.join("index.html");
    if index.is_file() {
        if state.live_reload && !head_only {
            return serve_live_reload_index(state, &index, headers).await;
        }
        return serve_file(
            &index,
            "text/html",
            "no-cache",
            true,
            headers,
            &state.auth_token,
            head_only,
        )
        .await;
    }

    if !state.dist_dir.join("main.js").is_file() {
        return text_response(StatusCode::NOT_FOUND, "Not found");
    }

    let body = concat!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\" />",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />",
        "<title>inferay</title><meta name=\"theme-color\" content=\"#09090b\" />",
        "<meta name=\"color-scheme\" content=\"dark\" /></head>",
        "<body><div id=\"root\"></div><script type=\"module\" src=\"/main.js\"></script></body></html>"
    );
    response_with_headers(
        StatusCode::OK,
        if head_only {
            Body::empty()
        } else {
            Body::from(body)
        },
        "text/html",
        "no-cache",
        true,
        headers,
        &state.auth_token,
    )
}

async fn serve_live_reload_index(
    state: &ServerState,
    index: &Path,
    headers: &HeaderMap,
) -> Response {
    let Ok(html) = tokio::fs::read_to_string(index).await else {
        return text_response(StatusCode::NOT_FOUND, "Not found");
    };
    let revision = tokio::fs::metadata(index)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());
    let reload = format!(
        r#"<meta name="inferay-build" content="{revision}"><script>(()=>{{const revision="{revision}";setInterval(async()=>{{try{{const html=await fetch("/?inferay-live-reload="+Date.now(),{{cache:"no-store"}}).then(response=>response.text());const next=html.match(/name="inferay-build" content="([^"]+)"/);if(next&&next[1]!==revision)location.reload();}}catch{{}}}},500);}})();</script>"#
    );
    let html = html.replacen("</head>", &format!("{reload}</head>"), 1);
    response_with_headers(
        StatusCode::OK,
        Body::from(html),
        "text/html",
        "no-cache",
        true,
        headers,
        &state.auth_token,
    )
}

async fn serve_file(
    path: &Path,
    content_type: &'static str,
    cache_control: &'static str,
    set_cookie: bool,
    request_headers: &HeaderMap,
    auth_token: &str,
    head_only: bool,
) -> Response {
    match tokio::fs::read(path).await {
        Ok(bytes) => response_with_headers(
            StatusCode::OK,
            if head_only {
                Body::empty()
            } else {
                Body::from(bytes)
            },
            content_type,
            cache_control,
            set_cookie,
            request_headers,
            auth_token,
        ),
        Err(_) => text_response(StatusCode::NOT_FOUND, "Not found"),
    }
}

fn response_with_headers(
    status: StatusCode,
    body: Body,
    content_type: &'static str,
    cache_control: &'static str,
    set_cookie: bool,
    request_headers: &HeaderMap,
    auth_token: &str,
) -> Response {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    if set_cookie {
        response.headers_mut().insert(
            SET_COOKIE,
            HeaderValue::from_str(&local_auth_cookie_header(auth_token))
                .expect("UUID auth token must produce a valid cookie"),
        );
    }
    add_cors_headers(response.headers_mut(), request_headers);
    response
}

async fn native_websocket(
    State(state): State<ServerState>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !is_trusted_local_request(&headers, &state.auth_token) {
        return text_response(StatusCode::FORBIDDEN, "Forbidden");
    }
    upgrade
        .on_upgrade(move |socket| serve_native_websocket(state, socket))
        .into_response()
}

async fn serve_native_websocket(state: ServerState, socket: WebSocket) {
    let client_id = state.next_client_id.fetch_add(1, Ordering::Relaxed);
    let (sender, mut outgoing) = broadcast::channel(512);
    let mut connection_reset = state.connection_reset.subscribe();
    let (mut sink, mut stream) = socket.split();
    loop {
        tokio::select! {
            _ = connection_reset.recv() => break,
            incoming = stream.next() => match incoming {
                Some(Ok(AxumMessage::Text(text))) => {
                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                        handle_native_websocket_message(&state, client_id, &sender, message).await;
                    }
                }
                Some(Ok(AxumMessage::Binary(bytes))) => {
                    if let Ok(message) = serde_json::from_slice::<Value>(&bytes) {
                        handle_native_websocket_message(&state, client_id, &sender, message).await;
                    }
                }
                Some(Ok(AxumMessage::Ping(bytes))) => {
                    if sink.send(AxumMessage::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(AxumMessage::Pong(_))) => {}
                Some(Ok(AxumMessage::Close(_))) | Some(Err(_)) | None => break,
            },
            message = outgoing.recv() => match message {
                Ok(message) => {
                    if sink.send(AxumMessage::Text(message.to_string().into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },

        }
    }
    state.chat_runtime.detach_client(client_id).await;
    let _ = sink.close().await;
}

async fn handle_native_websocket_message(
    state: &ServerState,
    client_id: chat_runtime::ClientId,
    sender: &broadcast::Sender<Value>,
    message: Value,
) {
    let Some(message_type) = message.get("type").and_then(Value::as_str) else {
        return;
    };
    let pane_id = message
        .get("paneId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match message_type {
        "chat:destroy" if !pane_id.is_empty() => {
            state.chat_runtime.destroy_session(pane_id).await;
        }
        "chat:reconnect" if !pane_id.is_empty() => {
            let pane = state
                .agent_state_store
                .lock()
                .expect("agent state lock poisoned")
                .pane(pane_id);
            let pane_exists = match pane {
                Ok(pane) => pane.is_some(),
                Err(error) => {
                    let _ = sender.send(json!({"type":"chat:error","paneId":pane_id,"error":format!("Could not restore saved workspace: {error}")}));
                    return;
                }
            };
            if !pane_exists && let Err(error) = state.chat_runtime.cancel_handoffs(pane_id).await {
                let _ = sender.send(json!({"type":"chat:error","paneId":pane_id,"error":format!("Could not cancel removed chat handoff: {error}")}));
                return;
            }
            state
                .chat_runtime
                .reconnect(
                    pane_id,
                    client_id,
                    sender.clone(),
                    message.get("agentKind").and_then(Value::as_str),
                    message.get("sessionId").and_then(Value::as_str),
                    message
                        .get("cwd")
                        .and_then(Value::as_str)
                        .filter(|path| !path.is_empty())
                        .and_then(|path| state.allowed_paths.resolve_allowed_local_path(path)),
                )
                .await;
        }
        "chat:stop" if !pane_id.is_empty() => {
            state.chat_runtime.stop_generation(pane_id).await;
        }
        "chat:send" if !pane_id.is_empty() => {
            let mut input = match chat_runtime::SendMessageInput::deserialize(&message) {
                Ok(input) => input,
                Err(error) => {
                    let _ = sender.send(json!({"type":"chat:error","paneId":pane_id,"error":format!("Invalid chat request: {error}")}));
                    return;
                }
            };
            if message.get("agentKind").is_none() {
                input.agent_kind = "claude".into();
            }
            input.cwd_provided = !input.cwd.as_os_str().is_empty();
            input.reasoning_level_provided = message.get("reasoningLevel").is_some();
            input.reference_paths_provided = message.get("referencePaths").is_some();
            input.cwd = normalize_chat_cwd(state, Some(&input.cwd));
            input.reference_paths = normalize_chat_paths(state, &input.reference_paths);
            input.images = normalize_chat_paths(state, &input.images);
            input.include_workspace = input.cwd_provided || !input.reference_paths.is_empty();
            input.client_id = Some(client_id);
            input.client_sender = Some(sender.clone());
            let runtime = state.chat_runtime.clone();
            tokio::spawn(async move { runtime.send_message(input).await });
        }
        "chat:btw" if !pane_id.is_empty() => {
            let Some(text) = message.get("text").and_then(Value::as_str) else {
                return;
            };
            let cwd = normalize_chat_cwd(state, message["cwd"].as_str().map(Path::new));
            let pane_id = pane_id.to_string();
            let text = text.to_string();
            let resolver = state.agent_command_resolver.clone();
            let sender = sender.clone();
            tokio::spawn(async move {
                one_shot::run_btw_chat_message(&pane_id, &text, &cwd, &resolver, |message| {
                    let _ = sender.send(message);
                })
                .await;
            });
        }
        "checkpoint:revert" if !pane_id.is_empty() => {
            let Some(checkpoint_id) = message.get("checkpointId").and_then(Value::as_str) else {
                return;
            };
            let result = state
                .checkpoint_service
                .revert_to_checkpoint(checkpoint_id, pane_id)
                .await;
            let mut response = json!({
                "type": if result.ok { "checkpoint:reverted" } else { "checkpoint:error" },
                "paneId": pane_id,
                "checkpointId": checkpoint_id,
            });
            if result.ok {
                response["restoredFiles"] = json!(result.restored_files);
            } else {
                response["error"] = json!(result.error);
            }
            let _ = sender.send(response);
        }
        "file:read" => {
            let response = match message.get("path").and_then(Value::as_str) {
                Some(path) => websocket_file_read_response(state, path).await,
                None => json!({
                    "type": "file:error",
                    "path": "",
                    "error": "No path provided",
                }),
            };
            let _ = sender.send(response);
        }
        "subscribe" | "unsubscribe" => {}
        _ => {}
    }
}

async fn websocket_file_read_response(state: &ServerState, path: &str) -> Value {
    let requested = PathBuf::from(path);
    let (cwd, relative) = if requested.is_absolute() {
        let Some(parent) = requested.parent() else {
            return json!({"type":"file:error", "path":path, "error":"Access denied"});
        };
        (
            parent.to_string_lossy().into_owned(),
            requested
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
        )
    } else {
        (
            state
                .allowed_paths
                .project_root()
                .to_string_lossy()
                .into_owned(),
            path.to_owned(),
        )
    };
    match state.native_project_files.read(&cwd, &relative).await {
        Ok(file) => json!({"type":"file:content", "path":path, "content":file.content}),
        Err(error) => json!({"type":"file:error", "path":path, "error":error.to_string()}),
    }
}

fn normalize_chat_cwd(state: &ServerState, value: Option<&Path>) -> PathBuf {
    value
        .and_then(|path| state.allowed_paths.resolve_allowed_local_path(path))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| state.allowed_paths.project_root().to_path_buf())
}

fn normalize_chat_paths(state: &ServerState, paths: &[impl AsRef<Path>]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    paths
        .iter()
        .filter_map(|path| path.as_ref().to_str())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter_map(|path| state.allowed_paths.resolve_allowed_local_path(path))
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn is_trusted_local_request(headers: &HeaderMap, auth_token: &str) -> bool {
    let origin = header_text(headers, ORIGIN);
    let fetch_site = header_text(headers, HeaderName::from_static("sec-fetch-site"));
    let from_app_view = origin.is_some_and(|value| value.starts_with("views:"));
    let trusted_origin = match origin {
        None => matches!(fetch_site, Some("same-origin" | "none")),
        Some(origin) => is_trusted_local_origin(Some(origin)),
    };

    is_loopback_host(header_text(headers, HOST))
        && trusted_origin
        && (is_authorized_local_request(headers, auth_token) || from_app_view)
        && (from_app_view || fetch_site != Some("cross-site"))
}

fn is_authorized_local_request(headers: &HeaderMap, auth_token: &str) -> bool {
    let header_token = header_text(headers, HeaderName::from_static("x-inferay-auth"));
    let cookie_token = header_text(headers, COOKIE).and_then(|cookie| {
        cookie.split(';').find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key == LOCAL_AUTH_COOKIE)
                .then(|| percent_decode_str(value).decode_utf8_lossy().into_owned())
        })
    });
    header_token
        .map(str::to_owned)
        .or(cookie_token)
        .is_some_and(|token| token == auth_token)
}

fn is_trusted_local_origin(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return false };
    if origin == "null" {
        return false;
    }
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    url.scheme() == "views" || is_loopback_host(url.host_str())
}

fn is_loopback_host(value: Option<&str>) -> bool {
    let Some(value) = value else { return true };
    let raw = value.to_ascii_lowercase();
    if raw == "::1" {
        return true;
    }
    let host = if let Some(bracketed) = raw.strip_prefix('[') {
        bracketed.split(']').next().unwrap_or(&raw)
    } else {
        raw.split(':').next().unwrap_or(&raw)
    };
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".localhost")
}

fn add_cors_headers(response: &mut HeaderMap, request: &HeaderMap) {
    response.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(CORS_METHODS),
    );
    response.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(CORS_HEADERS),
    );
    if let Some(origin) =
        header_text(request, ORIGIN).filter(|origin| is_trusted_local_origin(Some(origin)))
        && let Ok(origin) = HeaderValue::from_str(origin)
    {
        response.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response.insert(VARY, HeaderValue::from_static("Origin"));
    }
}

fn local_auth_cookie_header(auth_token: &str) -> String {
    format!("{LOCAL_AUTH_COOKIE}={auth_token}; Path=/; SameSite=Strict")
}

fn header_text(headers: &HeaderMap, name: HeaderName) -> Option<&str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn public_asset(path: &str) -> Option<&'static str> {
    match path {
        "/logo.png" => Some("logo.png"),
        "/app-icon.png" => Some("app-icon.png"),
        "/background-city-rain.png" => Some("background-city-rain.png"),
        "/background-nature-sanctuary.png" => Some("background-nature-sanctuary.png"),
        "/background-orbital-study.png" => Some("background-orbital-study.png"),
        "/inferay-vibespace.png" => Some("inferay-vibespace.png"),
        _ => None,
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html",
        Some("js") => "application/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ico") => "image/x-icon",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn text_response(status: StatusCode, text: &'static str) -> Response {
    let mut response = Response::new(Body::from(text));
    *response.status_mut() = status;
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request as HttpRequest;
    use axum::routing::get;
    use tempfile::TempDir;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tower::ServiceExt;

    fn test_config(root: &Path) -> ServerConfig {
        ServerConfig {
            listen_addr: "127.0.0.1:0".parse().unwrap(),
            app_root: root.to_path_buf(),
            home_directory: root.to_path_buf(),
            user_data_dir: root.join("user-data"),
            auth_token: "test-token".into(),
            release_api_url: Some("http://127.0.0.1:9/release".into()),
            live_reload: false,
        }
    }

    #[tokio::test]
    async fn development_renderer_injects_live_reload_client() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("dist")).unwrap();
        std::fs::create_dir_all(root.path().join("public")).unwrap();
        std::fs::write(
            root.path().join("dist/index.html"),
            "<!doctype html><html><head></head><body></body></html>",
        )
        .unwrap();
        let mut config = test_config(root.path());
        config.live_reload = true;

        let response = router(config)
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();

        assert!(html.contains("name=\"inferay-build\""));
        assert!(html.contains("inferay-live-reload"));
    }

    #[tokio::test]
    async fn serves_the_renderer_shell_and_sets_the_auth_cookie() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("dist")).unwrap();
        std::fs::create_dir_all(root.path().join("public")).unwrap();
        std::fs::write(
            root.path().join("dist/index.html"),
            "<div id=\"root\"></div><script type=\"module\">",
        )
        .unwrap();

        let response = router(test_config(root.path()))
            .oneshot(
                HttpRequest::builder()
                    .uri("/#/agent")
                    .header(HOST, "127.0.0.1:4001")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "text/html");
        assert_eq!(
            response.headers()[SET_COOKIE],
            "inferay_local_auth=test-token; Path=/; SameSite=Strict"
        );
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert!(String::from_utf8_lossy(&body).contains("id=\"root\""));
    }

    #[tokio::test]
    async fn protects_api_requests_before_native_routing() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let forbidden = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri("/api/app-info")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let authorized = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri("/api/app-info")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(authorized.status(), StatusCode::OK);

        let preflight = app
            .oneshot(
                HttpRequest::builder()
                    .method(Method::OPTIONS)
                    .uri("/api/app-info")
                    .header(HOST, "[::1]:4001")
                    .header(ORIGIN, "http://[::1]:4001")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            preflight.headers()[ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://[::1]:4001"
        );
        assert_eq!(
            preflight.headers()[ACCESS_CONTROL_ALLOW_METHODS],
            CORS_METHODS
        );
    }

    #[tokio::test]
    async fn validates_forge_requests_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        for (route, body, status, message) in [
            (
                "clone",
                json!({}),
                StatusCode::BAD_REQUEST,
                "Missing Git URL",
            ),
            (
                "clone",
                json!({"gitUrl":"https://github.com/inferay/example.git"}),
                StatusCode::BAD_REQUEST,
                "Missing clone location",
            ),
            (
                "clone",
                json!({"gitUrl":"https://gitlab.com/inferay/example.git", "cloneDirectory":root.path()}),
                StatusCode::INTERNAL_SERVER_ERROR,
                "Only GitHub clone URLs are supported",
            ),
            (
                "connect",
                json!({"provider":"gitlab"}),
                StatusCode::BAD_REQUEST,
                "Only GitHub connect is supported right now",
            ),
        ] {
            let actual = call_json(
                &app,
                Method::POST,
                format!("/api/forge/{route}"),
                Some(body),
            )
            .await;
            assert_eq!(
                actual,
                (status, json!({"error":message})),
                "{route}: {message}"
            );
        }
    }

    #[tokio::test]
    async fn validates_one_shot_requests() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/generate-title".into(),
            Some(json!({ "message": " " })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "Missing message" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/generate-commit-message".into(),
            Some(json!({ "cwd": "/definitely/outside/inferay" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            value,
            json!({ "error": "Path is outside allowed local roots" })
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_one_shot_claude_and_staged_diff_generation_without_bun() {
        use std::os::unix::fs::PermissionsExt;

        let root = TempDir::new().unwrap();
        let claude_path = root.path().join(".local/bin/claude");
        std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
        std::fs::write(
            &claude_path,
            r#"#!/bin/sh
case "$2" in
  "Generate a concise title"*) result="Generated Rust Title" ;;
  "You are a git commit message generator"*) result="Port one-shot services to Rust" ;;
  *) result="automation result" ;;
esac
printf '{"type":"result","result":"%s"}\n' "$result"
"#,
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&claude_path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&claude_path, permissions).unwrap();

        run_git(root.path(), &["init", "-q"]);
        run_git(root.path(), &["config", "user.name", "Inferay Test"]);
        run_git(
            root.path(),
            &["config", "user.email", "inferay@example.com"],
        );
        std::fs::write(root.path().join("staged.txt"), "staged\n").unwrap();
        run_git(root.path(), &["add", "staged.txt"]);

        let app = router(test_config(root.path()));

        let value = post_json(
            &app,
            "/api/generate-title".into(),
            json!({ "message": "Move server behavior" }),
        )
        .await;
        assert_eq!(value, json!({ "title": "Generated Rust Title" }));

        let value = post_json(
            &app,
            "/api/git/generate-commit-message".into(),
            json!({ "cwd": root.path() }),
        )
        .await;
        assert_eq!(
            value,
            json!({ "message": "Port one-shot services to Rust" })
        );
    }

    #[tokio::test]
    async fn native_markdown_validates_and_reuses_prepared_responses() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let text = format!("# Native markdown {}", uuid::Uuid::new_v4());
        for (streaming, chat, expected_cache) in [
            (false, false, "miss"),
            (false, false, "hit"),
            (true, false, "miss"),
            (false, true, "miss"),
        ] {
            let response = call_http(
                &app,
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/native/markdown"),
                Body::from(json!({"text": text, "streaming": streaming, "chat": chat}).to_string()),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-render-cache"], expected_cache);
            let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
            let actual: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(actual["version"], 1);
            assert_eq!(
                actual,
                serde_json::to_value(markdown::prepare(&text, streaming, chat)).unwrap()
            );
        }
        for payload in [
            json!({}),
            json!({"text": 1}),
            json!({"text": "ok", "chat": "true"}),
        ] {
            let (status, _) = call_json(
                &app,
                Method::POST,
                "/api/native/markdown".into(),
                Some(payload),
            )
            .await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
        }
        for text in ["x".repeat(2 * 1024 * 1024 + 1), "\n".repeat(50_000)] {
            let (status, _) = call_json(
                &app,
                Method::POST,
                "/api/native/markdown".into(),
                Some(json!({"text": text})),
            )
            .await;
            assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        }
        let response = app
            .oneshot(
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/native/markdown")
                    .header(HOST, "127.0.0.1:4001")
                    .body(Body::from(json!({"text": "hello"}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn prepares_sequential_edit_spans_without_legacy_diff_payload() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let value = post_json(
            &app,
            "/api/native/diff".into(),
            json!({
                "edits": [
                    { "old_string": "const value = 1;", "new_string": "const value = 2;" },
                    { "old_string": "2", "new_string": "3" }
                ]
            }),
        )
        .await;
        assert!(value.get("diff").is_none());
        let lines = value["prepared"]["hunks"][0]["lines"].as_array().unwrap();
        assert_eq!(lines[0]["text"], "const value = 1;");
        assert_eq!(lines[1]["text"], "const value = 3;");
        assert!(
            lines[1]["segments"]
                .as_array()
                .unwrap()
                .iter()
                .any(|span| span["text"] == "3" && span["changed"] == true)
        );
        let (status, _) = call_json(
            &app,
            Method::POST,
            "/api/native/diff".into(),
            Some(json!({
                "before": "x".repeat(2 * 1024 * 1024 + 1), "after": ""
            })),
        )
        .await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn accepts_only_syncable_preference_values() {
        let entries = normalize_client_storage_entries(&json!({
            AGENT_STATE_STORAGE_KEY: "{\"groups\":[]}",
            "agent-layout-mode": "grid",
            "agent-workspace-dock:default": "{\"type\":\"panel\",\"id\":\"pane-1\"}",
            "unknown-key": "value",
            "agent-main-view": 42,
            "inferay-custom-theme": null,
            "inferay-chat-pane": "legacy transcript",
            "inferay-chat-queue-pane": "[]",
        }));
        assert_eq!(
            entries,
            json!({
                "agent-layout-mode": "grid",
                "agent-workspace-dock:default": "{\"type\":\"panel\",\"id\":\"pane-1\"}",
                "inferay-custom-theme": null,
            })
            .as_object()
            .unwrap()
            .clone()
        );
        assert!(
            normalize_client_storage_entries(&json!({ AGENT_STATE_STORAGE_KEY: null })).is_empty()
        );
        assert!(normalize_client_storage_entries(&serde_json::Value::Null).is_empty());
        assert!(normalize_client_storage_entries(&json!(["not", "an", "object"])).is_empty());
    }

    #[tokio::test]
    async fn persists_client_storage_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let config = test_config(root.path());
        let storage_path = config.user_data_dir.join("client-storage.json");
        let app = router(config);

        let value = post_json(
            &app,
            "/api/client-storage".into(),
            json!({
                "entries": {
                    AGENT_STATE_STORAGE_KEY: "{\"groups\":[]}",
                    "agent-layout-mode": "grid",
                    "agent-workspace-panels:default": "{\"detachedFilePanels\":[]}",
                    "unknown-key": "ignored",
                    "inferay-custom-theme": "night",
                }
            }),
        )
        .await;
        assert_eq!(value, json!({ "ok": true }));

        let value = get_json(&app, "/api/client-storage".into()).await;
        assert_eq!(
            value,
            json!({
                "entries": {
                    "agent-layout-mode": "grid",
                    "agent-workspace-panels:default": "{\"detachedFilePanels\":[]}",
                    "inferay-custom-theme": "night",
                }
            })
        );

        let value = get_json(&app, "/api/client-storage?key=inferay-custom-theme".into()).await;
        assert_eq!(
            value,
            json!({ "entries": { "inferay-custom-theme": "night" } })
        );

        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/client-storage".into(),
            Some(json!({
                "entries": {
                    "agent-layout-mode": null,
                    "sidebar-collapsed": "true",
                }
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));

        let persisted: serde_json::Value =
            serde_json::from_slice(&std::fs::read(storage_path).unwrap()).unwrap();
        assert_eq!(
            persisted,
            json!({
                "inferay-custom-theme": "night",
                "agent-workspace-panels:default": "{\"detachedFilePanels\":[]}",
                "sidebar-collapsed": "true",
            })
        );
    }

    #[tokio::test]
    async fn persists_search_folders_and_serves_background_images() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));

        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/config/search-folders".into(),
            Some(json!({ "folders": ["~/Code", "~/Work"] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "folders": ["~/Code", "~/Work"] }));

        let value = get_json(&app, "/api/config/search-folders".into()).await;
        assert_eq!(value, json!({ "folders": ["~/Code", "~/Work"] }));

        let boundary = "inferay-test-boundary";
        let image = b"test-png-bytes";
        let mut multipart = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sky.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .into_bytes();
        multipart.extend_from_slice(image);
        multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = call_http(
            &app,
            HttpRequest::builder()
                .method(Method::POST)
                .uri("/api/config/background-image")
                .header(
                    CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                ),
            Body::from(multipart),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], true);
        assert!(value["revision"].as_u64().unwrap() > 0);

        let response = call_http(
            &app,
            HttpRequest::builder().uri("/api/config/background-image"),
            Body::empty(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        assert_eq!(
            to_bytes(response.into_body(), 64 * 1024).await.unwrap(),
            image.as_slice()
        );
    }

    #[tokio::test]
    async fn serves_prompt_and_agent_context_routes_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("data")).unwrap();
        std::fs::write(
            root.path().join("data/prompts.json"),
            serde_json::to_vec_pretty(&json!([{
                "_id": "builtin-review",
                "name": "Review",
                "description": "Review code",
                "command": "review",
                "promptTemplate": "Review {args}",
                "category": "code",
                "tags": ["quality"],
                "isBuiltIn": true,
                "executionCount": 0,
                "createdAt": 1,
                "updatedAt": 1,
            }]))
            .unwrap(),
        )
        .unwrap();
        let app = router(test_config(root.path()));

        let prompts = get_json(&app, "/api/prompts".into()).await;
        assert_eq!(prompts.as_array().unwrap().len(), 1);
        assert_eq!(prompts[0]["_id"], "builtin-review");

        let created = post_json(
            &app,
            "/api/prompts".into(),
            json!({
                "name": "Explain",
                "description": "Explain code",
                "command": "explain",
                "promptTemplate": "Explain {args}",
                "tags": ["learning"],
            }),
        )
        .await;
        assert_eq!(created["isBuiltIn"], false);
        assert_eq!(created["category"], "custom");
        let id = created["_id"].as_str().unwrap();

        let (status, updated) = call_json(
            &app,
            Method::PUT,
            format!("/api/prompts/{id}"),
            Some(json!({
                "name": "Explain Carefully",
                "tags": ["learning", 3, "code"],
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["name"], "Explain Carefully");
        assert_eq!(updated["tags"], json!(["learning", "code"]));

        let value = post_json(&app, format!("/api/prompts/{id}/usage"), json!({})).await;
        assert_eq!(value, json!({ "ok": true }));

        let cwd = root.path().to_string_lossy();
        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/agent-context".into(),
            Some(json!({
                "scope": "global",
                "instructions": " global rules ",
                "mode": "inherit",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));
        let (status, _) = call_json(
            &app,
            Method::PUT,
            "/api/agent-context".into(),
            Some(json!({
                "scope": "project",
                "cwd": cwd.as_ref(),
                "instructions": "project rules",
                "mode": "inherit",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let context_uri = query_path(
            "/api/agent-context",
            &[("cwd", cwd.as_ref()), ("paneId", "pane-1")],
        );
        let context = get_json(&app, context_uri).await;
        assert_eq!(context["scope"], "project");
        assert_eq!(
            context["effectiveInstructions"],
            "global rules\n\nproject rules"
        );
        assert_eq!(context["skillCount"], 2);
        assert!(
            context["skillManifest"]
                .as_str()
                .unwrap()
                .contains("- explain: Explain code")
        );

        let (status, value) =
            call_json(&app, Method::DELETE, format!("/api/prompts/{id}"), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));
        let (status, value) = call_json(
            &app,
            Method::DELETE,
            "/api/prompts/builtin-review".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "Cannot delete built-in prompts" }));
    }

    #[tokio::test]
    async fn discovers_agent_directories_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let search_root = root.path().join("workspaces");
        std::fs::create_dir_all(search_root.join("AlphaProject/.git")).unwrap();
        std::fs::create_dir_all(search_root.join("nested/BetaProject")).unwrap();
        std::fs::create_dir_all(search_root.join("Hidden.app")).unwrap();
        ConfigManager::new(root.path().join("user-data/settings.json"))
            .set_search_folders(vec![search_root.to_string_lossy().into_owned()])
            .unwrap();
        let app = router(test_config(root.path()));

        let browse_uri = query_path(
            "/api/agent/directories",
            &[("path", search_root.to_string_lossy().as_ref())],
        );
        let value = get_json(&app, browse_uri).await;
        assert_eq!(value["directories"].as_array().unwrap().len(), 2);
        assert_eq!(value["directories"][0]["name"], "AlphaProject");
        assert_eq!(value["directories"][1]["name"], "nested");
        assert_eq!(value["parent"], root.path().to_string_lossy().as_ref());

        let value = get_json(&app, "/api/agent/directories?q=beta".into()).await;
        assert_eq!(value["directories"].as_array().unwrap().len(), 1);
        assert_eq!(value["directories"][0]["name"], "BetaProject");
        assert_eq!(value["parent"], serde_json::Value::Null);

        let value = get_json(&app, "/api/agent/directories?quickPicks=true".into()).await;
        assert_eq!(value["quickPicks"].as_array().unwrap().len(), 1);
        assert_eq!(value["quickPicks"][0]["name"], "AlphaProject");
        assert_eq!(value["quickPicks"][0]["isGitRepo"], true);

        let outside = TempDir::new().unwrap();
        let outside_uri = query_path(
            "/api/agent/directories",
            &[("path", outside.path().to_string_lossy().as_ref())],
        );
        let (status, value) = call_json(&app, Method::GET, outside_uri, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(value["error"], "Path is outside allowed local roots");
    }

    #[tokio::test]
    async fn workspace_panels_merge_independent_updates() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let route = "/api/workspace/panels";
        let initial = post_json(&app, route.into(), json!({
                "workspaceId":"/repo", "patch":{"mainViewMode":"graph", "selectedCommitHash":"abc", "selectedCommitIds":["abc"]}
            })).await;
        assert_eq!(initial["session"]["selectedCommitIds"], json!(["abc"]));
        let (first, second) = tokio::join!(
            call_json(
                &app,
                Method::POST,
                route.into(),
                Some(json!({"workspaceId":"/repo", "patch":{"sidebarVisible":false}}))
            ),
            call_json(
                &app,
                Method::POST,
                route.into(),
                Some(json!({"workspaceId":"/repo", "patch":{"fileViewerCwd":"/repo"}}))
            )
        );
        assert_eq!(first.0, StatusCode::OK);
        assert_eq!(second.0, StatusCode::OK);
        drop(app);
        let restarted = router(test_config(root.path()));
        let restored = post_json(
            &restarted,
            route.into(),
            json!({
                "workspaceId":"/repo"
            }),
        )
        .await;
        assert_eq!(restored["session"]["sidebarVisible"], false);
        assert_eq!(restored["session"]["fileViewerCwd"], "/repo");
        assert_eq!(restored["session"]["selectedCommitHash"], "abc");
    }

    #[tokio::test]
    async fn workspace_actions_persist_through_the_http_interface() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let initial = post_json(&app, "/api/agent/state/initialize".into(), json!({})).await;
        let group = &initial["state"]["selectedGroupId"];
        let next = post_json(
            &app,
            "/api/agent/state/workspace-action".into(),
            json!({"action":{"type":"renameWorkspace","groupId":group,"name":"Project"}}),
        )
        .await;
        let restarted = router(test_config(root.path()));
        let saved = get_json(&restarted, "/api/agent/state".into()).await;
        assert_eq!(saved, next["state"]);
        assert_eq!(saved["groups"][0]["name"], "Project");
    }

    #[tokio::test]
    async fn serves_app_identity_and_caches_release_check_failures() {
        let root = TempDir::new().unwrap();
        std::fs::write(
            root.path().join("version.json"),
            serde_json::to_vec_pretty(&json!({
                "name": "inferay",
                "version": "1.2.3",
                "hash": "release-hash",
                "channel": "stable",
                "identifier": "com.inferay.app"
            }))
            .unwrap(),
        )
        .unwrap();
        let app = router(test_config(root.path()));

        let first = get_json(&app, "/api/app-info".into()).await;
        assert_eq!(first["name"], "inferay");
        assert_eq!(first["version"], "1.2.3");
        assert_eq!(first["hash"], "release-hash");
        assert_eq!(first["channel"], "stable");
        assert_eq!(first["identifier"], "com.inferay.app");
        assert_eq!(first["production"], true);
        assert_eq!(first["update"]["available"], false);
        assert_eq!(first["update"]["currentVersion"], "1.2.3");
        assert_eq!(first["update"]["latestVersion"], Value::Null);
        assert_eq!(first["update"]["url"], Value::Null);
        assert!(first["update"]["checkedAt"].is_u64());
        assert!(first["update"]["error"].is_string());

        let second = get_json(&app, "/api/app-info".into()).await;
        assert_eq!(
            second["update"]["checkedAt"], first["update"]["checkedAt"],
            "failed release checks retain the existing 60-second cache contract"
        );
    }

    #[tokio::test]
    async fn caches_successful_native_release_checks_without_bun() {
        let request_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = Arc::clone(&request_count);
        let release_app = Router::new().fallback(get(move || {
            let count = Arc::clone(&count);
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                axum::Json(json!({
                    "tag_name": "v1.2.4",
                    "html_url": "https://example.test/releases/v1.2.4"
                }))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let release_address = listener.local_addr().unwrap();
        let release_server = tokio::spawn(async move {
            axum::serve(listener, release_app).await.unwrap();
        });

        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("packages/inferay")).unwrap();
        std::fs::write(
            root.path().join("packages/inferay/package.json"),
            r#"{ "version": "1.2.3" }"#,
        )
        .unwrap();
        let mut config = test_config(root.path());
        config.release_api_url = Some(format!("http://{release_address}/release"));
        let app = router(config);

        let first = get_json(&app, "/api/app-info".into()).await;
        assert_eq!(first["version"], "1.2.3");
        assert_eq!(first["production"], false);
        assert_eq!(first["update"]["available"], true);
        assert_eq!(first["update"]["latestVersion"], "1.2.4");
        assert_eq!(
            first["update"]["url"],
            "https://example.test/releases/v1.2.4"
        );
        assert!(first["update"].get("error").is_none());

        let second = get_json(&app, "/api/app-info".into()).await;
        assert_eq!(second["update"], first["update"]);
        assert_eq!(request_count.load(Ordering::SeqCst), 1);

        release_server.abort();
    }

    #[tokio::test]
    async fn reports_agent_account_health_without_bun() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));

        let value = get_json(&app, "/api/agents/account-status".into()).await;
        let providers = value["providers"].as_array().unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0]["kind"], "claude");
        assert_eq!(providers[0]["label"], "Claude");
        assert_eq!(providers[1]["kind"], "codex");
        assert_eq!(providers[1]["label"], "Codex");
        for provider in providers {
            assert!(provider["installed"].is_boolean());
            assert!(provider["binaryPath"].is_string());
            assert!(provider["version"].is_null() || provider["version"].is_string());
            assert!(provider["authConfigPaths"].is_array());
            assert_eq!(provider["usageSignals"].as_array().unwrap().len(), 2);
            assert!(provider["checkedAt"].is_u64());
            assert!(matches!(
                provider["health"].as_str(),
                Some("ready" | "needs-login" | "missing-cli")
            ));
            assert!(provider["summary"].is_string());
        }
    }

    #[tokio::test]
    async fn serves_file_search_content_and_image_routes_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let repository = root_path.join("repository");
        std::fs::create_dir(&repository).unwrap();
        run_git(&repository, &["init", "-q"]);
        std::fs::create_dir(repository.join("src")).unwrap();
        std::fs::write(repository.join("src/main.ts"), "export const value = 1;\n").unwrap();
        std::fs::write(repository.join("README.md"), "repository\n").unwrap();
        run_git(&repository, &["add", "src/main.ts"]);

        let config = test_config(&root_path);
        std::fs::create_dir_all(&config.user_data_dir).unwrap();
        std::fs::write(
            config.user_data_dir.join("agent-state.json"),
            json!({
                "groups": [{
                    "id": "group-1", "name":"Main", "columns":1, "rows":1,
                    "selectedPaneId": "pane-2",
                    "panes": [
                        { "id": "pane-1", "title":"Root", "agentKind":"codex", "cwd": root_path },
                        { "id": "pane-2", "title":"Repo", "agentKind":"codex", "cwd": repository },
                    ],
                }],
                "selectedGroupId": "group-1",
                "themeId":"default", "fontSize":13, "fontFamily":"SF Mono", "opacity":1,
            })
            .to_string(),
        )
        .unwrap();
        let app = router(config);

        let search_uri = query_path("/api/files/search", &[("q", "main"), ("limit", "20")]);
        let search = get_json(&app, search_uri).await;
        assert_eq!(search["cwd"], repository.to_string_lossy().as_ref());
        assert_eq!(search["cwds"][0], repository.to_string_lossy().as_ref());
        assert_eq!(search["results"][0]["path"], "src/main.ts");
        assert_eq!(search["results"][0]["isDir"], false);

        let content_uri = query_path(
            "/api/files/content",
            &[
                ("cwd", repository.to_string_lossy().as_ref()),
                ("path", "src/main.ts"),
            ],
        );
        let content = get_json(&app, content_uri).await;
        assert_eq!(content["content"], "export const value = 1;\n");
        assert_eq!(content["path"], "src/main.ts");
        assert_eq!(content["size"], 24);

        let denied_uri = query_path(
            "/api/files/content",
            &[
                ("cwd", repository.to_string_lossy().as_ref()),
                ("path", "../outside.txt"),
            ],
        );
        let (status, denied) = call_json(&app, Method::GET, denied_uri, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(denied, json!({ "error": "Access denied" }));

        let boundary = "inferay-upload-boundary";
        let image = b"temporary-png";
        let mut multipart = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a weird.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .into_bytes();
        multipart.extend_from_slice(image);
        multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = call_http(
            &app,
            HttpRequest::builder()
                .method(Method::POST)
                .uri("/api/upload-temp")
                .header(
                    CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                ),
            Body::from(multipart),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let uploaded: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let uploaded_path = uploaded["path"].as_str().unwrap();
        assert!(uploaded_path.ends_with("-a_weird.png"));

        let listed = get_json(&app, "/api/images".into()).await;
        assert_eq!(listed["images"][0]["name"], "a_weird.png");
        assert_eq!(listed["images"][0]["path"], uploaded_path);
        assert_eq!(listed["images"][0]["size"], image.len());

        let file_uri = query_path("/api/file", &[("path", uploaded_path)]);
        let response = call_http(&app, HttpRequest::builder().uri(file_uri), Body::empty()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(
            to_bytes(response.into_body(), 64 * 1024).await.unwrap(),
            image.as_slice()
        );

        let delete_uri = query_path("/api/delete-temp", &[("path", uploaded_path)]);
        let (status, deleted) = call_json(&app, Method::DELETE, delete_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(deleted, json!({ "ok": true }));
        assert!(!Path::new(uploaded_path).exists());
    }

    #[test]
    fn formats_selected_folder_like_the_previous_bun_route() {
        let home = home_directory().to_string_lossy().into_owned();
        assert_eq!(
            display_folder_path(&format!("{home}/Developer/inferay/")),
            "~/Developer/inferay"
        );
        assert_eq!(display_folder_path("/opt/projects/"), "/opt/projects");
    }

    pub(crate) fn run_git(repository: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(repository)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn query_path(path: &str, values: &[(&str, &str)]) -> String {
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        for (name, value) in values {
            serializer.append_pair(name, value);
        }
        format!("{path}?{}", serializer.finish())
    }

    async fn get_json(app: &Router, uri: String) -> Value {
        let (status, body) = call_json(app, Method::GET, uri, None).await;
        assert_eq!(status, StatusCode::OK);
        body
    }

    async fn post_json(app: &Router, uri: String, body: Value) -> Value {
        let (status, body) = call_json(app, Method::POST, uri, Some(body)).await;
        assert_eq!(status, StatusCode::OK);
        body
    }

    async fn call_http(
        app: &Router,
        request: axum::http::request::Builder,
        body: Body,
    ) -> Response {
        app.clone()
            .oneshot(
                request
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(body)
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn call_json(
        app: &Router,
        method: Method,
        uri: String,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value) {
        let response = call_http(
            app,
            HttpRequest::builder().method(method).uri(uri),
            body.map_or_else(Body::empty, |value| Body::from(value.to_string())),
        )
        .await;
        let status = response.status();
        let body = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
        let value = serde_json::from_slice(&body).unwrap();
        (status, value)
    }

    #[tokio::test]
    async fn serves_chat_persistence_routes_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let user_data = root.path().join("user-data");
        std::fs::create_dir_all(&user_data).unwrap();
        let app = router(test_config(root.path()));

        let queue = json!([{
            "id": "queued-1",
            "text": "continue",
            "displayText": "continue"
        }]);
        chat_persistence::ChatPersistence::new(user_data.clone())
            .enqueue_runtime("pane-1", queue[0].clone())
            .await
            .unwrap();
        let value = get_json(&app, "/api/chat-queues/pane-1".into()).await;
        assert_eq!(value["queue"], queue);

        let (status, value) = call_json(
            &app,
            Method::PATCH,
            "/api/chat-queues/pane-1".into(),
            Some(json!({"action":"edit","id":"queued-1","text":" updated "})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["queue"][0]["text"], "updated");
        let (status, _) = call_json(
            &app,
            Method::PATCH,
            "/api/chat-queues/pane-1".into(),
            Some(json!({"action":"edit","id":"queued-1","text":" "})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, value) = call_json(
            &app,
            Method::PATCH,
            "/api/chat-queues/pane-1".into(),
            Some(json!({"action":"remove","id":"queued-1"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["queue"], json!([]));
        let (status, value) = call_json(
            &app,
            Method::PATCH,
            "/api/chat-queues/pane-1".into(),
            Some(json!({"action":"edit","id":"queued-1","text":"too late"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["queue"], json!([]));

        let (status, value) =
            call_json(&app, Method::DELETE, "/api/chat-queues/pane-1".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));
    }

    #[tokio::test]
    async fn serves_git_statuses_and_graph_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let repository = root_path.join("repository");
        std::fs::create_dir(&repository).unwrap();
        run_git(&repository, &["init", "-q"]);
        run_git(&repository, &["config", "user.name", "Inferay Test"]);
        run_git(
            &repository,
            &["config", "user.email", "inferay@example.com"],
        );
        std::fs::write(repository.join("README.md"), "first\nold\n").unwrap();
        run_git(&repository, &["add", "README.md"]);
        run_git(
            &repository,
            &[
                "-c",
                "user.name=Inferay Test",
                "-c",
                "user.email=inferay@example.com",
                "commit",
                "-q",
                "-m",
                "initial",
            ],
        );
        std::fs::write(repository.join("README.md"), "first\nchanged\nadded\n").unwrap();
        std::fs::write(repository.join("untracked.txt"), "new\n").unwrap();

        let cwd = repository.to_string_lossy();
        let app = router(test_config(&root_path));
        let response = call_http(
            &app,
            HttpRequest::builder()
                .method(Method::POST)
                .uri("/api/git/statuses"),
            Body::from(json!({ "cwds": [cwd.as_ref(), cwd.as_ref()] }).to_string()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value.as_array().unwrap().len(), 1);
        assert_eq!(
            value[0]["filePresentation"]["pathOrder"],
            json!(["README.md", "untracked.txt"])
        );
        let files = value[0]["files"].as_array().unwrap();
        let readme = files
            .iter()
            .find(|file| file["path"] == "README.md")
            .unwrap();
        assert_eq!(readme["status"], "M");
        assert_eq!(readme["staged"], false);
        assert_eq!(readme["additions"], 2);
        assert_eq!(readme["deletions"], 1);
        let untracked = files
            .iter()
            .find(|file| file["path"] == "untracked.txt")
            .unwrap();
        assert_eq!(untracked["status"], "?");
        assert!(untracked.get("additions").is_none());

        let full_diff_uri = query_path(
            "/api/git/full-diff",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("staged", "false"),
            ],
        );
        let value = get_json(&app, full_diff_uri).await;
        assert!(value.get("rawPatch").is_none());
        assert_eq!(value["metadata"]["stats"]["added"], 2);
        assert!(
            value["newLines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "add")
        );

        let review_diff_uri = query_path(
            "/api/git/full-diff",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("staged", "false"),
                ("view", "review"),
            ],
        );
        let value = get_json(&app, review_diff_uri).await;
        assert!(value.get("rawPatch").is_none());
        assert!(value.get("inlineLines").is_none());
        assert_eq!(value["metadata"]["stats"]["removed"], 1);
        assert!(
            value["oldLines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "remove")
        );
        assert!(
            value["newLines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "add")
        );
        assert!(
            value["compactLines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "add")
        );

        let graph_uri = query_path("/api/git/graph", &[("cwd", cwd.as_ref()), ("limit", "10")]);
        let response = call_http(&app, HttpRequest::builder().uri(&graph_uri), Body::empty()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let etag = response.headers().get("etag").unwrap().clone();
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let graph_commits = value["commits"].as_array().unwrap();
        assert_eq!(graph_commits.len(), 2);
        assert_eq!(graph_commits[0]["itemKind"], "worktreeWip");
        let initial = graph_commits
            .iter()
            .find(|commit| commit["message"] == "initial")
            .unwrap();
        assert_eq!(initial["authorEmail"], "inferay@example.com");
        assert_eq!(value["rows"][0]["row"], 0);

        let unchanged = call_http(
            &app,
            HttpRequest::builder()
                .uri(&graph_uri)
                .header("if-none-match", etag),
            Body::empty(),
        )
        .await;
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
        assert!(
            to_bytes(unchanged.into_body(), 64 * 1024)
                .await
                .unwrap()
                .is_empty()
        );

        let search_uri = query_path(
            "/api/git/graph",
            &[("cwd", cwd.as_ref()), ("limit", "10"), ("query", "initial")],
        );
        let search = get_json(&app, search_uri).await;
        assert_eq!(search["commits"].as_array().unwrap().len(), 1);
        assert_eq!(search["commits"][0]["message"], "initial");

        let outside = TempDir::new().unwrap();
        let outside_cwd = outside.path().to_string_lossy();
        let forbidden_graph = query_path(
            "/api/git/graph",
            &[("cwd", outside_cwd.as_ref()), ("limit", "10")],
        );
        let (status, _) = call_json(&app, Method::GET, forbidden_graph, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        for endpoint in [
            "/api/git/ref-operation-preflight",
            "/api/git/ref-operation",
            "/api/git/graph-action",
        ] {
            let (status, _) = call_json(
                &app,
                Method::POST,
                endpoint.into(),
                Some(json!({
                    "cwd": outside_cwd.as_ref(),
                    "source": "main",
                    "target": "feature",
                    "operation": "merge",
                    "action": "fetch"
                })),
            )
            .await;
            assert!(status.is_client_error());
        }
        for (endpoint, parameters) in [
            (
                "/api/git/commit-details",
                vec![("cwd", outside_cwd.as_ref()), ("hash", "deadbeef")],
            ),
            (
                "/api/git/commit-diff",
                vec![
                    ("cwd", outside_cwd.as_ref()),
                    ("hash", "deadbeef"),
                    ("file", "README.md"),
                ],
            ),
            (
                "/api/git/comparison-details",
                vec![
                    ("cwd", outside_cwd.as_ref()),
                    ("from", "deadbeef"),
                    ("to", "feedface"),
                ],
            ),
            (
                "/api/git/comparison-diff",
                vec![
                    ("cwd", outside_cwd.as_ref()),
                    ("from", "deadbeef"),
                    ("to", "feedface"),
                    ("file", "README.md"),
                ],
            ),
        ] {
            let uri = query_path(endpoint, &parameters);
            let (status, _) = call_json(&app, Method::GET, uri, None).await;
            assert!(
                status.is_client_error(),
                "{endpoint} accepted an outside path"
            );
        }

        run_git(&repository, &["branch", "feature"]);
        let branches_uri = query_path("/api/git/branches", &[("cwd", cwd.as_ref())]);
        let value = get_json(&app, branches_uri).await;
        assert_eq!(value["branches"].as_array().unwrap().len(), 2);
        assert_eq!(
            value["branches"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|branch| branch["current"] == true)
                .count(),
            1
        );

        let value = post_json(
            &app,
            "/api/git/branches".to_string(),
            json!({ "cwd": cwd.as_ref(), "branch": "feature" }),
        )
        .await;
        assert_eq!(value["ok"], false);
        assert_eq!(value["error_kind"], "dirtyWorktree");

        let value = post_json(
            &app,
            "/api/git/stage".to_string(),
            json!({ "cwd": cwd.as_ref() }),
        )
        .await;
        assert_eq!(value, json!({ "success": true }));

        let value = post_json(
            &app,
            "/api/git/commit".to_string(),
            json!({ "cwd": cwd.as_ref(), "message": "native route commit" }),
        )
        .await;
        assert_eq!(value["success"], true);
        let commit_hash = value["hash"].as_str().unwrap();

        let value = post_json(
            &app,
            "/api/git/branches".to_string(),
            json!({ "cwd": cwd.as_ref(), "branch": "feature" }),
        )
        .await;
        assert_eq!(value, json!({ "ok": true, "branch": "feature" }));
        run_git(&repository, &["checkout", "main"]);

        let details_uri = query_path(
            "/api/git/commit-details",
            &[("cwd", cwd.as_ref()), ("hash", commit_hash)],
        );
        let value = get_json(&app, details_uri).await;
        assert_eq!(value["details"]["message"], "native route commit");
        assert_eq!(value["details"]["authorEmail"], "inferay@example.com");
        assert!(value["details"].get("author_email").is_none());
        assert!(
            value["details"]["files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|file| file["path"] == "README.md")
        );

        std::fs::write(repository.join("README.md"), "unstaged again\n").unwrap();
        run_git(&repository, &["add", "README.md"]);
        let value = post_json(
            &app,
            "/api/git/unstage".to_string(),
            json!({ "cwd": cwd.as_ref(), "file": "README.md" }),
        )
        .await;
        assert_eq!(value, json!({ "success": true }));

        for (action, ok) in [("createBranch", true), ("unknown", false)] {
            let value = post_json(
                &app,
                "/api/git/graph-action".into(),
                json!({
                    "cwd":cwd.as_ref(), "action":action, "target":commit_hash, "name":"from-graph"
                }),
            )
            .await;
            assert_eq!(value["ok"], ok);
            assert_eq!(value["operation"], action);
            assert_eq!(value["outcome"], if ok { "completed" } else { "failed" });
            assert!(value.get("action").is_none());
        }

        let invalid_uri = query_path("/api/git/status", &[("cwd", "/outside-inferay")]);
        let response =
            call_http(&app, HttpRequest::builder().uri(invalid_uri), Body::empty()).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn matches_loopback_and_origin_rules() {
        assert!(is_loopback_host(None));
        assert!(is_loopback_host(Some("localhost:4001")));
        assert!(is_loopback_host(Some("127.0.0.1:4001")));
        assert!(is_loopback_host(Some("[::1]:4001")));
        assert!(is_loopback_host(Some("inferay.localhost:4001")));
        assert!(!is_loopback_host(Some("example.com")));
        assert!(is_trusted_local_origin(Some("views://app")));
        assert!(is_trusted_local_origin(Some("http://127.0.0.1:4001")));
        assert!(is_trusted_local_origin(Some("http://[::1]:4001")));
        assert!(!is_trusted_local_origin(Some("null")));
        assert!(!is_trusted_local_origin(Some("https://example.com")));
    }

    #[tokio::test]
    async fn owns_authenticated_http_and_websocket_traffic_without_a_backend() {
        let root = TempDir::new().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let mut server = ServerHandle::start(test_config(&root_path)).unwrap();

        let response = Client::new()
            .get(format!("http://{}/api/value", server.local_addr()))
            .header("sec-fetch-site", "none")
            .header(COOKIE, "inferay_local_auth=test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let mut request = format!("ws://{}/ws", server.local_addr())
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("sec-fetch-site", HeaderValue::from_static("none"));
        request.headers_mut().insert(
            COOKIE,
            HeaderValue::from_static("inferay_local_auth=test-token"),
        );
        let (mut socket, _) = connect_async(request).await.unwrap();
        socket
            .send(TungsteniteMessage::Text(
                json!({"type":"chat:reconnect","paneId":"missing-pane"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let mut reconnect_types = Vec::new();
        for _ in 0..3 {
            let TungsteniteMessage::Text(message) = socket.next().await.unwrap().unwrap() else {
                panic!("expected reconnect text message");
            };
            let value: Value = serde_json::from_str(&message).unwrap();
            if value["type"] == "chat:sync" {
                assert_eq!(value["modelVersion"], 1);
                assert!(value["epoch"].is_string());
            }
            reconnect_types.push(value["type"].as_str().unwrap().to_string());
        }
        assert_eq!(reconnect_types, ["chat:sync", "chat:queue", "chat:status"]);

        let preview_path = root_path.join("preview.md");
        std::fs::write(&preview_path, "# Native preview\n").unwrap();
        socket
            .send(TungsteniteMessage::Text(
                json!({"type":"file:read","path":preview_path})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let TungsteniteMessage::Text(message) = socket.next().await.unwrap().unwrap() else {
            panic!("expected file content text message");
        };
        let value: Value = serde_json::from_str(&message).unwrap();
        assert_eq!(value["type"], "file:content");
        assert_eq!(value["path"], preview_path.to_string_lossy().as_ref());
        assert_eq!(value["content"], "# Native preview\n");

        socket
            .send(TungsteniteMessage::Text(
                json!({"type":"file:read","path":"/outside-inferay/secret.md"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        let TungsteniteMessage::Text(message) = socket.next().await.unwrap().unwrap() else {
            panic!("expected file error text message");
        };
        let value: Value = serde_json::from_str(&message).unwrap();
        assert_eq!(value["type"], "file:error");
        assert_eq!(value["path"], "/outside-inferay/secret.md");
        assert_eq!(value["error"], "Invalid directory");

        socket.close(None).await.unwrap();

        server.shutdown();
    }
}
