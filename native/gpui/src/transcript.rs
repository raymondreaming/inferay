//! Own prepared rows and viewport publication together. Workers build immutable
//! rows; UI publication preserves the reader's anchor and retained source identity.
use crate::rich_text::RichText;
use gpui::{FollowMode, ListAlignment, ListOffset, ListState, px};
use inferay_core::chat_protocol::ChatTranscriptMessage;
use std::{collections::HashMap, sync::Arc};

#[derive(Clone)]
pub struct Row {
    pub message: Arc<ChatTranscriptMessage>,
    pub rich: Arc<RichText>,
    pub progress: Option<Progress>,
}

impl Row {
    fn ends_response(&self) -> bool {
        self.message.role == "user"
            || (self.message.id.starts_with("hook:")
                && self
                    .message
                    .tool_name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case("stop hook")))
    }

    fn has_card(&self) -> bool {
        self.message.render.as_ref().is_some_and(|render| {
            render.questions.is_some()
                || render.elicitation.is_some()
                || render.skill_proposal.is_some()
                || render.automation_proposal.is_some()
                || render.automation_definition_proposal.is_some()
                || render.plugin_proposal.is_some()
                || render.command.is_some()
                || render.goal.is_some()
                || render.skill_read.is_some()
        })
    }

    pub fn hidden(&self) -> bool {
        self.message
            .render
            .as_ref()
            .is_some_and(|render| render.hidden)
            || (self.message.role == "assistant"
                && self.message.content.trim().is_empty()
                && self.message.images.as_ref().is_none_or(Vec::is_empty))
    }
}

#[derive(Clone)]
pub struct Progress {
    pub title: String,
    pub body: Option<Arc<RichText>>,
}

pub struct Step {
    pub start: usize,
    pub end: usize,
    pub tools: usize,
}

pub struct Activity {
    pub start: usize,
    pub end: usize,
    pub steps: usize,
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
                // Provider summary IDs survive saved history and reconnects. Ordinary
                // Markdown headings and system/approval cards are not activity steps.
                let progress = (message.role == "system"
                    && message.id.starts_with("codex-summary:"))
                .then(|| {
                    let text = message.content.trim();
                    let (title, body) = text.split_once('\n').unwrap_or((text, ""));
                    Progress {
                        title: title.trim().trim_matches(['#', '*', '_', ' ']).to_owned(),
                        body: (!body.trim().is_empty())
                            .then(|| Arc::new(RichText::prepare(body.trim(), theme))),
                    }
                });
                Row {
                    message,
                    rich,
                    progress,
                }
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
            if let Some(body) = row
                .progress
                .as_mut()
                .and_then(|progress| progress.body.as_mut())
            {
                *body = Arc::new(body.retheme(theme));
            }
        }
        self.theme = theme.into();
        self
    }
}

pub struct Transcript {
    rows: Vec<Row>,
    total: usize,
    last_visible: Option<usize>,
    steps: Vec<Step>,
    owners: Vec<Option<usize>>,
    connections: Vec<(bool, bool)>,
    step_overrides: HashMap<String, bool>,
    activities: Vec<Activity>,
    activity_owners: Vec<Option<usize>>,
    current_activity: Option<usize>,
    // Overrides apply only in the phase (running or finished) where chosen.
    activity_overrides: HashMap<String, (bool, bool)>,
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
            steps: vec![],
            owners: vec![],
            connections: vec![],
            step_overrides: HashMap::new(),
            activities: vec![],
            activity_owners: vec![],
            current_activity: None,
            activity_overrides: HashMap::new(),
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

    pub fn step(&self, row: usize) -> Option<&Step> {
        self.owners
            .get(row)
            .copied()
            .flatten()
            .map(|owner| &self.steps[owner])
    }

    /// Incoming and outgoing segments join visible neighbors at the same depth.
    pub fn connections(&self, row: usize) -> (bool, bool) {
        self.connections[row]
    }

    pub fn step_active(&self, step: &Step, running: bool) -> bool {
        running && step.end == self.rows.len()
    }

    pub fn step_open(&self, step: &Step, running: bool) -> bool {
        self.step_overrides
            .get(&self.rows[step.start].message.id)
            .copied()
            .unwrap_or_else(|| self.step_active(step, running))
    }

    pub fn toggle_step(&mut self, row: usize, running: bool) {
        let Some(step) = self.step(row) else { return };
        let open = self.step_open(step, running);
        let range = step.start..step.end;
        let id = self.rows[step.start].message.id.clone();
        self.step_overrides.insert(id, !open);
        self.scroll.remeasure_items(range);
    }

    pub fn activity(&self, row: usize) -> Option<&Activity> {
        self.activity_owners
            .get(row)
            .copied()
            .flatten()
            .map(|owner| &self.activities[owner])
    }

    pub fn activity_active(&self, activity: &Activity, running: bool) -> bool {
        running
            && self
                .current_activity
                .is_some_and(|owner| self.activities[owner].start == activity.start)
    }

    pub fn activity_open(&self, activity: &Activity, running: bool) -> bool {
        let active = self.activity_active(activity, running);
        self.activity_overrides
            .get(&self.rows[activity.start].message.id)
            .filter(|(phase, _)| *phase == active)
            .map_or(active, |(_, open)| *open)
    }

    pub fn toggle_activity(&mut self, row: usize, running: bool) {
        let Some(activity) = self.activity(row) else {
            return;
        };
        let active = self.activity_active(activity, running);
        let open = self.activity_open(activity, running);
        let range = activity.start..activity.end;
        let id = self.rows[activity.start].message.id.clone();
        self.activity_overrides.insert(id, (active, !open));
        self.scroll.remeasure_items(range);
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
        let remeasure_start = self
            .activity(start)
            .or_else(|| self.activities.last())
            .map_or(start, |activity| activity.start.min(start));
        let remeasure_start = self
            .step(start)
            .or_else(|| self.steps.last())
            .map_or(remeasure_start, |step| step.start.min(remeasure_start));
        self.scroll
            .splice(start..self.rows.len(), prepared.rows.len());
        self.rows.truncate(start);
        self.rows.extend(prepared.rows);
        self.total = total.unwrap_or(self.rows.len());
        self.steps.clear();
        self.owners.clear();
        let mut owner: Option<usize> = None;
        for (index, row) in self.rows.iter().enumerate() {
            let hidden = row.hidden();
            if row.ends_response() {
                owner = None;
            } else if row.progress.is_some() && !hidden {
                owner = Some(self.steps.len());
                self.steps.push(Step {
                    start: index,
                    end: index + 1,
                    tools: 0,
                });
            } else if (row.message.role != "tool" || row.has_card()) && !hidden {
                owner = None;
            }
            if let Some(owner) = owner {
                self.steps[owner].end = index + 1;
                if row.message.role == "tool" && !hidden {
                    self.steps[owner].tools += 1;
                }
            }
            self.owners.push(owner);
        }
        self.connections = vec![(false, false); self.rows.len()];
        let mut previous_root: Option<usize> = None;
        let mut previous_child: Option<usize> = None;
        for (index, row) in self.rows.iter().enumerate() {
            if row.hidden() {
                // A stop hook is a real turn boundary, even though it has no UI.
                if row.ends_response() {
                    previous_root = None;
                    previous_child = None;
                }
                continue;
            }
            if row.has_card() {
                previous_root = None;
                previous_child = None;
                continue;
            }
            let previous = if row.progress.is_some() {
                previous_child = None;
                &mut previous_root
            } else if row.message.role == "tool" {
                if self.owners[index].is_some() {
                    &mut previous_child
                } else {
                    &mut previous_root
                }
            } else {
                previous_root = None;
                previous_child = None;
                continue;
            };
            if let Some(prior) = *previous {
                self.connections[prior].1 = true;
                self.connections[index].0 = true;
            }
            *previous = Some(index);
        }
        // A response has one activity envelope. Its final assistant text is
        // outside the envelope; earlier commentary joins it only when more
        // work follows. User messages and provider stop hooks end the response.
        self.activities.clear();
        self.activity_owners = vec![None; self.rows.len()];
        self.current_activity = None;
        for (index, row) in self.rows.iter().enumerate() {
            if row.ends_response() {
                self.current_activity = None;
            } else if !row.hidden()
                && (row.progress.is_some() || row.message.role == "tool")
                && !row.has_card()
            {
                let owner = *self.current_activity.get_or_insert_with(|| {
                    self.activities.push(Activity {
                        start: index,
                        end: index + 1,
                        steps: 0,
                    });
                    self.activities.len() - 1
                });
                self.activities[owner].end = index + 1;
                if self.owners[index].is_none_or(|owner| self.steps[owner].start == index) {
                    self.activities[owner].steps += 1;
                }
            }
        }
        for (owner, activity) in self.activities.iter().enumerate() {
            for index in activity.start..activity.end {
                let row = &self.rows[index];
                // Interactive cards and side questions stay outside any fold.
                if (row.progress.is_some()
                    || matches!(row.message.role.as_str(), "assistant" | "tool"))
                    && !row.has_card()
                {
                    self.activity_owners[index] = Some(owner);
                }
            }
        }
        self.activity_overrides.retain(|id, _| {
            self.activities
                .iter()
                .any(|activity| self.rows[activity.start].message.id == *id)
        });
        self.step_overrides.retain(|id, _| {
            self.steps
                .iter()
                .any(|step| self.rows[step.start].message.id == *id)
        });
        // A new step changes the previous step's automatic expansion, even
        // when its source message was not part of the incoming suffix.
        self.scroll
            .remeasure_items(remeasure_start..self.rows.len());
        self.last_visible = self.rows.iter().rposition(|row| !row.hidden());
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
    fn response_activity_groups_commentary_but_keeps_results_and_cards_visible() {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.replace_messages([
            json!({"id":"user","role":"user","content":"Do the work"}),
            json!({"id":"intro","role":"assistant","content":"I will inspect it."}),
            json!({"id":"codex-summary:first","role":"system","content":"Inspecting"}),
            json!({"id":"read","role":"tool","toolName":"Read","content":"source"}),
            json!({"id":"note","role":"assistant","content":"Found the cause."}),
            json!({"id":"card","role":"system","content":"Important notice"}),
            json!({"id":"codex-summary:second","role":"system","content":"Testing"}),
            json!({"id":"test","role":"tool","toolName":"exec_command","content":"tests passed"}),
            json!({"id":"answer","role":"assistant","content":"Fixed."}),
            json!({"id":"hook:stop","role":"tool","toolName":"stop hook","content":"{}"}),
            json!({"id":"next-user","role":"user","content":"Another task"}),
            json!({"id":"next-tool","role":"tool","toolName":"Read","content":"another file"}),
            json!({"id":"next-answer","role":"assistant","content":"Here is the result."}),
        ].into_iter().map(|value| serde_json::from_value(value).unwrap()).collect());
        let mut transcript = Transcript::new();
        transcript.publish(
            PreparedTranscript::prepare(
                0,
                buffer.messages().iter().cloned().map(Arc::new),
                "vscode-black",
            ),
            None,
        );
        assert_eq!(transcript.activities.len(), 2);
        let first = transcript.activity(2).unwrap();
        assert_eq!((first.start, first.end, first.steps), (2, 8, 2));
        assert_eq!(transcript.activity(4).unwrap().start, 2);
        for row in [0, 1, 5, 8, 9, 10, 12] {
            assert!(transcript.activity(row).is_none());
        }
        assert!(!transcript.activity_open(first, true));
        assert!(transcript.activity_open(transcript.activity(11).unwrap(), true));
        transcript.toggle_activity(11, true);
        assert!(!transcript.activity_open(transcript.activity(11).unwrap(), true));
        transcript.toggle_activity(11, true);
        assert!(transcript.activity_open(transcript.activity(11).unwrap(), true));
        // Ending the response folds even an explicitly reopened running group.
        assert!(!transcript.activity_open(transcript.activity(11).unwrap(), false));
        transcript.toggle_activity(2, false);
        let snapshot = transcript.snapshot();
        transcript.publish(snapshot, None);
        assert!(transcript.activity_open(transcript.activity(2).unwrap(), true));
        assert_eq!(transcript.activity(11).unwrap().steps, 1);
        assert!(transcript.step(11).is_none());
    }

    #[test]
    fn questions_stay_outside_both_activity_and_step_disclosures() {
        let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
        buffer.apply_event(&json!({"type":"inferay.progress","id":"codex-summary:work","text":"Choosing a direction"}));
        buffer.apply_event(&json!({"type":"inferay.tool","id":"question","name":"AskUserQuestion","input":{"questions":[{"question":"Which direction?","header":"Direction","options":[{"label":"A","description":"First"},{"label":"B","description":"Second"}],"multiSelect":false}]},"done":true}));
        buffer.apply_event(&json!({"type":"inferay.tool","id":"read","name":"Read","input":{"file_path":"main.rs"},"done":true}));
        assert!(
            buffer.messages()[1]
                .render
                .as_ref()
                .unwrap()
                .questions
                .is_some()
        );
        let mut transcript = Transcript::new();
        transcript.publish(
            PreparedTranscript::prepare(
                0,
                buffer.messages().iter().cloned().map(Arc::new),
                "vscode-black",
            ),
            None,
        );
        assert!(transcript.activity(1).is_none());
        assert!(transcript.step(1).is_none());
        assert!(!transcript.activity_open(transcript.activity(0).unwrap(), false));
    }

    #[test]
    fn steps_follow_activity_preserve_manual_choices_and_stop_at_answers() {
        let progress = |id: &str, text: &str| {
            Arc::new(
                serde_json::from_value(json!({
                    "id": format!("codex-summary:{id}"), "role": "system", "content": text,
                }))
                .unwrap(),
            )
        };
        let tool = |id: &str| {
            Arc::new(
                serde_json::from_value(json!({
                    "id": id, "role": "tool", "content": "output",
                }))
                .unwrap(),
            )
        };
        let mut transcript = Transcript::new();
        transcript.publish(
            PreparedTranscript::prepare(
                0,
                [
                    progress("one", "**Inspecting fields**\n\nDetails"),
                    tool("read"),
                ],
                "vscode-black",
            ),
            None,
        );
        assert_eq!(
            transcript.rows()[0].progress.as_ref().unwrap().title,
            "Inspecting fields"
        );
        assert!(
            transcript.rows()[0]
                .progress
                .as_ref()
                .unwrap()
                .body
                .is_some()
        );
        assert!(transcript.step_open(transcript.step(0).unwrap(), true));
        assert_eq!(transcript.step(1).unwrap().start, 0);
        transcript.publish(
            PreparedTranscript::prepare(
                2,
                [progress("two", "Testing validation"), tool("test")],
                "vscode-black",
            ),
            None,
        );
        assert!(!transcript.step_open(transcript.step(0).unwrap(), true));
        assert!(transcript.step_open(transcript.step(2).unwrap(), true));
        assert!(transcript.connections(0).1);
        assert!(transcript.connections(2).0);
        transcript.toggle_step(0, true);
        let restored = transcript.snapshot();
        transcript.publish(restored, None);
        assert!(transcript.step_open(transcript.step(0).unwrap(), true));
        transcript.toggle_step(2, true);
        transcript.publish(
            PreparedTranscript::prepare(4, [tool("more")], "vscode-black"),
            None,
        );
        assert!(!transcript.step_open(transcript.step(2).unwrap(), true));
        assert_eq!(transcript.step(2).unwrap().tools, 2);
        transcript.publish(
            PreparedTranscript::prepare(
                5,
                [message("answer", "## Final answer\nTests passed")],
                "vscode-black",
            ),
            None,
        );
        assert!(transcript.step(5).is_none());
        assert!(!transcript.step_active(transcript.step(2).unwrap(), true));
        assert!(transcript.step_open(transcript.step(0).unwrap(), false));
        assert!(!transcript.step_open(transcript.step(2).unwrap(), false));
        transcript.publish(
            PreparedTranscript::prepare(6, [progress("three", "Next turn")], "vscode-black"),
            None,
        );
        assert!(!transcript.connections(6).0);
        assert!(!transcript.step_open(transcript.step(6).unwrap(), false));
        assert!(transcript.step_open(transcript.step(6).unwrap(), true));
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
