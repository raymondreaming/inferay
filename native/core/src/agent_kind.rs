//! Supported native agent providers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentKind {
    Claude,
    Codex,
    Afk,
}

impl AgentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Afk => "afk",
        }
    }
}
