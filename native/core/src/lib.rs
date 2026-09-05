pub mod agent_command;
pub mod agent_context;
pub mod agent_protocol;
pub mod agent_state;
pub mod atomic_write;
pub mod chat_protocol;
pub mod config;
pub mod path_security;
pub mod prompts;

mod tool_presentation;

pub mod provider_config;

/// Count UTF-16 code units used by the chat wire format's text limits.
pub fn utf16_length(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn utf16_slice(value: &str, start: usize, end: usize) -> String {
    let units = value.encode_utf16().collect::<Vec<_>>();
    String::from_utf16_lossy(&units[start.min(units.len())..end.min(units.len())])
}
