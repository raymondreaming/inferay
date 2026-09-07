use crate::{array, flag, string};
use serde_json::{Value, json};

#[derive(Default, serde::Serialize, ts_rs::TS)]
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
pub fn empty() -> Value {
    json!(SkillFormState::default())
}
pub fn edit(skill: &Value) -> Value {
    json!({"isEditing":true,"name":skill["name"],"command":skill["command"],"description":skill["description"],"promptTemplate":skill["promptTemplate"],"error":""})
}
pub fn duplicate(skill: &Value) -> Value {
    let mut form = empty();
    form["isCreating"] = json!(true);
    form["name"] = json!(format!("{} copy", string(&skill["name"])));
    form["command"] = json!(format!("{}-custom", string(&skill["command"])));
    for field in ["description", "promptTemplate"] {
        form[field] = skill[field].clone();
    }
    form
}
pub fn dialog(i: &Value) -> Value {
    let mut form = empty();
    match string(&i["target"]["mode"]) {
        "create" => {
            form["isCreating"] = json!(true);
            json!({"selectedId":null,"form":form})
        }
        "browse" => json!({"selectedId":i["skills"][0]["_id"],"form":form}),
        _ => {
            if let Some(skill) = array(&i["skills"])
                .iter()
                .find(|s| s["_id"] == i["target"]["skillId"])
            {
                json!({"selectedId":skill["_id"],"form":if flag(&skill["isBuiltIn"]) { form } else { edit(skill) }})
            } else {
                form["error"] = json!("This skill is no longer available.");
                json!({"selectedId":null,"form":form})
            }
        }
    }
}
pub fn dirty(i: &Value) -> Value {
    let form = &i["form"];
    json!(
        (flag(&form["isCreating"]) || flag(&form["isEditing"]))
            && ["name", "command", "description", "promptTemplate"]
                .iter()
                .any(|field| string(&form[field]) != string(&i["original"][field]))
    )
}
