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

pub fn offsets(heights: &[Option<f64>]) -> Vec<f64> {
    let mut result = Vec::with_capacity(heights.len() + 1);
    result.push(0.);
    for height in heights {
        result.push(result.last().unwrap() + height.unwrap_or(160.));
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatViewport {
    offsets: Vec<f64>,
    scroll_offset: Option<f64>,
    viewport_height: f64,
    #[serde(default)]
    retained_window: Option<ChatWindow>,
}

#[derive(Debug, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatWindow {
    first_visible: usize,
    start: usize,
    end: usize,
}

pub fn window(input: &ChatViewport) -> ChatWindow {
    let count = input.offsets.len().saturating_sub(1);
    if count <= 60 {
        return ChatWindow {
            first_visible: 0,
            start: 0,
            end: count,
        };
    }
    let height = if input.viewport_height > 0. {
        input.viewport_height
    } else {
        800.
    };
    // Following uses the tail's measured offsets. Keep the mounted window
    // independent of programmatic DOM scroll events while heights settle.
    let scroll = input
        .scroll_offset
        .unwrap_or_else(|| (input.offsets[count] - height).max(0.));
    let first_visible = input.offsets[1..]
        .partition_point(|offset| *offset <= scroll)
        .min(count - 1);
    // Keep mounted rows stable while the viewport has room on both sides.
    // Rebuilding the slice at every row boundary needlessly remounts rich
    // content and introduces asynchronous height changes during scrolling.
    if let Some(previous) = &input.retained_window
        && input.scroll_offset.is_some()
        && previous.start < previous.end
        && previous.end <= count
        && (previous.start == 0 || previous.start + 4 <= first_visible)
        && (previous.end == count
            || input.offsets[previous.end.saturating_sub(4)] >= scroll + height)
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
        + input.offsets[first_visible..count].partition_point(|offset| *offset < bottom);
    ChatWindow {
        first_visible,
        start,
        end: count.min((start + 48).max(low + 8)),
    }
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatScrollSnapshot {
    at_bottom: bool,
    from_bottom: f64,
    top: f64,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatScrollState {
    snapshot: ChatScrollSnapshot,
    toward_bottom: bool,
    cancel_restore: bool,
}

/// Browser events supply intent and measurements; growth alone must not stop following.
pub fn scroll_state(input: &serde_json::Value) -> serde_json::Value {
    use crate::{flag, number, string};
    use serde_json::json;
    let mut state = input["state"].clone();
    state["cancelRestore"] = json!(false);
    match string(&input["action"]) {
        "follow" => state["snapshot"]["atBottom"] = json!(input["value"] != false),
        "intent" => {
            let delta = match string(&input["key"]) {
                "ArrowUp" | "PageUp" | "Home" => -1.,
                " " if flag(&input["shift"]) => -1.,
                "ArrowDown" | "PageDown" | "End" | " " => 1.,
                _ => number(&input["delta"]),
            };
            if delta < 0. {
                state["towardBottom"] = json!(false);
                state["snapshot"]["atBottom"] = json!(false);
                state["cancelRestore"] = json!(true);
            } else if delta > 0. {
                state["towardBottom"] = json!(true);
            }
        }
        action @ ("scroll" | "capture") if number(&input["viewport"]) > 0. => {
            let top = number(&input["top"]);
            let from_bottom = (number(&input["height"]) - top - number(&input["viewport"])).max(0.);
            if action == "scroll" {
                if from_bottom <= 1. && flag(&state["towardBottom"]) {
                    state["snapshot"]["atBottom"] = json!(true);
                } else if top - number(&state["snapshot"]["top"]) < -1. {
                    state["snapshot"]["atBottom"] = json!(false);
                }
            }
            state["snapshot"]["fromBottom"] = json!(from_bottom);
            state["snapshot"]["top"] = json!(top);
        }
        _ => {}
    }
    state
}

pub fn restore_scroll(input: &serde_json::Value) -> f64 {
    use crate::{flag, number};
    let max = (number(&input["height"]) - number(&input["viewport"])).max(0.);
    if flag(&input["snapshot"]["atBottom"]) {
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
    fn scroll_intent_distinguishes_content_growth_from_user_navigation() {
        let mut state = json!({"snapshot":{"atBottom":true,"fromBottom":0,"top":100},"towardBottom":false,"cancelRestore":false});
        let apply = |state: &serde_json::Value, action, top, height| {
            scroll_state(
                &json!({"state":state,"action":action,"top":top,"height":height,"viewport":100}),
            )
        };
        state = apply(&state, "scroll", 100, 400);
        assert_eq!(state["snapshot"]["atBottom"], true);
        state = apply(&state, "scroll", 50, 400);
        assert_eq!(state["snapshot"]["atBottom"], false);
        state = apply(&state, "scroll", 300, 400);
        assert_eq!(state["snapshot"]["atBottom"], false);
        state = scroll_state(&json!({"state":state,"action":"intent","key":"End"}));
        state = apply(&state, "scroll", 300, 400);
        assert_eq!(state["snapshot"]["atBottom"], true);
        state = scroll_state(&json!({"state":state,"action":"intent","key":" ","shift":true}));
        assert_eq!(state["snapshot"]["atBottom"], false);
        assert_eq!(state["cancelRestore"], true);
        assert_eq!(state["towardBottom"], false);
    }

    #[test]
    fn retained_window_covers_mixed_height_history_in_both_directions() {
        let heights: Vec<_> = (0..200)
            .map(|index| Some(if index % 7 == 0 { 900. } else { 32. }))
            .collect();
        let mut viewport = ChatViewport {
            offsets: offsets(&heights),
            scroll_offset: Some(0.),
            viewport_height: 700.,
            retained_window: None,
        };
        for step in (0..100).chain((0..100).rev()) {
            let scroll = step as f64 * 250.;
            viewport.scroll_offset = Some(scroll);
            let next = window(&viewport);
            assert!(viewport.offsets[next.start] <= scroll);
            assert!(viewport.offsets[next.end] >= scroll + 700.);
            viewport.retained_window = Some(next);
        }
        // Deleting history invalidates an old retained range.
        viewport.offsets.truncate(81);
        viewport.scroll_offset = Some(0.);
        assert!(window(&viewport).end <= 80);
    }
}
