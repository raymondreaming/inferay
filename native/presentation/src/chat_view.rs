//! Row grouping and viewport selection operate on descriptors and measurements,
//! never on transcript text. The renderer retains its existing message objects.
use serde::{Deserialize, Serialize};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDescriptor {
    kind: Option<String>,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    group_leader: bool,
    group_end: Option<usize>,
    file_path: Option<String>,
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

pub fn rows(descriptors: &[Option<RowDescriptor>]) -> Vec<ChatRow> {
    descriptors
        .iter()
        .enumerate()
        .filter_map(|(index, descriptor)| {
            let Some(render) = descriptor else {
                return Some(ChatRow::Message { index });
            };
            if render.hidden
                || (render.kind.as_deref() == Some("edit-group") && !render.group_leader)
            {
                return None;
            }
            if render.kind.as_deref() == Some("edit-group")
                && let Some(path) = render.file_path.as_ref().filter(|path| !path.is_empty())
            {
                let end = render.group_end.unwrap_or(index + 1).min(descriptors.len());
                return Some(if end > index + 1 {
                    ChatRow::EditGroup {
                        start: index,
                        end,
                        file_path: path.clone(),
                    }
                } else {
                    ChatRow::Message { index }
                });
            }
            Some(if render.kind.as_deref() == Some("tool-group") {
                ChatRow::ToolGroup {
                    index,
                    continues_after: render.continues_after,
                }
            } else {
                ChatRow::Message { index }
            })
        })
        .collect()
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
    let descriptors = messages
        .iter()
        .map(|message| serde_json::from_value(message["render"].clone()))
        .collect::<Result<Vec<Option<RowDescriptor>>, _>>()
        .map_err(|error| error.to_string())?;
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
    Ok(rows(&descriptors)
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            let message = &messages[match &row {
                ChatRow::Message { index } | ChatRow::ToolGroup { index, .. } => *index,
                ChatRow::EditGroup { start, .. } => *start,
            }];
            let key = message["render"]["rowId"]
                .as_str()
                .or_else(|| message["id"].as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("row-{index}"));
            let checkpoint = if matches!(row, ChatRow::Message { .. })
                && message["role"] == "assistant"
                && !flag(&message["isStreaming"])
            {
                checkpoints.get(string(&message["id"])).copied()
            } else {
                None
            };
            ChatListRow {
                row,
                key,
                checkpoint,
            }
        })
        .collect())
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

/// Local submission starts activity immediately; provider acknowledgement keeps
/// that start time. A reconnect's old idle snapshot cannot cancel a pending send.
pub fn run_status(input: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let current = &input["current"];
    if input["begin"] == true {
        return if current["isLoading"] == true {
            current.clone()
        } else {
            json!({"isLoading":true,"status":"sending","startTime":input["now"]})
        };
    }
    let mut next = input["incoming"].clone();
    if current["status"] == "sending" && next["status"] == "idle" && input["terminal"] != true {
        return current.clone();
    }
    if next["isLoading"] == true
        && current["isLoading"] == true
        && let Some(start) = current["startTime"].as_u64()
    {
        next["startTime"] = json!(
            next["startTime"]
                .as_u64()
                .map_or(start, |native| native.min(start))
        );
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn list_projects_stable_identity_and_checkpoint_eligibility() {
        let model = serde_json::to_value(list(&json!({
            "messages": [
                {"id":"user", "role":"user"},
                {"id":"streaming", "role":"assistant", "isStreaming":true},
                {"id":"done", "role":"assistant", "render":{"rowId":"stable"}},
                {"id":"edit", "role":"assistant", "render":{"kind":"edit-group", "groupLeader":true, "groupEnd":5, "filePath":"a.rs"}},
                {"id":"hidden", "render":{"kind":"edit-group"}}
            ],
            "checkpoints":[
                {"afterMessageId":"user"}, {"afterMessageId":"streaming"},
                {"afterMessageId":"done"}, {"afterMessageId":"edit"}, {"afterMessageId":"done"}
            ]
        })).unwrap()).unwrap();
        assert_eq!(
            model,
            json!([
                {"type":"message","index":0,"key":"user","checkpoint":null},
                {"type":"message","index":1,"key":"streaming","checkpoint":null},
                {"type":"message","index":2,"key":"stable","checkpoint":4},
                {"type":"edit-group","start":3,"end":5,"filePath":"a.rs","key":"edit","checkpoint":null}
            ])
        );
    }

    #[test]
    fn groups_keep_original_indices_and_unhydrated_messages() {
        let input = serde_json::from_value::<Vec<Option<RowDescriptor>>>(json!([
            null,
            {"hidden":true},
            {"kind":"edit-group", "groupLeader":true, "groupEnd":4, "filePath":"a.rs"},
            {"kind":"edit-group", "groupLeader":false},
            {"kind":"tool-group", "continuesAfter":true},
            {"kind":"edit-group", "groupLeader":true, "groupEnd":999, "filePath":"b.rs"}
        ]))
        .unwrap();
        assert_eq!(
            rows(&input),
            vec![
                ChatRow::Message { index: 0 },
                ChatRow::EditGroup {
                    start: 2,
                    end: 4,
                    file_path: "a.rs".into()
                },
                ChatRow::ToolGroup {
                    index: 4,
                    continues_after: true
                },
                ChatRow::Message { index: 5 },
            ]
        );
    }

    #[test]
    fn scrolling_retains_mounted_rows_until_the_viewport_nears_an_edge() {
        let mut viewport = ChatViewport {
            offsets: offsets(&vec![Some(32.); 500]),
            scroll_offset: Some(0.),
            viewport_height: 600.,
            retained_window: None,
        };
        let mut changes = 0;
        for step in 0..200 {
            let scroll = step as f64 * 32.;
            viewport.scroll_offset = Some(scroll);
            let next = window(&viewport);
            assert!(viewport.offsets[next.start] <= scroll);
            assert!(viewport.offsets[next.end] >= scroll + 600.);
            if viewport
                .retained_window
                .as_ref()
                .is_some_and(|previous| previous.start != next.start || previous.end != next.end)
            {
                changes += 1;
            }
            viewport.retained_window = Some(next);
        }
        assert!(changes < 30, "mounted range changed {changes} times");
        // Jumping back across unmounted history must update immediately.
        viewport.scroll_offset = Some(0.);
        let top = window(&viewport);
        assert_eq!(top.start, 0);
        // Following a new response must still choose the tail.
        viewport.scroll_offset = None;
        assert_eq!(window(&viewport).end, 500);
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

    #[test]
    fn following_covers_the_viewport_with_short_rows_and_tracks_tail_growth() {
        let mut viewport = ChatViewport {
            offsets: offsets(&vec![Some(20.); 100]),
            scroll_offset: None,
            viewport_height: 1200.,
            retained_window: None,
        };
        let initial = window(&viewport);
        assert_eq!(initial.first_visible, 40);
        assert_eq!(initial.end, 100);
        assert!(viewport.offsets[initial.start] <= 800.);
        // A growing final row must remain mounted, with enough rows above it
        // to fill the screen, without depending on a DOM scroll event.
        viewport.offsets[100] += 600.;
        let grown = window(&viewport);
        assert_eq!(grown.first_visible, 70);
        assert_eq!(grown.end, 100);
        viewport.viewport_height = 4000.;
        assert_eq!(window(&viewport).start, 0);
    }

    #[test]
    fn viewport_handles_empty_initial_and_past_end_positions() {
        assert_eq!(
            offsets(&[Some(0.), None, Some(25.5)]),
            vec![0., 0., 160., 185.5]
        );
        let mut viewport = ChatViewport {
            offsets: offsets(&vec![None; 100]),
            scroll_offset: None,
            viewport_height: 0.,
            retained_window: None,
        };
        assert_eq!(
            window(&viewport),
            ChatWindow {
                first_visible: 95,
                start: 87,
                end: 100
            }
        );
        viewport.scroll_offset = Some(160.);
        assert_eq!(
            window(&viewport),
            ChatWindow {
                first_visible: 1,
                start: 0,
                end: 48
            }
        );
        viewport.scroll_offset = Some(99_999.);
        assert_eq!(
            window(&viewport),
            ChatWindow {
                first_visible: 99,
                start: 91,
                end: 100
            }
        );
        viewport.offsets.clear();
        assert_eq!(
            window(&viewport),
            ChatWindow {
                first_visible: 0,
                start: 0,
                end: 0
            }
        );
    }
}
