//! Read-only profile adapter for the preview. Never initializes or migrates stores.
use anyhow::{Context, Result};
use inferay_core::{
    agent_state::{Pane, Workspace},
    chat_protocol::ChatTranscriptMessage,
    project_files::ProjectDefinition,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub struct Project {
    pub id: Option<String>,
    pub name: String,
    pub repositories: Vec<(String, String)>,
    pub panes: Vec<Pane>,
    pub dock: serde_json::Value,
    pub dock_workspace: Option<(String, String)>,
}
pub struct Session {
    pub default_config: inferay_core::provider_config::ProviderSettings,
    pub projects: Vec<Project>,
    pub closed_projects: std::collections::HashSet<String>,
    pub closed_repositories: HashMap<String, std::collections::HashSet<String>>,
    pub selected_project: usize,
    pub selected_pane: Option<String>,
    pub sidebar_width: f32,
    pub zoom: crate::zoom::Zoom,
    pub sidebar_collapsed: bool,
    pub drafts: HashMap<String, String>,
    pub chat_settings: HashMap<String, inferay_core::provider_config::ProviderSettings>,
    pub background: serde_json::Value,
    pub font: String,
    pub syntax_theme: String,
    pub graph_preferences: serde_json::Value,
}
pub fn profile() -> PathBuf {
    std::env::var_os("INFERAY_USER_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").expect("home directory"))
                .join("Library/Application Support/Inferay")
        })
}
fn open(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Could not read {}", path.display()))?;
    connection.busy_timeout(std::time::Duration::from_secs(2))?;
    Ok(connection)
}
pub fn load(root: &Path) -> Result<Session> {
    let mut workspace: Workspace = match std::fs::read(root.join("agent-state.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Workspace::new("codex"),
        Err(error) => return Err(error.into()),
    };
    workspace.validate().map_err(anyhow::Error::msg)?;
    let workspace_json = serde_json::to_value(&workspace)?;
    let preferences_path = root.join("client-storage.sqlite3");
    let prefs = preferences_path
        .exists()
        .then(|| open(&preferences_path))
        .transpose()?;
    let value = |key: &str| -> Result<Option<String>> {
        let Some(prefs) = &prefs else {
            return Ok(None);
        };
        let raw: Option<String> = prefs
            .query_row("SELECT value FROM entries WHERE key=?", [key], |r| r.get(0))
            .optional()?;
        raw.map(|raw| {
            serde_json::from_str::<Option<String>>(&raw)
                .with_context(|| format!("Invalid preference {key}"))
        })
        .transpose()
        .map(Option::flatten)
    };
    let order: Vec<String> = value("inferay-project-order")?
        .map(|v| serde_json::from_str(&v))
        .transpose()?
        .unwrap_or_default();
    let selected = value("inferay-selected-project-id")?;
    let projects_path = root.join("projects.sqlite3");
    let projects_db = projects_path
        .exists()
        .then(|| open(&projects_path))
        .transpose()?;
    let associations: HashMap<String, String> = if let Some(db) = &projects_db {
        db.prepare("SELECT pane_id,project_id FROM project_conversations")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    } else {
        HashMap::new()
    };
    let mut definitions = Vec::new();
    let projects_directory = match std::fs::read_dir(root.join("projects")) {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    for entry in projects_directory.into_iter().flatten() {
        let path = entry?.path().join("project.json");
        if !path.is_file() {
            continue;
        }
        let definition: ProjectDefinition = serde_json::from_slice(&std::fs::read(&path)?)
            .with_context(|| format!("Invalid project {}", path.display()))?;
        if !definition.archived {
            definitions.push(definition);
        }
    }
    definitions.sort_by_key(|p| {
        (
            order
                .iter()
                .position(|id| id == &p.id)
                .unwrap_or(usize::MAX),
            p.name.clone(),
        )
    });
    let mut projects = Vec::new();
    for definition in definitions {
        let bindings: HashMap<String, String> = if let Some(db) = &projects_db {
            db.prepare("SELECT repository_id,path FROM repository_paths WHERE project_id=?")?
                .query_map([&definition.id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?
        } else {
            HashMap::new()
        };
        let mut repositories: Vec<_> = definition
            .repositories
            .iter()
            .filter_map(|r| {
                bindings
                    .get(&r.id)
                    .map(|path| (r.name.clone(), path.clone()))
            })
            .collect();
        if let Some(order) = workspace_json["repositoryOrder"].as_array() {
            repositories.sort_by_key(|(_, path)| {
                order.iter().position(|v| v == path).unwrap_or(usize::MAX)
            });
        }
        let managed = root.join("projects").join(&definition.id);
        let panes: Vec<Pane> = workspace
            .panes()
            .filter(|p| {
                if let Some(project) = associations.get(&p.id) {
                    return project == &definition.id;
                }
                p.cwd.as_deref().is_some_and(|cwd| {
                    Path::new(cwd) == managed || repositories.iter().any(|(_, path)| path == cwd)
                })
            })
            .cloned()
            .collect();
        let group = workspace_json["groups"].as_array().and_then(|groups| {
            groups.iter().find(|g| {
                g["panes"].as_array().is_some_and(|ps| {
                    ps.iter()
                        .any(|p| panes.iter().any(|pane| p["id"] == pane.id))
                })
            })
        });
        let group_id = group.and_then(|g| g["id"].as_str()).unwrap_or("default");
        let key = serde_json::json!([group_id, definition.id]).to_string();
        let dock = value(&format!("native-workspace-dock:{key}"))?
            .or(value(&format!("native-workspace-dock:{group_id}"))?)
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or(serde_json::Value::Null);
        projects.push(Project {
            id: Some(definition.id),
            dock_workspace: Some((key, group_id.to_owned())),
            dock,
            name: definition.name,
            repositories,
            panes,
        });
    }
    let unassigned: Vec<_> = workspace
        .panes()
        .filter(|pane| {
            !projects
                .iter()
                .any(|p| p.panes.iter().any(|p| p.id == pane.id))
        })
        .cloned()
        .collect();
    if !unassigned.is_empty() || projects.is_empty() {
        let group = workspace_json["groups"].as_array().and_then(|groups| {
            groups
                .iter()
                .find(|g| g["id"] == workspace_json["selectedGroupId"])
                .or_else(|| groups.first())
        });
        let group_id = group.and_then(|g| g["id"].as_str()).unwrap_or("default");
        let key = serde_json::json!([group_id, ""]).to_string();
        let dock = value(&format!("native-workspace-dock:{key}"))?
            .or(value(&format!("native-workspace-dock:{group_id}"))?)
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or(serde_json::Value::Null);
        projects.push(Project {
            id: None,
            name: "Other chats".into(),
            dock,
            dock_workspace: Some((key, group_id.to_owned())),
            repositories: vec![],
            panes: unassigned,
        });
    }
    let selected_project = projects
        .iter()
        .position(|project| {
            selected
                .as_deref()
                .is_some_and(|selected| project.id.as_deref().unwrap_or_default() == selected)
        })
        .unwrap_or(0);
    let defaults: serde_json::Value = value("inferay-default-chat-settings")?
        .map(|v| serde_json::from_str(&v))
        .transpose()?
        .unwrap_or_default();
    let mut drafts = HashMap::new();
    let mut chat_settings = HashMap::new();
    for pane in workspace.panes() {
        drafts.insert(
            pane.id.clone(),
            value(&format!("inferay-chat-input-{}", pane.id))?.unwrap_or_default(),
        );
        chat_settings.insert(
            pane.id.clone(),
            inferay_core::provider_config::resolve(&serde_json::json!({
                "agentKind": pane.agent_kind,
                "model": value(&format!("inferay-chat-model-{}", pane.id))?,
                "reasoningLevel": value(&format!("inferay-chat-reasoning-{}", pane.id))?,
                "defaults": defaults,
            })),
        );
    }
    Ok(Session {
        default_config: inferay_core::provider_config::resolve(
            &serde_json::json!({"defaults":defaults}),
        ),
        sidebar_width: inferay_presentation::appearance::sidebar_resize(
            &serde_json::json!({"stored": value("main-sidebar-width")?}),
        )
        .width as f32,
        zoom: crate::zoom::Zoom::restore(value("inferay-ui-zoom-percent")?.as_deref()),
        sidebar_collapsed: value("sidebar-collapsed")?.as_deref() == Some("true"),
        closed_projects: value("inferay-closed-project-tabs")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default(),
        closed_repositories: value("inferay-closed-repositories")?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default(),
        drafts,
        chat_settings,
        projects,
        selected_project,
        selected_pane: workspace.selected_pane_id().map(str::to_owned),
        background: value("inferay-app-background")?
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or_default(),
        font: value("inferay-app-font")?.unwrap_or_else(|| "vscode".into()),
        syntax_theme: value("inferay-syntax-highlight-theme")?
            .unwrap_or_else(|| "vscode-black".into()),
        graph_preferences: value("commit-graph-columns-v13:global")?
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or_default(),
    })
}
pub fn transcript(
    root: &Path,
    pane: &str,
    limit: usize,
) -> Result<(usize, Vec<ChatTranscriptMessage>)> {
    let path = root.join("chat.sqlite3");
    if !path.exists() {
        return Ok((0, Vec::new()));
    }
    let mut db = open(&path)?;
    let tx = db.transaction()?;
    let count: i64 = tx.query_row(
        "SELECT count(*) FROM transcript_messages WHERE pane=?",
        [pane],
        |r| r.get(0),
    )?;
    let messages = tx.prepare("SELECT body FROM (SELECT position,body FROM transcript_messages WHERE pane=? ORDER BY position DESC LIMIT ?) ORDER BY position")?
        .query_map(rusqlite::params![pane,i64::try_from(limit)?], |r| r.get::<_,String>(0))?
        .map(|r| Ok(serde_json::from_str(&r?)?)).collect::<Result<_>>()?;
    let mut buffer = inferay_core::chat_protocol::ChatMessageBuffer::default();
    buffer.replace_messages(messages);
    Ok((usize::try_from(count)?, buffer.messages().to_vec()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn empty_profile_opens_without_creating_stores() {
        let root = tempfile::tempdir().unwrap();
        let session = super::load(root.path()).unwrap();
        assert_eq!(session.projects.len(), 1);
        assert_eq!(session.font, "vscode");
        assert_eq!(
            super::transcript(root.path(), "new-pane", 200).unwrap().0,
            0
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
    use super::*;
    use serde_json::json;

    #[test]
    fn restores_other_chats_layout() -> Result<()> {
        let root = tempfile::tempdir()?;
        let workspace = json!({"groups":[{"id":"g","name":"Workspace","columns":2,"rows":1,"selectedPaneId":"p","panes":[
            {"id":"p","title":"Chat","agentKind":"codex","pendingCwd":false}
        ]}],"selectedGroupId":"g"});
        std::fs::write(root.path().join("agent-state.json"), workspace.to_string())?;
        let prefs = Connection::open(root.path().join("client-storage.sqlite3"))?;
        prefs.execute_batch("CREATE TABLE entries(key TEXT PRIMARY KEY,value TEXT);")?;
        let dock = json!({"tree":{"type":"panel","id":"p"},"preset":["grid",2]});
        prefs.execute(
            "INSERT INTO entries VALUES(?,?)",
            rusqlite::params![
                "native-workspace-dock:[\"g\",\"\"]",
                json!(dock.to_string()).to_string()
            ],
        )?;
        let session = load(root.path())?;
        assert_eq!(session.projects[0].id, None);
        assert_eq!(session.projects[0].dock, dock);
        assert_eq!(
            session.projects[0].dock_workspace,
            Some((json!(["g", ""]).to_string(), "g".into()))
        );
        Ok(())
    }

    #[test]
    fn restores_order_membership_and_selected_chat_without_writing() -> Result<()> {
        let root = tempfile::tempdir()?;
        let root = root.path();
        for (id, name) in [("a", "Alpha"), ("b", "Beta")] {
            std::fs::create_dir_all(root.join("projects").join(id))?;
            std::fs::write(root.join("projects").join(id).join("project.json"), json!({
                "schema":"inferay.project/1", "id":id,"name":name,"description":"", "instructions":"", "repositories":[]
            }).to_string())?;
        }
        let workspace = json!({"groups":[{"id":"g","name":"Workspace","columns":2,"rows":1,"selectedPaneId":"p-b","panes":[
            {"id":"p-a","title":"Alpha chat","agentKind":"codex","pendingCwd":false},
            {"id":"p-b","title":"Beta chat","agentKind":"claude","pendingCwd":false}
        ]}],"selectedGroupId":"g"}).to_string();
        std::fs::write(root.join("agent-state.json"), &workspace)?;
        let prefs = Connection::open(root.join("client-storage.sqlite3"))?;
        prefs.execute_batch("CREATE TABLE entries(key TEXT PRIMARY KEY,value TEXT);")?;
        prefs.execute(
            "INSERT INTO entries VALUES(?,?)",
            rusqlite::params!["inferay-project-order", json!("[\"b\",\"a\"]").to_string()],
        )?;
        prefs.execute(
            "INSERT INTO entries VALUES(?,?)",
            rusqlite::params!["inferay-selected-project-id", json!("b").to_string()],
        )?;
        let dock = json!({"tree":{"type":"panel","id":"p-b"},"preset":["grid",3]});
        prefs.execute(
            "INSERT INTO entries VALUES(?,?)",
            rusqlite::params![
                "native-workspace-dock:[\"g\",\"b\"]",
                json!(dock.to_string()).to_string()
            ],
        )?;
        for (key, stored) in [
            ("inferay-chat-input-p-b", json!("unfinished\ndraft")),
            ("inferay-chat-model-p-b", json!(null)),
            ("inferay-app-font", json!("vscode")),
            ("main-sidebar-width", json!("240")),
            ("sidebar-collapsed", json!("true")),
        ] {
            prefs.execute(
                "INSERT INTO entries VALUES(?,?)",
                rusqlite::params![key, stored.to_string()],
            )?;
        }
        let projects = Connection::open(root.join("projects.sqlite3"))?;
        projects.execute_batch("CREATE TABLE project_conversations(pane_id TEXT,project_id TEXT); CREATE TABLE repository_paths(project_id TEXT,repository_id TEXT,path TEXT); INSERT INTO project_conversations VALUES('p-a','a'),('p-b','b');")?;
        let chat = Connection::open(root.join("chat.sqlite3"))?;
        chat.execute_batch(
            "CREATE TABLE transcript_messages(pane TEXT,position INTEGER,body TEXT);",
        )?;
        for position in 0..3 {
            chat.execute("INSERT INTO transcript_messages VALUES(?,?,?)", rusqlite::params!["p-b",position,json!({"id":position.to_string(),"role":"user","content":format!("message {position}")}).to_string()])?;
        }
        let session = load(root)?;
        assert_eq!(
            session
                .projects
                .iter()
                .map(|p| p.name.as_str())
                .collect::<Vec<_>>(),
            ["Beta", "Alpha"]
        );
        assert_eq!(session.sidebar_width, 240.);
        assert!(session.sidebar_collapsed);
        assert_eq!(session.font, "vscode");
        assert_eq!(session.drafts["p-b"], "unfinished\ndraft");
        assert_eq!(session.chat_settings["p-b"].agent_kind.as_str(), "claude");
        assert_eq!(session.selected_project, 0);
        assert_eq!(session.projects[0].dock, dock);
        assert_eq!(session.selected_pane.as_deref(), Some("p-b"));
        assert_eq!(session.projects[0].panes[0].id, "p-b");
        assert_eq!(session.projects[1].panes[0].id, "p-a");
        let (total, messages) = transcript(root, "p-b", 2)?;
        assert_eq!(total, 3);
        assert_eq!(
            messages
                .iter()
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>(),
            ["message 1", "message 2"]
        );
        assert_eq!(
            std::fs::read_to_string(root.join("agent-state.json"))?,
            workspace
        );
        assert!(
            open(&root.join("chat.sqlite3"))?
                .execute("DELETE FROM transcript_messages", [])
                .is_err()
        );
        Ok(())
    }
}
