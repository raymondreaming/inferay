//! Appearance choices and saved background migrations share one native model.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum AppThemeId {
    #[default]
    Default,
    Midnight,
}

#[derive(Clone, Copy, Default, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum AppBackgroundId {
    City,
    Nature,
    Orbit,
    Signals,
    Custom,
    #[default]
    None,
}

#[derive(Clone, Copy, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum AppBackgroundMode {
    Solid,
    Scene,
    Glass,
}

#[derive(Clone, Copy, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum AppFontId {
    Vscode,
    Menlo,
    Geist,
    Inter,
    Manrope,
    IbmPlexSans,
    System,
}

#[derive(Deserialize, Serialize, ts_rs::TS)]
pub struct AgentTheme {
    pub cursor: String,
    pub separator: String,
}

#[derive(Deserialize, Serialize, ts_rs::TS)]
pub struct AppTheme {
    pub id: AppThemeId,
    pub name: String,
    pub theme: AgentTheme,
}

#[derive(Deserialize, Serialize, ts_rs::TS)]
pub struct AppBackground {
    pub id: AppBackgroundId,
    pub name: String,
    pub path: Option<String>,
}

#[derive(Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AppFont {
    pub id: AppFontId,
    pub label: String,
    pub family: String,
    #[serde(default)]
    pub editor_family: Option<String>,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AppBackgroundSettings {
    #[ts(type = "7")]
    pub version: u8,
    pub mode: AppBackgroundMode,
    pub id: AppBackgroundId,
    pub dim: f64,
    pub blur: f64,
    pub glass_blur: f64,
    pub glass_opacity: f64,
    pub auto_theme: bool,
    pub custom_revision: f64,
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceCatalog {
    pub themes: Vec<AppTheme>,
    pub backgrounds: Vec<AppBackground>,
    pub fonts: Vec<AppFont>,
    pub default_background: AppBackgroundSettings,
}

pub fn catalog() -> AppearanceCatalog {
    AppearanceCatalog {
        themes: serde_json::from_value(json!([
            {"id":"default","name":"Black","theme":{"cursor":"#007AFF","separator":"#111111"}},
            {"id":"midnight","name":"Midnight","theme":{"cursor":"#6e8cff","separator":"#1e1f21"}}
        ])).expect("static themes"),
        backgrounds: serde_json::from_value(json!([
            {"id":"city","name":"City rain","path":"/background-city-rain.png"},
            {"id":"nature","name":"Night garden","path":"/background-nature-sanctuary.png"},
            {"id":"orbit","name":"Orbital study","path":"/background-orbital-study.png"},
            {"id":"signals","name":"Signal field","path":"/inferay-vibespace.png"}
        ])).expect("static backgrounds"),
        fonts: serde_json::from_value(json!([
            {"id":"vscode","label":"System UI + Menlo","family":"-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif","editorFamily":"Menlo, Monaco, \"Courier New\", monospace"},
            {"id":"menlo","label":"Menlo","family":"Menlo, Monaco, \"Courier New\", monospace"},
            {"id":"geist","label":"Geist","family":"\"Geist\", sans-serif"},
            {"id":"inter","label":"Inter","family":"\"Inter\", sans-serif"},
            {"id":"manrope","label":"Manrope","family":"\"Manrope\", sans-serif"},
            {"id":"ibm-plex-sans","label":"IBM Plex Sans","family":"\"IBM Plex Sans\", sans-serif"},
            {"id":"system","label":"System","family":"-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"}
        ])).expect("static fonts"),
        default_background: normalize_background(&Value::Null),
    }
}

pub fn normalize_background(stored: &Value) -> AppBackgroundSettings {
    let clamp = |key: &str, min: f64, max: f64, fallback| {
        stored
            .get(key)
            .and_then(Value::as_f64)
            .unwrap_or(fallback)
            .clamp(min, max)
    };
    let version = stored["version"].as_f64();
    let id = serde_json::from_value::<AppBackgroundId>(stored["id"].clone()).unwrap_or_default();
    let mode =
        serde_json::from_value(stored["mode"].clone()).unwrap_or(if id == AppBackgroundId::None {
            AppBackgroundMode::Solid
        } else {
            AppBackgroundMode::Scene
        });
    let blur = clamp("blur", 0.0, 20.0, 1.0);
    AppBackgroundSettings {
        version: 7,
        mode,
        id,
        dim: clamp("dim", 0.0, 85.0, 42.0),
        blur: if matches!(version, Some(2.0 | 3.0)) {
            blur
        } else {
            blur.min(1.0)
        },
        glass_blur: if version == Some(7.0) {
            clamp("glassBlur", 0.0, 40.0, 7.0)
        } else {
            7.0
        },
        glass_opacity: if version == Some(7.0) {
            clamp("glassOpacity", 8.0, 100.0, 83.0)
        } else {
            83.0
        },
        auto_theme: stored["autoTheme"].as_bool().unwrap_or(false),
        custom_revision: clamp("customRevision", 0.0, 9_007_199_254_740_991.0, 0.0),
    }
}

#[derive(Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundModel {
    background: AppBackgroundSettings,
    scenes: Vec<AppBackground>,
    background_url: Option<String>,
    theme_id: AppThemeId,
}

pub fn background_model(input: &Value) -> BackgroundModel {
    let mut saved = serde_json::to_value(normalize_background(&input["stored"])).unwrap();
    if let Some(patch) = input["patch"].as_object() {
        saved.as_object_mut().unwrap().extend(patch.clone());
        if patch.contains_key("customRevision") {
            saved["id"] = json!("custom");
        }
        if patch.contains_key("mode")
            || patch.contains_key("id")
            || patch.contains_key("customRevision")
        {
            saved["autoTheme"] = json!(false);
        }
    }
    let background = normalize_background(&saved);
    let mut scenes = catalog().backgrounds;
    scenes.push(AppBackground {
        id: AppBackgroundId::Custom,
        name: "Your image".into(),
        path: (background.custom_revision > 0.).then(|| {
            format!(
                "/api/config/background-image?v={}",
                background.custom_revision
            )
        }),
    });
    let background_url = if matches!(background.mode, AppBackgroundMode::Scene) {
        scenes
            .iter()
            .find(|scene| scene.id == background.id)
            .and_then(|scene| scene.path.clone())
    } else {
        None
    };
    let theme_id = if input["patch"].get("mode").is_some() || input["themeId"] != "midnight" {
        AppThemeId::Default
    } else {
        AppThemeId::Midnight
    };
    BackgroundModel {
        background,
        scenes,
        background_url,
        theme_id,
    }
}

pub fn normalize_background_settings(text: &str) -> String {
    serde_json::to_string(&normalize_background(
        &serde_json::from_str(text).unwrap_or(Value::Null),
    ))
    .expect("background serialization")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_choices_and_uploads_share_normalized_policy() {
        let initial =
            serde_json::to_value(background_model(&json!({"themeId":"midnight"}))).unwrap();
        assert_eq!(initial["themeId"], "midnight");
        assert!(initial["scenes"].as_array().unwrap().last().unwrap()["path"].is_null());
        let uploaded = serde_json::to_value(background_model(&json!({
            "stored":{"version":7,"mode":"scene","id":"city","autoTheme":true},
            "themeId":"midnight","patch":{"customRevision":42,"dim":500}
        })))
        .unwrap();
        assert_eq!(uploaded["background"]["id"], "custom");
        assert_eq!(uploaded["background"]["autoTheme"], false);
        assert_eq!(uploaded["background"]["dim"], 85.0);
        assert_eq!(
            uploaded["backgroundUrl"],
            "/api/config/background-image?v=42"
        );
        assert_eq!(uploaded["themeId"], "midnight");
        let switched = serde_json::to_value(background_model(&json!({
            "stored":uploaded["background"],"themeId":"midnight","patch":{"mode":"glass"}
        })))
        .unwrap();
        assert_eq!(switched["themeId"], "default");
        assert!(switched["backgroundUrl"].is_null());
        let selected = serde_json::to_value(background_model(&json!({
            "stored":{"version":7,"mode":"scene","autoTheme":true}, "patch":{"id":"nature"}
        })))
        .unwrap();
        assert_eq!(
            selected["backgroundUrl"],
            "/background-nature-sanctuary.png"
        );
        assert_eq!(selected["background"]["autoTheme"], false);
    }

    #[test]
    fn migrates_old_backgrounds_without_reusing_obsolete_glass_values() {
        let settings = normalize_background(&json!({
            "version": 3, "id": "city", "blur": 12, "glassBlur": 32, "glassOpacity": 20
        }));
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(value["mode"], "scene");
        assert_eq!(value["blur"], 12.);
        assert_eq!(value["glassBlur"], 7.);
        assert_eq!(value["glassOpacity"], 83.);
        assert_eq!(value["version"], 7);
    }

    #[test]
    fn current_backgrounds_validate_choices_and_clamp_saved_values() {
        let value = serde_json::to_value(normalize_background(&json!({
            "version":7, "id":"unknown", "mode":"invalid", "dim":120,
            "blur":14, "glassBlur":100, "glassOpacity":0, "customRevision":-2
        })))
        .unwrap();
        assert_eq!(value["id"], "none");
        assert_eq!(value["mode"], "solid");
        assert_eq!(value["dim"], 85.);
        assert_eq!(value["blur"], 1.);
        assert_eq!(value["glassBlur"], 40.);
        assert_eq!(value["glassOpacity"], 8.);
        assert_eq!(value["customRevision"], 0.);
    }

    #[test]
    fn invalid_preferences_use_the_same_defaults_as_the_catalog() {
        assert_eq!(
            normalize_background_settings("not json"),
            serde_json::to_string(&catalog().default_background).unwrap()
        );
    }
}
