//! Typed, transport-free access to [`ChatRuntime`] for native UI clients.
//!
//! This module deliberately does not own chat sessions. It adapts the JSON
//! event stream currently consumed by the WebSocket client while delegating
//! execution, persistence, reconnect snapshots, queues, and cancellation to
//! `ChatRuntime`.

use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use serde_json::Value;
use tokio::sync::broadcast;

use crate::chat_runtime::{ChatRuntime, ClientId, SendMessageInput};
use crate::checkpoint::CheckpointService;
use inferay_core::path_security::AllowedPaths;

const EVENT_BUFFER_CAPACITY: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeChatRuntimeStopped;

impl std::fmt::Display for NativeChatRuntimeStopped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("native chat runtime stopped")
    }
}

impl std::error::Error for NativeChatRuntimeStopped {}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NativeChatSendRequest {
    pub client_message_id: Option<String>,
    pub pane_id: String,
    pub agent_kind: String,
    pub session_id: Option<String>,
    pub cwd: PathBuf,
    pub cwd_provided: bool,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub reasoning_level_provided: bool,
    pub reference_paths: Vec<PathBuf>,
    pub reference_paths_provided: bool,
    pub display_text: Option<String>,
    pub images: Vec<PathBuf>,
    pub text: String,
    pub include_workspace: bool,
}

#[derive(Clone)]
pub struct NativeChatClient {
    client_id: ClientId,
    sender: broadcast::Sender<Value>,
}

impl NativeChatClient {
    pub(crate) fn send_value(&self, value: Value) {
        let _ = self.sender.send(value);
    }

    pub(crate) fn value_sender(&self) -> broadcast::Sender<Value> {
        self.sender.clone()
    }
}

pub struct NativeChatConnection {
    client: NativeChatClient,
    receiver: broadcast::Receiver<Value>,
}

impl NativeChatConnection {
    pub fn client(&self) -> NativeChatClient {
        self.client.clone()
    }

    pub(crate) async fn recv_value(&mut self) -> Result<Value, broadcast::error::RecvError> {
        self.receiver.recv().await
    }
}

#[derive(Clone)]
pub struct NativeChatService {
    runtime: ChatRuntime,
    owner: tokio::runtime::Handle,
    next_client_id: Arc<AtomicU64>,
    allowed_paths: AllowedPaths,
}

impl NativeChatService {
    pub(crate) fn new(
        runtime: ChatRuntime,
        owner: tokio::runtime::Handle,
        next_client_id: Arc<AtomicU64>,
        allowed_paths: AllowedPaths,
        _checkpoints: CheckpointService,
    ) -> Self {
        Self {
            runtime,
            owner,
            next_client_id,
            allowed_paths,
        }
    }

    pub fn connect(&self) -> NativeChatConnection {
        let client_id = self.next_client_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = broadcast::channel(EVENT_BUFFER_CAPACITY);
        NativeChatConnection {
            client: NativeChatClient { client_id, sender },
            receiver,
        }
    }

    pub async fn reconnect(
        &self,
        client: &NativeChatClient,
        pane_id: &str,
        provider: Option<&str>,
        session_id: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<(), NativeChatRuntimeStopped> {
        let runtime = self.runtime.clone();
        let pane_id = pane_id.to_string();
        let provider = provider.map(str::to_owned);
        let session_id = session_id.map(str::to_owned);
        let cwd = cwd
            .filter(|path| !path.is_empty())
            .and_then(|path| self.allowed_paths.resolve_allowed_local_path(path));
        let client_id = client.client_id;
        let sender = client.sender.clone();
        self.owner
            .spawn(async move {
                runtime
                    .reconnect(
                        &pane_id,
                        client_id,
                        sender,
                        provider.as_deref(),
                        session_id.as_deref(),
                        cwd,
                    )
                    .await
            })
            .await
            .map_err(|_| NativeChatRuntimeStopped)
    }

    /// Starts a turn and returns immediately, matching the WebSocket transport.
    pub fn send(&self, client: &NativeChatClient, mut request: NativeChatSendRequest) {
        request.cwd = self
            .allowed_paths
            .resolve_allowed_local_path(&request.cwd)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| self.allowed_paths.project_root().to_path_buf());
        request.reference_paths = normalize_paths(&self.allowed_paths, request.reference_paths);
        request.images = normalize_paths(&self.allowed_paths, request.images);
        let runtime = self.runtime.clone();
        let input = SendMessageInput {
            client_message_id: request.client_message_id,
            pane_id: request.pane_id,
            agent_kind: request.agent_kind,
            client_session_id: request.session_id,
            cwd: request.cwd,
            cwd_provided: request.cwd_provided,
            model: request.model,
            reasoning_level: request.reasoning_level,
            reasoning_level_provided: request.reasoning_level_provided,
            reference_paths: request.reference_paths,
            reference_paths_provided: request.reference_paths_provided,
            display_text: request.display_text,
            images: request.images,
            text: request.text,
            client_id: Some(client.client_id),
            client_sender: Some(client.sender.clone()),
            include_workspace: request.include_workspace,
        };
        self.owner
            .spawn(async move { runtime.send_message(input).await });
    }

    pub async fn stop(&self, pane_id: &str) -> Result<(), NativeChatRuntimeStopped> {
        let runtime = self.runtime.clone();
        let pane_id = pane_id.to_string();
        self.owner
            .spawn(async move { runtime.stop_generation(&pane_id).await })
            .await
            .map_err(|_| NativeChatRuntimeStopped)
    }

    pub async fn destroy(&self, pane_id: &str) -> Result<(), NativeChatRuntimeStopped> {
        let runtime = self.runtime.clone();
        let pane_id = pane_id.to_string();
        self.owner
            .spawn(async move { runtime.destroy_session(&pane_id).await })
            .await
            .map_err(|_| NativeChatRuntimeStopped)
    }

    /// Explicit because `Drop` cannot await runtime cleanup.
    pub async fn detach(&self, client: NativeChatClient) -> Result<(), NativeChatRuntimeStopped> {
        let runtime = self.runtime.clone();
        let client_id = client.client_id;
        self.owner
            .spawn(async move { runtime.detach_client(client_id).await })
            .await
            .map_err(|_| NativeChatRuntimeStopped)
    }
}

fn normalize_paths(allowed_paths: &AllowedPaths, paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| allowed_paths.resolve_allowed_local_path(path))
        .filter(|path| seen.insert(path.clone()))
        .collect()
}
