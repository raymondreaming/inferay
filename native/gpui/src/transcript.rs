//! Own prepared rows and viewport publication together. Workers build immutable
//! rows; UI publication preserves the reader's anchor and retained source identity.
use crate::rich_text::RichText;
use gpui::{FollowMode, ListAlignment, ListOffset, ListState, px};
use inferay_core::chat_protocol::ChatTranscriptMessage;
use std::sync::Arc;

#[derive(Clone)]
pub struct Row {
    pub message: Arc<ChatTranscriptMessage>,
    pub rich: Arc<RichText>,
}

pub struct PreparedTranscript {
    pub start: usize,
    pub theme: String,
    rows: Vec<Row>,
}

impl PreparedTranscript {
    pub fn prepare(
        start: usize,
        messages: impl IntoIterator<Item = Arc<ChatTranscriptMessage>>,
        theme: &str,
    ) -> Self {
        let rows = messages
            .into_iter()
            .map(|message| {
                let rich = Arc::new(RichText::message(&message, theme));
                Row { message, rich }
            })
            .collect();
        Self {
            start,
            theme: theme.into(),
            rows,
        }
    }

    pub fn retheme(mut self, theme: &str) -> Self {
        for row in &mut self.rows {
            row.rich = Arc::new(row.rich.retheme(theme));
        }
        self.theme = theme.into();
        self
    }
}

pub struct Transcript {
    rows: Vec<Row>,
    total: usize,
    last_visible: Option<usize>,
    pub scroll: ListState,
}

impl Transcript {
    pub fn new() -> Self {
        let scroll = ListState::new(0, ListAlignment::Top, px(300.));
        scroll.set_follow_mode(FollowMode::Tail);
        Self {
            rows: vec![],
            total: 0,
            last_visible: None,
            scroll,
        }
    }

    pub fn rows(&self) -> &[Row] {
        &self.rows
    }
    pub fn total(&self) -> usize {
        self.total
    }
    pub fn last_visible(&self) -> Option<usize> {
        self.last_visible
    }

    pub fn snapshot(&self) -> PreparedTranscript {
        PreparedTranscript {
            start: 0,
            theme: String::new(),
            rows: self.rows.clone(),
        }
    }

    pub fn publish(&mut self, prepared: PreparedTranscript, total: Option<usize>) {
        let start = prepared.start;
        assert!(
            start <= self.rows.len(),
            "transcript suffix requires its admitted prefix"
        );
        let follow = self.scroll.is_following_tail();
        let anchor = self.scroll.logical_scroll_top();
        let anchor_message = self.rows.get(anchor.item_ix).map(|row| row.message.clone());
        let previous_last = self.last_visible;
        self.scroll
            .splice(start..self.rows.len(), prepared.rows.len());
        self.rows.truncate(start);
        self.rows.extend(prepared.rows);
        self.total = total.unwrap_or(self.rows.len());
        self.last_visible = self.rows.iter().rposition(|row| {
            !row.message
                .render
                .as_ref()
                .is_some_and(|render| render.hidden)
        });
        if previous_last != self.last_visible
            && let Some(previous) = previous_last.filter(|&i| i < start)
        {
            self.scroll.remeasure_items(previous..previous + 1);
        }
        if follow {
            self.scroll.scroll_to_end();
        } else if let Some(message) = anchor_message
            && let Some(item_ix) = self
                .rows
                .iter()
                .position(|row| row.message.id == message.id)
        {
            self.scroll.scroll_to(ListOffset { item_ix, ..anchor });
        }
    }

    /// A theme job may finish after a streaming patch. Recolor only the exact
    /// retained sources it prepared; newer rows already use the requested theme.
    pub fn publish_theme(&mut self, prepared: PreparedTranscript) {
        for (current, recolored) in self.rows.iter_mut().zip(prepared.rows) {
            if Arc::ptr_eq(&current.message, &recolored.message) {
                *current = recolored;
            }
        }
        self.scroll.remeasure();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(id: &str, content: &str) -> Arc<ChatTranscriptMessage> {
        Arc::new(
            serde_json::from_value(json!({"id":id,"role":"assistant","content":content})).unwrap(),
        )
    }

    #[test]
    fn publication_retains_prefix_identity_and_rejects_stale_theme_sources() {
        let first = message("first", "retained");
        let second = message("second", "old");
        let mut transcript = Transcript::new();
        transcript.publish(
            PreparedTranscript::prepare(0, [first.clone(), second], "vscode-black"),
            Some(500),
        );
        assert_eq!(transcript.total(), 500);
        let prefix = transcript.rows()[0].rich.clone();
        let stale_theme = transcript.snapshot().retheme("slack");
        let updated = message("second", "new content");
        transcript.publish(
            PreparedTranscript::prepare(1, [updated.clone()], "slack"),
            None,
        );
        let current = transcript.rows()[1].rich.clone();
        assert!(Arc::ptr_eq(&prefix, &transcript.rows()[0].rich));
        transcript.publish_theme(stale_theme);
        assert!(Arc::ptr_eq(&first, &transcript.rows()[0].message));
        assert!(!Arc::ptr_eq(&prefix, &transcript.rows()[0].rich));
        assert!(Arc::ptr_eq(&updated, &transcript.rows()[1].message));
        assert!(Arc::ptr_eq(&current, &transcript.rows()[1].rich));
        assert_eq!(transcript.rows()[1].message.content, "new content");
        assert_eq!(transcript.total(), 2);
        assert_eq!(transcript.scroll.item_count(), 2);
    }

    #[test]
    fn hidden_tail_and_clear_keep_viewport_count_and_last_visible_coherent() {
        let mut hidden = (*message("hidden", "internal")).clone();
        let mut render = inferay_core::chat_protocol::NativeChatRender::default();
        render.hidden = true;
        hidden.render = Some(render);
        let mut transcript = Transcript::new();
        transcript.publish(
            PreparedTranscript::prepare(
                0,
                [message("visible", "visible"), Arc::new(hidden)],
                "vscode-black",
            ),
            None,
        );
        assert_eq!(transcript.last_visible(), Some(0));
        transcript.publish(PreparedTranscript::prepare(0, [], "vscode-black"), None);
        assert!(transcript.rows().is_empty());
        assert_eq!(transcript.last_visible(), None);
        assert_eq!(transcript.scroll.item_count(), 0);
        transcript.publish(
            PreparedTranscript::prepare(0, [message("new", "after clear")], "vscode-black"),
            None,
        );
        assert_eq!(transcript.last_visible(), Some(0));
        assert_eq!(transcript.scroll.item_count(), 1);
    }
}
