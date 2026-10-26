//! Row grouping and viewport selection operate on descriptors and measurements,
//! never on transcript text. The renderer retains its existing message objects.
use serde::{Deserialize, Serialize};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RowDescriptor<'a> {
    kind: Option<&'a str>,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    group_leader: bool,
    group_end: Option<usize>,
    file_path: Option<&'a str>,
    #[serde(default)]
    continues_after: bool,
}

#[derive(Debug, PartialEq, Serialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ChatRow {
    Message {
        index: usize,
    },
    EditGroup {
        start: usize,
        end: usize,
        #[serde(rename = "filePath")]
        file_path: String,
    },
    ToolGroup {
        index: usize,
        #[serde(rename = "continuesAfter")]
        continues_after: bool,
    },
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatListRow {
    #[serde(flatten)]
    pub row: ChatRow,
    pub key: String,
    pub checkpoint: Option<usize>,
}

pub fn list(input: &serde_json::Value) -> Result<Vec<ChatListRow>, String> {
    use crate::{array, flag, string};
    let messages = array(&input["messages"]);
    let checkpoints: std::collections::HashMap<_, _> = array(&input["checkpoints"])
        .iter()
        .enumerate()
        .filter_map(|(index, checkpoint)| {
            checkpoint["afterMessageId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(|id| (id, index))
        })
        .collect();
    let mut result = Vec::with_capacity(messages.len());
    for (index, message) in messages.iter().enumerate() {
        let render = Option::<RowDescriptor>::deserialize(&message["render"])
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        if render.hidden || (render.kind == Some("edit-group") && !render.group_leader) {
            continue;
        }
        let end = render.group_end.unwrap_or(index + 1).min(messages.len());
        let row = match render.kind {
            Some("edit-group")
                if end > index + 1 && render.file_path.is_some_and(|path| !path.is_empty()) =>
            {
                ChatRow::EditGroup {
                    start: index,
                    end,
                    file_path: render.file_path.unwrap().into(),
                }
            }
            Some("tool-group") => ChatRow::ToolGroup {
                index,
                continues_after: render.continues_after,
            },
            _ => ChatRow::Message { index },
        };
        let key = message["render"]["rowId"]
            .as_str()
            .or_else(|| message["id"].as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("row-{}", result.len()));
        let checkpoint = if matches!(row, ChatRow::Message { .. })
            && message["role"] == "assistant"
            && !flag(&message["isStreaming"])
        {
            checkpoints.get(string(&message["id"])).copied()
        } else {
            None
        };
        result.push(ChatListRow {
            row,
            key,
            checkpoint,
        });
    }
    Ok(result)
}

/// Own offsets and window hysteresis in Rust. Scroll events carry only the
/// current position and viewport height, not a serialized copy of the history.

#[derive(Default)]
pub struct ChatViewport {
    offsets: Vec<f64>,
    retained_window: Option<ChatWindow>,
}

impl ChatViewport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn measure(&mut self, heights: &[f64]) {
        self.offsets.clear();
        self.offsets.reserve(heights.len() + 1);
        self.offsets.push(0.);
        for height in heights {
            let height = if height.is_finite() && *height > 0. {
                *height
            } else {
                160.
            };
            self.offsets.push(self.offsets.last().unwrap() + height);
        }
        if self.offsets.capacity() > self.offsets.len().saturating_mul(4) {
            self.offsets.shrink_to_fit();
        }
    }

    /// Apply index/height pairs and return the scroll correction above the anchor.
    /// Tail streaming updates touch only the tail, without rebuilding the history.
    pub fn update_measurements(&mut self, measurements: &[f64], anchor: usize) -> Option<f64> {
        let count = self.offsets.len().saturating_sub(1);
        let mut changes = std::collections::BTreeMap::new();
        for pair in measurements.chunks_exact(2) {
            let (index, height) = (pair[0], pair[1]);
            if index.is_finite()
                && index >= 0.
                && index.fract() == 0.
                && index < count as f64
                && height.is_finite()
                && height > 0.
            {
                changes.insert(index as usize, height);
            }
        }
        changes.retain(|index, height| {
            *height -= self.offsets[index + 1] - self.offsets[*index];
            height.abs() >= 0.5
        });
        let start = *changes.first_key_value()?.0 + 1;
        let adjustment = changes.range(..anchor).map(|(_, delta)| delta).sum();
        let mut changes = changes.into_iter().peekable();
        let mut delta = 0.;
        for (index, offset) in self.offsets.iter_mut().enumerate().skip(start) {
            if changes.peek().is_some_and(|(row, _)| *row + 1 == index) {
                delta += changes.next().unwrap().1;
            }
            *offset += delta;
        }
        Some(adjustment)
    }

    pub fn offset(&self, index: usize) -> f64 {
        self.offsets.get(index).copied().unwrap_or(0.)
    }

    pub fn window(&mut self, scroll: Option<f64>, height: f64) -> String {
        let next = self.select(scroll, height);
        let result = crate::json_wire::stringify(&next, "chat viewport");
        self.retained_window = Some(next);
        result
    }

    pub fn first_visible(&self, scroll: Option<f64>, height: f64) -> usize {
        self.select(scroll, height).first_visible
    }
}

#[derive(Debug, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatWindow {
    first_visible: usize,
    start: usize,
    end: usize,
}

impl ChatViewport {
    fn select(&self, scroll_offset: Option<f64>, viewport_height: f64) -> ChatWindow {
        let count = self.offsets.len().saturating_sub(1);
        if count <= 60 {
            return ChatWindow {
                first_visible: 0,
                start: 0,
                end: count,
            };
        }
        let height = if viewport_height > 0. {
            viewport_height
        } else {
            800.
        };
        // Following uses the tail's measured offsets. Keep the mounted window
        // independent of programmatic DOM scroll events while heights settle.
        let scroll = scroll_offset.unwrap_or_else(|| (self.offsets[count] - height).max(0.));
        let first_visible = self.offsets[1..]
            .partition_point(|offset| *offset <= scroll)
            .min(count - 1);
        // Keep mounted rows stable while the viewport has room on both sides.
        // Rebuilding the slice at every row boundary needlessly remounts rich
        // content and introduces asynchronous height changes during scrolling.
        if let Some(previous) = &self.retained_window
            && scroll_offset.is_some()
            && previous.start < previous.end
            && previous.end <= count
            && (previous.start == 0 || previous.start + 4 <= first_visible)
            && (previous.end == count
                || self.offsets[previous.end.saturating_sub(4)] >= scroll + height)
        {
            return ChatWindow {
                first_visible,
                start: previous.start,
                end: previous.end,
            };
        }
        let start = first_visible.saturating_sub(8);
        let bottom = scroll + height;
        let low = first_visible
            + self.offsets[first_visible..count].partition_point(|offset| *offset < bottom);
        ChatWindow {
            first_visible,
            start,
            end: count.min((start + 48).max(low + 8)),
        }
    }
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatScrollSnapshot {
    following: bool,
    top: f64,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatScrollState {
    snapshot: ChatScrollSnapshot,
    cancel_restore: bool,
}

/// Browser events supply intent and measurements; growth alone must not stop following.
pub fn scroll_state(input: &serde_json::Value) -> serde_json::Value {
    use crate::{flag, number, string};
    use serde_json::json;
    let mut state = input["state"].clone();
    state["cancelRestore"] = json!(false);
    match string(&input["action"]) {
        "follow" => state["snapshot"]["following"] = json!(true),
        "intent" => {
            let delta = match string(&input["key"]) {
                "ArrowUp" | "PageUp" | "Home" => -1.,
                " " if flag(&input["shift"]) => -1.,
                "ArrowDown" | "PageDown" | "End" | " " => 1.,
                _ => number(&input["delta"]),
            };
            if delta < 0. {
                state["snapshot"]["following"] = json!(false);
            }
            state["cancelRestore"] = json!(delta != 0.);
        }
        "scroll" if number(&input["viewport"]) > 0. => {
            let top = number(&input["top"]).max(0.);
            if flag(&input["pointer"]) && top < number(&state["snapshot"]["top"]) - 1. {
                state["snapshot"]["following"] = json!(false);
                state["cancelRestore"] = json!(true);
            }
            state["snapshot"]["top"] = json!(top);
        }
        _ => {}
    }
    state
}

pub fn restore_scroll(input: &serde_json::Value) -> f64 {
    use crate::{flag, number};
    let max = (number(&input["height"]) - number(&input["viewport"])).max(0.);
    if flag(&input["snapshot"]["following"]) {
        max
    } else {
        number(&input["snapshot"]["top"]).min(max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn following_changes_only_with_explicit_user_intent() {
        let mut state = json!({"snapshot":{"following":true,"top":100},"cancelRestore":false});
        let scroll = |state: &serde_json::Value, top, pointer, viewport| {
            scroll_state(
                &json!({"state":state,"action":"scroll","top":top,"pointer":pointer,"viewport":viewport}),
            )
        };
        // Layout shrink and delayed programmatic scrolls cannot turn follow off.
        state = scroll(&state, 0, false, 100);
        assert_eq!(state["snapshot"]["following"], true);
        state = scroll_state(&json!({"state":state,"action":"intent","delta":-20}));
        assert_eq!(state["snapshot"]["following"], false);
        assert_eq!(state["cancelRestore"], true);
        state = scroll(&state, 40, false, 100);
        // Hidden elements cannot replace a saved position with zero.
        state = scroll(&state, 0, false, 0);
        assert_eq!(state["snapshot"]["top"], 40.);
        assert_eq!(
            restore_scroll(&json!({"snapshot":state["snapshot"],"height":1000,"viewport":100})),
            40.
        );
        for key in ["ArrowDown", "PageDown", "End", " "] {
            state = scroll_state(&json!({"state":state,"action":"intent","key":key}));
            state = scroll(&state, 900, false, 100);
            assert_eq!(state["snapshot"]["following"], false);
        }
        state = scroll_state(&json!({"state":state,"action":"follow"}));
        assert_eq!(state["snapshot"]["following"], true);
        assert_eq!(
            restore_scroll(&json!({"snapshot":state["snapshot"],"height":2000,"viewport":100})),
            1900.
        );
        // Dragging a scrollbar upward is user intent too.
        state = scroll(&state, 500, true, 100);
        assert_eq!(state["snapshot"]["following"], false);
        assert_eq!(state["cancelRestore"], true);
    }

    #[test]
    fn incremental_measurements_preserve_anchor_and_match_full_layout() {
        let mut heights = vec![160.; 200];
        let mut viewport = ChatViewport::new();
        viewport.measure(&heights);
        // Unordered updates, repeated indices and invalid measurements.
        assert_eq!(
            viewport.update_measurements(
                &[
                    190.,
                    500.,
                    2.,
                    100.,
                    2.,
                    120.,
                    0.,
                    200.,
                    3.,
                    f64::NAN,
                    -1.,
                    300.,
                    4.5,
                    200.,
                    200.,
                    20.,
                    8.,
                    0.,
                ],
                10
            ),
            Some(0.)
        );
        heights[0] = 200.;
        heights[2] = 120.;
        heights[190] = 500.;
        let mut expected = ChatViewport::new();
        expected.measure(&heights);
        assert_eq!(viewport.offsets, expected.offsets);
        assert_eq!(
            viewport.update_measurements(&[2., 120.4, 199., 160.], 10),
            None
        );
        assert_eq!(
            viewport.update_measurements(&[2., 90., 199., 200.], 10),
            Some(-30.)
        );
        heights[2] = 90.;
        heights[199] = 200.;
        expected.measure(&heights);
        assert_eq!(viewport.offsets, expected.offsets);
        for scroll in [None, Some(0.), Some(1000.), Some(25000.)] {
            assert_eq!(viewport.select(scroll, 700.), expected.select(scroll, 700.));
        }
        viewport.measure(&heights[..2]);
        assert_eq!(viewport.update_measurements(&[190., 300.], 0), None);
        viewport.measure(&[]);
        assert_eq!(viewport.update_measurements(&[0., 300.], 0), None);
    }

    #[test]
    fn retained_window_covers_mixed_height_history_in_both_directions() {
        let heights: Vec<_> = (0..200)
            .map(|index| if index % 7 == 0 { 900. } else { 32. })
            .collect();
        let mut viewport = ChatViewport::new();
        viewport.measure(&heights);
        for step in (0..100).chain((0..100).rev()) {
            let scroll = step as f64 * 250.;
            let next: ChatWindow =
                serde_json::from_str(&viewport.window(Some(scroll), 700.)).unwrap();
            assert!(viewport.offsets[next.start] <= scroll);
            assert!(viewport.offsets[next.end] >= scroll + 700.);
        }
        // Deleting history invalidates an old retained range.
        viewport.measure(&heights[..80]);
        assert!(viewport.select(Some(0.), 700.).end <= 80);
        viewport.measure(&[]);
        assert_eq!(
            viewport.select(None, 700.),
            ChatWindow {
                first_visible: 0,
                start: 0,
                end: 0
            }
        );
        assert_eq!(viewport.offset(0), 0.);
    }
}
