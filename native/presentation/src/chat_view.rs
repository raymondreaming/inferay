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
