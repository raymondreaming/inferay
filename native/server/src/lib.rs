mod agent_tools_mcp;
use inferay_presentation::appearance::normalize_background_settings;
mod connections;
mod files;
mod link_metadata;
mod local_video;
mod mcp_connections;
mod mcp_icons;
use files::{image_content_type, is_image_extension};
mod agent_context_store;
use inferay_presentation::git_actions;
mod settings_store;
mod workspace_dock;
mod workspace_panels;
mod workspace_store;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::agent_command::AgentCommandResolver;
use crate::agent_context_store::AgentContextStore;
use crate::path_resolution::{is_within_directory, resolve_lexically};
use crate::prompt_store::PromptStore;
use crate::settings_store::ConfigManager;
use crate::workspace_store::AgentStateStore;
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
use inferay_core::path_security::{AllowedPaths, is_safe_relative_path};
use inferay_core::prompts::PromptError;
use inferay_native_diff::{
    checkout_git_branch, commit_git, discard_git, finish_git_ref_operation, get_git_branches,
    get_git_commit_details_for_parent, get_git_commit_hunk_diff_for_parent,
    get_git_comparison_details, get_git_comparison_hunk_diff, get_git_status,
    get_git_worktree_comparison_details, get_git_worktree_comparison_hunk_diff,
    perform_git_graph_action_with_targets, perform_git_ref_operation, preflight_git_ref_operation,
    stage_git, stash_git_file, unstage_git,
};
use percent_encoding::percent_decode_str;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{broadcast, oneshot};
use url::Url;
use uuid::Uuid;

mod agent_account;
mod agent_command;
mod agent_mcp;
mod agent_protocol;
mod agent_runner;
pub mod api_reference;
mod atomic_write;
mod automation_sandbox;
pub mod chat_persistence;
mod chat_runtime;
pub mod checkpoint;
mod client_storage;
mod database_explorer;
mod forge;
mod highlight;
mod json_file;
mod markdown;
mod markdown_stream;
mod memory_store;
mod native_app;
pub mod native_git;
mod one_shot;
mod path_resolution;
mod project_chat;
mod project_definitions;
mod project_effects;
mod project_file_commands;
mod project_file_store;
mod project_index;
mod project_packs;
mod project_proposals;
mod project_requirements;
mod project_runs;
mod project_runtime;
mod project_store;
mod project_tools;
mod prompt_store;
mod provider_history;
mod render_jobs;

/// Export the same types that serialize HTTP and chat responses. Keeping this
/// beside the server makes renderer contracts follow backend schema changes.
pub fn export_renderer_types(config: &ts_rs::Config) -> Result<(), ts_rs::ExportError> {
    use ts_rs::TS;
    database_explorer::DatabaseInfo::export_all(config)?;
    database_explorer::DatabaseSchema::export_all(config)?;
    database_explorer::DatabaseRows::export_all(config)?;
    database_explorer::DatabaseRowsQuery::export_all(config)?;
    database_explorer::DatabaseCellQuery::export_all(config)?;
    memory_store::MemoryGraphData::export_all(config)?;
    memory_store::MemorySearchResponse::export_all(config)?;
    memory_store::MemoryNoteView::export_all(config)?;
    files::ProjectFileEntry::export_all(config)?;
    files::DirectoryQuickPicks::export_all(config)?;
    markdown_stream::Input::export_all(config)?;
    agent_account::AgentAccountProviderStatus::export_all(config)?;
    mcp_connections::McpProviderStatus::export_all(config)?;
    mcp_connections::McpAction::export_all(config)?;
    forge::ForgeAccount::export_all(config)?;
    forge::GithubRepo::export_all(config)?;
    markdown::PreparedMarkdown::export_all(config)?;
    markdown::MarkdownPatch::export_all(config)?;
    highlight::Classified::export_all(config)?;
    checkpoint::CheckpointMeta::export_all(config)?;
    chat_persistence::QueuedMessageInfo::export_all(config)?;
    native_app::AppInfo::export_all(config)?;
    native_git::ComparisonPlan::export_all(config)?;
    native_git::GraphDelta::export_all(config)?;
    render_jobs::HunkDiff::export_all(config)?;
    Ok(())
}

const LOCAL_AUTH_COOKIE: &str = "inferay_local_auth";
const MAX_PROXY_BODY_BYTES: usize = 32 * 1024 * 1024;
const CORS_METHODS: &str = "GET,POST,PUT,DELETE,OPTIONS";
const CORS_HEADERS: &str = "Content-Type,X-Inferay-Auth,If-None-Match,A-IM";
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
    pub run_automations: bool,
}

impl ServerConfig {
    pub fn new(listen_addr: SocketAddr, app_root: PathBuf) -> Self {
        Self {
            listen_addr,
            app_root,
            home_directory: home_directory(),
            user_data_dir: std::env::var_os("INFERAY_USER_DATA_DIR")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(default_user_data_directory),
            auth_token: Uuid::new_v4().to_string(),
            release_api_url: None,
            live_reload: false,
            run_automations: std::env::var("INFERAY_DISABLE_AUTOMATIONS").as_deref() != Ok("1"),
        }
    }
}

#[derive(Clone)]
struct ServerState {
    user_data_dir: PathBuf,
    dist_dir: PathBuf,
    public_dir: PathBuf,
    allowed_paths: AllowedPaths,
    agent_command_resolver: Arc<AgentCommandResolver>,
    mcp_connections: mcp_connections::Connections,
    agent_state_store: Arc<Mutex<AgentStateStore>>,
    background_dir: PathBuf,
    client_storage: Arc<tokio::sync::Mutex<client_storage::ClientStorage>>,
    chat_persistence: chat_persistence::ChatPersistence,
    chat_runtime: Arc<chat_runtime::ChatRuntime>,
    projects: Arc<project_runtime::ProjectRuntime>,
    checkpoint_service: checkpoint::CheckpointService,
    config_manager: Arc<tokio::sync::Mutex<ConfigManager>>,
    forge_state: Arc<forge::ForgeState>,
    next_client_id: Arc<AtomicU64>,
    agent_context_store: Arc<tokio::sync::Mutex<AgentContextStore>>,
    prompts: Arc<tokio::sync::Mutex<PromptStore>>,
    release_api_url: Option<String>,
    release_check_cache: Arc<tokio::sync::Mutex<Option<native_app::ReleaseCheckCache>>>,
    temp_dir: PathBuf,
    auth_token: String,
    client: Client,
    connection_reset: broadcast::Sender<()>,
    live_reload: bool,
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
    #[serde(flatten)]
    request: git_actions::GitRefOperationRequest,
}

#[derive(Deserialize)]
struct GitGraphActionBody {
    cwd: Option<String>,
    #[serde(flatten)]
    request: git_actions::GitGraphActionRequest,
}

#[derive(Deserialize)]
struct GitFileBody {
    cwd: Option<String>,
    file: Option<String>,
    #[serde(default)]
    staged: bool,
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
        let app = match build_router_with_connection_reset(config, connection_reset.clone()) {
            Ok(app) => app,
            Err(error) => {
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
        };
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

fn build_router_with_connection_reset(
    mut config: ServerConfig,
    connection_reset: broadcast::Sender<()>,
) -> Result<Router, String> {
    std::fs::create_dir_all(&config.user_data_dir)
        .expect("Could not create Inferay data directory");
    config.user_data_dir = config
        .user_data_dir
        .canonicalize()
        .expect("Could not resolve Inferay data directory");
    let dist_dir = if config.app_root.join("dist").is_dir() {
        config.app_root.join("dist")
    } else {
        config.app_root.join("views")
    };
    let allowed_paths = AllowedPaths::new(
        &config.app_root,
        &config.home_directory,
        std::env::current_dir().expect("server working directory must resolve"),
    )
    .expect("server path roots must resolve")
    .with_managed_root(config.user_data_dir.join("projects"))
    .expect("managed project root must resolve");
    let bundled_prompts = config.app_root.join("data/prompts.json");
    let agent_state_path = config.user_data_dir.join("agent-state.json");
    let checkpoints_path = config.user_data_dir.join("checkpoints.json");
    let checkpoint_service = checkpoint::CheckpointService::new(
        allowed_paths.clone(),
        checkpoints_path,
        config.user_data_dir.join("client-storage.json"),
    );
    let pid_tracker =
        agent_runner::RuntimePidTracker::new(config.user_data_dir.join("runtime-pids.json"));
    let orphan_cleaner = pid_tracker.clone();
    tokio::spawn(async move { orphan_cleaner.cleanup_orphans().await });
    let agent_command_resolver = Arc::new(AgentCommandResolver::new(
        config.home_directory.clone(),
        config.user_data_dir.join("mcp-preferences.json"),
    ));
    mcp_icons::initialize(config.user_data_dir.join("mcp-icons.json"));
    let agent_context_store = Arc::new(tokio::sync::Mutex::new(AgentContextStore::new(
        config.user_data_dir.join("agent-context.json"),
    )));
    let prompt_store = Arc::new(tokio::sync::Mutex::new(
        PromptStore::open(bundled_prompts, config.user_data_dir.join("prompts.json"))
            .map_err(|error| error.to_string())?,
    ));
    let config_manager = Arc::new(tokio::sync::Mutex::new(ConfigManager::new(
        config.user_data_dir.join("settings.json"),
    )));
    let chat_persistence = chat_persistence::ChatPersistence::new(config.user_data_dir.clone());
    let agent_state_store = Arc::new(Mutex::new(AgentStateStore::new(agent_state_path.clone())));
    let client_storage = Arc::new(tokio::sync::Mutex::new(client_storage::ClientStorage::new(
        config.user_data_dir.join("client-storage.json"),
    )));
    let projects = project_runtime::ProjectRuntime::open(
        &config.user_data_dir,
        prompt_store.clone(),
        pid_tracker.clone(),
    )
    .map_err(|error| error.to_string())?;
    let chat_runtime = Arc::new(chat_runtime::ChatRuntime::new(
        chat_persistence.clone(),
        checkpoint_service.clone(),
        pid_tracker.clone(),
        agent_context_store.clone(),
        prompt_store.clone(),
        agent_state_store.clone(),
        agent_command_resolver.clone(),
        projects.clone(),
        client_storage.clone(),
    ));
    let _ = projects.chat.set(Arc::downgrade(&chat_runtime));
    if config.run_automations {
        projects.start();
    }
    let state = ServerState {
        user_data_dir: config.user_data_dir.clone(),
        dist_dir,
        public_dir: config.app_root.join("public"),
        allowed_paths,
        agent_command_resolver,
        mcp_connections: Default::default(),
        agent_state_store,
        background_dir: config.user_data_dir.join("backgrounds"),
        client_storage,
        chat_persistence,
        chat_runtime,
        checkpoint_service,
        config_manager,
        projects,
        forge_state: Arc::new(forge::ForgeState::default()),
        next_client_id: Arc::new(AtomicU64::new(1)),
        agent_context_store,
        prompts: prompt_store,
        release_api_url: config.release_api_url,
        release_check_cache: Arc::new(tokio::sync::Mutex::new(None)),
        temp_dir: config.app_root.join("data/.tmp"),
        auth_token: config.auth_token,
        client: Client::new(),
        connection_reset,
        live_reload: config.live_reload,
    };
    Ok(Router::new()
        .route("/ws", any(native_websocket))
        .fallback(any(dispatch_request))
        .layer(DefaultBodyLimit::max(MAX_TEMP_UPLOAD_BYTES + 1024 * 1024))
        .with_state(state))
}

async fn dispatch_request(State(state): State<ServerState>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    let request_headers = request.headers().clone();
    let head_only = request.method() == Method::HEAD;
    if path.starts_with("/api/") || path == "/api" {
        if !is_trusted_local_request(request.headers(), &state.auth_token) {
            return text_response(StatusCode::FORBIDDEN, "Forbidden");
        }
        let mut response = if request.method() == Method::OPTIONS && path.starts_with("/api/") {
            StatusCode::NO_CONTENT.into_response()
        } else {
            dispatch_api(&state, &path, request)
                .await
                .unwrap_or_else(IntoResponse::into_response)
        };
        add_cors_headers(response.headers_mut(), &request_headers);
        return response;
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
    serve_renderer_index(&state, &request_headers, head_only).await
}
async fn dispatch_api(state: &ServerState, path: &str, request: Request) -> ApiResult<Response> {
    let result = match (path, request.method().as_str()) {
        ("/api/openapi.json", "GET") => {
            return Ok(json_response(
                StatusCode::OK,
                database_explorer::http::openapi(),
            ));
        }
        (path, "GET") if database_explorer::http::handles(path) => {
            return database_explorer::http::read(state, request).await;
        }
        ("/api/link-metadata", "GET") => {
            let url = query_value(&request, "url").unwrap_or_default();
            return Ok(json_response(
                StatusCode::OK,
                link_metadata::load(&url).await,
            ));
        }
        ("/api/projects", "GET") => {
            let project = query_value(&request, "projectId");
            let before = query_value(&request, "before");
            state
                .projects
                .catalog(project, before)
                .await
                .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
                .and_then(|v| {
                    serde_json::to_value(v)
                        .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))
                })
        }
        ("/api/projects/history", "GET") => state
            .projects
            .history(
                query_value(&request, "projectId").unwrap_or_default(),
                query_value(&request, "before"),
            )
            .await
            .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
            .and_then(|v| {
                serde_json::to_value(v).map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, e))
            }),
        ("/api/projects/connections", "GET" | "POST") => connections::http(state, request).await,
        ("/api/projects/run-chat", "POST") => project_chat::open(state, request).await,
        ("/api/projects/effects", "GET") => project_effects::inbox_http(state, request).await,
        ("/api/projects/effects/cancel", "POST") => {
            project_effects::cancel_http(state, request).await
        }
        ("/api/projects/effects/dismiss", "POST") => {
            project_effects::dismiss_http(state, request).await
        }
        ("/api/projects/command", "POST") => project_command(state, request).await,
        ("/api/projects/proposal", "POST") => project_proposal(state, request).await,
        ("/api/projects/proposal-review", "POST") => project_proposal_review(state, request).await,
        ("/api/memory" | "/api/memory/note" | "/api/memory/graph", "GET") => {
            return memory_store::http::read(state, request).await;
        }
        ("/api/memory/delete", "POST") => memory_store::http::delete(state, request).await,
        ("/api/memory/save", "POST") => memory_store::http::save(state, request).await,
        ("/api/client-storage", "GET") => get_client_storage(state, request).await,
        ("/api/client-storage", "POST" | "PUT") => update_client_storage(state, request).await,
        ("/api/config/search-folders", "GET") => get_search_folders(state, request).await,
        ("/api/prompts", "GET") => list_prompts(state, request).await,
        ("/api/prompts/proposal", "POST") => skill_proposal(state, request).await,
        ("/api/prompts", "POST") => create_prompt(state, request).await,
        ("/api/agent-context", "GET") => get_agent_context(state, request).await,
        ("/api/agent-context", "PUT") => update_agent_context(state, request).await,
        ("/api/agent/state/initialize", "POST") => initialize_agent_state(state, request).await,
        ("/api/agent/state", "GET") => return get_agent_state(state, request).await,
        ("/api/agent/state/workspace-action", "POST") => {
            apply_agent_workspace_action(state, request).await
        }
        ("/api/agent/directories", "GET") => files::get_agent_directories(state, request).await,
        ("/api/forge/accounts", "GET") => forge::handle_request(state, path, request).await,
        ("/api/forge/repos", "GET") => forge::handle_request(state, path, request).await,
        ("/api/forge/commit-avatars", "POST") => forge::handle_request(state, path, request).await,
        ("/api/forge/clone", "POST") => forge::handle_request(state, path, request).await,
        ("/api/forge/connect", "POST") => forge::handle_request(state, path, request).await,
        ("/api/git/status", "GET") => git_status(state, request).await,
        ("/api/git/statuses", "POST") => git_statuses(state, request).await,
        ("/api/git/summaries", "POST") => git_summaries(state, request).await,
        ("/api/git/branches", "GET") => git_branches(state, request).await,
        ("/api/git/branches", "POST") => git_checkout_branch(state, request).await,
        ("/api/git/ref-operation", "POST") => git_ref_operation(state, request).await,
        ("/api/git/ref-operation-preflight", "POST") => {
            git_ref_operation_preflight(state, request).await
        }
        ("/api/git/graph-action", "POST") => git_graph_action(state, request).await,
        ("/api/git/commit-details", "GET") => git_commit_details(state, request).await,
        ("/api/git/comparison-details", "GET" | "POST") => {
            git_comparison_details(state, request).await
        }
        ("/api/git/stage", "POST") => git_file_action(state, request, GitFileAction::Stage).await,
        ("/api/git/unstage", "POST") => {
            git_file_action(state, request, GitFileAction::Unstage).await
        }
        ("/api/git/discard", "POST") => {
            git_file_action(state, request, GitFileAction::Discard).await
        }
        ("/api/git/stash-file", "POST") => {
            git_file_action(state, request, GitFileAction::Stash).await
        }
        ("/api/git/commit", "POST") => git_commit(state, request).await,

        ("/api/agent/commands", "GET") => state
            .prompts
            .lock()
            .await
            .load()
            .map_err(ApiError::from)
            .map(|skills| {
                json!(inferay_core::provider_config::composer_commands(
                    &query_value(&request, "kind").unwrap_or_default(),
                    &skills,
                ))
            }),
        ("/api/native/provider-config", "GET") => {
            // A broken skill library must not prevent startup or local commands.
            let skills = state.prompts.lock().await.load().unwrap_or_default();
            let entries = state
                .client_storage
                .lock()
                .await
                .select(&["inferay-default-chat-settings"])
                .await
                .unwrap_or_default();
            let defaults = entries
                .get("inferay-default-chat-settings")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .unwrap_or(Value::Null);
            Ok(json!(inferay_core::provider_config::renderer_catalog(
                &defaults, &skills
            )))
        }
        ("/api/native/provider-config", "POST") => provider_configuration(state, request).await,
        ("/api/native/markdown", "POST") => {
            return native_markdown(request).await;
        }
        ("/api/native/markdown/stream", "POST") => {
            return native_markdown_stream(request).await;
        }
        ("/api/native/highlight", "POST") => {
            return native_highlight(request).await;
        }
        ("/api/native/diff", "POST") => {
            return native_diff(request).await;
        }
        ("/api/config/search-folders", "PUT") => update_search_folders(state, request).await,
        ("/api/config/background-image", "GET") => {
            return get_background_image(state, request).await;
        }
        ("/api/config/background-image", "POST") => update_background_image(state, request).await,
        ("/api/config/pick-folder", "POST") => Ok(json!({"folder": selected_folder_path().await})),

        ("/api/agents/account-status", "GET") => agent_account::account_status(state).await,
        ("/api/agents/mcp-action", "POST") => mcp_connections::act(state, request).await,
        ("/api/agents/mcp-status", "GET") => {
            let kind = match query_value(&request, "provider").as_deref() {
                Some("codex") => inferay_core::agent_kind::AgentKind::Codex,
                Some("claude") => inferay_core::agent_kind::AgentKind::Claude,
                _ => {
                    return Err(ApiError(
                        StatusCode::BAD_REQUEST,
                        "Unknown agent provider".into(),
                    ));
                }
            };
            Ok(json!(mcp_connections::status(
                state,
                kind,
                query_value(&request, "refresh").as_deref() == Some("true")
            )))
        }
        ("/api/workspace/panels", "POST") => workspace_panels::handle(state, request).await,
        ("/api/workspace/dock", "POST") => workspace_dock::handle(state, request).await,

        ("/api/files/search", "GET") => search_files(state, request).await,
        ("/api/mcp-icons", "GET") => Ok(mcp_icons::manifest()),
        ("/api/mcp-icon", "GET") => {
            let server = query_value(&request, "server").unwrap_or_default();
            let response = match mcp_icons::get(&server).await {
                Some((mime, bytes)) => {
                    let mut response = Response::new(Body::from(bytes));
                    response
                        .headers_mut()
                        .insert(CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap());
                    response.headers_mut().insert(
                        CACHE_CONTROL,
                        HeaderValue::from_static("private, max-age=3600"),
                    );
                    response.headers_mut().insert(
                        "content-security-policy",
                        HeaderValue::from_static("default-src 'none'; sandbox"),
                    );
                    response.headers_mut().insert(
                        "x-content-type-options",
                        HeaderValue::from_static("nosniff"),
                    );
                    Ok(response)
                }
                None => Err(api_error(StatusCode::NOT_FOUND, "Icon unavailable")),
            };
            return response;
        }
        ("/api/workspace/documents", "POST") => {
            workspace_panels::restore_documents(state, request).await
        }
        ("/api/files/content" | "/api/files/preview", "GET") => {
            get_file_content(state, request).await
        }
        ("/api/upload-temp", "POST") => upload_temp_file(state, request).await,
        ("/api/projects/documents", "POST") => upload_project_document(state, request).await,
        ("/api/projects/plugin-import", "POST") => upload_plugin_library(state, request).await,
        ("/api/projects/document", "GET") => {
            return serve_project_document(state, request).await;
        }

        ("/api/video", "GET" | "HEAD") => {
            return local_video::serve(state, request).await;
        }
        ("/api/file", "GET") => {
            return serve_local_image(state, request).await;
        }
        ("/api/git/image", "GET") => {
            return serve_git_image(state, request).await;
        }
        ("/api/git/graph", "GET") => {
            return git_graph(state, request).await;
        }
        ("/api/git/diff", "GET") => {
            return git_diff(state, request).await;
        }
        ("/api/git/generate-commit-message", "POST") => {
            one_shot::generate_commit_message_route(state, request).await
        }
        ("/api/app-info", "GET") => Ok(json!(native_app::load_app_info(state).await)),
        ("/api/native/update", "POST") => return Ok(native_app::update_route()),
        ("/api/native/update", "GET") => {
            return Ok(native_app::update_status_route());
        }
        _ => dynamic_json_route(state, path, request).await,
    };
    result.map(|value| json_response(StatusCode::OK, value))
}
async fn dynamic_json_route(state: &ServerState, path: &str, request: Request) -> ApiResult {
    if let Some(id) = prompt_path(path) {
        return match request.method().as_str() {
            "PUT" => update_prompt(state, request, id).await,
            "DELETE" => delete_prompt(state, request, id).await,
            _ => Err(api_error(StatusCode::NOT_FOUND, "Not found")),
        };
    }
    if let Some(pane_id) = route_parameter(path, "/api/chat-queues/") {
        return match request.method().as_str() {
            "GET" => get_chat_queue(state, request, &pane_id).await,
            "PATCH" => patch_chat_queue(state, request, &pane_id).await,
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

async fn provider_configuration(state: &ServerState, request: Request) -> ApiResult {
    save_provider_configuration(state, api_body(request).await?).await
}

async fn save_provider_configuration(state: &ServerState, mut input: Value) -> ApiResult {
    let Some(pane_id) = input["paneId"].as_str().map(str::to_owned) else {
        let resolved = json!(inferay_core::provider_config::resolve(&input));
        state
            .client_storage
            .lock()
            .await
            .update(std::collections::BTreeMap::from([(
                "inferay-default-chat-settings".into(),
                Some(Value::String(resolved.to_string())),
            )]))
            .await?;
        return Ok(resolved);
    };
    let storage = state.client_storage.lock().await;
    let fields = [
        ("model", format!("inferay-chat-model-{pane_id}")),
        (
            "reasoningLevel",
            format!("inferay-chat-reasoning-{pane_id}"),
        ),
    ];
    let entries = storage
        .select(&["inferay-default-chat-settings", &fields[0].1, &fields[1].1])
        .await?;
    input["defaults"] = entries
        .get("inferay-default-chat-settings")
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(Value::Null);
    for (field, key) in &fields {
        if input.get(field).is_none() {
            input[field] = entries.get(key).cloned().unwrap_or(Value::Null);
        }
    }
    let resolved = json!(inferay_core::provider_config::resolve(&input));
    storage
        .update(
            fields
                .into_iter()
                .map(|(field, key)| (key, Some(resolved[field].clone())))
                .collect(),
        )
        .await?;
    Ok(resolved)
}

async fn default_chat_kind(state: &ServerState) -> &'static str {
    let entries = state
        .client_storage
        .lock()
        .await
        .select(&["inferay-default-chat-settings"])
        .await
        .unwrap_or_default();
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
    state.chat_runtime.repair_saved_titles().await?;
    let kind = default_chat_kind(state).await;
    let value = state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .initialize(kind)?;
    Ok(json!({"state":value}))
}

async fn get_agent_state(state: &ServerState, _request: Request) -> ApiResult<Response> {
    state.chat_runtime.repair_saved_titles().await?;
    state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .read()
        .map(|state| json_response(StatusCode::OK, state))
        .map_err(Into::into)
}

async fn apply_agent_workspace_action(state: &ServerState, request: Request) -> ApiResult {
    #[derive(Deserialize)]
    struct Input {
        action: inferay_core::workspace_action::AgentWorkspaceAction,
    }
    let body: Input = api_body(request).await?;
    let default_kind = default_chat_kind(state).await;
    state
        .agent_state_store
        .lock()
        .expect("agent state lock poisoned")
        .apply_workspace_action(&body.action, default_kind)
        .map(|value| json!({ "state": value }))
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))
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
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        json_response(self.0, json!({"error":self.1}))
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
    Ok(json!(
        read_git_repositories(state, request, get_git_status)
            .await?
            .into_iter()
            .map(|(_, status)| status)
            .collect::<Vec<_>>()
    ))
}
async fn git_summaries(state: &ServerState, request: Request) -> ApiResult {
    Ok(json!(
        read_git_repositories(state, request, inferay_native_diff::get_git_change_summary)
            .await?
            .into_iter()
            .collect::<std::collections::BTreeMap<_, _>>()
    ))
}
async fn read_git_repositories<T: Send + 'static>(
    state: &ServerState,
    request: Request,
    read: fn(&str) -> Option<T>,
) -> ApiResult<Vec<(String, T)>> {
    let body: GitStatusesBody = api_body(request).await?;
    let mut seen = std::collections::HashSet::new();
    let tasks = body
        .cwds
        .unwrap_or_default()
        .into_iter()
        .filter_map(|cwd| safe_cwd(state, &cwd))
        .filter(|cwd| seen.insert(cwd.clone()))
        .map(|cwd| tokio::task::spawn_blocking(move || read(&cwd).map(|result| (cwd, result))));
    Ok(join_all(tasks)
        .await
        .into_iter()
        .filter_map(|result| result.ok().flatten())
        .collect())
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
    let git_actions::GitRefOperationRequest {
        operation,
        action,
        source,
        target,
    } = body.request;
    let result = if action == "start" {
        let source = required(source, "Missing source branch")?;
        let target = required(target, "Missing target branch")?;
        tokio::task::spawn_blocking(move || {
            perform_git_ref_operation(&cwd, &operation, &source, &target)
        })
        .await?
    } else {
        tokio::task::spawn_blocking(move || finish_git_ref_operation(&cwd, &operation, &action))
            .await?
    };
    Ok(git_actions::operation_payload(result, true))
}
async fn git_ref_operation_preflight(state: &ServerState, request: Request) -> ApiResult {
    let body: GitRefOperationBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let source = required(body.request.source, "Missing source branch")?;
    let target = required(body.request.target, "Missing target branch")?;
    Ok(json!(
        tokio::task::spawn_blocking(move || preflight_git_ref_operation(&cwd, &source, &target))
            .await?
    ))
}
async fn git_graph_action(state: &ServerState, request: Request) -> ApiResult {
    let body: GitGraphActionBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    Ok(git_actions::operation_payload(
        tokio::task::spawn_blocking(move || {
            perform_git_graph_action_with_targets(
                &cwd,
                &body.request.action,
                body.request.target.as_deref(),
                body.request.targets.as_deref().unwrap_or_default(),
                body.request.name.as_deref(),
                body.request.message.as_deref(),
            )
        })
        .await?,
        false,
    ))
}
enum GitFileAction {
    Stage,
    Unstage,
    Discard,
    Stash,
}

async fn git_file_action(
    state: &ServerState,
    request: Request,
    action: GitFileAction,
) -> ApiResult {
    let body: GitFileBody = api_body(request).await?;
    let cwd = request_cwd(state, body.cwd.as_deref())?;
    let file = body.file.filter(|file| !file.is_empty());
    if file
        .as_deref()
        .is_some_and(|file| !is_safe_relative_path(file))
        || (matches!(action, GitFileAction::Stash) && file.is_none())
    {
        return Err(api_error(StatusCode::BAD_REQUEST, "Invalid file parameter"));
    }
    let success = tokio::task::spawn_blocking(move || match action {
        GitFileAction::Stage => Ok(stage_git(&cwd, file.as_deref())),
        GitFileAction::Unstage => Ok(unstage_git(&cwd, file.as_deref())),
        GitFileAction::Discard => discard_git(&cwd, body.staged, file.as_deref()).map(|()| true),
        GitFileAction::Stash => {
            stash_git_file(&cwd, file.as_deref().expect("validated file")).map(|()| true)
        }
    })
    .await?
    .map_err(|error| api_error(StatusCode::CONFLICT, error))?;
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
    let (hidden_refs, solo_refs, pinned_refs) = {
        let preference = |key: &str| {
            query_value(&request, key)
                .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
                .unwrap_or_default()
        };
        (
            preference("hiddenRefs"),
            preference("soloRefs"),
            preference("pinnedRefs"),
        )
    };
    if query.len() > 4096 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Graph search query is too long",
        ));
    }
    let started = std::time::Instant::now();
    let scope = format!(
        "graph-v6\0{}\0",
        serde_json::to_string(&(&cwd, limit, &query, &hidden_refs, &solo_refs, &pinned_refs))
            .expect("graph scope serialization")
    );
    let previous =
        if request_headers.get("a-im").and_then(|h| h.to_str().ok()) == Some("inferay-graph") {
            request_headers
                .get("if-none-match")
                .and_then(|h| h.to_str().ok())
                .and_then(|etag| render_jobs::previous(&scope, etag))
        } else {
            None
        };
    let task = async move {
        let input_cwd = cwd.clone();
        let (forge_result, input_result) = tokio::join!(
            forge::graph_pull_requests(state, Path::new(&cwd)),
            render_jobs::run(move || inferay_native_diff::prepare_git_graph(&input_cwd))
        );
        let (pr_revision, pull_requests) = forge_result;
        let input = input_result?;
        let key = format!("{scope}{}\0{pr_revision}", input.revision);
        // Repeated snapshots are similarly sized. Reserve once, with room for a
        // small edit, instead of repeatedly reallocating a multi-megabyte buffer.
        let capacity = previous.as_ref().map_or(128, |base| base.body.len() + 4096);
        let (rendered, hit) =
            render_jobs::cached(key, std::time::Duration::from_secs(30), move || {
                let mut snapshot = inferay_native_diff::get_git_graph_snapshot_with_query(
                    &cwd, limit, input, &query,
                );
                inferay_presentation::graph_response::annotate_pull_requests(
                    &mut snapshot,
                    &pull_requests,
                );
                let response = inferay_presentation::graph_response::response(
                    &snapshot,
                    &hidden_refs,
                    &solo_refs,
                    &pinned_refs,
                );
                let mut bytes = Vec::with_capacity(capacity);
                serde_json::to_writer(&mut bytes, &response).ok()?;
                Some(bytes)
            })
            .await?;
        let rendered = rendered.ok_or_else(|| "Graph preparation failed".to_owned())?;
        render_jobs::release_previous(&scope, &rendered.etag);
        let current = rendered.clone();
        let delta = match previous {
            Some(previous) if previous.etag != rendered.etag => render_jobs::run(move || {
                native_git::graph_delta(&previous.body, &current.body)
                    .map(|body| (previous.etag, body))
            })
            .await
            .unwrap_or(None),
            _ => None,
        };
        Ok::<_, String>((rendered, hit, delta))
    };
    match tokio::time::timeout(std::time::Duration::from_secs(10), task).await {
        Ok(Ok((rendered, hit, delta))) => {
            let mut response = cached_render_response(rendered, hit, started, &request_headers);
            if let Some((base, body)) = delta {
                *response.status_mut() = StatusCode::IM_USED;
                *response.body_mut() = Body::from(body);
                response
                    .headers_mut()
                    .insert("im", HeaderValue::from_static("inferay-graph"));
                response
                    .headers_mut()
                    .insert("delta-base", HeaderValue::from_str(&base).unwrap());
                response
                    .headers_mut()
                    .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
            }
            Ok(response)
        }
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Git history request timed out",
        )),
    }
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
        json!({ "details": get_git_commit_details_for_parent(&cwd, &hash, parent.as_deref()) })
    })
    .await
    {
        Ok(details) => Ok(details),
        Err(error) => Err(api_error(StatusCode::INTERNAL_SERVER_ERROR, error)),
    }
}

async fn git_comparison_details(state: &ServerState, request: Request) -> ApiResult {
    let cwd = query_value(&request, "cwd")
        .as_deref()
        .and_then(|cwd| safe_cwd(state, cwd))
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Invalid comparison directory"))?;
    let explicit_from = query_value(&request, "from").unwrap_or_default();
    let explicit_to = query_value(&request, "to").unwrap_or_default();
    let selection = if request.method() == Method::POST {
        let mut body: Value = api_body(request).await?;
        Some(
            serde_json::from_value::<Vec<native_git::ComparisonSelection>>(
                body.get_mut("selection")
                    .map(Value::take)
                    .unwrap_or(Value::Null),
            ),
        )
    } else {
        query_value(&request, "selection").map(|selection| serde_json::from_str(&selection))
    };
    let plan = if let Some(items) = selection {
        match items {
            Ok(items) if items.len() <= 1000 => native_git::plan_comparison(&cwd, &items),
            _ => {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "Invalid comparison selection",
                ));
            }
        }
    } else {
        Some(native_git::ComparisonPlan {
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
        if to == "WORKTREE" {
            get_git_worktree_comparison_details(&allowed_paths, &cwd, &from)
        } else {
            get_git_comparison_details(&cwd, &from, &to)
        }
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

async fn git_diff(state: &ServerState, request: Request) -> ApiResult<Response> {
    // Decode once, retaining the first occurrence of duplicate parameters.
    let query = url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .collect::<Vec<_>>();
    let value = |key: &str| {
        query
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_ref())
    };
    let comparison = value("comparisonFrom").is_some_and(|s| !s.is_empty())
        && value("comparisonTo").is_some_and(|s| !s.is_empty());
    let full = !comparison && value("commitHash").is_none_or(|s| s.is_empty());
    let missing = if full {
        "Missing cwd or file parameter"
    } else if comparison {
        "Missing cwd, from, to, or file parameter"
    } else {
        "Missing cwd, hash, or file parameter"
    };
    let invalid = || api_error(StatusCode::BAD_REQUEST, missing);
    let cwd = value("cwd")
        .and_then(|cwd| safe_cwd(state, cwd))
        .ok_or_else(invalid)?;
    let file = value("file")
        .filter(|file| is_safe_relative_path(file))
        .ok_or_else(invalid)?
        .to_owned();
    let review = value("view") == Some("review");
    let allowed_paths = state.allowed_paths.clone();
    if full {
        return await_cached_render(
            native_git::full_diff(
                allowed_paths,
                cwd,
                file,
                value("staged") == Some("true"),
                review,
            ),
            std::time::Instant::now(),
            request.headers(),
            Some("File is not changed"),
            "Working-tree diff unavailable",
        )
        .await;
    }
    let from = value(if comparison {
        "comparisonFrom"
    } else {
        "commitHash"
    })
    .filter(|hash| safe_hash(hash))
    .ok_or_else(invalid)?
    .to_owned();
    let to = if comparison {
        Some(
            value("comparisonTo")
                .filter(|hash| *hash == "WORKTREE" || safe_hash(hash))
                .ok_or_else(invalid)?
                .to_owned(),
        )
    } else {
        value("commitParent")
            .filter(|hash| safe_hash(hash))
            .map(str::to_owned)
    };
    let worktree = comparison && to.as_deref() == Some("WORKTREE");
    let started = std::time::Instant::now();
    let key = format!(
        "git-diff:{:?}",
        (
            &allowed_paths,
            &cwd,
            &file,
            comparison,
            &from,
            &to,
            review,
            value("revision").unwrap_or_default()
        )
    );
    // Full object IDs are immutable; abbreviated hashes retain the short cache window.
    let full_oid = |value: &str| {
        matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
    };
    let immutable = full_oid(&from) && to.as_deref().is_none_or(full_oid);
    let ttl = std::time::Duration::from_secs(if worktree {
        0
    } else if immutable {
        60
    } else {
        2
    });
    let task = render_jobs::cached(key, ttl, move || {
        let diff = if worktree {
            get_git_worktree_comparison_hunk_diff(&allowed_paths, &cwd, &from, &file, review)
        } else if comparison {
            get_git_comparison_hunk_diff(&cwd, &from, to.as_deref().unwrap(), &file, review)
        } else {
            get_git_commit_hunk_diff_for_parent(&cwd, &from, to.as_deref(), &file, review)
        };
        diff.map(|diff| render_jobs::diff_bytes(diff, &file))
    });
    let (unchanged, unavailable) = if comparison {
        (
            "File is not changed between these commits",
            "Comparison diff unavailable",
        )
    } else {
        (
            "File is not changed in this commit",
            "Commit diff unavailable",
        )
    };
    await_cached_render(
        task,
        started,
        request.headers(),
        Some(unchanged),
        unavailable,
    )
    .await
}

fn prompt_path(path: &str) -> Option<&str> {
    let remainder = path.strip_prefix("/api/prompts/")?;
    let mut parts = remainder.split('/');
    let id = parts.next().filter(|id| !id.is_empty())?;
    (parts.next().is_none()).then_some(id)
}

async fn list_prompts(state: &ServerState, request: Request) -> ApiResult {
    let skills = state.prompts.lock().await.load()?;
    Ok(json!(inferay_core::prompts::filter_prompts(
        &skills,
        &query_value(&request, "filter").unwrap_or_else(|| "all".into()),
        &query_value(&request, "search").unwrap_or_default(),
    )))
}

async fn skill_proposal(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let id = required(
        body["messageId"].as_str().filter(|id| !id.is_empty()),
        "Missing proposal message ID",
    )?;
    let key = format!("inferay-skill-proposal:{id}");
    let storage = state.client_storage.lock().await;
    let entries = storage.select(&[&key]).await?;
    let stored = entries
        .get(&key)
        .and_then(Value::as_str)
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or(Value::Null);
    let (view, record) = state.prompts.lock().await.proposal(
        &body["proposal"],
        &stored,
        body["decision"].as_str(),
        unix_millis(),
    )?;
    if let Some(record) = record {
        storage
            .update(std::collections::BTreeMap::from([(
                key,
                Some(Value::String(record.to_string())),
            )]))
            .await?;
    }
    Ok(json!(view))
}

async fn create_prompt(state: &ServerState, request: Request) -> ApiResult {
    let body: serde_json::Map<String, Value> = api_body(request).await?;
    Ok(json!(
        state.prompts.lock().await.create(&body, unix_millis())?
    ))
}

async fn update_prompt(state: &ServerState, request: Request, id: &str) -> ApiResult {
    let body: serde_json::Map<String, Value> = api_body(request).await?;
    Ok(json!(state.prompts.lock().await.update(
        id,
        &body,
        unix_millis()
    )?))
}

async fn delete_prompt(state: &ServerState, _request: Request, id: &str) -> ApiResult {
    state.prompts.lock().await.delete(id)?;
    Ok(json!({"ok":true}))
}

async fn get_agent_context(state: &ServerState, request: Request) -> ApiResult {
    let cwd = query_value(&request, "cwd");
    let pane_id = query_value(&request, "paneId");
    Ok(json!(
        state
            .agent_context_store
            .lock()
            .await
            .resolve(cwd.as_deref(), pane_id.as_deref())
    ))
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
            .active_cwds()
            .await
            .unwrap_or_else(|_| vec![project_root_cwd(state)]),
    };
    let invalid_directory = |_| api_error(StatusCode::BAD_REQUEST, "Invalid directory");
    let cwds = cwds
        .iter()
        .map(|cwd| state.project_cwd(cwd))
        .collect::<Result<Vec<_>, _>>()
        .map_err(invalid_directory)?;
    let query = query_value(&request, "q").unwrap_or_default();
    let limit = safe_limit(
        query_value(&request, "limit").as_deref().unwrap_or("20"),
        20,
        50,
    );
    let searches = cwds
        .into_iter()
        .map(|cwd| files::search_project_files(cwd, &query, limit));
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
    Ok(json!({"results":results}))
}

fn project_root_cwd(state: &ServerState) -> String {
    state
        .allowed_paths
        .project_root()
        .to_string_lossy()
        .into_owned()
}

async fn get_file_content(state: &ServerState, request: Request) -> ApiResult {
    let path = required(
        query_value(&request, "path").filter(|path| !path.is_empty()),
        "No path provided",
    )?;
    let cwd = if request.uri().path() == "/api/files/preview" {
        let requested = Path::new(&path);
        if requested.is_absolute() {
            requested
                .parent()
                .ok_or(ApiError(StatusCode::FORBIDDEN, "Access denied".into()))?
                .to_string_lossy()
                .into_owned()
        } else {
            project_root_cwd(state)
        }
    } else {
        match query_value(&request, "cwd").filter(|cwd| !cwd.is_empty()) {
            Some(cwd) => cwd,
            None => state
                .active_cwds()
                .await
                .unwrap_or_default()
                .into_iter()
                .next()
                .unwrap_or_else(|| project_root_cwd(state)),
        }
    };
    state.read_project_file(&cwd, &path).await
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

async fn serve_project_document(state: &ServerState, request: Request) -> ApiResult<Response> {
    let id = query_value(&request, "projectId").unwrap_or_default();
    let path = query_value(&request, "path").unwrap_or_default();
    let bytes = state
        .projects
        .document_bytes(id, path.clone())
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))?;
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    let mut response = Response::new(axum::body::Body::from(bytes));
    response
        .headers_mut()
        .insert("content-type", mime.parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    if mime == "application/octet-stream" {
        response
            .headers_mut()
            .insert("content-disposition", "attachment".parse().unwrap());
    }
    Ok(response)
}

async fn upload_plugin_library(state: &ServerState, mut request: Request) -> ApiResult {
    request.extensions_mut().insert(DefaultBodyLimit::max(
        inferay_core::project_files::PLUGIN_BYTE_LIMIT + 1024 * 1024,
    ));
    let project_id = query_value(&request, "projectId")
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Project is required"))?;
    let name = query_value(&request, "name")
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Library name is required"))?;
    let mut multipart = Multipart::from_request(request, &())
        .await
        .map_err(|e| e.to_string())?;
    let mut originals = std::collections::BTreeMap::new();
    let mut total = 0usize;
    while let Some(field) = multipart.next_field().await.map_err(|e| e.to_string())? {
        let path = field
            .name()
            .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "File path is required"))?
            .to_owned();
        inferay_core::project_files::relative_path(&path)?;
        let bytes = field.bytes().await.map_err(|e| e.to_string())?;
        total += bytes.len();
        if total > inferay_core::project_files::PLUGIN_BYTE_LIMIT
            || originals.len() >= inferay_core::project_files::PLUGIN_ENTRY_LIMIT
        {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "Library exceeds 1,000 entries or 50 MB",
            ));
        }
        if originals.insert(path, bytes.to_vec()).is_some() {
            return Err(api_error(StatusCode::BAD_REQUEST, "Duplicate file path"));
        }
    }
    state
        .projects
        .import_library(project_id, name, originals)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

async fn upload_project_document(state: &ServerState, request: Request) -> ApiResult {
    let project_id = query_value(&request, "projectId")
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Project is required"))?;
    let (name, _, bytes) = uploaded_file(request, "Choose a document").await?;
    state
        .projects
        .import_document(project_id, name, bytes.to_vec())
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

async fn upload_temp_file(state: &ServerState, request: Request) -> ApiResult {
    let (name, _, bytes) = uploaded_file(request, "No file provided").await?;
    let path = state.store_image(&name, &bytes).await?;
    Ok(json!({"path":path}))
}

async fn serve_local_image(state: &ServerState, request: Request) -> ApiResult<Response> {
    let request_headers = request.headers().clone();
    let thumbnail = query_value(&request, "thumbnail").as_deref() == Some("true");
    let Some(path) = query_value(&request, "path").filter(|path| !path.is_empty()) else {
        return Err(api_error(StatusCode::BAD_REQUEST, "No path provided"));
    };
    let Some(path) = resolve_serveable_local_path(state, &path).await else {
        return Err(api_error(StatusCode::FORBIDDEN, "Access denied"));
    };
    if !is_image_extension(&path.to_string_lossy()) {
        return Err(api_error(StatusCode::BAD_REQUEST, "Unsupported file type"));
    }
    let thumbnail = thumbnail && image_content_type(&path) != "image/svg+xml";
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
    let etag = format!(
        "\"{}-{}-{}\"",
        metadata.len(),
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|time| time.as_nanos())
            .unwrap_or_default(),
        if thumbnail { "preview-1" } else { "original" }
    );
    let unchanged = request_headers
        .get("if-none-match")
        .and_then(|value| value.to_str().ok())
        == Some(etag.as_str());
    let mut response = if unchanged {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::NOT_MODIFIED;
        response
    } else {
        let bytes = if thumbnail {
            files::image_thumbnail(path.clone())
                .await
                .map_err(|error| api_error(StatusCode::UNPROCESSABLE_ENTITY, &error))?
        } else {
            tokio::fs::read(&path).await?
        };
        Response::new(Body::from(bytes))
    };
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static(if thumbnail {
            "image/png"
        } else {
            image_content_type(&path)
        }),
    );
    response.headers_mut().insert(
        "etag",
        HeaderValue::from_str(&etag).expect("numeric image validator"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    response.headers_mut().insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

async fn serve_git_image(state: &ServerState, request: Request) -> ApiResult<Response> {
    let invalid = || {
        api_error(
            StatusCode::BAD_REQUEST,
            "Missing cwd, rev, or file parameter",
        )
    };
    let cwd = query_value(&request, "cwd")
        .and_then(|cwd| safe_cwd(state, &cwd))
        .ok_or_else(invalid)?;
    let file = query_value(&request, "file")
        .filter(|file| is_safe_relative_path(file) && is_image_extension(file))
        .ok_or_else(invalid)?;
    let revision = match query_value(&request, "rev").unwrap_or_default().as_str() {
        "INDEX" => String::new(),
        "HEAD" => String::from("HEAD"),
        hash if safe_hash(hash) => hash.to_owned(),
        _ => return Err(invalid()),
    };
    let content_type = image_content_type(Path::new(&file));
    let bytes = tokio::task::spawn_blocking(move || {
        inferay_native_diff::git_blob_bytes(&cwd, &revision, &file)
    })
    .await
    .map_err(|error| ApiError::from(error.to_string()))?
    .map_err(|_| api_error(StatusCode::NOT_FOUND, "Image not found at this revision"))?;
    if bytes.len() as u64 > MAX_SERVED_FILE_BYTES {
        return Err(api_error(StatusCode::PAYLOAD_TOO_LARGE, "File too large"));
    }
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

async fn resolve_serveable_local_path(state: &ServerState, path: &str) -> Option<PathBuf> {
    let resolved = resolve_lexically(Path::new(path)).ok()?;
    let real = tokio::fs::canonicalize(resolved).await.ok()?;
    (state.allowed_paths.is_allowed_local_path(&real)
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

async fn get_background_image(state: &ServerState, _request: Request) -> ApiResult<Response> {
    let file_path = state.background_dir.join("custom-background");
    let bytes = match tokio::fs::read(&file_path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(text_response(StatusCode::NOT_FOUND, "Not found"));
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
    "editor-selected-pane",
    "git-watched-dirs",
    "main-sidebar-width",
    "sidebar-collapsed",
    "workspace-sidebar-mode",
    "agent-editor-zen",
    "agent-layout-mode",
    "agent-main-view",
];
const SYNCED_STORAGE_PREFIXES: &[&str] = &[
    "commit-graph-columns-",
    "commit-graph-scroll-v1:",
    "agent-workspace-",
    "git-change-checkpoint:",
    "inferay-",
    "inferay.",
];
const CHAT_NON_MESSAGE_STORAGE_PREFIXES: &[&str] = &[
    "inferay-chat-session-",
    "inferay-chat-input-",
    "inferay-chat-scroll-",
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

// Browser filtering uses the native key lists, before preferences are uploaded.
fn client_storage_key_pattern() -> String {
    let alternatives = |values: &[&str]| {
        values
            .iter()
            .map(|value| regex::escape(value))
            .collect::<Vec<_>>()
            .join("|")
    };
    let chat_suffixes = CHAT_NON_MESSAGE_STORAGE_PREFIXES
        .iter()
        .filter_map(|prefix| prefix.strip_prefix("inferay-chat-"))
        .collect::<Vec<_>>();
    format!(
        r"^(?!{}(?![\s\S])|inferay-chat-(?:queue|loading|model|reasoning)-)(?!inferay-chat-(?!(?:{})))(?:(?:{})(?![\s\S])|{})",
        regex::escape(AGENT_STATE_STORAGE_KEY),
        alternatives(&chat_suffixes),
        alternatives(SYNCED_STORAGE_KEYS),
        alternatives(SYNCED_STORAGE_PREFIXES),
    )
}

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
        || key.starts_with("inferay-chat-model-")
        || key.starts_with("inferay-chat-reasoning-")
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
        .map(|(key, value)| {
            let value = if key == "inferay-app-background" {
                value
                    .as_str()
                    .map(normalize_background_settings)
                    .map(Value::String)
                    .unwrap_or_else(|| value.clone())
            } else {
                value.clone()
            };
            (key.clone(), value)
        })
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

fn migrate_vscode_appearance(entries: &mut serde_json::Map<String, Value>) -> bool {
    const MIGRATION: &str = "inferay-vscode-appearance-version";
    if entries.get(MIGRATION).and_then(Value::as_str) == Some("1") {
        return false;
    }
    entries.insert("inferay-app-font".into(), json!("vscode"));
    entries.insert("inferay-app-theme-id".into(), json!("default"));
    entries.insert(
        "inferay-syntax-highlight-theme".into(),
        json!("vscode-black"),
    );
    entries.insert(MIGRATION.into(), json!("1"));
    true
}

async fn get_client_storage(state: &ServerState, request: Request) -> ApiResult {
    let requested_key = query_value(&request, "key");
    let storage = state.client_storage.lock().await;
    let mut migrations = storage
        .select(&[
            "inferay-vscode-appearance-version",
            "inferay-app-background",
        ])
        .await?;
    let mut changed = migrate_vscode_appearance(&mut migrations);
    if let Some(Value::String(stored)) = migrations.get("inferay-app-background") {
        let normalized = normalize_background_settings(stored);
        if normalized != *stored {
            migrations.insert("inferay-app-background".into(), Value::String(normalized));
            changed = true;
        }
    }
    if changed {
        storage
            .update(
                migrations
                    .into_iter()
                    .map(|(key, value)| (key, Some(value)))
                    .collect(),
            )
            .await?;
    }
    let entries = if let Some(key) = requested_key {
        storage.select(&[&key]).await?
    } else {
        storage
            .read_matching(|key| {
                !is_chat_message_storage_key(key) && !key.starts_with("inferay-checkpoints-")
            })
            .await?
    };
    Ok(json!({"entries":entries,"storageKeyPattern":client_storage_key_pattern()}))
}

async fn update_client_storage(state: &ServerState, request: Request) -> ApiResult {
    let body: Value = api_body(request).await?;
    let entries = normalize_client_storage_entries(&body["entries"]);
    let changes = entries
        .into_iter()
        .map(|(key, value)| {
            let remove = value.is_null() && !is_chat_preference_key(&key);
            (key, (!remove).then_some(value))
        })
        .collect();
    state.client_storage.lock().await.update(changes).await?;
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

async fn native_markdown_stream(request: Request) -> ApiResult<Response> {
    let bytes = to_bytes(request.into_body(), markdown::MAX_PARSE_BYTES * 6 + 1024)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Markdown request exceeds the payload limit",
            )
        })?;
    let input: markdown_stream::Input = serde_json::from_slice(&bytes)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid Markdown stream request"))?;
    let job = render_jobs::run(move || {
        markdown_stream::apply(input)
            .map(|patch| serde_json::to_vec(&patch).expect("Markdown patch serialization"))
    });
    match tokio::time::timeout(std::time::Duration::from_secs(10), job).await {
        Ok(Ok(Ok(body))) => Ok(json_bytes_response(StatusCode::OK, body.into())),
        Ok(Ok(Err(markdown_stream::Error::Resync))) => Err(api_error(
            StatusCode::CONFLICT,
            "Markdown stream needs a full reset",
        )),
        Ok(Ok(Err(markdown_stream::Error::Invalid(message)))) => {
            Err(api_error(StatusCode::BAD_REQUEST, message))
        }
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Markdown preparation unavailable",
        )),
    }
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
            let mut response = json_bytes_response(StatusCode::OK, body.body);
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

async fn native_highlight(request: Request) -> ApiResult<Response> {
    const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
    #[derive(Deserialize)]
    struct Input {
        path: String,
        text: String,
        #[serde(default, rename = "lineTypes")]
        line_types: Option<Vec<String>>,
        #[serde(default)]
        preview: bool,
    }
    // A JSON escape can expand one input byte into six wire bytes.
    let Ok(bytes) = to_bytes(request.into_body(), MAX_TEXT_BYTES * 6 + 1024).await else {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Highlight request exceeds the payload limit",
        ));
    };
    let Ok(input) = serde_json::from_slice::<Input>(&bytes) else {
        return Err(api_error(StatusCode::BAD_REQUEST, "Expected path and text"));
    };
    // Filename and shebang can select grammars for extensionless files.
    let key = format!(
        "highlight:4:{}:{:?}:{}",
        input.path, input.line_types, input.text
    );
    let preview = input.preview;
    let classify = move || {
        let result = match input.line_types {
            Some(types) => highlight::classify_diff(&input.path, &input.text, &types),
            None => highlight::classify(&input.path, &input.text),
        };
        serde_json::to_vec(&result).ok()
    };
    let job = render_jobs::cached_highlight_priority(
        key,
        std::time::Duration::from_secs(300),
        preview,
        classify,
    );
    match tokio::time::timeout(std::time::Duration::from_secs(10), job).await {
        Ok(Ok((Some(body), _))) => Ok(json_bytes_response(StatusCode::OK, body.body)),
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Syntax highlighting unavailable",
        )),
    }
}

async fn native_diff(request: Request) -> ApiResult<Response> {
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
        Ok(Ok(Ok(bytes))) => Ok(json_bytes_response(StatusCode::OK, bytes.into())),
        Ok(Ok(Err(error))) => Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, error)),
        _ => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Edit diff preparation unavailable",
        )),
    }
}

async fn await_cached_render(
    task: impl std::future::Future<Output = Result<(Option<render_jobs::Rendered>, bool), String>>,
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
    rendered: render_jobs::Rendered,
    hit: bool,
    started: std::time::Instant,
    headers: &HeaderMap,
) -> Response {
    let render_jobs::Rendered { body, etag } = rendered;
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

fn json_bytes_response(status: StatusCode, body: axum::body::Bytes) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json;charset=utf-8"),
    );
    response
}

fn json_response(status: StatusCode, value: impl Serialize) -> Response {
    let body = serde_json::to_vec(&value).expect("JSON response serialization");
    json_bytes_response(status, body.into())
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
    if state.live_reload && !head_only {
        return serve_live_reload_index(state, &index, headers).await;
    }
    serve_file(
        &index,
        "text/html",
        "no-cache",
        true,
        headers,
        &state.auth_token,
        head_only,
    )
    .await
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
    body: Body,
    content_type: &'static str,
    cache_control: &'static str,
    set_cookie: bool,
    request_headers: &HeaderMap,
    auth_token: &str,
) -> Response {
    let mut response = Response::new(body);
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

fn encode_chat_event(message: impl Serialize) -> axum::extract::ws::Utf8Bytes {
    serde_json::to_string(&message)
        .expect("chat event serialization")
        .into()
}

async fn serve_native_websocket(state: ServerState, socket: WebSocket) {
    let client_id = state.next_client_id.fetch_add(1, Ordering::Relaxed);
    let (sender, mut outgoing) = broadcast::channel(512);
    let mut connection_reset = state.connection_reset.subscribe();
    let (mut sink, mut stream) = socket.split();
    {
        // Keep command order on this connection, while allowing output for all
        // panes to drain during a slow reconnect or state operation.
        let read = async {
            while let Some(incoming) = stream.next().await {
                match incoming {
                    Ok(message @ (AxumMessage::Text(_) | AxumMessage::Binary(_))) => {
                        if let Ok(message) = serde_json::from_slice::<Value>(&message.into_data())
                            && let Err(error) = handle_native_websocket_message(
                                &state, client_id, &sender, &message,
                            )
                            .await
                        {
                            let pane = message
                                .get("paneId")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            let _ = sender.send(encode_chat_event(
                                json!({"type":"chat:error", "paneId":pane, "error":error}),
                            ));
                        }
                    }
                    // Axum/Tungstenite owns ping responses, including flushing them.
                    Ok(AxumMessage::Ping(_) | AxumMessage::Pong(_)) => {}
                    Ok(AxumMessage::Close(_)) | Err(_) => break,
                }
            }
        };
        let write = async {
            loop {
                let message = match outgoing.recv().await {
                    Ok(message) => AxumMessage::Text(message),
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                };
                if sink.send(message).await.is_err() {
                    break;
                }
            }
        };
        tokio::select! {
            _ = connection_reset.recv() => {},
            _ = read => {},
            _ = write => {},
        }
    }
    state.chat_runtime.detach_client(client_id, None).await;
    let _ = sink.close().await;
}

async fn handle_native_websocket_message(
    state: &ServerState,
    client_id: chat_runtime::ClientId,
    sender: &broadcast::Sender<axum::extract::ws::Utf8Bytes>,
    message: &Value,
) -> Result<(), String> {
    let send = |message: Value| {
        let _ = sender.send(encode_chat_event(message));
    };
    let Some(message_type) = message.get("type").and_then(Value::as_str) else {
        return Ok(());
    };
    let pane_id = message
        .get("paneId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if message_type == "chat:send"
        && !pane_id.is_empty()
        && let Some(text) = message.get("text").and_then(Value::as_str)
        && let Some(command) = text.trim().strip_prefix('/')
    {
        let mut parts = command.splitn(2, char::is_whitespace);
        let name = parts.next().unwrap_or_default().to_ascii_lowercase();
        let args = parts.next().unwrap_or_default().trim();
        let command_input = || {
            let mut input =
                chat_runtime::SendMessageInput::deserialize(message).unwrap_or_default();
            if input.agent_kind.is_empty() {
                input.agent_kind = "claude".into();
            }
            input.cwd = normalize_chat_cwd(state, Some(&input.cwd));
            input.cwd_provided = true;
            input.client_id = Some(client_id);
            input.client_sender = Some(sender.clone());
            input
        };
        if name == "exit" {
            send(json!({"type":"chat:control","paneId":pane_id,"action":"exit"}));
            return Ok(());
        }
        if name == "clear" {
            state.chat_runtime.destroy_session(pane_id).await?;
            send(json!({"type":"chat:control","paneId":pane_id,"action":"cleared"}));
            return Ok(());
        }
        if name == "help" {
            let skills = state.prompts.lock().await.load().unwrap_or_default();
            let kind = message
                .get("agentKind")
                .and_then(Value::as_str)
                .unwrap_or("claude");
            let help = inferay_core::provider_config::composer_commands(kind, &skills)
                .into_iter()
                .map(|command| format!("/{} - {}", command.name, command.description))
                .collect::<Vec<_>>()
                .join("\n");
            state
                .chat_runtime
                .publish_command_response(command_input(), &help)
                .await;
            return Ok(());
        }
        if name == "btw" {
            if args.is_empty() {
                state
                    .chat_runtime
                    .publish_command_response(command_input(), "Usage: /btw <question>")
                    .await;
            } else {
                let cwd = normalize_chat_cwd(state, message["cwd"].as_str().map(Path::new));
                let runtime = state.chat_runtime.clone();
                let resolver = state.agent_command_resolver.clone();
                let sender = sender.clone();
                let pane = pane_id.to_owned();
                let question = args.to_owned();
                tokio::spawn(async move {
                    runtime
                        .run_side_question(&pane, &question, cwd, client_id, sender, &resolver)
                        .await;
                });
            }
            return Ok(());
        }
    }
    match message_type {
        "chat:destroy" if !pane_id.is_empty() => {
            // Removing a run's pane only hides it. History retains the same
            // conversation, and an active task continues without a viewer.
            if state
                .projects
                .is_run_chat(pane_id)
                .map_err(|e| e.to_string())?
            {
                state
                    .chat_runtime
                    .detach_client(client_id, Some(pane_id))
                    .await;
                return Ok(());
            }
            state
                .chat_runtime
                .destroy_session(pane_id)
                .await
                .map_err(|error| format!("Could not clear saved chat: {error}"))?;
            let store = state
                .agent_state_store
                .lock()
                .expect("agent state lock poisoned");
            if store.pane(pane_id)?.is_some() {
                store.set_pane_provider_session(pane_id, None)?;
            }
        }

        "chat:unsubscribe" if !pane_id.is_empty() => {
            state
                .chat_runtime
                .detach_client(client_id, Some(pane_id))
                .await;
        }
        "chat:reconnect" if !pane_id.is_empty() => {
            let pane = state
                .agent_state_store
                .lock()
                .expect("agent state lock poisoned")
                .pane(pane_id)
                .map_err(|error| format!("Could not restore saved workspace: {error}"))?;
            state
                .chat_runtime
                .reconnect(chat_runtime::ReconnectInput {
                    pane_id,
                    client_id,
                    sender: sender.clone(),
                    provider: message.get("agentKind").and_then(Value::as_str),
                    provider_session_id: pane
                        .as_ref()
                        .and_then(|pane| pane.provider_session_id.as_deref())
                        .or_else(|| message.get("sessionId").and_then(Value::as_str)),
                    cwd: message
                        .get("cwd")
                        .and_then(Value::as_str)
                        .filter(|path| !path.is_empty())
                        .and_then(|path| state.allowed_paths.resolve_allowed_local_path(path)),
                    cursor: message
                        .get("epoch")
                        .and_then(Value::as_str)
                        .zip(message.get("revision").and_then(Value::as_u64)),
                })
                .await;
        }
        "chat:stop" if !pane_id.is_empty() => {
            state.chat_runtime.stop_generation(pane_id).await;
        }
        "chat:workspace" if !pane_id.is_empty() => {
            serde_json::from_value::<Vec<String>>(message["paths"].clone())
                .map_err(|error| error.to_string())
                .and_then(|paths| {
                    let paths = normalize_chat_paths(state, &paths)
                        .into_iter()
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect();
                    state
                        .agent_state_store
                        .lock()
                        .expect("agent state lock poisoned")
                        .set_pending_workspace(pane_id, paths)
                })?;
        }
        "chat:send" if !pane_id.is_empty() => {
            let mut input = chat_runtime::SendMessageInput::deserialize(message)
                .map_err(|error| format!("Invalid chat request: {error}"))?;
            if message.get("agentKind").is_none() {
                input.agent_kind = "claude".into();
            }
            let settings = state
                .client_storage
                .lock()
                .await
                .select(&[
                    &format!("inferay-chat-model-{pane_id}"),
                    &format!("inferay-chat-reasoning-{pane_id}"),
                ])
                .await?;
            input.model = settings
                .get(&format!("inferay-chat-model-{pane_id}"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(input.model);
            input.reasoning_level = settings
                .get(&format!("inferay-chat-reasoning-{pane_id}"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(input.reasoning_level);
            if input.cwd.as_os_str().is_empty() {
                let pending = state
                    .agent_state_store
                    .lock()
                    .expect("agent state lock poisoned")
                    .consume_pending_workspace(pane_id)?;
                if let Some((cwd, references)) = pending {
                    input.cwd = PathBuf::from(cwd);
                    input.reference_paths = references.into_iter().map(PathBuf::from).collect();
                    input.reference_paths_provided = true;
                    send(json!({"type":"chat:workspace","paneId":pane_id}));
                }
            }
            input.cwd_provided = !input.cwd.as_os_str().is_empty();
            input.reasoning_level_provided = input.reasoning_level.is_some();
            input.reference_paths_provided |= message.get("referencePaths").is_some();
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
                return Ok(());
            };
            let cwd = normalize_chat_cwd(state, message["cwd"].as_str().map(Path::new));
            let pane_id = pane_id.to_string();
            let text = text.to_string();
            let resolver = state.agent_command_resolver.clone();
            let sender = sender.clone();
            let runtime = state.chat_runtime.clone();
            tokio::spawn(async move {
                runtime
                    .run_side_question(&pane_id, &text, cwd, client_id, sender, &resolver)
                    .await;
            });
        }
        "checkpoint:revert" if !pane_id.is_empty() => {
            let Some(checkpoint_id) = message.get("checkpointId").and_then(Value::as_str) else {
                return Ok(());
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
                response["checkpoints"] =
                    json!(state.checkpoint_service.list_checkpoints(pane_id).await);
            } else {
                response["error"] = json!(result.error);
            }
            send(response);
        }
        _ => {}
    }
    Ok(())
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
        "access-control-expose-headers",
        HeaderValue::from_static("ETag,IM,Delta-Base"),
    );
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
mod file_http_tests {
    use super::*;

    #[tokio::test]
    async fn working_tree_diff_validators_follow_content_and_preserve_errors() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let repository = root.join("home/repo");
        std::fs::create_dir_all(&repository).unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(args)
                .current_dir(&repository)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "user.name", "Fixture"]);
        git(&["config", "commit.gpgsign", "false"]);
        let file = repository.join("source.txt");
        std::fs::write(&file, "base\n").unwrap();
        git(&["add", "source.txt"]);
        git(&["commit", "-qm", "fixture"]);
        std::fs::write(&file, "first\n").unwrap();
        std::fs::create_dir(root.join("app")).unwrap();
        let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.join("app"));
        config.home_directory = root.join("home");
        config.user_data_dir = root.join("state");
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let client = Client::new();
        let mut url = Url::parse(&format!("http://{}/api/git/diff", server.local_addr())).unwrap();
        url.query_pairs_mut().extend_pairs([
            ("cwd", repository.to_str().unwrap()),
            ("file", "source.txt"),
            ("staged", "false"),
            ("view", "full"),
        ]);
        let get = || {
            client
                .get(url.clone())
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
                .header("origin", "http://localhost:9999")
        };
        for request in [
            client.get(url.clone()),
            client
                .get(url.clone())
                .header("x-inferay-auth", &auth)
                .header("origin", "https://example.invalid"),
        ] {
            let forbidden = request.send().await.unwrap();
            assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
            assert!(
                !forbidden
                    .headers()
                    .contains_key(ACCESS_CONTROL_ALLOW_ORIGIN)
            );
        }
        let first = get().send().await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(
            first.headers()[ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:9999"
        );
        let etag = first.headers()["etag"].clone();
        assert!(!first.bytes().await.unwrap().is_empty());
        std::fs::write(repository.join("unrelated.txt"), "other edit\n").unwrap();
        let unchanged = get().header("if-none-match", &etag).send().await.unwrap();
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(
            unchanged.headers()[ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:9999"
        );
        assert!(unchanged.bytes().await.unwrap().is_empty());
        std::fs::write(&file, "second\n").unwrap();
        let changed = get().header("if-none-match", &etag).send().await.unwrap();
        assert_eq!(changed.status(), StatusCode::OK);
        assert_ne!(changed.headers()["etag"], etag);
        let etag = changed.headers()["etag"].clone();
        assert!(changed.text().await.unwrap().contains("second"));
        std::fs::write(&file, "base\n").unwrap();
        let clean = get().header("if-none-match", &etag).send().await.unwrap();
        assert_eq!(clean.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            clean.headers()[ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:9999"
        );
        assert!(clean.text().await.unwrap().contains("File is not changed"));
        let image_path = repository.join("new.png");
        std::fs::write(&image_path, b"first image").unwrap();
        url.query_pairs_mut().clear().extend_pairs([
            ("cwd", repository.to_str().unwrap()),
            ("file", "new.png"),
            ("staged", "false"),
            ("view", "full"),
        ]);
        let image_get = || {
            client
                .get(url.clone())
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
                .header("origin", "http://localhost:9999")
        };
        let first = image_get().send().await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let etag = first.headers()["etag"].clone();
        let first: Value = serde_json::from_slice(&first.bytes().await.unwrap()).unwrap();
        let unchanged = image_get()
            .header("if-none-match", &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(unchanged.status(), StatusCode::NOT_MODIFIED);
        std::fs::write(&image_path, b"second image").unwrap();
        let changed = image_get()
            .header("if-none-match", &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(changed.status(), StatusCode::OK);
        assert_ne!(changed.headers()["etag"], etag);
        let changed: Value = serde_json::from_slice(&changed.bytes().await.unwrap()).unwrap();
        assert_ne!(first["newImage"], changed["newImage"]);
        server.shutdown();
    }

    #[tokio::test]
    async fn image_previews_are_bounded_cached_and_preserve_originals() {
        let root = std::env::temp_dir().join(format!("inferay-image-test-{}", Uuid::new_v4()));
        let app = root.join("app");
        std::fs::create_dir_all(&app).unwrap();
        let path = app.join("screenshot.png");
        image::RgbaImage::from_pixel(3456, 2168, image::Rgba([20, 40, 80, 128]))
            .save(&path)
            .unwrap();
        let original = std::fs::read(&path).unwrap();
        let mut config = ServerConfig::new(
            "127.0.0.1:0".parse().unwrap(),
            std::fs::canonicalize(&app).unwrap(),
        );
        config.user_data_dir = root.join("state");
        std::fs::create_dir_all(root.join("home")).unwrap();
        config.home_directory = std::fs::canonicalize(root.join("home")).unwrap();
        std::fs::create_dir_all(&config.user_data_dir).unwrap();
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let client = Client::new();
        let get = |path: &Path, thumbnail: bool| {
            let mut url = Url::parse(&format!("http://{}/api/file", server.local_addr())).unwrap();
            url.query_pairs_mut().extend_pairs([
                ("path", path.to_string_lossy().into_owned()),
                ("thumbnail", thumbnail.to_string()),
            ]);
            client
                .get(url)
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
        };
        let artifact = root.join("state/projects/studio/runs/render/output/beauty.png");
        std::fs::create_dir_all(artifact.parent().unwrap()).unwrap();
        std::fs::write(&artifact, &original).unwrap();
        let artifact_response = get(&artifact, false).send().await.unwrap();
        assert_eq!(artifact_response.status(), StatusCode::OK);
        assert_eq!(artifact_response.headers()["content-type"], "image/png");
        assert_eq!(
            artifact_response.bytes().await.unwrap().as_ref(),
            original.as_slice()
        );
        let response = get(&path, true).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let etag = response.headers()["etag"].clone();
        let bytes = response.bytes().await.unwrap();
        let preview = image::load_from_memory(&bytes).unwrap();
        assert_eq!(preview.width(), 512);
        assert!(preview.height() <= 512);
        assert_eq!(preview.to_rgba8().get_pixel(0, 0)[3], 128);
        let cached = get(&path, true)
            .header("if-none-match", &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(cached.status(), StatusCode::NOT_MODIFIED);
        assert!(cached.bytes().await.unwrap().is_empty());
        assert_eq!(
            get(&path, false)
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap()
                .as_ref(),
            original
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        image::RgbaImage::new(64, 32).save(&path).unwrap();
        assert_eq!(
            get(&path, true)
                .header("if-none-match", &etag)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        std::fs::write(root.join("outside.png"), &original).unwrap();
        assert_eq!(
            get(&root.join("outside.png"), true)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let repository = root.join("home/Developer/checkout");
        std::fs::create_dir_all(&repository).unwrap();
        let icon = repository.join("AppIcon-76.png");
        std::fs::write(&icon, &original).unwrap();
        let response = get(&icon, false).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(response.bytes().await.unwrap().as_ref(), original);
        let vector = repository.join("logo.svg");
        let markup = b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"/>";
        std::fs::write(&vector, markup).unwrap();
        let response = get(&vector, true).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/svg+xml");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.bytes().await.unwrap().as_ref(), markup);
        server.shutdown();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn committed_and_staged_image_sides_stream_from_git() {
        let temp = std::env::temp_dir().join(format!("inferay-git-image-{}", Uuid::new_v4()));
        std::fs::create_dir_all(temp.join("home")).unwrap();
        let root = std::fs::canonicalize(&temp).unwrap();
        let repository = root.join("home/repo");
        std::fs::create_dir_all(&repository).unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(args)
                .current_dir(&repository)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        git(&["config", "user.name", "Fixture"]);
        git(&["config", "commit.gpgsign", "false"]);
        let icon = repository.join("icon.png");
        let committed = {
            let mut bytes = Vec::new();
            image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255]))
                .write_to(
                    &mut std::io::Cursor::new(&mut bytes),
                    image::ImageFormat::Png,
                )
                .unwrap();
            bytes
        };
        std::fs::write(&icon, &committed).unwrap();
        git(&["add", "icon.png"]);
        git(&["commit", "-m", "add icon"]);

        let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.join("app"));
        std::fs::create_dir_all(root.join("app")).unwrap();
        config.user_data_dir = root.join("state");
        config.home_directory = root.join("home");
        std::fs::create_dir_all(&config.user_data_dir).unwrap();
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let client = Client::new();
        let get = |rev: &str, file: &str| {
            let mut url =
                Url::parse(&format!("http://{}/api/git/image", server.local_addr())).unwrap();
            url.query_pairs_mut().extend_pairs([
                ("cwd", repository.to_string_lossy().into_owned()),
                ("rev", rev.to_owned()),
                ("file", file.to_owned()),
            ]);
            client
                .get(url)
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
        };

        std::fs::write(&icon, b"replaced").unwrap();
        let response = get("HEAD", "icon.png").send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(response.bytes().await.unwrap().as_ref(), committed);
        assert_eq!(
            get("INDEX", "icon.png")
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap()
                .as_ref(),
            committed
        );
        assert_eq!(
            get("HEAD", "../outside.png").send().await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            get("HEAD", "notes.txt").send().await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            get("main", "icon.png").send().await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            get("HEAD", "missing.png").send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        server.shutdown();
        std::fs::remove_dir_all(temp).unwrap();
    }
}

#[cfg(test)]
mod proposal_http_tests {
    use super::*;

    #[tokio::test]
    async fn proposal_decisions_survive_restart_and_do_not_repeat_writes() {
        let root = std::env::temp_dir().join(format!("inferay-proposal-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut saved_id = Value::Null;
        for restart in [false, true] {
            let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.clone());
            config.home_directory = root.clone();
            config.user_data_dir = root.join("state");
            let auth = config.auth_token.clone();
            let server = ServerHandle::start(config).unwrap();
            let url = format!("http://{}/api/prompts/proposal", server.local_addr());
            let client = Client::new();
            for decision in [None, Some("approve"), Some("approve")] {
                let response = client.post(&url)
                    .header("x-inferay-auth", &auth).header("sec-fetch-site", "same-origin")
                    .header("content-type", "application/json").body(json!({"messageId":"proposal-1", "decision":decision,
                        "proposal":{"action":"create","name":"Review","command":"review","promptTemplate":"Review code"}}).to_string())
                    .send().await.unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let model: Value =
                    serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
                if decision.is_none() && !restart {
                    assert_eq!(model["decided"], false);
                } else {
                    assert_eq!(model["decided"], true);
                    if saved_id.is_null() {
                        saved_id = model["savedSkillId"].clone();
                        assert!(model["message"].is_string());
                    } else {
                        assert_eq!(model["savedSkillId"], saved_id);
                        assert!(model["message"].is_null());
                    }
                }
            }
            drop(server);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

async fn project_command(state: &ServerState, request: Request) -> ApiResult {
    let command: inferay_core::project_files::ProjectFileCommand = api_body(request).await?;
    state
        .projects
        .command(command, true)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e.to_string()))
}

async fn project_proposal(state: &ServerState, request: Request) -> ApiResult {
    let proposal: inferay_core::project_files::ProjectProposalRequest = api_body(request).await?;
    state
        .projects
        .proposal(proposal)
        .await
        .and_then(|view| Ok(serde_json::to_value(view)?))
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))
}

async fn project_proposal_review(state: &ServerState, request: Request) -> ApiResult {
    let command: inferay_core::project_files::ProjectFileCommand = api_body(request).await?;
    state
        .projects
        .review_plugin_proposal(command)
        .await
        .and_then(|review| Ok(serde_json::to_value(review)?))
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))
}

#[cfg(test)]
mod saved_title_tests {
    use super::*;

    #[tokio::test]
    async fn workspace_load_repairs_unopened_chat_titles_and_preserves_provider_names() {
        let root = tempfile::tempdir().unwrap();
        let profile = root.path().join("state");
        std::fs::create_dir_all(&profile).unwrap();
        let store = AgentStateStore::new(profile.join("agent-state.json"));
        let workspace = store.initialize("codex").unwrap();
        let id = workspace.selected_pane_id().unwrap();
        store
            .set_pane_summary(
                id,
                Some("Your organization has disabled Claude subscription access".into()),
            )
            .unwrap();
        let persistence = chat_persistence::ChatPersistence::new(profile.clone());
        persistence.read_transcript(id).await;
        let connection = rusqlite::Connection::open(profile.join("chat.sqlite3")).unwrap();
        connection
            .execute(
                "INSERT INTO transcripts(pane,epoch,revision) VALUES(?1,'test','1')",
                [id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transcript_messages(pane,position,body) VALUES(?1,0,?2)",
                rusqlite::params![
                    id,
                    json!({"id":"message", "role":"user", "content":"Fix the repository picker"})
                        .to_string()
                ],
            )
            .unwrap();
        drop(connection);
        let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.path().to_owned());
        config.home_directory = root.path().to_owned();
        config.user_data_dir = profile;
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let url = format!("http://{}/api/agent/state", server.local_addr());
        for title in ["Fix the repository picker", "Provider supplied title"] {
            if title == "Provider supplied title" {
                store.set_pane_summary(id, Some(title.into())).unwrap();
            }
            let response = Client::new()
                .get(&url)
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let value: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
            assert_eq!(value["groups"][0]["panes"][0]["summary"], title);
            assert_eq!(
                store.pane(id).unwrap().unwrap().summary.as_deref(),
                Some(title)
            );
        }
        server.shutdown();
    }
}

#[cfg(test)]
mod client_storage_http_tests {
    use super::*;

    #[tokio::test]
    async fn bootstrap_omits_archives_without_losing_preferences_or_native_records() {
        let root = tempfile::tempdir().unwrap();
        let profile = root.path().join("state");
        std::fs::create_dir_all(&profile).unwrap();
        let mut expected = json!({
            "inferay-vscode-appearance-version": "1",
            "inferay-app-font": "vscode",
            "inferay-chat-input-pane": "Unsaved draft ⡀",
            "inferay-chat-scroll-pane": "{\"following\":false,\"top\":420}",
            "inferay-chat-summary-pane": "Saved title",
            "inferay-chat-model-pane": null,
            "native-workspace-dock:project": "{\"panes\":[]}",
            "inferay-chat-pane": "x".repeat(1_000_000),
            "inferay-checkpoints-pane": "[{\"id\":\"checkpoint\",\"afterMessageId\":\"message\"}]"
        })
        .as_object()
        .unwrap()
        .clone();
        let original = serde_json::to_vec(&expected).unwrap();
        std::fs::write(profile.join("client-storage.json"), &original).unwrap();
        let mut config = ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.path().to_owned());
        config.home_directory = root.path().to_owned();
        config.user_data_dir = profile.clone();
        let auth = config.auth_token.clone();
        let mut server = ServerHandle::start(config).unwrap();
        let url = format!("http://{}/api/client-storage", server.local_addr());
        let client = Client::new();
        let response = client
            .get(&url)
            .header("x-inferay-auth", &auth)
            .header("sec-fetch-site", "same-origin")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert!(
            response.len() < 4096,
            "Legacy transcript entered bootstrap payload"
        );
        for key in ["inferay-chat-pane", "inferay-checkpoints-pane"] {
            let saved = expected.remove(key).unwrap();
            let queried = client
                .get(format!("{url}?key={key}"))
                .header("x-inferay-auth", &auth)
                .header("sec-fetch-site", "same-origin")
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .bytes()
                .await
                .unwrap();
            let queried: Value = serde_json::from_slice(&queried).unwrap();
            assert_eq!(queried["entries"][key], saved);
        }
        assert!(should_sync_client_storage_key("inferay-chat-scroll-pane"));
        let bootstrap: Value = serde_json::from_slice(&response).unwrap();
        assert_eq!(bootstrap["entries"], json!(expected));
        assert_eq!(
            std::fs::read(profile.join("client-storage.json")).unwrap(),
            original
        );
        server.shutdown();
    }
}
