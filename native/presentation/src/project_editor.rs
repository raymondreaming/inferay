//! Editor validation shares the authoritative native rules.
use inferay_core::project_files::{
    AutomationDefinition, DefinitionDirectory, DefinitionExecution, Overlap, Trigger,
};
use serde::Deserialize;
use ts_rs::TS;

#[derive(Deserialize, TS)]
pub struct ProposalPath {
    pub path: String,
    #[serde(default)]
    pub removal: bool,
}

pub fn proposal_path(input: ProposalPath) -> Result<String, String> {
    let path = input.path.trim();
    inferay_core::project_files::relative_path(path)?;
    if path.split('/').any(|part| part == ".") {
        return Err("Use a relative file path inside this library.".into());
    }
    if input.removal && path == "plugin.json" {
        return Err("The library needs its plugin.json manifest.".into());
    }
    Ok(path.into())
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NewAutomation {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub model: String,
    pub interval_seconds: Option<u64>,
    pub timezone: String,
}
pub fn new_automation(input: NewAutomation) -> AutomationDefinition {
    AutomationDefinition {
        schema: "inferay.automation/1".into(),
        id: input.id,
        name: input.name,
        archived: false,
        may: Default::default(),
        overlap: Overlap::Skip,
        trigger: match input.interval_seconds {
            Some(seconds @ (86400 | 604800)) => Trigger::Calendar {
                timezone: input.timezone,
                days: if seconds == 86400 {
                    (1..=7).collect()
                } else {
                    vec![1]
                },
                times: vec!["09:00".into()],
            },
            Some(seconds) => Trigger::Interval { seconds },
            None => Trigger::Manual,
        },
        execution: DefinitionExecution::Agent {
            provider: "codex".into(),
            model: Some(input.model),
            reasoning_level: Some("low".into()),
            instructions: input.instructions,
            tools: vec![],
            skills: vec![],
            resources: vec![],
            repositories: vec![],
            working_directory: DefinitionDirectory::Project { path: ".".into() },
            timeout_seconds: 300,
        },
    }
}
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TriggerPreset {
    pub trigger: Trigger,
    pub preset: String,
    pub timezone: String,
}
pub fn trigger_preset(input: TriggerPreset) -> Result<Trigger, String> {
    Ok(match input.preset.as_str() {
        "" => Trigger::Manual,
        "3600" => Trigger::Interval { seconds: 3600 },
        "custom" => Trigger::Interval {
            seconds: match input.trigger {
                Trigger::Interval { seconds } => seconds,
                Trigger::Calendar { days, .. } => {
                    if days.len() == 7 {
                        86400
                    } else {
                        604800
                    }
                }
                Trigger::Manual => 3600,
            },
        },
        "86400" | "604800" => {
            let (timezone, days, times) = match input.trigger {
                Trigger::Calendar {
                    timezone,
                    days,
                    times,
                } => (timezone, days, times),
                _ => (input.timezone, vec![1], vec!["09:00".into()]),
            };
            Trigger::Calendar {
                timezone,
                days: if input.preset == "86400" {
                    (1..=7).collect()
                } else {
                    vec![days.first().copied().unwrap_or(1)]
                },
                times,
            }
        }
        _ => return Err("Unknown schedule preset".into()),
    })
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillChoices {
    pub local: Vec<inferay_core::project_files::catalog::SkillChoice>,
    pub global: Vec<(String, String)>,
    pub owner_path: String,
    pub selected: Vec<String>,
}
#[derive(serde::Serialize, TS)]
pub struct SkillOption {
    pub id: String,
    pub label: String,
    pub source: String,
}
pub fn skill_choices(input: SkillChoices) -> Vec<SkillOption> {
    let mut options: Vec<_> = input
        .global
        .into_iter()
        .map(|(id, label)| SkillOption {
            id: format!("global:{id}"),
            label,
            source: "Global".into(),
        })
        .collect();
    for skill in input.local {
        let own = skill.owner_path == input.owner_path;
        if !own && skill.qualified_id.is_none() {
            continue;
        }
        let id = match skill.qualified_id {
            Some(id) if !own || input.selected.contains(&id) => id,
            _ => skill.id,
        };
        options.push(SkillOption {
            id,
            label: skill.label,
            source: skill.source,
        });
    }
    for id in input.selected {
        if !options.iter().any(|option| option.id == id) {
            options.push(SkillOption {
                label: id.clone(),
                id,
                source: "Unavailable skill".into(),
            });
        }
    }
    options
}
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EditToolGrant {
    pub grants: Vec<inferay_core::project_files::AgentToolGrant>,
    pub grant: inferay_core::project_files::AgentToolGrant,
    pub enabled: bool,
}
pub fn edit_tool_grant(
    mut input: EditToolGrant,
) -> Vec<inferay_core::project_files::AgentToolGrant> {
    input.grants.retain(|grant| {
        grant.plugin_id != input.grant.plugin_id || grant.tool_id != input.grant.tool_id
    });
    if input.enabled {
        input.grants.push(input.grant);
    }
    input.grants
}
