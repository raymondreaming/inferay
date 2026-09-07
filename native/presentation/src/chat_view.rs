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
}

#[derive(Debug, PartialEq, Serialize, ts_rs::TS)]
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
    let first_visible = input
        .scroll_offset
        .map_or(count.saturating_sub(24), |scroll| {
            input.offsets[1..]
                .partition_point(|offset| *offset <= scroll)
                .min(count - 1)
        });
    let start = first_visible.saturating_sub(8);
    let bottom = input.scroll_offset.unwrap_or(input.offsets[first_visible])
        + if input.viewport_height == 0. {
            800.
        } else {
            input.viewport_height
        };
    let low = first_visible
        + input.offsets[first_visible..count].partition_point(|offset| *offset < bottom);
    ChatWindow {
        first_visible,
        start,
        end: count.min((start + 48).max(low + 8)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
    fn viewport_handles_empty_initial_and_past_end_positions() {
        assert_eq!(
            offsets(&[Some(0.), None, Some(25.5)]),
            vec![0., 0., 160., 185.5]
        );
        let mut viewport = ChatViewport {
            offsets: offsets(&vec![None; 100]),
            scroll_offset: None,
            viewport_height: 0.,
        };
        assert_eq!(
            window(&viewport),
            ChatWindow {
                first_visible: 76,
                start: 68,
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
