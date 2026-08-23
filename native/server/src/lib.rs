use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
#[cfg(test)]
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
    GitFileWithDiff, NativeRequest, NativeResponse, checkout_git_branch, commit_git, get_git_blame,
    get_git_branches, get_git_commit_details, get_git_diff, get_git_file_history,
    get_git_file_with_diff, get_git_graph, get_git_hunk_diff, get_git_log, get_git_status,
    is_changed_git_file, stage_git, unstage_git,
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
pub mod automation_service;
pub mod btw;
mod chat_persistence;
mod chat_runtime;
pub mod checkpoint;
mod forge;
pub mod native_agent_context;
mod native_app;
pub mod native_chat;
pub mod native_chat_service;
pub mod native_directories;
pub mod native_files;
pub mod native_git;
pub mod native_project_files;
pub mod native_project_map;
pub mod native_prompts;
pub mod native_sessions;
mod one_shot;
mod pid_tracker;

const LOCAL_AUTH_COOKIE: &str = "inferay_local_auth";
const MAX_PROXY_BODY_BYTES: usize = 32 * 1024 * 1024;
const MAX_NATIVE_DIFF_LINES: usize = 2_000;
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
    pub automation_routes_enabled: bool,
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
            automation_routes_enabled: std::env::var_os("AGENT_GUI_APP_ROOT").is_some(),
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
    automation_service: automation_service::AutomationService,
    automation_routes_enabled: bool,
    client_storage_path: PathBuf,
    client_storage_write: Arc<tokio::sync::Mutex<()>>,
    chat_persistence: chat_persistence::ChatPersistence,
    chat_runtime: chat_runtime::ChatRuntime,
    checkpoint_service: checkpoint::CheckpointService,
    config_manager: Arc<tokio::sync::Mutex<ConfigManager>>,
    native_git: native_git::NativeGit,
    native_project_files: native_project_files::NativeProjectFiles,
    forge_state: Arc<forge::ForgeState>,
    native_sessions: native_sessions::NativeSessions,
    native_files: native_files::NativeFiles,
    native_chat_handoff: native_chat::NativeChatHandoff,
    native_chat_service: native_chat_service::NativeChatService,
    native_directories: native_directories::NativeAgentDirectories,
    native_agent_context: native_agent_context::NativeAgentContext,
    native_prompts: native_prompts::NativePrompts,
    pid_tracker: pid_tracker::RuntimePidTracker,
    release_api_url: Option<String>,
    release_check_cache: Arc<tokio::sync::Mutex<Option<native_app::ReleaseCheckCache>>>,
    temp_dir: PathBuf,
    auth_token: String,
    client: Client,
    connection_reset: broadcast::Sender<()>,
}

#[derive(Clone)]
struct DirectAgentExecutor {
    resolver: Arc<AgentCommandResolver>,
    pid_tracker: pid_tracker::RuntimePidTracker,
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
            Ok(chat_runtime::ExecutedTurn { result, protocol })
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
struct GitFileBody {
    cwd: Option<String>,
    file: Option<String>,
}

#[derive(Deserialize)]
struct GitCommitBody {
    cwd: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct GitWatchBody {
    cwd: Option<String>,
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
    let scripts_dir = config.app_root.join("scripts");
    let bundled_prompts = config.app_root.join("data/prompts.json");
    let agent_state_path = config.user_data_dir.join("agent-state.json");
    let legacy_agent_state_path = config.user_data_dir.join("terminal-state.json");
    let checkpoints_path = config.user_data_dir.join("checkpoints.json");
    let checkpoint_service =
        checkpoint::CheckpointService::new(allowed_paths.clone(), checkpoints_path);
    let checkpoint_loader = checkpoint_service.clone();
    tokio::spawn(async move { checkpoint_loader.load().await });
    let pid_tracker =
        pid_tracker::RuntimePidTracker::new(config.user_data_dir.join("runtime-pids.json"));
    let orphan_cleaner = pid_tracker.clone();
    tokio::spawn(async move { orphan_cleaner.cleanup_orphans().await });
    let agent_command_resolver = Arc::new(AgentCommandResolver::new(config.home_directory.clone()));
    let automation_service = automation_service::AutomationService::new(
        config.user_data_dir.join("automations.json"),
        agent_command_resolver.clone(),
    );
    let agent_context_store = Arc::new(tokio::sync::Mutex::new(AgentContextStore::new(
        config.user_data_dir.join("agent-context.json"),
    )));
    let prompt_store = Arc::new(tokio::sync::Mutex::new(PromptStore::new(
        bundled_prompts,
        config.user_data_dir.join("prompts.json"),
    )));
    let native_prompts = native_prompts::NativePrompts::new(prompt_store.clone());
    let native_agent_context = native_agent_context::NativeAgentContext::new(
        agent_context_store.clone(),
        prompt_store.clone(),
    );
    let config_manager = Arc::new(tokio::sync::Mutex::new(ConfigManager::new(
        scripts_dir.join("config.yaml"),
        scripts_dir.join("config.local.yaml"),
    )));
    let native_directories = native_directories::NativeAgentDirectories::with_config_manager(
        allowed_paths.clone(),
        config_manager.clone(),
    );
    let native_git = native_git::NativeGit::new(allowed_paths.clone());
    let chat_persistence = chat_persistence::ChatPersistence::new(config.user_data_dir.clone());
    let agent_state_store = Arc::new(Mutex::new(AgentStateStore::new(
        agent_state_path.clone(),
        legacy_agent_state_path.clone(),
    )));
    let native_project_files = native_project_files::NativeProjectFiles::with_agent_state(
        allowed_paths.clone(),
        agent_state_store.clone(),
    );
    let native_sessions = native_sessions::NativeSessions::with_persistence(
        config.user_data_dir.clone(),
        chat_persistence.clone(),
        agent_state_store.clone(),
    );
    let native_files = native_files::NativeFiles::from_app_root(&config.app_root);
    let client_storage_write = Arc::new(tokio::sync::Mutex::new(()));
    let native_chat_handoff = native_chat::NativeChatHandoff::with_storage(
        config.user_data_dir.clone(),
        client_storage_write.clone(),
    );
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
    let native_chat_service = native_chat_service::NativeChatService::new(
        chat_runtime.clone(),
        tokio::runtime::Handle::current(),
        Arc::new(AtomicU64::new(1)),
        allowed_paths.clone(),
        checkpoint_service.clone(),
    );
    let state = ServerState {
        dist_dir,
        public_dir: config.app_root.join("public"),
        allowed_paths,
        agent_command_resolver,
        agent_state_store,
        background_dir: config.user_data_dir.join("backgrounds"),
        automation_service,
        automation_routes_enabled: config.automation_routes_enabled,
        client_storage_path: config.user_data_dir.join("client-storage.json"),
        client_storage_write,
        chat_persistence,
        chat_runtime,
        checkpoint_service,
        config_manager,
        native_git: native_git.clone(),
        native_project_files: native_project_files.clone(),
        forge_state: Arc::new(forge::ForgeState::default()),
        native_sessions,
        native_files,
        native_chat_handoff,
        native_chat_service: native_chat_service.clone(),
        native_directories,
        native_agent_context,
        native_prompts,
        pid_tracker,
        release_api_url: config.release_api_url,
        release_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
        temp_dir: config.app_root.join("data/.tmp"),
        auth_token: config.auth_token,
        client: Client::new(),
        connection_reset,
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
        if path == "/api/native/diff" && request.method() == Method::POST {
            return native_diff(request).await;
        }
        if path == "/api/client-storage" {
            if request.method() == Method::GET {
                return get_client_storage(&state, request).await;
            }
            if request.method() == Method::POST || request.method() == Method::PUT {
                return update_client_storage(&state, request).await;
            }
        }
        if path == "/api/config" {
            if request.method() == Method::GET {
                return get_config(&state, request).await;
            }
            if request.method() == Method::PUT {
                return update_config(&state, request).await;
            }
        }
        if path == "/api/config/search-folders" {
            if request.method() == Method::GET {
                return get_search_folders(&state, request).await;
            }
            if request.method() == Method::PUT {
                return update_search_folders(&state, request).await;
            }
        }
        if path == "/api/config/background-image" {
            if request.method() == Method::GET {
                return get_background_image(&state, request).await;
            }
            if request.method() == Method::POST {
                return update_background_image(&state, request).await;
            }
        }
        if path == "/api/config/pick-folder" && request.method() == Method::POST {
            return pick_config_folder(request).await;
        }
        if path == "/api/machine-id" && request.method() == Method::GET {
            return get_machine_id(&state, request).await;
        }
        if path == "/api/agents/account-status" && request.method() == Method::GET {
            return agent_account::account_status(&state, request).await;
        }
        if forge::is_route(&path, request.method()) {
            return forge::handle_request(&state, &path, request).await;
        }
        if native_app::is_route(&path, request.method()) {
            return native_app::handle_request(&state, &path, request).await;
        }
        if one_shot::is_route(&state, &path, request.method()) {
            return one_shot::handle_request(&state, &path, request).await;
        }
        if path == "/api/prompts" {
            if request.method() == Method::GET {
                return list_prompts(&state, request).await;
            }
            if request.method() == Method::POST {
                return create_prompt(&state, request).await;
            }
        }
        if let Some((id, usage)) = prompt_path(&path) {
            if usage && request.method() == Method::POST {
                return increment_prompt_usage(&state, request, id).await;
            }
            if !usage && request.method() == Method::PUT {
                return update_prompt(&state, request, id).await;
            }
            if !usage && request.method() == Method::DELETE {
                return delete_prompt(&state, request, id).await;
            }
        }
        if path == "/api/agent-context" {
            if request.method() == Method::GET {
                return get_agent_context(&state, request).await;
            }
            if request.method() == Method::PUT {
                return update_agent_context(&state, request).await;
            }
        }
        if path == "/api/agent/state" {
            if request.method() == Method::GET {
                return get_agent_state(&state, request).await;
            }
            if request.method() == Method::POST {
                return update_agent_state(&state, request).await;
            }
        }
        if path == "/api/agent/state/workspace-action" && request.method() == Method::POST {
            return apply_agent_workspace_action(&state, request).await;
        }
        if path == "/api/agent/directories" && request.method() == Method::GET {
            return get_agent_directories(&state, request).await;
        }
        if path == "/api/agent/ports" && request.method() == Method::GET {
            return get_agent_ports(request).await;
        }
        if path == "/api/agent/ports/kill" && request.method() == Method::POST {
            return kill_agent_port(request).await;
        }
        if path == "/api/agent/claude-processes" && request.method() == Method::GET {
            return get_agent_claude_processes(request).await;
        }
        if path == "/api/agent/claude-processes/kill" && request.method() == Method::POST {
            return kill_agent_claude_process(request).await;
        }
        if path == "/api/agent/claude-processes/kill-all" && request.method() == Method::POST {
            return kill_all_agent_claude_processes(request).await;
        }
        if let Some(pane_id) = route_parameter(&path, "/api/chat-events/")
            && request.method() == Method::GET
        {
            return get_chat_events(&state, request, &pane_id).await;
        }
        if let Some(pane_id) = route_parameter(&path, "/api/chat-queues/") {
            if request.method() == Method::GET {
                return get_chat_queue(&state, request, &pane_id).await;
            }
            if request.method() == Method::PUT {
                return put_chat_queue(&state, request, &pane_id).await;
            }
            if request.method() == Method::DELETE {
                return delete_chat_queue(&state, request, &pane_id).await;
            }
        }
        if path == "/api/sessions" && request.method() == Method::GET {
            return list_local_chat_sessions(&state, request).await;
        }
        if path == "/api/agent/agent-sessions" && request.method() == Method::GET {
            let headers = request.headers().clone();
            let sessions = state.chat_runtime.list_sessions().await;
            return json_response(StatusCode::OK, json!({ "sessions": sessions }), &headers);
        }
        if path == "/api/goals" && request.method() == Method::GET {
            let headers = request.headers().clone();
            let goals = state.chat_runtime.list_goals().await;
            return json_response(StatusCode::OK, json!({ "goals": goals }), &headers);
        }
        if path == "/api/restart" && request.method() == Method::POST {
            let headers = request.headers().clone();
            for session in state.chat_runtime.list_sessions().await {
                let _ = state.native_chat_service.destroy(&session.pane_id).await;
            }
            state.pid_tracker.flush().await;
            let _ = state.connection_reset.send(());
            return json_response(
                StatusCode::OK,
                json!({ "ok": true, "message": "Restarting services..." }),
                &headers,
            );
        }
        if let Some(pane_id) = route_parameter(&path, "/api/checkpoints/")
            && request.method() == Method::GET
        {
            return list_checkpoints(&state, request, &pane_id).await;
        }
        if let Some((pane_id, checkpoint_id)) = checkpoint_revert_parameters(&path)
            && request.method() == Method::POST
        {
            return revert_checkpoint(&state, request, &pane_id, &checkpoint_id).await;
        }
        if let Some(checkpoint_id) = route_parameter(&path, "/api/checkpoints/detail/")
            && request.method() == Method::GET
        {
            return checkpoint_detail(&state, request, &checkpoint_id).await;
        }
        if path == "/api/files/search" && request.method() == Method::GET {
            return search_files(&state, request).await;
        }
        if path == "/api/files/map" && request.method() == Method::GET {
            return project_file_map(&state, request).await;
        }
        if path == "/api/files/content" && request.method() == Method::GET {
            return get_file_content(&state, request).await;
        }
        if path == "/api/upload-temp" && request.method() == Method::POST {
            return upload_temp_file(&state, request).await;
        }
        if path == "/api/images" && request.method() == Method::GET {
            return list_temp_images(&state, request).await;
        }
        if path == "/api/delete-temp" && request.method() == Method::DELETE {
            return delete_temp_file(&state, request).await;
        }
        if path == "/api/file" && request.method() == Method::GET {
            return serve_local_image(&state, request).await;
        }
        if path == "/api/git/status" && request.method() == Method::GET {
            return git_status(&state, request).await;
        }
        if path == "/api/git/statuses" && request.method() == Method::POST {
            return git_statuses(&state, request).await;
        }
        if path == "/api/git/graph" && request.method() == Method::GET {
            return git_graph(&state, request).await;
        }
        if path == "/api/git/branches" {
            if request.method() == Method::GET {
                return git_branches(&state, request).await;
            }
            if request.method() == Method::POST {
                return git_checkout_branch(&state, request).await;
            }
        }
        if path == "/api/git/log" && request.method() == Method::GET {
            return git_log(&state, request).await;
        }
        if path == "/api/git/blame" && request.method() == Method::GET {
            return git_blame(&state, request).await;
        }
        if path == "/api/git/file-history" && request.method() == Method::GET {
            return git_file_history(&state, request).await;
        }
        if path == "/api/git/commit-details" && request.method() == Method::GET {
            return git_commit_details(&state, request).await;
        }
        if path == "/api/git/stage" && request.method() == Method::POST {
            return git_stage(&state, request).await;
        }
        if path == "/api/git/unstage" && request.method() == Method::POST {
            return git_unstage(&state, request).await;
        }
        if path == "/api/git/commit" && request.method() == Method::POST {
            return git_commit(&state, request).await;
        }
        if path == "/api/git/diff" && request.method() == Method::GET {
            return git_diff(&state, request).await;
        }
        if path == "/api/git/full-diff" && request.method() == Method::GET {
            return git_full_diff(&state, request).await;
        }
        if path == "/api/git/file-with-diff" && request.method() == Method::GET {
            return git_file_with_diff(&state, request).await;
        }
        if path == "/api/git/watch" && request.method() == Method::POST {
            return git_watch(&state, request, true).await;
        }
        if path == "/api/git/unwatch" && request.method() == Method::POST {
            return git_watch(&state, request, false).await;
        }
        return text_response(StatusCode::NOT_FOUND, "Not found");
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

fn checkpoint_revert_parameters(path: &str) -> Option<(String, String)> {
    let suffix = path.strip_prefix("/api/checkpoints/revert/")?;
    let mut parameters = suffix.split('/');
    let pane_id = parameters.next()?;
    let checkpoint_id = parameters.next()?;
    if pane_id.is_empty() || checkpoint_id.is_empty() || parameters.next().is_some() {
        return None;
    }
    let pane_id = percent_decode_str(pane_id).decode_utf8().ok()?.into_owned();
    let checkpoint_id = percent_decode_str(checkpoint_id)
        .decode_utf8()
        .ok()?
        .into_owned();
    Some((pane_id, checkpoint_id))
}

async fn get_chat_events(state: &ServerState, request: Request, pane_id: &str) -> Response {
    let headers = request.headers().clone();
    let after = query_value(&request, "after")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value as u64)
        .unwrap_or_default();
    let limit = query_value(&request, "limit")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value != 0.0)
        .map(|value| value as i64)
        .unwrap_or(500)
        .clamp(1, 1000) as usize;
    match state.chat_runtime.read_events(pane_id, after, limit).await {
        Ok(events) => json_response(StatusCode::OK, json!({ "events": events }), &headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &headers,
        ),
    }
}

async fn get_chat_queue(state: &ServerState, request: Request, pane_id: &str) -> Response {
    let headers = request.headers().clone();
    match state.chat_persistence.read_queue(pane_id).await {
        Ok(queue) => json_response(StatusCode::OK, json!({ "queue": queue }), &headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &headers,
        ),
    }
}

async fn put_chat_queue(state: &ServerState, request: Request, pane_id: &str) -> Response {
    let headers = request.headers().clone();
    let body: Value = match request_json(request, &headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(queue) = body.get("queue").and_then(Value::as_array) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Expected queue array" }),
            &headers,
        );
    };
    match state.chat_persistence.save_queue(pane_id, queue).await {
        Ok(()) => {
            state.chat_runtime.broadcast_queue(pane_id, queue).await;
            json_response(StatusCode::OK, json!({ "ok": true }), &headers)
        }
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &headers,
        ),
    }
}

async fn delete_chat_queue(state: &ServerState, request: Request, pane_id: &str) -> Response {
    let headers = request.headers().clone();
    match state.chat_persistence.delete_queue(pane_id).await {
        Ok(()) => {
            state.chat_runtime.broadcast_queue(pane_id, &[]).await;
            json_response(StatusCode::OK, json!({ "ok": true }), &headers)
        }
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &headers,
        ),
    }
}

async fn list_local_chat_sessions(state: &ServerState, request: Request) -> Response {
    let headers = request.headers().clone();
    let sessions = state.native_sessions.snapshot().await.sessions;
    json_response(StatusCode::OK, json!({ "sessions": sessions }), &headers)
}

async fn list_checkpoints(state: &ServerState, request: Request, pane_id: &str) -> Response {
    let headers = request.headers().clone();
    let checkpoints = state.checkpoint_service.list_checkpoints(pane_id).await;
    json_response(
        StatusCode::OK,
        json!({ "checkpoints": checkpoints }),
        &headers,
    )
}

async fn revert_checkpoint(
    state: &ServerState,
    request: Request,
    pane_id: &str,
    checkpoint_id: &str,
) -> Response {
    let headers = request.headers().clone();
    let result = state
        .checkpoint_service
        .revert_to_checkpoint(checkpoint_id, pane_id)
        .await;
    json_response(StatusCode::OK, json!(result), &headers)
}

async fn checkpoint_detail(state: &ServerState, request: Request, checkpoint_id: &str) -> Response {
    let headers = request.headers().clone();
    match state
        .checkpoint_service
        .get_checkpoint_meta(checkpoint_id)
        .await
    {
        Some(checkpoint) => json_response(StatusCode::OK, json!(checkpoint), &headers),
        None => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "Not found" }),
            &headers,
        ),
    }
}

async fn get_agent_state(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let value = state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .read();
    json_response(StatusCode::OK, value, &request_headers)
}

async fn update_agent_state(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    match state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .write_guarded(body)
    {
        Ok(_) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

async fn apply_agent_workspace_action(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let action = state
        .native_chat_handoff
        .workspace_action_with_defaults(body.get("action").cloned().unwrap_or(Value::Null))
        .await;
    match state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .apply_workspace_action(&action)
    {
        Ok(value) => json_response(StatusCode::OK, json!({ "state": value }), &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

async fn get_agent_directories(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let query = query_value(&request, "q").unwrap_or_default();
    let requested_path = query_value(&request, "path");

    if let Some(path) = requested_path.filter(|path| !path.is_empty()) {
        return match state.native_directories.browse(path) {
            Ok(listing) => json_response(StatusCode::OK, json!(listing), &request_headers),
            Err(error) => json_response(
                StatusCode::FORBIDDEN,
                json!({ "error": error.to_string() }),
                &request_headers,
            ),
        };
    }

    if !query.is_empty() {
        let listing = state.native_directories.search(&query).await;
        return json_response(StatusCode::OK, json!(listing), &request_headers);
    }

    if query_value(&request, "quickPicks").as_deref() == Some("true") {
        let quick_picks = state.native_directories.quick_picks().await;
        return json_response(StatusCode::OK, json!(quick_picks), &request_headers);
    }

    json_response(
        StatusCode::OK,
        json!(state.native_directories.home()),
        &request_headers,
    )
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct RunningPort {
    port: u16,
    pid: i64,
    command: String,
    name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ClaudeProcess {
    pid: i64,
    ppid: i64,
    cpu: f64,
    mem: f64,
    rss: i64,
    cwd: String,
    command: String,
    elapsed: String,
}

async fn get_agent_ports(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let ports = running_ports().await;
    json_response(StatusCode::OK, json!({ "ports": ports }), &request_headers)
}

async fn kill_agent_port(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let pid = match request_pid(request, &request_headers).await {
        Ok(pid) => pid,
        Err(response) => return response,
    };
    if !running_ports().await.iter().any(|port| port.pid == pid) {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "PID is not a listed port" }),
            &request_headers,
        );
    }
    match kill_port_process(pid).await {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => json_response(
            StatusCode::OK,
            json!({ "ok": false, "error": error }),
            &request_headers,
        ),
    }
}

async fn get_agent_claude_processes(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let processes = claude_processes().await;
    json_response(
        StatusCode::OK,
        json!({ "processes": processes }),
        &request_headers,
    )
}

async fn kill_agent_claude_process(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let pid = match request_pid(request, &request_headers).await {
        Ok(pid) => pid,
        Err(response) => return response,
    };
    if !claude_processes()
        .await
        .iter()
        .any(|process| process.pid == pid)
    {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "PID is not a listed Claude process" }),
            &request_headers,
        );
    }
    match kill_claude_process_tree(pid).await {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => json_response(
            StatusCode::OK,
            json!({ "ok": false, "error": error }),
            &request_headers,
        ),
    }
}

async fn kill_all_agent_claude_processes(request: Request) -> Response {
    let request_headers = request.headers().clone();
    kill_all_claude_processes().await;
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "killed": 0 }),
        &request_headers,
    )
}

async fn request_pid(request: Request, request_headers: &HeaderMap) -> Result<i64, Response> {
    let body: Value = request_json(request, request_headers).await?;
    let Some(pid) = body.get("pid").and_then(json_safe_positive_integer) else {
        return Err(json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Invalid pid" }),
            request_headers,
        ));
    };
    Ok(pid)
}

fn json_safe_positive_integer(value: &Value) -> Option<i64> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    let value = value.as_f64()?;
    (value.is_finite()
        && value.fract() == 0.0
        && value > 0.0
        && value <= MAX_SAFE_INTEGER
        && value <= i64::MAX as f64)
        .then_some(value as i64)
}

async fn running_ports() -> Vec<RunningPort> {
    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("netstat")
            .arg("-ano")
            .output()
            .await;
        return output
            .ok()
            .map(|output| parse_windows_running_ports(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = tokio::process::Command::new("/usr/sbin/lsof")
            .args(["-i", "-P", "-n", "-sTCP:LISTEN"])
            .output()
            .await;
        output
            .ok()
            .map(|output| parse_unix_running_ports(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default()
    }
}

fn is_dev_port(port: u16) -> bool {
    (3000..=4000).contains(&port)
}

fn parse_unix_running_ports(output: &str) -> Vec<RunningPort> {
    const DEV_COMMANDS: &[&str] = &[
        "node", "bun", "deno", "ruby", "rails", "go", "cargo", "java", "gradle", "php", "artisan",
        "nginx", "caddy",
    ];
    const EXCLUDED_COMMANDS: &[&str] = &[
        "rapportd",
        "airportd",
        "configd",
        "mDNSResponder",
        "ControlCe",
        "ControlCenter",
    ];
    let mut ports = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in output.trim().lines().skip(1) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 9 {
            continue;
        }
        let command = parts[0];
        let Ok(pid) = parts[1].parse::<i64>() else {
            continue;
        };
        let Some(port) = final_port(parts[8]) else {
            continue;
        };
        if seen.contains(&port) || EXCLUDED_COMMANDS.contains(&command) {
            continue;
        }
        if !is_dev_port(port) && !DEV_COMMANDS.contains(&command) {
            continue;
        }
        seen.insert(port);
        let name = match command {
            "node" => "node server",
            "bun" => "bun server",
            "ruby" => "Ruby server",
            "nginx" => "nginx",
            _ => command,
        };
        ports.push(RunningPort {
            port,
            pid,
            command: command.into(),
            name: name.into(),
        });
    }
    ports.sort_by_key(|port| port.port);
    ports
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_windows_running_ports(output: &str) -> Vec<RunningPort> {
    let mut ports = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in output.trim().lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 5 {
            continue;
        }
        let Some(port) = final_port(parts[1]) else {
            continue;
        };
        let Ok(pid) = parts[4].parse::<i64>() else {
            continue;
        };
        if !is_dev_port(port) || !seen.insert(port) {
            continue;
        }
        ports.push(RunningPort {
            port,
            pid,
            command: "unknown".into(),
            name: format!("port {port}"),
        });
    }
    ports.sort_by_key(|port| port.port);
    ports
}

fn final_port(value: &str) -> Option<u16> {
    value.rsplit_once(':')?.1.parse().ok()
}

async fn kill_port_process(pid: i64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let output = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .await;

    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .await;

    command_succeeded(output)
}

async fn claude_processes() -> Vec<ClaudeProcess> {
    #[cfg(target_os = "windows")]
    {
        Vec::new()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let Ok(output) = tokio::process::Command::new("ps")
            .args(["-eo", "pid,ppid,pcpu,pmem,rss,etime,comm,args"])
            .output()
            .await
        else {
            return Vec::new();
        };
        let mut processes = parse_claude_processes(
            &String::from_utf8_lossy(&output.stdout),
            std::process::id() as i64,
        );
        for process in &mut processes {
            process.cwd = process_cwd(process.pid).await;
        }
        aggregate_claude_processes(processes)
    }
}

fn parse_claude_processes(output: &str, own_pid: i64) -> Vec<ClaudeProcess> {
    let mut processes = Vec::new();
    for line in output.trim().lines().skip(1) {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 8 || parts[6] != "claude" {
            continue;
        }
        let Ok(pid) = parts[0].parse::<i64>() else {
            continue;
        };
        if pid == own_pid {
            continue;
        }
        processes.push(ClaudeProcess {
            pid,
            ppid: parts[1].parse().unwrap_or(0),
            cpu: parts[2].parse().unwrap_or(0.0),
            mem: parts[3].parse().unwrap_or(0.0),
            rss: parts[4].parse().unwrap_or(0),
            cwd: String::new(),
            command: parts[7..].join(" "),
            elapsed: parts[5].into(),
        });
    }
    processes
}

fn aggregate_claude_processes(processes: Vec<ClaudeProcess>) -> Vec<ClaudeProcess> {
    let claude_pids = processes
        .iter()
        .map(|process| process.pid)
        .collect::<std::collections::HashSet<_>>();
    processes
        .iter()
        .filter(|parent| !claude_pids.contains(&parent.ppid))
        .map(|parent| {
            let children = processes
                .iter()
                .filter(|process| process.ppid == parent.pid);
            let mut aggregated = parent.clone();
            for child in children {
                aggregated.cpu += child.cpu;
                aggregated.mem += child.mem;
                aggregated.rss += child.rss;
            }
            aggregated.cpu = (aggregated.cpu * 10.0).round() / 10.0;
            aggregated.mem = (aggregated.mem * 10.0).round() / 10.0;
            aggregated
        })
        .collect()
}

async fn process_cwd(pid: i64) -> String {
    let output = tokio::process::Command::new("/usr/sbin/lsof")
        .args(["-p", &pid.to_string(), "-Fn"])
        .output()
        .await;
    output
        .ok()
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.strip_prefix("n/").map(|path| format!("/{path}")))
        })
        .unwrap_or_default()
}

async fn kill_claude_process_tree(pid: i64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return command_succeeded(
            tokio::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output()
                .await,
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        tokio::task::spawn_blocking(move || terminate_process_tree(pid))
            .await
            .map_err(|error| error.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .is_ok_and(|status| status.success())
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .status();
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree(pid: i64) {
    if let Ok(output) = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        for child in String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|pid| pid.trim().parse().ok())
        {
            terminate_process_tree(child);
        }
    }
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
}

async fn kill_all_claude_processes() {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = tokio::process::Command::new("pkill")
            .args(["-9", "-f", "^claude"])
            .output()
            .await;
        let _ = tokio::process::Command::new("killall")
            .args(["-9", "claude"])
            .output()
            .await;
    }
}

fn command_succeeded(output: std::io::Result<std::process::Output>) -> Result<(), String> {
    let output = output.map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("process exited with {}", output.status)
    } else {
        stderr
    })
}

async fn git_status(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };

    match tokio::task::spawn_blocking(move || get_git_status(&cwd)).await {
        Ok(Some(status)) => json_response(StatusCode::OK, json!(status), &request_headers),
        Ok(None) => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "Not a git repository" }),
            &request_headers,
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
    }
}

async fn git_statuses(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let bytes = match to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return json_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                json!({ "error": "Payload too large" }),
                &request_headers,
            );
        }
    };
    let body: GitStatusesBody = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error.to_string() }),
                &request_headers,
            );
        }
    };
    let mut unique = Vec::new();
    for cwd in body.cwds.unwrap_or_default() {
        if let Some(cwd) = safe_cwd(state, &cwd)
            && !unique.contains(&cwd)
        {
            unique.push(cwd);
        }
    }
    let tasks = unique
        .into_iter()
        .map(|cwd| tokio::task::spawn_blocking(move || get_git_status(&cwd)));
    let statuses = join_all(tasks)
        .await
        .into_iter()
        .filter_map(|result| result.ok().flatten())
        .collect::<Vec<_>>();
    json_response(StatusCode::OK, json!(statuses), &request_headers)
}

async fn git_graph(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    let limit = query_value(&request, "limit")
        .as_deref()
        .map(|value| safe_limit(value, 50, 500))
        .unwrap_or(50);
    let task = tokio::task::spawn_blocking(move || get_git_graph(&cwd, limit));
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok((commits, rows))) => json_response(
            StatusCode::OK,
            json!({ "commits": commits, "rows": rows }),
            &request_headers,
        ),
        Ok(Err(error)) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
        Err(_) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "error": "Native Git graph unavailable" }),
            &request_headers,
        ),
    }
}

async fn git_branches(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    match tokio::task::spawn_blocking(move || get_git_branches(&cwd)).await {
        Ok(branches) => json_response(
            StatusCode::OK,
            json!({ "branches": branches }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_checkout_branch(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: GitBranchBody = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let cwd = body.cwd.as_deref().and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    let Some(branch) = body.branch.filter(|branch| !branch.is_empty()) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing branch parameter" }),
            &request_headers,
        );
    };
    match tokio::task::spawn_blocking(move || checkout_git_branch(&cwd, &branch)).await {
        Ok(result) => json_response(StatusCode::OK, json!(result), &request_headers),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_log(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    let limit = query_value(&request, "limit")
        .as_deref()
        .map(|value| safe_limit(value, 20, 200))
        .unwrap_or(20);
    match tokio::task::spawn_blocking(move || get_git_log(&cwd, limit)).await {
        Ok(log) => json_response(StatusCode::OK, json!({ "log": log }), &request_headers),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_blame(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let file = query_value(&request, "file").filter(|file| is_safe_relative_path(file));
    let (Some(cwd), Some(file)) = (cwd, file) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or file parameter" }),
            &request_headers,
        );
    };
    let task = tokio::task::spawn_blocking(move || get_git_blame(&cwd, &file));
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok(blame)) => json_response(StatusCode::OK, json!({ "blame": blame }), &request_headers),
        Ok(Err(error)) => internal_task_error(error, &request_headers),
        Err(_) => json_response(StatusCode::OK, json!({ "blame": [] }), &request_headers),
    }
}

async fn git_file_history(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let file = query_value(&request, "file").filter(|file| is_safe_relative_path(file));
    let (Some(cwd), Some(file)) = (cwd, file) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or file parameter" }),
            &request_headers,
        );
    };
    let limit = query_value(&request, "limit")
        .as_deref()
        .map(|value| safe_limit(value, 20, 200))
        .unwrap_or(20);
    match tokio::task::spawn_blocking(move || get_git_file_history(&cwd, &file, limit)).await {
        Ok(history) => json_response(
            StatusCode::OK,
            json!({ "history": history }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_commit_details(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd));
    let hash = query_value(&request, "hash").filter(|hash| safe_hash(hash));
    let (Some(cwd), Some(hash)) = (cwd, hash) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or hash parameter" }),
            &request_headers,
        );
    };
    match tokio::task::spawn_blocking(move || get_git_commit_details(&cwd, &hash)).await {
        Ok(details) => json_response(
            StatusCode::OK,
            json!({ "details": details }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_stage(state: &ServerState, request: Request) -> Response {
    git_stage_change(state, request, true).await
}

async fn git_unstage(state: &ServerState, request: Request) -> Response {
    git_stage_change(state, request, false).await
}

async fn git_stage_change(state: &ServerState, request: Request, stage: bool) -> Response {
    let request_headers = request.headers().clone();
    let body: GitFileBody = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let cwd = body.cwd.as_deref().and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    let file = body.file.filter(|file| !file.is_empty());
    if file
        .as_deref()
        .is_some_and(|file| !is_safe_relative_path(file))
    {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Invalid file parameter" }),
            &request_headers,
        );
    }
    let task = tokio::task::spawn_blocking(move || {
        if stage {
            stage_git(&cwd, file.as_deref())
        } else {
            unstage_git(&cwd, file.as_deref())
        }
    });
    match task.await {
        Ok(success) => json_response(
            StatusCode::OK,
            json!({ "success": success }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_commit(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: GitCommitBody = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let cwd = body.cwd.as_deref().and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };
    let Some(message) = body.message.filter(|message| !message.is_empty()) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing message parameter" }),
            &request_headers,
        );
    };
    let task = tokio::task::spawn_blocking(move || commit_git(&cwd, &message));
    match tokio::time::timeout(std::time::Duration::from_secs(30), task).await {
        Ok(Ok(result)) => json_response(StatusCode::OK, json!(result), &request_headers),
        Ok(Err(error)) => internal_task_error(error, &request_headers),
        Err(_) => json_response(
            StatusCode::OK,
            json!({ "success": false, "error": "Commit failed" }),
            &request_headers,
        ),
    }
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

async fn git_diff(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let Some(params) = git_diff_params(state, &request) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or file parameter" }),
            &request_headers,
        );
    };
    let allowed_paths = state.allowed_paths.clone();
    let task = tokio::task::spawn_blocking(move || {
        if !is_changed_git_file(&params.cwd, &params.file) {
            return None;
        }
        Some(get_git_diff(
            &allowed_paths,
            &params.cwd,
            &params.file,
            params.staged,
        ))
    });
    match task.await {
        Ok(Some(diff)) => json_response(StatusCode::OK, json!({ "diff": diff }), &request_headers),
        Ok(None) => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "File is not changed" }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_full_diff(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let Some(params) = git_diff_params(state, &request) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or file parameter" }),
            &request_headers,
        );
    };
    let allowed_paths = state.allowed_paths.clone();
    let task = tokio::task::spawn_blocking(move || {
        if !is_changed_git_file(&params.cwd, &params.file) {
            return None;
        }
        Some(get_git_hunk_diff(
            &allowed_paths,
            &params.cwd,
            &params.file,
            params.staged,
        ))
    });
    match task.await {
        Ok(Some(diff)) => json_response(StatusCode::OK, json!(diff), &request_headers),
        Ok(None) => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "File is not changed" }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_file_with_diff(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let Some(params) = git_diff_params(state, &request) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd or file parameter" }),
            &request_headers,
        );
    };
    let allowed_paths = state.allowed_paths.clone();
    let task = tokio::task::spawn_blocking(move || {
        if !is_changed_git_file(&params.cwd, &params.file) {
            return None;
        }
        Some(get_git_file_with_diff(
            &allowed_paths,
            &params.cwd,
            &params.file,
            params.staged,
        ))
    });
    match task.await {
        Ok(None) => json_response(
            StatusCode::NOT_FOUND,
            json!({ "error": "File is not changed" }),
            &request_headers,
        ),
        Ok(Some(GitFileWithDiff::Image { image_path })) => json_response(
            StatusCode::OK,
            json!({ "isImage": true, "imagePath": image_path, "lines": [] }),
            &request_headers,
        ),
        Ok(Some(GitFileWithDiff::Text { lines })) => {
            json_response(StatusCode::OK, json!({ "lines": lines }), &request_headers)
        }
        Ok(Some(GitFileWithDiff::Error { error })) => json_response(
            StatusCode::OK,
            json!({ "error": error, "lines": [] }),
            &request_headers,
        ),
        Ok(Some(GitFileWithDiff::AccessDenied)) => json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Path is outside allowed local roots" }),
            &request_headers,
        ),
        Err(error) => internal_task_error(error, &request_headers),
    }
}

async fn git_watch(state: &ServerState, request: Request, watch: bool) -> Response {
    let request_headers = request.headers().clone();
    let body: GitWatchBody = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let cwd = body.cwd.as_deref().and_then(|cwd| safe_cwd(state, cwd));
    let Some(cwd) = cwd else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing cwd parameter" }),
            &request_headers,
        );
    };

    let result = if watch {
        state.native_git.watch(&cwd)
    } else {
        state.native_git.unwatch(&cwd)
    };
    if let Err(error) = result {
        eprintln!("[FileWatcher] Failed to update watch for {cwd}: {error}");
    }
    json_response(StatusCode::OK, json!({ "ok": true }), &request_headers)
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

async fn list_prompts(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    match state.native_prompts.list().await {
        Ok(prompts) => json_response(
            StatusCode::OK,
            serde_json::to_value(prompts).expect("prompts must serialize"),
            &request_headers,
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

async fn create_prompt(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(body) = body.as_object() else {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": "Prompt body must be an object" }),
            &request_headers,
        );
    };
    match state
        .native_prompts
        .create_json(body.clone(), unix_millis())
        .await
    {
        Ok(prompt) => json_response(
            StatusCode::OK,
            serde_json::to_value(prompt).expect("prompt must serialize"),
            &request_headers,
        ),
        Err(error) => prompt_error_response(error, &request_headers),
    }
}

async fn update_prompt(state: &ServerState, request: Request, id: &str) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(body) = body.as_object() else {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": "Prompt body must be an object" }),
            &request_headers,
        );
    };
    match state
        .native_prompts
        .update_json(id, body.clone(), unix_millis())
        .await
    {
        Ok(prompt) => json_response(
            StatusCode::OK,
            serde_json::to_value(prompt).expect("prompt must serialize"),
            &request_headers,
        ),
        Err(error) => prompt_error_response(error, &request_headers),
    }
}

async fn delete_prompt(state: &ServerState, request: Request, id: &str) -> Response {
    let request_headers = request.headers().clone();
    match state.native_prompts.delete(id).await {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => prompt_error_response(error, &request_headers),
    }
}

async fn increment_prompt_usage(state: &ServerState, request: Request, id: &str) -> Response {
    let request_headers = request.headers().clone();
    match state
        .native_prompts
        .increment_usage_at(id, unix_millis())
        .await
    {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => prompt_error_response(error, &request_headers),
    }
}

fn prompt_error_response(error: PromptError, request_headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        json!({ "error": error.message }),
        request_headers,
    )
}

async fn get_agent_context(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd");
    let pane_id = query_value(&request, "paneId");
    let query = native_agent_context::NativeAgentContextQuery { cwd, pane_id };
    let context = match state.native_agent_context.load(&query).await {
        Ok(context) => context,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error }),
                &request_headers,
            );
        }
    };
    json_response(
        StatusCode::OK,
        serde_json::to_value(context).expect("agent context must serialize"),
        &request_headers,
    )
}

async fn update_agent_context(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(body) = body.as_object() else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "instructions is required" }),
            &request_headers,
        );
    };
    let Some(instructions) = body.get("instructions").and_then(serde_json::Value::as_str) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "instructions is required" }),
            &request_headers,
        );
    };
    let Some(scope) = body.get("scope").and_then(serde_json::Value::as_str) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "scope is invalid" }),
            &request_headers,
        );
    };
    if !matches!(scope, "global" | "project" | "chat") {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "scope is invalid" }),
            &request_headers,
        );
    }
    let cwd = body
        .get("cwd")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let pane_id = body
        .get("paneId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let mode = body
        .get("mode")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    match state
        .native_agent_context
        .update_raw(
            scope.into(),
            cwd,
            pane_id,
            instructions.into(),
            mode,
            unix_millis(),
        )
        .await
    {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn search_files(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let explicit_cwd = query_value(&request, "cwd");
    let search_cwds = if let Some(cwd) = explicit_cwd.filter(|cwd| !cwd.is_empty()) {
        vec![cwd]
    } else {
        match state.native_project_files.active_cwds().await {
            Ok(cwds) => cwds,
            Err(_) => vec![
                state
                    .allowed_paths
                    .project_root()
                    .to_string_lossy()
                    .into_owned(),
            ],
        }
    };
    let search_cwds = search_cwds
        .iter()
        .map(|cwd| state.native_project_files.resolve_cwd(cwd))
        .collect::<Result<Vec<_>, _>>();
    let Ok(search_cwds) = search_cwds else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Invalid directory" }),
            &request_headers,
        );
    };
    let query = query_value(&request, "q")
        .unwrap_or_default()
        .to_lowercase();
    let limit = file_search_limit(query_value(&request, "limit").as_deref());
    let searches = search_cwds
        .iter()
        .map(|cwd| state.native_project_files.search(cwd, &query, limit));
    let per_cwd_results = join_all(searches).await;
    if per_cwd_results.iter().any(Result::is_err) {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Invalid directory" }),
            &request_headers,
        );
    }
    let per_cwd_results = per_cwd_results
        .into_iter()
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    let mut results = Vec::new();
    let mut index = 0;
    while results.len() < limit {
        let mut added = false;
        for cwd_results in &per_cwd_results {
            if let Some(result) = cwd_results.get(index) {
                results.push(result.clone());
                added = true;
                if results.len() >= limit {
                    break;
                }
            }
        }
        if !added {
            break;
        }
        index += 1;
    }
    let cwd_strings = search_cwds;
    json_response(
        StatusCode::OK,
        json!({
            "cwd": cwd_strings.first().cloned().unwrap_or_else(|| state.allowed_paths.project_root().to_string_lossy().into_owned()),
            "cwds": cwd_strings,
            "results": results,
        }),
        &request_headers,
    )
}

async fn project_file_map(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = query_value(&request, "cwd")
        .filter(|cwd| !cwd.is_empty())
        .unwrap_or_else(|| {
            state
                .allowed_paths
                .project_root()
                .to_string_lossy()
                .into_owned()
        });
    let cwd = match state.native_project_files.resolve_cwd(&cwd) {
        Ok(cwd) => cwd,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                json!({ "error": "Invalid directory" }),
                &request_headers,
            );
        }
    };
    let root = PathBuf::from(cwd);
    match tokio::task::spawn_blocking(move || native_project_map::build_project_map(&root)).await {
        Ok(project_map) => json_response(StatusCode::OK, json!(project_map), &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
    }
}

fn file_search_limit(value: Option<&str>) -> usize {
    let raw = value.filter(|value| !value.is_empty()).unwrap_or("20");
    let parsed = raw
        .parse::<f64>()
        .ok()
        .filter(|value| !value.is_nan() && *value != 0.0);
    let limited = parsed.unwrap_or(20.0).min(50.0);
    if limited.is_nan() || limited <= 0.0 {
        0
    } else {
        limited.ceil() as usize
    }
}

async fn get_file_content(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let cwd = match query_value(&request, "cwd") {
        Some(cwd) if !cwd.is_empty() => cwd,
        _ => state
            .native_project_files
            .active_cwds()
            .await
            .unwrap_or_default()
            .into_iter()
            .next()
            .unwrap_or_else(|| {
                state
                    .allowed_paths
                    .project_root()
                    .to_string_lossy()
                    .into_owned()
            }),
    };
    let Some(file_path) = query_value(&request, "path").filter(|path| !path.is_empty()) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No path provided" }),
            &request_headers,
        );
    };
    match state.native_project_files.read(&cwd, &file_path).await {
        Ok(content) => json_response(StatusCode::OK, json!(content), &request_headers),
        Err(native_project_files::NativeProjectFilesError::InvalidDirectory) => json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Invalid directory" }),
            &request_headers,
        ),
        Err(native_project_files::NativeProjectFilesError::MissingPath) => json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No path provided" }),
            &request_headers,
        ),
        Err(native_project_files::NativeProjectFilesError::AccessDenied) => json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Access denied" }),
            &request_headers,
        ),
        Err(native_project_files::NativeProjectFilesError::NotFile) => json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Not a file" }),
            &request_headers,
        ),
        Err(native_project_files::NativeProjectFilesError::FileTooLarge) => json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "File too large" }),
            &request_headers,
        ),
        Err(native_project_files::NativeProjectFilesError::NotFound) => {
            text_response(StatusCode::NOT_FOUND, "Not found")
        }
        Err(native_project_files::NativeProjectFilesError::Runtime(error)) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

fn is_image_extension(path: &str) -> bool {
    native_files::is_image_extension(path)
}

async fn upload_temp_file(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let mut multipart = match Multipart::from_request(request, &()).await {
        Ok(multipart) => multipart,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error.to_string() }),
                &request_headers,
            );
        }
    };
    let mut upload = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": error.to_string() }),
                    &request_headers,
                );
            }
        };
        if field.name() != Some("file") || field.file_name().is_none() {
            continue;
        }
        let name = field.file_name().unwrap_or_default().to_string();
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": error.to_string() }),
                    &request_headers,
                );
            }
        };
        upload = Some((name, bytes));
        break;
    }
    let Some((name, bytes)) = upload else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No file provided" }),
            &request_headers,
        );
    };
    match state.native_files.store_image(&name, &bytes).await {
        Ok(file) => json_response(
            StatusCode::OK,
            json!({ "path": file.path }),
            &request_headers,
        ),
        Err(native_files::NativeFilesError::FileTooLarge) => json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "File too large" }),
            &request_headers,
        ),
        Err(native_files::NativeFilesError::UnsupportedFileType) => json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Unsupported file type" }),
            &request_headers,
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
    }
}

async fn list_temp_images(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    match state.native_files.list().await {
        Ok(images) => json_response(
            StatusCode::OK,
            json!({ "images": images }),
            &request_headers,
        ),
        Err(native_files::NativeFilesError::Io(error)) => file_route_error(error, &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
    }
}

async fn delete_temp_file(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No path provided" }),
            &request_headers,
        );
    };
    match state.native_files.delete(Path::new(&path)).await {
        Ok(()) => json_response(StatusCode::OK, json!({ "ok": true }), &request_headers),
        Err(native_files::NativeFilesError::AccessDenied) => json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Access denied" }),
            &request_headers,
        ),
        Err(native_files::NativeFilesError::Io(error)) => file_route_error(error, &request_headers),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        ),
    }
}

async fn serve_local_image(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No path provided" }),
            &request_headers,
        );
    };
    let Some(path) = resolve_serveable_image_path(state, &path).await else {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "Access denied" }),
            &request_headers,
        );
    };
    if !is_image_extension(&path.to_string_lossy()) {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Unsupported file type" }),
            &request_headers,
        );
    }
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return json_response(
                StatusCode::NOT_FOUND,
                json!({ "error": "File not found" }),
                &request_headers,
            );
        }
        Err(error) => return file_route_error(error, &request_headers),
    };
    if metadata.len() > MAX_SERVED_FILE_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({ "error": "File too large" }),
            &request_headers,
        );
    }
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(error) => return file_route_error(error, &request_headers),
    };
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static(image_content_type(&path)),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    add_cors_headers(response.headers_mut(), &request_headers);
    response
}

async fn resolve_serveable_image_path(state: &ServerState, path: &str) -> Option<PathBuf> {
    let resolved = resolve_lexically(Path::new(path)).ok()?;
    let real = tokio::fs::canonicalize(resolved).await.ok()?;
    (is_within_directory(&real, state.allowed_paths.project_root())
        || is_allowed_inferay_temp_path(state, &real))
    .then_some(real)
}

fn is_allowed_inferay_temp_path(state: &ServerState, path: &Path) -> bool {
    if is_within_directory(path, &state.temp_dir) {
        return true;
    }
    let marker = format!(
        "{}{}",
        std::path::MAIN_SEPARATOR,
        ["Contents", "Resources", "app", "data", ".tmp"].join(std::path::MAIN_SEPARATOR_STR)
    );
    path.to_string_lossy().contains(&marker)
}

fn image_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn file_route_error(error: impl std::fmt::Display, request_headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": error.to_string() }),
        request_headers,
    )
}

async fn get_config(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let config = state.config_manager.lock().await.load();
    json_response(
        StatusCode::OK,
        serde_json::Value::Object(config),
        &request_headers,
    )
}

async fn update_config(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(updates) = body.as_object().cloned() else {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": "Config updates must be an object" }),
            &request_headers,
        );
    };
    match state.config_manager.lock().await.update(updates) {
        Ok(config) => json_response(
            StatusCode::OK,
            serde_json::Value::Object(config),
            &request_headers,
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

async fn get_search_folders(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let config = state.config_manager.lock().await.load();
    let folders = config
        .get("search_folders")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    json_response(
        StatusCode::OK,
        json!({ "folders": folders }),
        &request_headers,
    )
}

async fn update_search_folders(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(folders) = body.get("folders").and_then(serde_json::Value::as_array) else {
        let mut response = text_response(StatusCode::BAD_REQUEST, "folders must be an array");
        add_cors_headers(response.headers_mut(), &request_headers);
        return response;
    };
    let updates = json!({ "search_folders": folders })
        .as_object()
        .expect("search folder update must be an object")
        .clone();
    match state.config_manager.lock().await.update(updates) {
        Ok(config) => json_response(
            StatusCode::OK,
            json!({ "folders": config.get("search_folders").cloned().unwrap_or(serde_json::Value::Null) }),
            &request_headers,
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        ),
    }
}

fn is_background_content_type(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

async fn get_background_image(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let file_path = state.background_dir.join("custom-background");
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut response = text_response(StatusCode::NOT_FOUND, "Not found");
            add_cors_headers(response.headers_mut(), &request_headers);
            return response;
        }
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error.to_string() }),
                &request_headers,
            );
        }
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
    response
}

async fn update_background_image(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let mut multipart = match Multipart::from_request(request, &()).await {
        Ok(multipart) => multipart,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error.to_string() }),
                &request_headers,
            );
        }
    };
    let mut upload = None;
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": error.to_string() }),
                    &request_headers,
                );
            }
        };
        if field.name() != Some("file") || field.file_name().is_none() {
            continue;
        }
        let name = field.file_name().unwrap_or_default().to_string();
        let content_type = field.content_type().unwrap_or_default().to_string();
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": error.to_string() }),
                    &request_headers,
                );
            }
        };
        upload = Some((name, content_type, bytes));
        break;
    }
    let Some((name, content_type, bytes)) = upload else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "No background image provided" }),
            &request_headers,
        );
    };
    if bytes.len() > MAX_TEMP_UPLOAD_BYTES {
        let mut response = text_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Image must be 20 MB or smaller",
        );
        add_cors_headers(response.headers_mut(), &request_headers);
        return response;
    }
    if !is_background_content_type(&content_type) {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Use a PNG, JPEG, WebP, or GIF image" }),
            &request_headers,
        );
    }
    if let Err(error) = tokio::fs::create_dir_all(&state.background_dir).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        );
    }
    if let Err(error) =
        tokio::fs::write(state.background_dir.join("custom-background"), &bytes).await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            &request_headers,
        );
    }
    let revision = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let metadata = json!({
        "contentType": content_type,
        "name": name,
        "revision": revision,
    })
    .as_object()
    .expect("background metadata must be an object")
    .clone();
    if let Err(error) = write_json_object(
        &state.background_dir.join("custom-background.json"),
        &metadata,
    )
    .await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        );
    }
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "revision": revision }),
        &request_headers,
    )
}

async fn pick_config_folder(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let folder = selected_folder_path().await;
    json_response(
        StatusCode::OK,
        json!({ "folder": folder }),
        &request_headers,
    )
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

async fn get_machine_id(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let config = state.config_manager.lock().await.load();
    let configured = config.get("machine_id").filter(|value| js_truthy(value));
    let machine_id = configured.cloned().unwrap_or_else(|| {
        std::env::var("MACHINE_ID")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                hostname::get()
                    .ok()
                    .map(|value| value.to_string_lossy().into_owned())
                    .filter(|value| !value.is_empty())
            })
            .map(serde_json::Value::String)
            .unwrap_or_else(|| serde_json::Value::String("unknown".into()))
    });
    json_response(
        StatusCode::OK,
        json!({ "machineId": machine_id }),
        &request_headers,
    )
}

fn js_truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => true,
    }
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
        .filter_map(|(key, value)| {
            if key == AGENT_STATE_STORAGE_KEY {
                return value
                    .is_null()
                    .then(|| (key.clone(), serde_json::Value::Null));
            }
            (should_sync_client_storage_key(key) && (value.is_string() || value.is_null()))
                .then(|| (key.clone(), value.clone()))
        })
        .collect()
}

async fn get_client_storage(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let requested_key = query_value(&request, "key");
    let _write_guard = state.client_storage_write.lock().await;
    let mut entries = read_json_object(&state.client_storage_path).await;
    if entries.remove(AGENT_STATE_STORAGE_KEY).is_some()
        && let Err(error) = write_json_object(&state.client_storage_path, &entries).await
    {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        );
    }
    if let Some(key) = requested_key {
        entries.retain(|entry_key, _| entry_key == &key);
    }
    json_response(
        StatusCode::OK,
        json!({ "entries": entries }),
        &request_headers,
    )
}

async fn update_client_storage(state: &ServerState, request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body: serde_json::Value = match request_json(request, &request_headers).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let entries =
        normalize_client_storage_entries(body.get("entries").unwrap_or(&serde_json::Value::Null));
    let _write_guard = state.client_storage_write.lock().await;
    let mut snapshot = read_json_object(&state.client_storage_path).await;
    for (key, value) in entries {
        if key == AGENT_STATE_STORAGE_KEY && !value.is_null() {
            continue;
        }
        if value.is_null() {
            snapshot.remove(&key);
        } else {
            snapshot.insert(key, value);
        }
    }
    if let Err(error) = write_json_object(&state.client_storage_path, &snapshot).await {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error }),
            &request_headers,
        );
    }
    json_response(StatusCode::OK, json!({ "ok": true }), &request_headers)
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

async fn request_json<T: for<'de> Deserialize<'de>>(
    request: Request,
    request_headers: &HeaderMap,
) -> Result<T, Response> {
    let bytes = to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES)
        .await
        .map_err(|_| {
            json_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                json!({ "error": "Payload too large" }),
                request_headers,
            )
        })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error.to_string() }),
            request_headers,
        )
    })
}

fn internal_task_error(error: tokio::task::JoinError, headers: &HeaderMap) -> Response {
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": error.to_string() }),
        headers,
    )
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

async fn native_diff(request: Request) -> Response {
    let request_headers = request.headers().clone();
    let body = match to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES).await {
        Ok(body) => body,
        Err(_) => {
            return json_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                json!({ "error": "Payload too large" }),
                &request_headers,
            );
        }
    };
    let body: NativeDiffBody = match serde_json::from_slice(&body) {
        Ok(body) => body,
        Err(error) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error.to_string() }),
                &request_headers,
            );
        }
    };
    let (Some(before), Some(after)) = (body.before, body.after) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "Missing before/after diff payload" }),
            &request_headers,
        );
    };
    if before.split('\n').take(MAX_NATIVE_DIFF_LINES + 1).count() > MAX_NATIVE_DIFF_LINES
        || after.split('\n').take(MAX_NATIVE_DIFF_LINES + 1).count() > MAX_NATIVE_DIFF_LINES
    {
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({
                "ok": false,
                "error": "Native diff unavailable",
                "available": true,
            }),
            &request_headers,
        );
    }

    let NativeResponse::Diff { mut diff } =
        inferay_native_diff::execute_request(NativeRequest::Diff { before, after })
    else {
        unreachable!("diff request must produce a diff response");
    };
    diff.computed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "diff": diff }),
        &request_headers,
    )
}

fn json_response(
    status: StatusCode,
    value: serde_json::Value,
    request_headers: &HeaderMap,
) -> Response {
    let body = serde_json::to_vec(&value).expect("JSON value serialization cannot fail");
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json;charset=utf-8"),
    );
    add_cors_headers(response.headers_mut(), request_headers);
    response
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
    let mut connection = state.native_chat_service.connect();
    let client = connection.client();
    let mut local_events = state.native_git.subscribe();
    let mut connection_reset = state.connection_reset.subscribe();
    let (mut sink, mut stream) = socket.split();
    loop {
        tokio::select! {
            _ = connection_reset.recv() => break,
            incoming = stream.next() => match incoming {
                Some(Ok(AxumMessage::Text(text))) => {
                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                        handle_native_websocket_message(&state, &client, message).await;
                    }
                }
                Some(Ok(AxumMessage::Binary(bytes))) => {
                    if let Ok(message) = serde_json::from_slice::<Value>(&bytes) {
                        handle_native_websocket_message(&state, &client, message).await;
                    }
                }
                Some(Ok(AxumMessage::Ping(bytes))) => {
                    if sink.send(AxumMessage::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(AxumMessage::Pong(_))) => {}
                Some(Ok(AxumMessage::Close(_))) | Some(Err(_)) | None => break,
            },
            outgoing = connection.recv_value() => match outgoing {
                Ok(message) => {
                    if sink.send(AxumMessage::Text(message.to_string().into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            event = local_events.recv() => match event {
                Ok(event) => {
                    let message = json!({
                        "type": "file:changed",
                        "cwd": event.cwd,
                        "file": event.file,
                        "eventType": event.event_type,
                    });
                    if sink.send(AxumMessage::Text(message.to_string().into())).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
    let _ = state.native_chat_service.detach(client).await;
    let _ = sink.close().await;
}

async fn handle_native_websocket_message(
    state: &ServerState,
    client: &native_chat_service::NativeChatClient,
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
            let _ = state.native_chat_service.destroy(pane_id).await;
        }
        "chat:reconnect" if !pane_id.is_empty() => {
            let _ = state.native_chat_service.reconnect(client, pane_id).await;
        }
        "chat:stop" if !pane_id.is_empty() => {
            let _ = state.native_chat_service.stop(pane_id).await;
        }
        "chat:send" if !pane_id.is_empty() => {
            let Some(text) = message.get("text").and_then(Value::as_str) else {
                return;
            };
            let cwd_provided = message
                .get("cwd")
                .and_then(Value::as_str)
                .is_some_and(|cwd| !cwd.is_empty());
            let reference_paths_provided = message.get("referencePaths").is_some_and(|value| {
                !matches!(value, Value::Null | Value::Bool(false))
                    && !value.as_str().is_some_and(str::is_empty)
            });
            let reasoning_level_provided = message.get("reasoningLevel").is_some();
            let reference_paths = normalize_chat_paths(state, message.get("referencePaths"));
            let include_workspace = cwd_provided || !reference_paths.is_empty();
            let agent_kind = message
                .get("agentKind")
                .and_then(Value::as_str)
                .unwrap_or("claude");
            let input = native_chat_service::NativeChatSendRequest {
                pane_id: pane_id.into(),
                agent_kind: agent_kind.into(),
                session_id: message
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                cwd: normalize_chat_cwd(state, message.get("cwd")),
                cwd_provided,
                model: resolve_agent_model(
                    agent_kind,
                    message.get("model").and_then(Value::as_str),
                ),
                reasoning_level: message
                    .get("reasoningLevel")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                reasoning_level_provided,
                reference_paths,
                reference_paths_provided,
                display_text: message
                    .get("displayText")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                images: normalize_chat_paths(state, message.get("images")),
                text: text.into(),
                include_workspace,
            };
            state.native_chat_service.send(client, input);
        }
        "chat:btw" if !pane_id.is_empty() => {
            let Some(text) = message.get("text").and_then(Value::as_str) else {
                return;
            };
            let cwd = normalize_chat_cwd(state, message.get("cwd"));
            let pane_id = pane_id.to_string();
            let text = text.to_string();
            let resolver = state.agent_command_resolver.clone();
            let sender = client.value_sender();
            tokio::spawn(async move {
                btw::run_btw_chat_message(&pane_id, &text, &cwd, &resolver, |message| {
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
            client.send_value(response);
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
            client.send_value(response);
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

fn normalize_chat_cwd(state: &ServerState, value: Option<&Value>) -> PathBuf {
    value
        .and_then(Value::as_str)
        .and_then(|path| state.allowed_paths.resolve_allowed_local_path(path))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| state.allowed_paths.project_root().to_path_buf())
}

fn normalize_chat_paths(state: &ServerState, value: Option<&Value>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter_map(|path| state.allowed_paths.resolve_allowed_local_path(path))
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn resolve_agent_model(agent_kind: &str, requested: Option<&str>) -> Option<String> {
    native_chat::resolve_agent_model(agent_kind, requested)
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
            automation_routes_enabled: false,
        }
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

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/forge/clone".into(),
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "Missing Git URL" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/forge/clone".into(),
            Some(json!({ "gitUrl": "https://github.com/inferay/example.git" })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "Missing clone location" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/forge/clone".into(),
            Some(json!({
                "gitUrl": "https://gitlab.com/inferay/example.git",
                "cloneDirectory": root.path(),
            })),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            value,
            json!({ "error": "Only GitHub clone URLs are supported" })
        );

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/forge/connect".into(),
            Some(json!({ "provider": "gitlab" })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            value,
            json!({ "error": "Only GitHub connect is supported right now" })
        );
    }

    #[tokio::test]
    async fn persists_automations_and_validates_one_shot_routes_without_bun() {
        let root = TempDir::new().unwrap();
        let mut config = test_config(root.path());
        config.automation_routes_enabled = true;
        let automations_path = config.user_data_dir.join("automations.json");
        let app = router(config);

        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/automations".into(),
            Some(json!({
                "flows": [{ "id": "flow-1", "nodes": [{ "prompt": "research" }] }],
                "ignored": true,
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            value,
            json!({ "flows": [{ "id": "flow-1", "nodes": [{ "prompt": "research" }] }] })
        );
        let persisted: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&automations_path).unwrap()).unwrap();
        assert_eq!(persisted, value);

        let (status, value) = call_json(&app, Method::GET, "/api/automations".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            value,
            json!({ "flows": [{ "id": "flow-1", "nodes": [{ "prompt": "research" }] }] })
        );

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/automations/run".into(),
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "prompt is required" }));

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

        let mut config = test_config(root.path());
        config.automation_routes_enabled = true;
        let app = router(config);

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/generate-title".into(),
            Some(json!({ "message": "Move server behavior" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "title": "Generated Rust Title" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/automations/run".into(),
            Some(json!({ "prompt": "research the repository", "cwd": root.path() })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "result": "automation result" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/generate-commit-message".into(),
            Some(json!({ "cwd": root.path() })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            value,
            json!({ "message": "Port one-shot services to Rust" })
        );
    }

    #[tokio::test]
    async fn serves_native_diff_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let response = router(test_config(root.path()))
            .oneshot(
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/native/diff")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::from(
                        json!({ "before": "alpha\nbeta", "after": "alpha\ngamma" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(
            value["diff"]["stats"],
            json!({ "added": 1, "removed": 1, "unchanged": 1 })
        );
        assert!(value["diff"]["computedAt"].as_u64().unwrap() > 0);
    }

    #[test]
    fn normalizes_client_storage_like_the_previous_bun_route() {
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
        assert_eq!(
            normalize_client_storage_entries(&json!({ AGENT_STATE_STORAGE_KEY: null })),
            json!({ AGENT_STATE_STORAGE_KEY: null })
                .as_object()
                .unwrap()
                .clone()
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

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/client-storage".into(),
            Some(json!({
                "entries": {
                    AGENT_STATE_STORAGE_KEY: "{\"groups\":[]}",
                    "agent-layout-mode": "grid",
                    "agent-workspace-panels:default": "{\"detachedFilePanels\":[]}",
                    "unknown-key": "ignored",
                    "inferay-custom-theme": "night",
                }
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));

        let (status, value) =
            call_json(&app, Method::GET, "/api/client-storage".into(), None).await;
        assert_eq!(status, StatusCode::OK);
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

        let (status, value) = call_json(
            &app,
            Method::GET,
            "/api/client-storage?key=inferay-custom-theme".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
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
    async fn serves_config_and_background_routes_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));

        let (status, config) = call_json(&app, Method::GET, "/api/config".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(config["openai"]["model"], "gpt-5.6-sol");
        assert_eq!(config["build_agent"], "claude");

        let (status, config) = call_json(
            &app,
            Method::PUT,
            "/api/config".into(),
            Some(json!({
                "openai": { "api_key": "secret" },
                "build_agent": "codex",
                "machine_id": "configured-machine",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(config["openai"]["api_key"], "secret");
        assert_eq!(config["openai"]["model"], "gpt-5.6-sol");
        assert_eq!(config["build_agent"], "codex");

        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/config/search-folders".into(),
            Some(json!({ "folders": ["~/Code", "~/Work"] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "folders": ["~/Code", "~/Work"] }));

        let (status, value) =
            call_json(&app, Method::GET, "/api/config/search-folders".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "folders": ["~/Code", "~/Work"] }));

        let (status, value) = call_json(&app, Method::GET, "/api/machine-id".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "machineId": "configured-machine" }));

        let boundary = "inferay-test-boundary";
        let image = b"test-png-bytes";
        let mut multipart = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sky.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .into_bytes();
        multipart.extend_from_slice(image);
        multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/config/background-image")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .header(
                        CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(multipart))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], true);
        assert!(value["revision"].as_u64().unwrap() > 0);

        let response = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/api/config/background-image")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
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

        let (status, prompts) = call_json(&app, Method::GET, "/api/prompts".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(prompts.as_array().unwrap().len(), 1);
        assert_eq!(prompts[0]["_id"], "builtin-review");

        let (status, created) = call_json(
            &app,
            Method::POST,
            "/api/prompts".into(),
            Some(json!({
                "name": "Explain",
                "description": "Explain code",
                "command": "explain",
                "promptTemplate": "Explain {args}",
                "tags": ["learning"],
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
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

        let (status, value) = call_json(
            &app,
            Method::POST,
            format!("/api/prompts/{id}/usage"),
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
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
        let (status, context) = call_json(&app, Method::GET, context_uri, None).await;
        assert_eq!(status, StatusCode::OK);
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
        std::fs::create_dir_all(root.path().join("scripts")).unwrap();
        std::fs::write(
            root.path().join("scripts/config.local.yaml"),
            format!(
                "search_folders:\n  - {}\n",
                serde_json::to_string(&search_root.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
        let app = router(test_config(root.path()));

        let browse_uri = query_path(
            "/api/agent/directories",
            &[("path", search_root.to_string_lossy().as_ref())],
        );
        let (status, value) = call_json(&app, Method::GET, browse_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["directories"].as_array().unwrap().len(), 2);
        assert_eq!(value["directories"][0]["name"], "AlphaProject");
        assert_eq!(value["directories"][1]["name"], "nested");
        assert_eq!(value["parent"], root.path().to_string_lossy().as_ref());

        let (status, value) = call_json(
            &app,
            Method::GET,
            "/api/agent/directories?q=beta".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["directories"].as_array().unwrap().len(), 1);
        assert_eq!(value["directories"][0]["name"], "BetaProject");
        assert_eq!(value["parent"], serde_json::Value::Null);

        let (status, value) = call_json(
            &app,
            Method::GET,
            "/api/agent/directories?quickPicks=true".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
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
    async fn persists_and_mutates_agent_state_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let config = test_config(root.path());
        std::fs::create_dir_all(&config.user_data_dir).unwrap();
        let legacy_state = json!({
            "groups": [{
                "id": "legacy-group",
                "name": "Legacy",
                "panes": [{
                    "id": "legacy-pane",
                    "title": "legacy",
                    "agentKind": "codex",
                    "cwd": "/tmp/legacy",
                    "pendingCwd": false,
                }],
                "selectedPaneId": "legacy-pane",
                "columns": 3,
                "rows": 2,
            }],
            "selectedGroupId": "legacy-group",
            "themeId": "default",
            "fontSize": 13,
            "fontFamily": "SF Mono",
            "opacity": 1,
        });
        std::fs::write(
            config.user_data_dir.join("terminal-state.json"),
            serde_json::to_vec(&legacy_state).unwrap(),
        )
        .unwrap();
        let state_path = config.user_data_dir.join("agent-state.json");
        let app = router(config);

        let (status, value) = call_json(&app, Method::GET, "/api/agent/state".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["selectedGroupId"], "legacy-group");

        let current = json!({
            "groups": [{
                "id": "group-1",
                "name": "Current",
                "panes": [
                    {
                        "id": "pane-1",
                        "title": "one",
                        "agentKind": "codex",
                        "cwd": "/tmp/one",
                        "pendingCwd": false,
                    },
                    {
                        "id": "pane-2",
                        "title": "two",
                        "agentKind": "claude",
                        "cwd": "/tmp/two",
                        "pendingCwd": false,
                    }
                ],
                "selectedPaneId": "pane-1",
                "columns": 3,
                "rows": 2,
            }],
            "selectedGroupId": "group-1",
            "themeId": "default",
            "fontSize": 13,
            "fontFamily": "SF Mono",
            "opacity": 1,
        });
        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/state".into(),
            Some(current.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));

        let mut regressed = current.clone();
        regressed["groups"][0]["panes"] = json!([current["groups"][0]["panes"][0].clone()]);
        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/state".into(),
            Some(regressed),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));
        let persisted: Value =
            serde_json::from_slice(&std::fs::read(&state_path).unwrap()).unwrap();
        assert_eq!(persisted["groups"][0]["panes"].as_array().unwrap().len(), 2);

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/state/workspace-action".into(),
            Some(json!({
                "action": {
                    "type": "directorySelected",
                    "groupId": "group-1",
                    "paneId": "pane-1",
                    "path": "/tmp/renamed",
                }
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            value["state"]["groups"][0]["panes"][0]["cwd"],
            "/tmp/renamed"
        );
        assert_eq!(value["state"]["groups"][0]["panes"][0]["title"], "renamed");
        assert_eq!(value["state"]["groups"][0]["panes"][0]["pendingCwd"], false);

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/state/workspace-action".into(),
            Some(json!({
                "action": {
                    "type": "removeWorkspace",
                    "groupId": "group-1",
                }
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["state"]["groups"].as_array().unwrap().len(), 1);
        assert_eq!(value["state"]["groups"][0]["name"], "Default");
        assert_eq!(
            value["state"]["groups"][0]["panes"][0]["agentKind"],
            "codex"
        );
    }

    #[test]
    fn parses_development_ports_and_claude_processes_like_the_bun_route() {
        let ports = parse_unix_running_ports(
            "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n\
             node 101 ray 1u IPv4 dev 0t0 TCP *:3000 (LISTEN)\n\
             python 102 ray 1u IPv4 dev 0t0 TCP 127.0.0.1:3500 (LISTEN)\n\
             python 103 ray 1u IPv4 dev 0t0 TCP *:8000 (LISTEN)\n\
             cargo 104 ray 1u IPv4 dev 0t0 TCP *:9000 (LISTEN)\n\
             rapportd 105 ray 1u IPv4 dev 0t0 TCP *:3333 (LISTEN)\n\
             bun 106 ray 1u IPv4 dev 0t0 TCP *:3000 (LISTEN)\n",
        );
        assert_eq!(ports.len(), 3);
        assert_eq!(ports[0].port, 3000);
        assert_eq!(ports[0].name, "node server");
        assert_eq!(ports[1].port, 3500);
        assert_eq!(ports[1].name, "python");
        assert_eq!(ports[2].port, 9000);
        assert_eq!(ports[2].command, "cargo");

        let windows = parse_windows_running_ports(
            "TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING 201\n\
             TCP 0.0.0.0:5000 0.0.0.0:0 LISTENING 202\n",
        );
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].port, 3001);
        assert_eq!(windows[0].pid, 201);
        assert_eq!(windows[0].name, "port 3001");

        let parsed = parse_claude_processes(
            "PID PPID %CPU %MEM RSS ELAPSED COMMAND COMMAND\n\
             10 1 1.25 2.04 100 00:10 claude claude --resume parent\n\
             11 10 0.26 0.07 50 00:05 claude claude child\n\
             12 11 8.0 9.0 500 00:01 claude claude grandchild\n\
             20 1 0.04 0.04 25 00:02 claude claude second\n\
             99 1 100 100 1000 00:01 claude claude own\n\
             30 1 1.0 1.0 10 00:01 node node server\n",
            99,
        );
        let aggregated = aggregate_claude_processes(parsed);
        assert_eq!(aggregated.len(), 2);
        assert_eq!(aggregated[0].pid, 10);
        assert_eq!(aggregated[0].cpu, 1.5);
        assert_eq!(aggregated[0].mem, 2.1);
        assert_eq!(aggregated[0].rss, 150);
        assert_eq!(aggregated[0].command, "claude --resume parent");
        assert_eq!(aggregated[1].pid, 20);
    }

    #[tokio::test]
    async fn process_kill_routes_reject_unlisted_and_invalid_pids() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));

        let (status, ports) = call_json(&app, Method::GET, "/api/agent/ports".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(ports["ports"].is_array());

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/ports/kill".into(),
            Some(json!({ "pid": 9_007_199_254_740_991_u64 })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(value["error"], "PID is not a listed port");

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/ports/kill".into(),
            Some(json!({ "pid": 1.5 })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value["error"], "Invalid pid");

        let (status, processes) = call_json(
            &app,
            Method::GET,
            "/api/agent/claude-processes".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(processes["processes"].is_array());

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/agent/claude-processes/kill".into(),
            Some(json!({ "pid": 9_007_199_254_740_991_u64 })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(value["error"], "PID is not a listed Claude process");
    }

    #[tokio::test]
    async fn serves_app_identity_and_validates_native_paths_without_bun() {
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

        let (status, first) = call_json(&app, Method::GET, "/api/app-info".into(), None).await;
        assert_eq!(status, StatusCode::OK);
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

        let (status, second) = call_json(&app, Method::GET, "/api/app-info".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            second["update"]["checkedAt"], first["update"]["checkedAt"],
            "failed release checks retain the existing 60-second cache contract"
        );

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/native/open-path".into(),
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(value, json!({ "error": "Missing path" }));

        let outside = root.path().parent().unwrap().join("outside-file");
        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/native/open-path".into(),
            Some(json!({ "path": outside, "reveal": true })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(value, json!({ "error": "Access denied" }));
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

        let (status, first) = call_json(&app, Method::GET, "/api/app-info".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["version"], "1.2.3");
        assert_eq!(first["production"], false);
        assert_eq!(first["update"]["available"], true);
        assert_eq!(first["update"]["latestVersion"], "1.2.4");
        assert_eq!(
            first["update"]["url"],
            "https://example.test/releases/v1.2.4"
        );
        assert!(first["update"].get("error").is_none());

        let (status, second) = call_json(&app, Method::GET, "/api/app-info".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(second["update"], first["update"]);
        assert_eq!(request_count.load(Ordering::SeqCst), 1);

        release_server.abort();
    }

    #[tokio::test]
    async fn reports_agent_account_health_without_bun() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));

        let (status, value) =
            call_json(&app, Method::GET, "/api/agents/account-status".into(), None).await;
        assert_eq!(status, StatusCode::OK);
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
                    "id": "group-1",
                    "selectedPaneId": "pane-2",
                    "panes": [
                        { "id": "pane-1", "cwd": root_path },
                        { "id": "pane-2", "cwd": repository },
                    ],
                }],
                "selectedGroupId": "group-1",
            })
            .to_string(),
        )
        .unwrap();
        let app = router(config);

        let search_uri = query_path("/api/files/search", &[("q", "main"), ("limit", "20")]);
        let (status, search) = call_json(&app, Method::GET, search_uri, None).await;
        assert_eq!(status, StatusCode::OK);
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
        let (status, content) = call_json(&app, Method::GET, content_uri, None).await;
        assert_eq!(status, StatusCode::OK);
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
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/upload-temp")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .header(
                        CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(multipart))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let uploaded: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let uploaded_path = uploaded["path"].as_str().unwrap();
        assert!(uploaded_path.ends_with("-a_weird.png"));

        let (status, listed) = call_json(&app, Method::GET, "/api/images".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed["images"][0]["name"], "a_weird.png");
        assert_eq!(listed["images"][0]["path"], uploaded_path);
        assert_eq!(listed["images"][0]["size"], image.len());

        let file_uri = query_path("/api/file", &[("path", uploaded_path)]);
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(file_uri)
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
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

    fn run_git(repository: &Path, args: &[&str]) {
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

    async fn call_json(
        app: &Router,
        method: Method,
        uri: String,
        body: Option<serde_json::Value>,
    ) -> (StatusCode, serde_json::Value) {
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .method(method)
                    .uri(uri)
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
        let value = serde_json::from_slice(&body).unwrap();
        (status, value)
    }

    #[tokio::test]
    async fn serves_chat_persistence_routes_without_the_compatibility_backend() {
        let root = TempDir::new().unwrap();
        let user_data = root.path().join("user-data");
        std::fs::create_dir_all(user_data.join("chat-transcripts")).unwrap();
        std::fs::write(
            user_data.join("chat-transcripts/pane-1.json"),
            serde_json::to_vec_pretty(&json!([{
                "id": "saved-1",
                "role": "user",
                "content": "persist this",
                "isStreaming": false
            }]))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            user_data.join("agent-state.json"),
            serde_json::to_vec_pretty(&json!({
                "groups": [{ "panes": [{
                    "id": "pane-1",
                    "title": "Native chat",
                    "agentKind": "claude",
                    "cwd": root.path()
                }] }]
            }))
            .unwrap(),
        )
        .unwrap();
        let app = router(test_config(root.path()));

        let queue = json!([{
            "id": "queued-1",
            "text": "continue",
            "displayText": "continue"
        }]);
        let (status, value) = call_json(
            &app,
            Method::PUT,
            "/api/chat-queues/pane-1".into(),
            Some(json!({ "queue": queue })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));
        let (status, value) =
            call_json(&app, Method::GET, "/api/chat-queues/pane-1".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["queue"], queue);

        let (status, value) = call_json(
            &app,
            Method::GET,
            "/api/chat-events/pane-1?after=0&limit=10".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["events"][0]["type"], "queue_persisted");

        let (status, value) = call_json(&app, Method::GET, "/api/sessions".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["sessions"][0]["paneId"], "pane-1");
        assert_eq!(value["sessions"][0]["title"], "Native chat");
        assert_eq!(value["sessions"][0]["agentKind"], "claude");
        assert_eq!(
            value["sessions"][0]["cwd"],
            root.path().to_string_lossy().as_ref()
        );
        assert_eq!(value["sessions"][0]["messageCount"], 1);
        assert_eq!(value["sessions"][0]["lastMessage"], "persist this");
        assert_eq!(value["sessions"][0]["lastRole"], "user");
        assert!(value["sessions"][0]["updatedAt"].is_number());
        assert_eq!(value["sessions"][0]["inCurrentWorkspace"], true);

        let (status, value) =
            call_json(&app, Method::DELETE, "/api/chat-queues/pane-1".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true }));

        let (status, value) =
            call_json(&app, Method::GET, "/api/checkpoints/pane-1".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "checkpoints": [] }));
        let (status, value) = call_json(
            &app,
            Method::GET,
            "/api/checkpoints/detail/missing".into(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(value, json!({ "error": "Not found" }));
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
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .method(Method::POST)
                    .uri("/api/git/statuses")
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::from(
                        json!({ "cwds": [cwd.as_ref(), cwd.as_ref()] }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value.as_array().unwrap().len(), 1);
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

        let diff_uri = query_path(
            "/api/git/diff",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("staged", "false"),
            ],
        );
        let (status, value) = call_json(&app, Method::GET, diff_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["diff"].as_str().unwrap().contains("+changed"));

        let full_diff_uri = query_path(
            "/api/git/full-diff",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("staged", "false"),
            ],
        );
        let (status, value) = call_json(&app, Method::GET, full_diff_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["rawPatch"].as_str().unwrap().contains("diff --git"));
        assert!(
            value["newLines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "add")
        );

        let file_diff_uri = query_path(
            "/api/git/file-with-diff",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("staged", "false"),
            ],
        );
        let (status, value) = call_json(&app, Method::GET, file_diff_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            value["lines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|line| line["type"] == "add" && line["content"] == "changed")
        );

        let graph_uri = query_path("/api/git/graph", &[("cwd", cwd.as_ref()), ("limit", "10")]);
        let response = app
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .uri(graph_uri)
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["commits"].as_array().unwrap().len(), 1);
        assert_eq!(value["commits"][0]["message"], "initial");
        assert_eq!(value["commits"][0]["authorEmail"], "inferay@example.com");
        assert_eq!(value["rows"][0]["row"], 0);

        run_git(&repository, &["branch", "feature"]);
        let branches_uri = query_path("/api/git/branches", &[("cwd", cwd.as_ref())]);
        let (status, value) = call_json(&app, Method::GET, branches_uri, None).await;
        assert_eq!(status, StatusCode::OK);
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

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/branches".to_string(),
            Some(json!({ "cwd": cwd.as_ref(), "branch": "feature" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "ok": true, "branch": "feature" }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/stage".to_string(),
            Some(json!({ "cwd": cwd.as_ref() })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "success": true }));

        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/commit".to_string(),
            Some(json!({ "cwd": cwd.as_ref(), "message": "native route commit" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["success"], true);
        let commit_hash = value["hash"].as_str().unwrap();

        let log_uri = query_path("/api/git/log", &[("cwd", cwd.as_ref()), ("limit", "10")]);
        let (status, value) = call_json(&app, Method::GET, log_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["log"][0]["message"], "native route commit");

        let history_uri = query_path(
            "/api/git/file-history",
            &[
                ("cwd", cwd.as_ref()),
                ("file", "README.md"),
                ("limit", "10"),
            ],
        );
        let (status, value) = call_json(&app, Method::GET, history_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["history"].as_array().unwrap().len(), 2);

        let blame_uri = query_path(
            "/api/git/blame",
            &[("cwd", cwd.as_ref()), ("file", "README.md")],
        );
        let (status, value) = call_json(&app, Method::GET, blame_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["blame"][1]["author"], "Inferay Test");
        assert_eq!(value["blame"][1]["content"], "changed");

        let details_uri = query_path(
            "/api/git/commit-details",
            &[("cwd", cwd.as_ref()), ("hash", commit_hash)],
        );
        let (status, value) = call_json(&app, Method::GET, details_uri, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["details"]["message"], "native route commit");
        assert!(
            value["details"]["files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|file| file["path"] == "README.md")
        );

        std::fs::write(repository.join("README.md"), "unstaged again\n").unwrap();
        run_git(&repository, &["add", "README.md"]);
        let (status, value) = call_json(
            &app,
            Method::POST,
            "/api/git/unstage".to_string(),
            Some(json!({ "cwd": cwd.as_ref(), "file": "README.md" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value, json!({ "success": true }));

        let invalid_uri = query_path("/api/git/status", &[("cwd", "/outside-inferay")]);
        let response = app
            .oneshot(
                HttpRequest::builder()
                    .uri(invalid_uri)
                    .header(HOST, "127.0.0.1:4001")
                    .header("sec-fetch-site", "same-origin")
                    .header(COOKIE, "inferay_local_auth=test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
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

    #[test]
    fn filters_watched_files_like_the_previous_bun_server() {
        for filename in [
            "src/main.ts",
            "src/view.tsx",
            "src/tool.js",
            "src/component.jsx",
            "src/styles.css",
            "index.html",
            "README.md",
        ] {
            assert!(
                native_git::should_broadcast_file_change(filename),
                "{filename}"
            );
        }
        for filename in [
            ".env.ts",
            "node_modules/pkg/index.ts",
            ".git/hooks/test.ts",
            "data/session.ts",
            "src/config.json",
            "src/main.rs",
        ] {
            assert!(
                !native_git::should_broadcast_file_change(filename),
                "{filename}"
            );
        }
    }

    #[tokio::test]
    async fn embedded_restart_resets_services_without_terminating_the_host() {
        let root = TempDir::new().unwrap();
        let app = router(test_config(root.path()));
        let (status, body) = call_json(&app, Method::POST, "/api/restart".into(), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);

        let (status, _) = call_json(&app, Method::GET, "/api/app-info".into(), None).await;
        assert_eq!(status, StatusCode::OK);
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

        let watch_response = Client::new()
            .post(format!("http://{}/api/git/watch", server.local_addr()))
            .header("sec-fetch-site", "none")
            .header(COOKIE, "inferay_local_auth=test-token")
            .header(CONTENT_TYPE, "application/json")
            .body(json!({ "cwd": root_path }).to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(watch_response.status(), StatusCode::OK);

        std::fs::create_dir(root_path.join("src")).unwrap();
        std::fs::write(root_path.join("src/watched.ts"), "export {}\n").unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Some(Ok(TungsteniteMessage::Text(message))) = socket.next().await {
                    let value: serde_json::Value = serde_json::from_str(&message).unwrap();
                    if value["type"] == "file:changed" {
                        break value;
                    }
                }
            }
        })
        .await
        .expect("timed out waiting for a Rust file watcher event");
        assert_eq!(event["cwd"], root_path.to_string_lossy().as_ref());
        assert_eq!(event["file"], "src/watched.ts");
        assert!(matches!(
            event["eventType"].as_str(),
            Some("rename" | "change")
        ));

        let unwatch_response = Client::new()
            .post(format!("http://{}/api/git/unwatch", server.local_addr()))
            .header("sec-fetch-site", "none")
            .header(COOKIE, "inferay_local_auth=test-token")
            .header(CONTENT_TYPE, "application/json")
            .body(json!({ "cwd": root_path }).to_string())
            .send()
            .await
            .unwrap();
        assert_eq!(unwatch_response.status(), StatusCode::OK);
        socket.close(None).await.unwrap();

        server.shutdown();
    }
}
