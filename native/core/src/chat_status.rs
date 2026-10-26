//! Shared turn activity transitions. Callers supply the clock; no renderer or
//! runtime owns a second interpretation of pending sends and acknowledged work.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRunStatus {
    pub is_loading: bool,
    pub status: String,
    pub start_time: Option<u64>,
}

impl Default for ChatRunStatus {
    fn default() -> Self {
        Self {
            is_loading: false,
            status: "idle".into(),
            start_time: None,
        }
    }
}

impl ChatRunStatus {
    pub fn begin(&mut self, now: u64) -> bool {
        if self.is_loading {
            return false;
        }
        self.observe("sending".into(), Some(true), now);
        true
    }

    pub fn observe(&mut self, status: String, loading: Option<bool>, now: u64) {
        self.status = status;
        if let Some(loading) = loading {
            self.is_loading = loading;
            if !loading {
                self.start_time = None;
            } else if self.start_time.is_none() {
                self.start_time = Some(now);
            }
        }
    }

    pub fn admit(&mut self, mut incoming: Self, terminal: bool) {
        if self.status == "sending" && incoming.status == "idle" && !terminal {
            return;
        }
        if self.is_loading
            && incoming.is_loading
            && let Some(start) = self.start_time
        {
            incoming.start_time = Some(
                incoming
                    .start_time
                    .map_or(start, |native| native.min(start)),
            );
        }
        *self = incoming;
    }

    pub fn submission_failed(&mut self) {
        if self.status == "sending" {
            *self = Self::default();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pending_send_survives_idle_reconnect_and_keeps_its_start_on_acknowledgement() {
        let mut status = ChatRunStatus::default();
        assert!(status.begin(100));
        assert!(!status.begin(200));
        status.admit(ChatRunStatus::default(), false);
        assert_eq!(status.status, "sending");
        let mut acknowledged = ChatRunStatus::default();
        acknowledged.observe("thinking".into(), Some(true), 300);
        status.admit(acknowledged, false);
        assert_eq!(status.status, "thinking");
        assert_eq!(status.start_time, Some(100));
        status.submission_failed();
        assert!(status.is_loading);
        status.admit(ChatRunStatus::default(), true);
        assert_eq!(status, ChatRunStatus::default());
    }

    #[test]
    fn activity_updates_keep_the_first_clock_and_failures_only_reset_pending_sends() {
        let mut status = ChatRunStatus::default();
        status.observe("thinking".into(), Some(true), 100);
        status.observe("tool:read".into(), None, 200);
        assert_eq!(status.start_time, Some(100));
        assert!(status.is_loading);
        status.observe("error".into(), Some(false), 300);
        assert_eq!(status.start_time, None);
        assert!(!status.is_loading);
        assert!(status.begin(400));
        status.submission_failed();
        assert_eq!(status, ChatRunStatus::default());
    }

    #[test]
    fn status_keeps_the_existing_websocket_shape() {
        let value = json!({"isLoading":true,"status":"tool:custom","startTime":1234});
        let status: ChatRunStatus = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(status).unwrap(), value);
        assert_eq!(
            serde_json::to_value(ChatRunStatus::default()).unwrap(),
            json!({"isLoading":false,"status":"idle","startTime":null})
        );
    }
}
