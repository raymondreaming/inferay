use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};
use uuid::Uuid;

const DEFAULT_THEME_ID: &str = "default";
const DEFAULT_FONT_SIZE: u64 = 13;
const DEFAULT_FONT_FAMILY: &str = "SF Mono";
const DEFAULT_OPACITY: u64 = 1;
const DEFAULT_COLUMNS: u64 = 3;
const DEFAULT_ROWS: u64 = 2;
const DEFAULT_CHAT_AGENT_KIND: &str = "codex";
const THEME_IDS: &[&str] = &[
    "default",
    "midnight",
    "dracula",
    "monokai",
    "nord",
    "solarized",
    "github",
    "gruvbox",
    "tokyo",
    "onedark",
    "ocean",
    "rose",
    "githubLight",
    "solarizedLight",
    "custom",
];

#[derive(Debug)]
pub struct AgentStateStore {
    current_path: PathBuf,
    legacy_path: PathBuf,
}

impl AgentStateStore {
    pub fn new(current_path: PathBuf, legacy_path: PathBuf) -> Self {
        Self {
            current_path,
            legacy_path,
        }
    }

    pub fn read(&self) -> Value {
        match read_json(&self.current_path) {
            Some(value) if !value.is_null() => value,
            _ => read_json(&self.legacy_path).unwrap_or(Value::Null),
        }
    }

    /// Returns `true` when the snapshot was persisted and `false` when the
    /// existing TypeScript regression guard would have ignored it.
    pub fn write_guarded(&self, next: Value) -> Result<bool, String> {
        let current = read_json(&self.current_path).unwrap_or(Value::Null);
        if is_agent_state_regression(&current, &next) {
            return Ok(false);
        }
        write_json_atomic(&self.current_path, &next)?;
        Ok(true)
    }

    pub fn apply_workspace_action(&self, action: &Value) -> Result<Value, String> {
        let current = read_json(&self.current_path).unwrap_or(Value::Null);
        let default_agent_kind = action
            .get("defaultAgentKind")
            .and_then(Value::as_str)
            .filter(|kind| matches!(*kind, "claude" | "codex"))
            .unwrap_or(DEFAULT_CHAT_AGENT_KIND);
        let current = normalize_agent_state(&current, false)?
            .unwrap_or_else(|| create_default_agent_state_with_chat_kind(default_agent_kind));
        let next = reduce_agent_workspace_state(&current, action)?;
        let normalized = normalize_agent_state(next.as_ref().unwrap_or(&Value::Null), true)?
            .unwrap_or_else(create_default_agent_state);
        write_json_atomic(&self.current_path, &normalized)?;
        Ok(normalized)
    }
}

pub fn agent_state_score(state: &Value) -> usize {
    let Some(groups) = state.get("groups").and_then(Value::as_array) else {
        return 0;
    };
    let mut score = groups.len();
    for group in groups {
        let Some(panes) = group.get("panes").and_then(Value::as_array) else {
            continue;
        };
        score += panes.len() * 10;
        for pane in panes {
            if pane
                .get("cwd")
                .and_then(Value::as_str)
                .is_some_and(|cwd| !cwd.is_empty())
            {
                score += 10;
            }
            if pane.get("pendingCwd") == Some(&Value::Bool(false)) {
                score += 3;
            }
        }
    }
    score
}

pub fn is_agent_state_regression(current: &Value, next: &Value) -> bool {
    if agent_state_score(next) < agent_state_score(current) {
        return true;
    }
    let current_panes = pane_map(current);
    if current_panes.is_empty() {
        return false;
    }
    let next_panes = pane_map(next);
    current_panes.into_iter().any(|(pane_id, current_pane)| {
        if current_pane.cwd.as_deref().is_none_or(str::is_empty) {
            return false;
        }
        next_panes.get(&pane_id).is_some_and(|next_pane| {
            next_pane.cwd.as_deref().is_none_or(str::is_empty)
                && next_pane.pending_cwd == Some(true)
        })
    })
}

#[derive(Default)]
struct PaneSnapshot {
    cwd: Option<String>,
    pending_cwd: Option<bool>,
}

fn pane_map(state: &Value) -> HashMap<String, PaneSnapshot> {
    let mut result = HashMap::new();
    let Some(groups) = state.get("groups").and_then(Value::as_array) else {
        return result;
    };
    for group in groups {
        let Some(panes) = group.get("panes").and_then(Value::as_array) else {
            continue;
        };
        for pane in panes {
            let Some(id) = pane.get("id").and_then(Value::as_str) else {
                continue;
            };
            result.insert(
                id.to_string(),
                PaneSnapshot {
                    cwd: pane.get("cwd").and_then(Value::as_str).map(str::to_string),
                    pending_cwd: pane.get("pendingCwd").and_then(Value::as_bool),
                },
            );
        }
    }
    result
}

pub fn create_default_agent_state() -> Value {
    create_default_agent_state_with_chat_kind(DEFAULT_CHAT_AGENT_KIND)
}

pub fn create_default_agent_state_with_chat_kind(agent_kind: &str) -> Value {
    let agent_kind = if agent_kind == "claude" {
        "claude"
    } else {
        DEFAULT_CHAT_AGENT_KIND
    };
    let pane_id = Uuid::new_v4().to_string();
    let group_id = Uuid::new_v4().to_string();
    json!({
        "groups": [{
            "id": group_id,
            "name": "Default",
            "panes": [{
                "id": pane_id,
                "title": if agent_kind == "claude" { "Claude" } else { "Codex" },
                "agentKind": agent_kind,
                "isClaude": agent_kind == "claude",
                "paneType": agent_kind,
                "pendingCwd": true,
            }],
            "selectedPaneId": pane_id,
            "columns": DEFAULT_COLUMNS,
            "rows": DEFAULT_ROWS,
        }],
        "selectedGroupId": group_id,
        "themeId": DEFAULT_THEME_ID,
        "fontSize": DEFAULT_FONT_SIZE,
        "fontFamily": DEFAULT_FONT_FAMILY,
        "opacity": DEFAULT_OPACITY,
    })
}

pub fn normalize_agent_state(value: &Value, create_default: bool) -> Result<Option<Value>, String> {
    if !is_valid_agent_state(value) {
        return Ok(create_default.then(create_default_agent_state));
    }
    let source = value
        .as_object()
        .ok_or_else(|| "agent state must be an object".to_string())?;
    let groups = source["groups"]
        .as_array()
        .expect("validated groups must be an array")
        .iter()
        .map(migrate_group)
        .collect::<Result<Vec<_>, _>>()?;
    if groups.is_empty() {
        return Ok(create_default.then(create_default_agent_state));
    }

    let mut normalized = source.clone();
    let selected_group_id = choose_selected_group_id(&groups, source.get("selectedGroupId"));
    normalized.insert("groups".into(), Value::Array(groups));
    normalized.insert("selectedGroupId".into(), selected_group_id);
    let theme = source["themeId"].as_str().unwrap_or(DEFAULT_THEME_ID);
    normalized.insert(
        "themeId".into(),
        Value::String(if THEME_IDS.contains(&theme) {
            theme.to_string()
        } else {
            DEFAULT_THEME_ID.to_string()
        }),
    );
    if source["fontFamily"].as_str().is_none_or(str::is_empty) {
        normalized.insert(
            "fontFamily".into(),
            Value::String(DEFAULT_FONT_FAMILY.into()),
        );
    }
    Ok(Some(Value::Object(normalized)))
}

/// Produces the same normalized, selected-draft-preserving state consumed by
/// the renderer after loading the canonical agent state.
pub fn canonical_agent_state(value: &Value, create_default: bool) -> Result<Option<Value>, String> {
    normalize_agent_state(value, create_default)?
        .map(|state| compact_agent_state(&state, true))
        .transpose()
}

fn is_valid_agent_state(value: &Value) -> bool {
    let Some(value) = value.as_object() else {
        return false;
    };
    value
        .get("groups")
        .and_then(Value::as_array)
        .is_some_and(|groups| !groups.is_empty())
        && value.get("themeId").is_some_and(Value::is_string)
        && value.get("fontSize").is_some_and(Value::is_number)
        && value.get("fontFamily").is_some_and(Value::is_string)
        && value.get("opacity").is_some_and(Value::is_number)
}

fn migrate_group(group: &Value) -> Result<Value, String> {
    let source = group
        .as_object()
        .ok_or_else(|| "agent group must be an object".to_string())?;
    let panes = source
        .get("panes")
        .and_then(Value::as_array)
        .ok_or_else(|| "agent group panes must be an array".to_string())?
        .iter()
        .map(migrate_pane)
        .collect::<Result<Vec<_>, _>>()?;
    let selected = source.get("selectedPaneId");
    let selected_is_valid = panes
        .iter()
        .any(|pane| same_optional_value(pane.get("id"), selected));
    let selected_pane_id = if selected_is_valid {
        selected.cloned().unwrap_or(Value::Null)
    } else {
        panes
            .first()
            .and_then(|pane| pane.get("id"))
            .cloned()
            .unwrap_or(Value::Null)
    };

    let mut migrated = source.clone();
    migrated.insert("panes".into(), Value::Array(panes));
    migrated.insert("selectedPaneId".into(), selected_pane_id);
    if source.get("columns").is_none_or(Value::is_null) {
        migrated.insert("columns".into(), json!(DEFAULT_COLUMNS));
    }
    if source.get("rows").is_none_or(Value::is_null) {
        migrated.insert("rows".into(), json!(DEFAULT_ROWS));
    }
    Ok(Value::Object(migrated))
}

fn migrate_pane(pane: &Value) -> Result<Value, String> {
    let source = pane
        .as_object()
        .ok_or_else(|| "agent pane must be an object".to_string())?;
    let inferred = source
        .get("agentKind")
        .filter(|value| !value.is_null())
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if source.get("paneType").and_then(Value::as_str) == Some("codex") {
                "codex"
            } else if source.get("isClaude").is_some_and(js_truthy) {
                "claude"
            } else {
                "agent"
            }
        });
    let agent_kind = if matches!(inferred, "claude" | "codex") {
        inferred
    } else {
        DEFAULT_CHAT_AGENT_KIND
    };
    let mut migrated = source.clone();
    migrated.insert("agentKind".into(), Value::String(agent_kind.into()));
    migrated.insert("isClaude".into(), Value::Bool(agent_kind == "claude"));
    migrated.insert("paneType".into(), Value::String(agent_kind.into()));
    Ok(Value::Object(migrated))
}

fn choose_selected_group_id(groups: &[Value], selected: Option<&Value>) -> Value {
    if groups
        .iter()
        .any(|group| same_optional_value(group.get("id"), selected))
    {
        return selected.cloned().unwrap_or(Value::Null);
    }
    let mut best_group = None;
    let mut best_score = None;
    for group in groups {
        let score = renderer_group_score(group);
        if best_score.is_none_or(|current| score > current) {
            best_group = Some(group);
            best_score = Some(score);
        }
    }
    best_group
        .and_then(|group| group.get("id"))
        .cloned()
        .unwrap_or(Value::Null)
}

fn renderer_group_score(group: &Value) -> usize {
    let Some(panes) = group.get("panes").and_then(Value::as_array) else {
        return 1;
    };
    1 + panes.len() * 10
        + panes
            .iter()
            .filter(|pane| has_durable_pane_value(pane))
            .count()
            * 10
}

pub fn reduce_agent_workspace_state(
    state: &Value,
    action: &Value,
) -> Result<Option<Value>, String> {
    let action_type = action.get("type").and_then(Value::as_str).unwrap_or("");
    let mut next = state.clone();
    match action_type {
        "selectWorkspace" => {
            let group_id = action.get("groupId");
            if !state_groups(state)?
                .iter()
                .any(|group| same_optional_value(group.get("id"), group_id))
            {
                return Ok(Some(state.clone()));
            }
            set_optional_property(next_object_mut(&mut next)?, "selectedGroupId", group_id);
            Ok(Some(compact_agent_state(&next, true)?))
        }
        "selectPane" => {
            let group_id = action.get("groupId");
            let pane_id = action.get("paneId");
            set_optional_property(next_object_mut(&mut next)?, "selectedGroupId", group_id);
            for group in state_groups_mut(&mut next)? {
                if same_optional_value(group.get("id"), group_id) {
                    set_optional_property(next_object_mut(group)?, "selectedPaneId", pane_id);
                }
            }
            Ok(Some(compact_agent_state(&next, true)?))
        }
        "addWorkspace" => {
            next = compact_agent_state(state, true)?;
            let groups = state_groups(&next)?;
            let selected = next.get("selectedGroupId");
            let selected_group = groups
                .iter()
                .find(|group| same_optional_value(group.get("id"), selected))
                .or_else(|| groups.first());
            let columns = selected_group
                .and_then(|group| group.get("columns"))
                .filter(|value| !value.is_null())
                .cloned()
                .unwrap_or_else(|| json!(DEFAULT_COLUMNS));
            let rows = selected_group
                .and_then(|group| group.get("rows"))
                .filter(|value| !value.is_null())
                .cloned()
                .unwrap_or_else(|| json!(DEFAULT_ROWS));
            let group_id = Uuid::new_v4().to_string();
            let default_agent_kind = action
                .get("defaultAgentKind")
                .and_then(Value::as_str)
                .filter(|kind| matches!(*kind, "claude" | "codex"))
                .unwrap_or(DEFAULT_CHAT_AGENT_KIND);
            let starter_pane = create_pending_chat_pane(default_agent_kind);
            let starter_pane_id = starter_pane.get("id").cloned().unwrap_or(Value::Null);
            let group = json!({
                "id": group_id,
                "name": format!("Workspace {}", groups.len() + 1),
                "panes": [starter_pane],
                "selectedPaneId": starter_pane_id,
                "columns": columns,
                "rows": rows,
            });
            state_groups_mut(&mut next)?.push(group);
            next_object_mut(&mut next)?.insert("selectedGroupId".into(), json!(group_id));
            Ok(Some(next))
        }
        "removeWorkspace" => {
            if state_groups(state)?.len() <= 1 {
                return Ok(None);
            }
            let group_id = action.get("groupId");
            let selected_was_removed = same_optional_value(state.get("selectedGroupId"), group_id);
            state_groups_mut(&mut next)?
                .retain(|group| !same_optional_value(group.get("id"), group_id));
            if selected_was_removed {
                let first_id = state_groups(&next)?
                    .first()
                    .and_then(|group| group.get("id"))
                    .cloned()
                    .unwrap_or(Value::Null);
                next_object_mut(&mut next)?.insert("selectedGroupId".into(), first_id);
            }
            Ok(Some(next))
        }
        "renameWorkspace" => {
            let group_id = action.get("groupId");
            let name = action
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "workspace name must be a string".to_string())?
                .trim();
            for group in state_groups_mut(&mut next)? {
                if same_optional_value(group.get("id"), group_id) && !name.is_empty() {
                    next_object_mut(group)?.insert("name".into(), Value::String(name.into()));
                }
            }
            Ok(Some(next))
        }
        "addPane" => {
            let selected_group_id = action
                .get("groupId")
                .filter(|value| !value.is_null())
                .or_else(|| {
                    state
                        .get("selectedGroupId")
                        .filter(|value| !value.is_null())
                })
                .or_else(|| state_groups(state).ok()?.first()?.get("id"));
            let Some(selected_group_id) = selected_group_id.cloned() else {
                return Ok(None);
            };
            let pane = action
                .get("pane")
                .cloned()
                .ok_or_else(|| "addPane action requires a pane".to_string())?;
            for group in state_groups_mut(&mut next)? {
                if group.get("id") == Some(&selected_group_id) {
                    append_pane_to_group(group, pane.clone())?;
                }
            }
            next_object_mut(&mut next)?.insert("selectedGroupId".into(), selected_group_id);
            Ok(Some(next))
        }
        "removePane" => {
            reduce_remove_pane(&mut next, action)?;
            Ok(Some(next))
        }
        "directorySelected" => {
            reduce_directory_selected(&mut next, action)?;
            Ok(Some(next))
        }
        "setPaneAgentKind" => {
            reduce_set_pane_agent_kind(&mut next, action)?;
            Ok(Some(next))
        }
        "reorderPanes" => {
            let group_id = action.get("groupId");
            let from = action.get("fromIndex").and_then(Value::as_u64);
            let to = action.get("toIndex").and_then(Value::as_u64);
            if let (Some(from), Some(to)) = (from, to) {
                for group in state_groups_mut(&mut next)? {
                    if !same_optional_value(group.get("id"), group_id) {
                        continue;
                    }
                    let panes = group_panes_mut(group)?;
                    let (Ok(from), Ok(to)) = (usize::try_from(from), usize::try_from(to)) else {
                        continue;
                    };
                    if from < panes.len() && to < panes.len() && from != to {
                        let pane = panes.remove(from);
                        panes.insert(to, pane);
                    }
                }
            }
            Ok(Some(next))
        }
        "setGridDimensions" => {
            let group_id = action.get("groupId");
            let columns = action
                .get("columns")
                .and_then(Value::as_u64)
                .filter(|value| *value > 0);
            let rows = action
                .get("rows")
                .and_then(Value::as_u64)
                .filter(|value| *value > 0);
            for group in state_groups_mut(&mut next)? {
                if same_optional_value(group.get("id"), group_id) {
                    let object = next_object_mut(group)?;
                    if let Some(columns) = columns {
                        object.insert("columns".into(), json!(columns));
                    }
                    if let Some(rows) = rows {
                        object.insert("rows".into(), json!(rows));
                    }
                }
            }
            Ok(Some(next))
        }
        "ensureChatPane" => reduce_ensure_chat_pane(&mut next, action),
        _ => Ok(None),
    }
}

fn compact_agent_state(state: &Value, keep_selected_draft: bool) -> Result<Value, String> {
    let groups = state_groups(state)?;
    let has_durable_group = groups.iter().any(has_durable_pane);
    let selected_group = groups
        .iter()
        .find(|group| same_optional_value(group.get("id"), state.get("selectedGroupId")))
        .or_else(|| groups.first());
    let mut compacted_groups = Vec::new();

    for group in groups {
        let group_is_durable = has_durable_pane(group);
        let is_selected = same_optional_value(group.get("id"), state.get("selectedGroupId"));
        if has_durable_group && !(keep_selected_draft && is_selected) && !group_is_durable {
            continue;
        }
        if !has_durable_group
            && selected_group.is_some_and(|selected| group.get("id") != selected.get("id"))
        {
            continue;
        }
        if !group_is_durable {
            if keep_selected_draft && is_selected {
                compacted_groups.push(group.clone());
                continue;
            }
            let panes = group_panes(group)?;
            let selected_pane = panes
                .iter()
                .find(|pane| same_optional_value(pane.get("id"), group.get("selectedPaneId")))
                .or_else(|| panes.first());
            let mut compacted = group.clone();
            let compacted_object = next_object_mut(&mut compacted)?;
            compacted_object.insert(
                "panes".into(),
                Value::Array(selected_pane.cloned().into_iter().collect()),
            );
            compacted_object.insert(
                "selectedPaneId".into(),
                selected_pane
                    .and_then(|pane| pane.get("id"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            compacted_groups.push(compacted);
            continue;
        }

        let panes = group_panes(group)?;
        let compacted_panes = panes
            .iter()
            .filter(|pane| {
                same_optional_value(pane.get("id"), group.get("selectedPaneId"))
                    || (keep_selected_draft
                        && is_selected
                        && is_chat_agent_kind(pane.get("agentKind")))
                    || !is_empty_pending_pane(pane)
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut compacted = group.clone();
        let selected_still_exists = compacted_panes
            .iter()
            .any(|pane| same_optional_value(pane.get("id"), group.get("selectedPaneId")));
        let compacted_object = next_object_mut(&mut compacted)?;
        compacted_object.insert("panes".into(), Value::Array(compacted_panes.clone()));
        if !selected_still_exists {
            compacted_object.insert(
                "selectedPaneId".into(),
                compacted_panes
                    .first()
                    .and_then(|pane| pane.get("id"))
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
        compacted_groups.push(compacted);
    }

    let mut next = state.clone();
    let selected = choose_selected_group_id(&compacted_groups, state.get("selectedGroupId"));
    let object = next_object_mut(&mut next)?;
    object.insert("groups".into(), Value::Array(compacted_groups));
    object.insert("selectedGroupId".into(), selected);
    Ok(next)
}

fn append_pane_to_group(group: &mut Value, pane: Value) -> Result<(), String> {
    let existing = group_panes(group)?.clone();
    let replace_draft = existing.len() == 1
        && existing.first().is_some_and(is_empty_pending_pane)
        && !is_empty_pending_pane(&pane);
    let mut panes = if replace_draft { Vec::new() } else { existing };
    panes.push(pane.clone());
    let object = next_object_mut(group)?;
    object.insert("panes".into(), Value::Array(panes));
    object.insert(
        "selectedPaneId".into(),
        pane.get("id").cloned().unwrap_or(Value::Null),
    );
    Ok(())
}

fn reduce_remove_pane(state: &mut Value, action: &Value) -> Result<(), String> {
    let group_id = action.get("groupId");
    let pane_id = action.get("paneId");
    for group in state_groups_mut(state)? {
        if !same_optional_value(group.get("id"), group_id) {
            continue;
        }
        let mut panes = group_panes(group)?.clone();
        panes.retain(|pane| !same_optional_value(pane.get("id"), pane_id));
        let selected_was_removed = same_optional_value(group.get("selectedPaneId"), pane_id);
        let first_id = panes
            .first()
            .and_then(|pane| pane.get("id"))
            .cloned()
            .unwrap_or(Value::Null);
        let object = next_object_mut(group)?;
        object.insert("panes".into(), Value::Array(panes));
        if selected_was_removed {
            object.insert("selectedPaneId".into(), first_id);
        }
    }
    Ok(())
}

fn reduce_directory_selected(state: &mut Value, action: &Value) -> Result<(), String> {
    let group_id = action.get("groupId");
    let pane_id = action.get("paneId");
    for group in state_groups_mut(state)? {
        if !same_optional_value(group.get("id"), group_id) {
            continue;
        }
        for pane in group_panes_mut(group)? {
            if !same_optional_value(pane.get("id"), pane_id) {
                continue;
            }
            let agent_kind = pane
                .get("agentKind")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_CHAT_AGENT_KIND);
            let path = action.get("path").and_then(Value::as_str);
            let title = pane_title(agent_kind, path);
            let object = next_object_mut(pane)?;
            set_optional_property(
                object,
                "cwd",
                action.get("path").filter(|value| !value.is_null()),
            );
            object.insert("pendingCwd".into(), Value::Bool(false));
            set_optional_property(object, "referencePaths", action.get("referencePaths"));
            object.insert("title".into(), Value::String(title));
        }
    }
    Ok(())
}

fn reduce_set_pane_agent_kind(state: &mut Value, action: &Value) -> Result<(), String> {
    let group_id = action.get("groupId");
    let pane_id = action.get("paneId");
    let agent_kind = action
        .get("agentKind")
        .and_then(Value::as_str)
        .ok_or_else(|| "agentKind must be a string".to_string())?;
    if !matches!(agent_kind, "agent" | "claude" | "codex") {
        return Err("unknown agentKind".into());
    }
    for group in state_groups_mut(state)? {
        if !same_optional_value(group.get("id"), group_id) {
            continue;
        }
        for pane in group_panes_mut(group)? {
            if !same_optional_value(pane.get("id"), pane_id) {
                continue;
            }
            let title = pane_title(agent_kind, pane.get("cwd").and_then(Value::as_str));
            let object = next_object_mut(pane)?;
            object.insert("agentKind".into(), Value::String(agent_kind.into()));
            object.insert("isClaude".into(), Value::Bool(agent_kind == "claude"));
            object.insert("paneType".into(), Value::String(agent_kind.into()));
            object.insert("title".into(), Value::String(title));
        }
    }
    Ok(())
}

fn reduce_ensure_chat_pane(state: &mut Value, action: &Value) -> Result<Option<Value>, String> {
    let selected_group_id = state
        .get("selectedGroupId")
        .filter(|value| !value.is_null())
        .cloned()
        .or_else(|| state_groups(state).ok()?.first()?.get("id").cloned());
    let Some(selected_group_id) = selected_group_id else {
        return Ok(None);
    };
    let group_index = state_groups(state)?
        .iter()
        .position(|group| group.get("id") == Some(&selected_group_id))
        .unwrap_or(0);
    let group = &state_groups(state)?[group_index];
    let selected_pane_id = group.get("selectedPaneId");
    let panes = group_panes(group)?;
    let chat_pane_index = panes
        .iter()
        .position(|pane| {
            same_optional_value(pane.get("id"), selected_pane_id)
                && is_chat_agent_kind(pane.get("agentKind"))
        })
        .or_else(|| {
            panes
                .iter()
                .position(|pane| is_chat_agent_kind(pane.get("agentKind")))
        });
    let default_agent_kind = action
        .get("defaultAgentKind")
        .and_then(Value::as_str)
        .filter(|kind| matches!(*kind, "claude" | "codex"))
        .unwrap_or(DEFAULT_CHAT_AGENT_KIND);
    let chat_pane = chat_pane_index
        .and_then(|index| panes.get(index).cloned())
        .unwrap_or_else(|| create_pending_chat_pane(default_agent_kind));
    let chat_pane_id = chat_pane.get("id").cloned().unwrap_or(Value::Null);
    let group = &mut state_groups_mut(state)?[group_index];
    if chat_pane_index.is_none() {
        group_panes_mut(group)?.insert(0, chat_pane);
    }
    next_object_mut(group)?.insert("selectedPaneId".into(), chat_pane_id);
    next_object_mut(state)?.insert("selectedGroupId".into(), selected_group_id);
    Ok(Some(state.clone()))
}

fn create_pending_chat_pane(agent_kind: &str) -> Value {
    json!({
        "id": Uuid::new_v4().to_string(),
        "title": if agent_kind == "claude" { "Claude" } else { "Codex" },
        "agentKind": agent_kind,
        "isClaude": agent_kind == "claude",
        "paneType": agent_kind,
        "pendingCwd": true,
    })
}

fn pane_title(agent_kind: &str, cwd: Option<&str>) -> String {
    if let Some(cwd) = cwd.filter(|cwd| !cwd.is_empty()) {
        let final_component = cwd.rsplit('/').next().unwrap_or(cwd);
        return if final_component.is_empty() {
            cwd.to_string()
        } else {
            final_component.to_string()
        };
    }
    match agent_kind {
        "claude" => "Claude",
        "agent" => "Agent",
        _ => "Codex",
    }
    .into()
}

fn has_durable_pane(group: &Value) -> bool {
    group_panes(group).is_ok_and(|panes| panes.iter().any(has_durable_pane_value))
}

fn has_durable_pane_value(pane: &Value) -> bool {
    pane.get("cwd").is_some_and(js_truthy) || pane.get("pendingCwd") == Some(&Value::Bool(false))
}

fn is_empty_pending_pane(pane: &Value) -> bool {
    pane.get("pendingCwd") == Some(&Value::Bool(true))
        && !pane.get("cwd").is_some_and(js_truthy)
        && match pane.get("referencePaths") {
            None | Some(Value::Null) => true,
            Some(Value::Array(paths)) => paths.is_empty(),
            Some(value) => !js_truthy(value),
        }
}

fn is_chat_agent_kind(value: Option<&Value>) -> bool {
    matches!(value.and_then(Value::as_str), Some("claude" | "codex"))
}

fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn same_optional_value(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn state_groups(state: &Value) -> Result<&Vec<Value>, String> {
    state
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| "agent state groups must be an array".to_string())
}

fn state_groups_mut(state: &mut Value) -> Result<&mut Vec<Value>, String> {
    state
        .get_mut("groups")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "agent state groups must be an array".to_string())
}

fn group_panes(group: &Value) -> Result<&Vec<Value>, String> {
    group
        .get("panes")
        .and_then(Value::as_array)
        .ok_or_else(|| "agent group panes must be an array".to_string())
}

fn group_panes_mut(group: &mut Value) -> Result<&mut Vec<Value>, String> {
    group
        .get_mut("panes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "agent group panes must be an array".to_string())
}

fn next_object_mut(value: &mut Value) -> Result<&mut Map<String, Value>, String> {
    value
        .as_object_mut()
        .ok_or_else(|| "agent value must be an object".to_string())
}

fn set_optional_property(object: &mut Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(value) = value {
        object.insert(key.into(), value.clone());
    } else {
        object.remove(key);
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "agent state path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    crate::atomic_write::overwrite(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved_state() -> Value {
        json!({
            "groups": [{
                "id": "group-1",
                "name": "Workspace",
                "panes": [{
                    "id": "pane-1",
                    "title": "project",
                    "agentKind": "codex",
                    "isClaude": false,
                    "paneType": "codex",
                    "cwd": "/tmp/project",
                    "pendingCwd": false,
                    "extra": "preserved",
                }],
                "selectedPaneId": "pane-1",
                "columns": 2,
                "rows": 1,
            }],
            "selectedGroupId": "group-1",
            "themeId": "midnight",
            "fontSize": 14,
            "fontFamily": "Menlo",
            "opacity": 0.9,
            "futureField": true,
        })
    }

    #[test]
    fn normalizes_legacy_panes_and_preserves_unknown_fields() {
        let state = json!({
            "groups": [{
                "id": "group-1",
                "name": "Legacy",
                "panes": [{ "id": "pane-1", "title": "Old", "isClaude": true, "extra": 7 }],
                "selectedPaneId": "missing",
            }],
            "selectedGroupId": "missing",
            "themeId": "not-a-theme",
            "fontSize": 13,
            "fontFamily": "",
            "opacity": 1,
            "futureField": true,
        });
        let normalized = normalize_agent_state(&state, true).unwrap().unwrap();
        assert_eq!(normalized["selectedGroupId"], "group-1");
        assert_eq!(normalized["groups"][0]["selectedPaneId"], "pane-1");
        assert_eq!(normalized["groups"][0]["columns"], 3);
        assert_eq!(normalized["groups"][0]["rows"], 2);
        assert_eq!(normalized["groups"][0]["panes"][0]["agentKind"], "claude");
        assert_eq!(normalized["groups"][0]["panes"][0]["paneType"], "claude");
        assert_eq!(normalized["groups"][0]["panes"][0]["extra"], 7);
        assert_eq!(normalized["themeId"], "default");
        assert_eq!(normalized["fontFamily"], "SF Mono");
        assert_eq!(normalized["futureField"], true);
    }

    #[test]
    fn canonical_state_matches_renderer_compaction_after_normalization() {
        let mut state = saved_state();
        state["groups"].as_array_mut().unwrap().push(json!({
            "id": "empty-group",
            "name": "Empty",
            "panes": [],
            "selectedPaneId": null,
            "columns": 2,
            "rows": 1,
        }));
        let canonical = canonical_agent_state(&state, false).unwrap().unwrap();
        assert_eq!(canonical["groups"].as_array().unwrap().len(), 1);
        assert_eq!(canonical["groups"][0]["id"], "group-1");
        assert_eq!(canonical["selectedGroupId"], "group-1");
    }

    #[test]
    fn guards_state_regressions_like_the_bun_server() {
        let current = saved_state();
        let mut fewer = current.clone();
        fewer["groups"][0]["panes"] = json!([]);
        assert!(is_agent_state_regression(&current, &fewer));

        let mut pending_loss = current.clone();
        pending_loss["groups"][0]["panes"][0]
            .as_object_mut()
            .unwrap()
            .remove("cwd");
        pending_loss["groups"][0]["panes"][0]["pendingCwd"] = true.into();
        pending_loss["groups"][0]["panes"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id": "pane-2",
                "cwd": "/tmp/extra",
                "pendingCwd": false,
            }));
        assert!(agent_state_score(&pending_loss) >= agent_state_score(&current));
        assert!(is_agent_state_regression(&current, &pending_loss));
    }

    #[test]
    fn applies_workspace_actions_with_the_existing_compaction_contract() {
        let state = saved_state();
        let renamed = reduce_agent_workspace_state(
            &state,
            &json!({ "type": "renameWorkspace", "groupId": "group-1", "name": "  Renamed  " }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(renamed["groups"][0]["name"], "Renamed");

        let selected = reduce_agent_workspace_state(
            &renamed,
            &json!({
                "type": "directorySelected",
                "groupId": "group-1",
                "paneId": "pane-1",
                "path": "/tmp/other",
                "referencePaths": ["/tmp/reference"],
            }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(selected["groups"][0]["panes"][0]["cwd"], "/tmp/other");
        assert_eq!(selected["groups"][0]["panes"][0]["title"], "other");
        assert_eq!(selected["groups"][0]["panes"][0]["pendingCwd"], false);
        assert_eq!(selected["groups"][0]["panes"][0]["extra"], "preserved");

        let removed = reduce_agent_workspace_state(
            &selected,
            &json!({ "type": "removeWorkspace", "groupId": "group-1" }),
        )
        .unwrap();
        assert!(removed.is_none());
    }

    #[test]
    fn creates_a_workspace_with_a_selected_starter_chat() {
        let added = reduce_agent_workspace_state(
            &saved_state(),
            &json!({ "type": "addWorkspace", "defaultAgentKind": "claude" }),
        )
        .unwrap()
        .unwrap();
        let workspace = &added["groups"][1];
        let pane = &workspace["panes"][0];

        assert_eq!(workspace["selectedPaneId"], pane["id"]);
        assert_eq!(added["selectedGroupId"], workspace["id"]);
        assert_eq!(pane["agentKind"], "claude");
        assert_eq!(pane["pendingCwd"], true);
    }

    #[test]
    fn store_reads_legacy_but_actions_start_from_the_current_file() {
        let root = tempfile::TempDir::new().unwrap();
        let current = root.path().join("agent-state.json");
        let legacy = root.path().join("terminal-state.json");
        std::fs::write(&legacy, serde_json::to_vec(&saved_state()).unwrap()).unwrap();
        let store = AgentStateStore::new(current.clone(), legacy);
        assert_eq!(store.read()["selectedGroupId"], "group-1");

        let next = store
            .apply_workspace_action(&json!({ "type": "ensureChatPane" }))
            .unwrap();
        assert_ne!(next["selectedGroupId"], "group-1");
        assert!(current.is_file());
        assert!(!store.write_guarded(json!({ "groups": [] })).unwrap());
    }

    #[test]
    fn ensure_chat_pane_uses_the_validated_default_only_when_creating_a_pane() {
        let state = json!({
            "groups": [{
                "id":"group", "name":"Group", "selectedPaneId":"editor",
                "columns":3, "rows":2,
                "panes":[{"id":"editor","title":"Editor","agentKind":"editor","paneType":"editor"}]
            }],
            "selectedGroupId":"group", "themeId":"default", "fontSize":13,
            "fontFamily":"SF Mono", "opacity":1
        });
        let next = reduce_agent_workspace_state(
            &state,
            &json!({"type":"ensureChatPane","defaultAgentKind":"claude"}),
        )
        .unwrap()
        .unwrap();
        let pane = &next["groups"][0]["panes"][0];
        assert_eq!(pane["agentKind"], "claude");
        assert_eq!(pane["paneType"], "claude");
        assert_eq!(pane["title"], "Claude");
        assert_eq!(pane["isClaude"], true);
        assert_eq!(pane["pendingCwd"], true);

        let existing = reduce_agent_workspace_state(
            &next,
            &json!({"type":"ensureChatPane","defaultAgentKind":"codex"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(existing["groups"][0]["panes"][0]["agentKind"], "claude");
        assert_eq!(existing["groups"][0]["panes"].as_array().unwrap().len(), 2);
    }
}
