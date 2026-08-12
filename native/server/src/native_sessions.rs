use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use inferay_core::agent_state::AgentStateStore;

use crate::chat_persistence::ChatPersistence;
pub use crate::chat_persistence::LocalSessionInfo;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeSessionsSnapshot {
    pub sessions: Vec<LocalSessionInfo>,
}

#[derive(Clone)]
pub struct NativeSessions {
    persistence: ChatPersistence,
    agent_state_path: PathBuf,
}

impl NativeSessions {
    pub fn new(user_data_dir: PathBuf) -> Self {
        let store = Arc::new(Mutex::new(AgentStateStore::new(
            user_data_dir.join("agent-state.json"),
            user_data_dir.join("terminal-state.json"),
        )));
        Self::with_persistence(
            user_data_dir.clone(),
            ChatPersistence::new(user_data_dir),
            store,
        )
    }

    pub(crate) fn with_persistence(
        user_data_dir: PathBuf,
        persistence: ChatPersistence,
        _agent_state_store: Arc<Mutex<AgentStateStore>>,
    ) -> Self {
        Self {
            persistence,
            agent_state_path: user_data_dir.join("agent-state.json"),
        }
    }

    pub fn from_default_location() -> Self {
        Self::new(super::default_user_data_directory())
    }

    pub async fn snapshot(&self) -> NativeSessionsSnapshot {
        let sessions = self
            .persistence
            .list_local_sessions(&self.agent_state_path)
            .await;
        NativeSessionsSnapshot { sessions }
    }
}
