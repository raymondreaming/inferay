//! Skill library selection and editing; browser code owns dialogs and requests.
use inferay_core::prompts::{Prompt, filter_prompts, library::PromptLibrary};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[derive(Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillFormState {
    name: String,
    command: String,
    description: String,
    prompt_template: String,
    error: String,
    is_saving: bool,
    is_editing: bool,
    is_creating: bool,
}
impl SkillFormState {
    fn from_prompt(prompt: &Prompt) -> Self {
        Self {
            name: prompt.name.clone(),
            command: prompt.command.clone(),
            description: prompt.description.clone(),
            prompt_template: prompt.prompt_template.clone(),
            ..Self::default()
        }
    }
    fn fields(&self) -> Value {
        json!({"name":self.name,"command":self.command,"description":self.description,"promptTemplate":self.prompt_template})
    }
}
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillEditorView {
    form: SkillFormState,
    busy: bool,
    editing: bool,
    deleting: bool,
    can_edit: bool,
    can_delete: bool,
    badge: &'static str,
    save_label: &'static str,
}
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillLibraryRow {
    #[serde(rename = "_id")]
    id: String,
    command: String,
    description: String,
    is_built_in: bool,
    active: bool,
}
#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SkillDialogView {
    rows: Vec<SkillLibraryRow>,
    editor: SkillEditorView,
    dirty: bool,
    show_editor: bool,
    built_in: bool,
    delete_confirmation: Option<String>,
}
#[derive(Serialize, ts_rs::TS)]
pub struct SkillSaveRequest {
    id: Option<String>,
    body: Value,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Action {
    Select { id: String },
    Create,
    Edit,
    Duplicate,
    Cancel,
    Field { field: String, value: String },
    Saved { id: String },
    Deleted,
    Failed { message: String },
}
#[wasm_bindgen]
pub struct SkillDialogReplica {
    target: Option<Value>,
    skills: Vec<Prompt>,
    selected: Option<String>,
    form: SkillFormState,
    deleting: bool,
}
#[wasm_bindgen]
impl SkillDialogReplica {
    #[wasm_bindgen(constructor)]
    pub fn new(target: &str) -> Result<Self, JsValue> {
        Ok(Self {
            target: Some(serde_json::from_str(target).map_err(error)?),
            skills: vec![],
            selected: None,
            form: SkillFormState::default(),
            deleting: false,
        })
    }
    pub fn receive(&mut self, library: &str) -> Result<(), JsValue> {
        self.skills = serde_json::from_str(library).map_err(error)?;
        if let Some(target) = self.target.take() {
            match target["mode"].as_str() {
                Some("create") => self.form.is_creating = true,
                Some("browse") => self.selected = self.skills.first().map(|skill| skill.id.clone()),
                _ => {
                    self.selected = self
                        .skills
                        .iter()
                        .find(|skill| target["skillId"] == skill.id)
                        .map(|skill| skill.id.clone());
                    if let Some(skill) = self.selected_skill() {
                        if !skill.is_built_in {
                            self.form = SkillFormState {
                                is_editing: true,
                                ..SkillFormState::from_prompt(skill)
                            };
                        }
                    } else {
                        self.form.error = "This skill is no longer available.".into();
                    }
                }
            }
        }
        Ok(())
    }
    pub fn dispatch(&mut self, action: &str) -> Result<(), JsValue> {
        let action: Action = serde_json::from_str(action).map_err(error)?;
        if self.busy()
            && !matches!(
                action,
                Action::Saved { .. } | Action::Deleted | Action::Failed { .. }
            )
        {
            return Ok(());
        }
        match action {
            Action::Select { id } => {
                self.selected = self
                    .skills
                    .iter()
                    .find(|skill| skill.id == id)
                    .map(|skill| skill.id.clone());
                self.form = SkillFormState::default();
            }
            Action::Create => {
                self.selected = None;
                self.form = SkillFormState {
                    is_creating: true,
                    ..Default::default()
                };
            }
            Action::Edit => {
                if let Some(skill) = self.selected_skill().filter(|skill| !skill.is_built_in) {
                    self.form = SkillFormState {
                        is_editing: true,
                        ..SkillFormState::from_prompt(skill)
                    };
                }
            }
            Action::Duplicate => {
                if let Some(skill) = self.selected_skill() {
                    let mut form = SkillFormState::from_prompt(skill);
                    form.name.push_str(" copy");
                    form.command.push_str("-custom");
                    form.is_creating = true;
                    self.form = form;
                    self.selected = None;
                }
            }
            Action::Cancel => self.form = SkillFormState::default(),
            Action::Field { field, value } if self.form.is_editing || self.form.is_creating => {
                match field.as_str() {
                    "name" => self.form.name = value,
                    "command" => {
                        self.form.command = value
                            .to_lowercase()
                            .chars()
                            .filter(|ch| {
                                ch.is_ascii_lowercase() || ch.is_ascii_digit() || *ch == '-'
                            })
                            .collect()
                    }
                    "description" => self.form.description = value,
                    "promptTemplate" => self.form.prompt_template = value,
                    _ => {}
                }
            }
            Action::Saved { id } => {
                self.selected = Some(id);
                self.form = SkillFormState::default();
            }
            Action::Deleted => {
                self.selected = None;
                self.form = SkillFormState::default();
                self.deleting = false;
            }
            Action::Failed { message } => {
                self.form.error = message;
                self.form.is_saving = false;
                self.deleting = false;
            }
            _ => {}
        }
        Ok(())
    }
    pub fn save_request(&mut self) -> Option<String> {
        if self.busy() || !(self.form.is_creating || self.form.is_editing) {
            return None;
        }
        let body = self.form.fields();
        let mut library = PromptLibrary::new(self.skills.clone());
        let id = if self.form.is_editing {
            self.selected.clone()
        } else {
            None
        };
        let result = match id.as_deref() {
            Some(id) => library.update(id, body.as_object().unwrap(), 0),
            None if self.form.is_creating => library.create(body.as_object().unwrap(), 0),
            _ => return None,
        };
        match result {
            Ok(prompt) => {
                self.form.error.clear();
                self.form.is_saving = true;
                Some(
                    json!(SkillSaveRequest {
                        id,
                        body: SkillFormState::from_prompt(&prompt).fields()
                    })
                    .to_string(),
                )
            }
            Err(error) => {
                self.form.error = error.message;
                None
            }
        }
    }
    pub fn delete_request(&mut self) -> Option<String> {
        if self.busy() {
            return None;
        }
        let id = self
            .selected_skill()
            .filter(|skill| !skill.is_built_in)?
            .id
            .clone();
        self.deleting = true;
        self.form.error.clear();
        Some(id)
    }
    pub fn snapshot(&self, search: &str) -> String {
        json!(self.view(search)).to_string()
    }
}
fn error(error: serde_json::Error) -> JsValue {
    JsValue::from_str(&error.to_string())
}
impl SkillDialogReplica {
    fn selected_skill(&self) -> Option<&Prompt> {
        self.skills
            .iter()
            .find(|skill| Some(&skill.id) == self.selected.as_ref())
    }
    fn busy(&self) -> bool {
        self.form.is_saving || self.deleting
    }
    fn view(&self, search: &str) -> SkillDialogView {
        let selected = self.selected_skill();
        let editing = self.form.is_creating || self.form.is_editing;
        let built_in = selected.is_some_and(|skill| skill.is_built_in);
        let editable = selected.is_some() && !built_in;
        let original = if self.form.is_editing {
            selected
                .map(SkillFormState::from_prompt)
                .unwrap_or_default()
        } else {
            SkillFormState::default()
        };
        let mut display = self.form.clone();
        if !editing && let Some(skill) = selected {
            display = SkillFormState {
                error: self.form.error.clone(),
                ..SkillFormState::from_prompt(skill)
            };
        }
        SkillDialogView {
            rows: filter_prompts(&self.skills, "all", search)
                .into_iter()
                .map(|skill| SkillLibraryRow {
                    id: skill.id.clone(),
                    command: skill.command.clone(),
                    description: if skill.description.is_empty() {
                        skill.name.clone()
                    } else {
                        skill.description.clone()
                    },
                    is_built_in: skill.is_built_in,
                    active: !self.form.is_creating && Some(&skill.id) == self.selected.as_ref(),
                })
                .collect(),
            dirty: editing && self.form.fields() != original.fields(),
            show_editor: selected.is_some() || self.form.is_creating,
            built_in: built_in && !self.form.is_creating,
            delete_confirmation: (editable && !self.form.is_creating)
                .then(|| format!("Delete /{}?", selected.unwrap().command)),
            editor: SkillEditorView {
                form: display,
                busy: self.busy(),
                editing,
                deleting: self.deleting,
                can_edit: editable && !editing,
                can_delete: editable && !self.form.is_creating,
                badge: if self.form.is_creating {
                    "Draft"
                } else if built_in {
                    "Built-in"
                } else {
                    "Personal"
                },
                save_label: if self.form.is_saving {
                    "Saving…"
                } else if self.form.is_creating {
                    "Create skill"
                } else {
                    "Save changes"
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> String {
        json!([
            {"_id":"builtin","name":"Review","command":"review","description":"Inspect changes","promptTemplate":"Review carefully","isBuiltIn":true,"createdAt":1,"updatedAt":1},
            {"_id":"personal","name":"Notes","command":"notes","description":"Write notes","promptTemplate":"Remember details","isBuiltIn":false,"createdAt":2,"updatedAt":2}
        ]).to_string()
    }
    fn open(target: Value) -> SkillDialogReplica {
        let mut model = SkillDialogReplica::new(&target.to_string()).unwrap();
        model.receive(&library()).unwrap();
        model
    }
    fn action(model: &mut SkillDialogReplica, input: Value) {
        model.dispatch(&input.to_string()).unwrap();
    }

    #[test]
    fn edits_survive_library_refresh_and_save_uses_core_validation() {
        let mut model = open(json!({"mode":"edit","skillId":"personal"}));
        assert!(!model.view("").dirty);
        action(
            &mut model,
            json!({"type":"field","field":"command","value":" /MY_new! "}),
        );
        assert_eq!(model.form.command, "mynew");
        action(
            &mut model,
            json!({"type":"field","field":"promptTemplate","value":"  Updated instructions  "}),
        );
        model.receive(&library()).unwrap();
        assert!(model.view("").dirty);
        let request: Value = serde_json::from_str(&model.save_request().unwrap()).unwrap();
        assert_eq!(request["id"], "personal");
        assert_eq!(request["body"]["promptTemplate"], "Updated instructions");
        assert!(model.view("").editor.busy);
        action(&mut model, json!({"type":"create"}));
        assert!(!model.form.is_creating);
        assert!(model.save_request().is_none());
        action(&mut model, json!({"type":"failed","message":"Offline"}));
        assert!(!model.view("").editor.busy);
        assert_eq!(model.form.error, "Offline");
        assert_eq!(model.form.prompt_template, "  Updated instructions  ");
    }

    #[test]
    fn invalid_drafts_remain_editable_and_cancellation_discards_their_errors() {
        let mut model = open(json!({"mode":"create"}));
        assert!(!model.view("").dirty);
        assert!(model.save_request().is_none());
        assert_eq!(
            model.form.error,
            "Name, command, and instructions are required"
        );
        assert!(!model.view("").editor.busy);
        action(&mut model, json!({"type":"cancel"}));
        assert!(model.form.error.is_empty());
        assert!(!model.view("").show_editor);
    }
}
