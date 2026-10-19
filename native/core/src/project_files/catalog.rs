//! Derived catalog relationships. Definitions remain the authoritative facts.
use super::*;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepositoryChange {
    Add { path: String },
    Relink { id: String, path: String },
    Remove { id: String },
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryUser {
    pub name: String,
    pub automation_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillChoice {
    pub id: String,
    pub label: String,
    pub source: String,
    pub owner_path: String,
    pub qualified_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ToolChoice {
    pub plugin_id: String,
    pub tool_id: String,
    pub label: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PluginOverview {
    pub status: String,
    pub schedules_active: bool,
    pub consumers: BTreeMap<String, String>,
    pub tools: Vec<String>,
    pub issues: Vec<DefinitionIssue>,
    pub latest_run_id: Option<String>,
}

impl ProjectFileCatalog {
    pub fn derive_relationships(&mut self) {
        self.repository_users.clear();
        self.skill_choices.clear();
        self.tool_choices.clear();
        self.resource_choices = self
            .resources
            .iter()
            .filter(|r| r.error.is_none())
            .filter_map(|r| r.definition.as_ref())
            .filter(|r| !r.archived)
            .map(|r| [r.id.clone(), format!("{} · {}", r.name, r.type_id)])
            .collect();
        for file in &self.skills {
            let Some(skill) = file.definition.as_ref().filter(|_| file.error.is_none()) else {
                continue;
            };
            let owner_path = file
                .source_path
                .split('/')
                .take(2)
                .collect::<Vec<_>>()
                .join("/");
            let plugin = self.plugins.iter().find(|p| {
                p.file.project_id == file.project_id
                    && p.file.error.is_none()
                    && p.file
                        .definition
                        .as_ref()
                        .is_some_and(|p| Some(&p.id) == file.plugin_id.as_ref())
            });
            self.skill_choices.push(SkillChoice {
                id: skill.id.clone(),
                label: skill.name.clone(),
                owner_path,
                source: plugin
                    .and_then(|p| p.file.definition.as_ref())
                    .map_or("This automation", |p| p.name.as_str())
                    .into(),
                qualified_id: plugin
                    .and_then(|p| p.file.definition.as_ref())
                    .map(|p| format!("plugin:{}:{}", p.id, skill.id)),
            });
        }
        for file in &self.tools {
            let Some(tool) = &file.definition else {
                continue;
            };
            if let Some(pack) = &tool.pack {
                self.repository_users
                    .entry(pack.repository_id.clone())
                    .or_default()
                    .push(RepositoryUser {
                        name: tool.name.clone(),
                        automation_id: None,
                    });
            }
            if file.error.is_some() {
                continue;
            }
            if let Some(plugin) = self
                .plugins
                .iter()
                .filter(|p| p.file.project_id == file.project_id && p.file.error.is_none())
                .filter_map(|p| p.file.definition.as_ref())
                .find(|p| Some(&p.id) == file.plugin_id.as_ref())
            {
                self.tool_choices.push(ToolChoice {
                    plugin_id: plugin.id.clone(),
                    tool_id: tool.id.clone(),
                    label: format!("{} · {}", plugin.name, tool.name),
                });
            }
        }
        for automation in &self.automations {
            let Some(definition) = &automation.file.definition else {
                continue;
            };
            if let DefinitionExecution::Agent {
                repositories,
                working_directory,
                ..
            } = &definition.execution
            {
                let mut ids: BTreeSet<&String> = repositories.iter().collect();
                if let DefinitionDirectory::Repository { id } = working_directory {
                    ids.insert(id);
                }
                for id in ids {
                    self.repository_users
                        .entry(id.clone())
                        .or_default()
                        .push(RepositoryUser {
                            name: definition.name.clone(),
                            automation_id: Some(definition.id.clone()),
                        });
                }
            }
        }
        for plugin in &mut self.plugins {
            let prefix = plugin
                .file
                .source_path
                .strip_suffix("plugin.json")
                .unwrap_or(&plugin.file.source_path);
            let mut overview = PluginOverview::default();
            let mut changed = plugin.approved_at.is_some() && plugin.approved_hash.is_none();
            let mut own = 0;
            for automation in &self.automations {
                let Some(a) = &automation.file.definition else {
                    continue;
                };
                if a.archived || automation.file.project_id != plugin.file.project_id {
                    continue;
                }
                let inside = automation.file.source_path.starts_with(prefix);
                if inside {
                    own += 1;
                    changed |= automation.inputs_changed;
                    overview.schedules_active |= automation.enabled;
                }
                let references =
                    plugin
                        .file
                        .definition
                        .as_ref()
                        .is_some_and(|p| match &a.execution {
                            DefinitionExecution::Agent { tools, skills, .. } => {
                                tools.iter().any(|t| t.plugin_id == p.id)
                                    || skills
                                        .iter()
                                        .any(|s| s.starts_with(&format!("plugin:{}:", p.id)))
                            }
                            _ => false,
                        });
                if inside || references {
                    overview.consumers.insert(a.id.clone(), a.name.clone());
                }
            }
            overview.tools = self
                .tools
                .iter()
                .filter(|t| {
                    t.project_id == plugin.file.project_id
                        && t.source_path.starts_with(prefix)
                        && t.error.is_none()
                })
                .filter_map(|t| t.definition.as_ref().map(|t| t.name.clone()))
                .collect();
            overview.issues = self
                .issues
                .iter()
                .filter(|i| {
                    i.project_id == plugin.file.project_id && i.source_path.starts_with(prefix)
                })
                .cloned()
                .collect();
            overview.status = if !overview.issues.is_empty() {
                "Needs repair"
            } else if changed {
                "Changed · Review required"
            } else if overview.schedules_active {
                "Schedules active"
            } else if own > 0 {
                "Schedules off"
            } else {
                "Reusable library"
            }
            .into();
            plugin.overview = overview;
        }
    }
}
