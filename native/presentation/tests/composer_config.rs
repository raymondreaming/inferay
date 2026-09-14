use inferay_presentation::project;
use serde_json::json;

#[test]
fn provider_controls_use_catalog_labels_and_keep_full_model_tooltips() {
    let controls = project("composerConfig", &json!({
        "agentKind":"codex", "model":"astra", "reasoningLevel":"high",
        "agentKindOptions":[{"id":"codex","label":"Codex"}],
        "definition":{"label":"Codex","models":[{"id":"astra","label":"GPT Astra","shortLabel":"Astra"}],
            "reasoningLevels":[{"id":"high","label":"High"}]}
    })).unwrap();
    assert_eq!(controls[0]["agentKind"], "codex");
    assert_eq!(controls[0]["value"], "codex");
    assert_eq!(controls[1]["label"], "Astra");
    assert_eq!(controls[1]["tooltip"], "GPT Astra");
    assert_eq!(controls[2]["label"], "High");
    assert!(controls[1]["agentKind"].is_null());
}

#[test]
fn unavailable_controls_are_omitted_and_unknown_values_remain_visible() {
    let mut input = json!({"agentKind":"agent", "model":"custom", "reasoningLevel":"custom-level",
        "agentKindOptions":[], "definition":{"label":"Agent","models":[],"reasoningLevels":[]}});
    assert_eq!(
        project("composerConfig", &input)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    input["definition"]["models"] = json!([{"id":"known","label":"Known"}]);
    input["definition"]["reasoningLevels"] = json!([{"id":"high","label":"High"}]);
    let controls = project("composerConfig", &input).unwrap();
    assert_eq!(controls[1]["label"], "custom");
    assert_eq!(controls[1]["tooltip"], "custom");
    assert_eq!(controls[2]["label"], "custom-level");
    input["model"] = json!("");
    assert_eq!(
        project("composerConfig", &input).unwrap()[1]["label"],
        "No model"
    );
}
