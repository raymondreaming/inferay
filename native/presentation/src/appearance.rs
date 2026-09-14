//! Appearance choices and saved background migrations share one native model.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum AppThemeId {
    #[default]
    Default,
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
    #[ts(type = "8")]
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
            {"id":"default","name":"Black","theme":{"cursor":"#007AFF","separator":"#111111"}}
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
        version: 8,
        mode,
        id,
        dim: clamp("dim", 0.0, 85.0, 42.0),
        blur: if matches!(version, Some(2.0 | 3.0)) {
            blur
        } else {
            blur.min(1.0)
        },
        glass_blur: if version == Some(8.0) {
            clamp("glassBlur", 0.0, 60.0, 42.0)
        } else {
            42.0
        },
        glass_opacity: if version == Some(8.0) {
            clamp("glassOpacity", 8.0, 100.0, 70.0)
        } else {
            70.0
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
    let theme_id = AppThemeId::Default;
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
    fn migrates_old_backgrounds_without_reusing_obsolete_glass_values() {
        let settings = normalize_background(&json!({
            "version": 3, "id": "city", "blur": 12, "glassBlur": 32, "glassOpacity": 20
        }));
        let value = serde_json::to_value(settings).unwrap();
        assert_eq!(value["mode"], "scene");
        assert_eq!(value["blur"], 12.);
        assert_eq!(value["glassBlur"], 42.);
        assert_eq!(value["glassOpacity"], 70.);
        assert_eq!(value["version"], 8);
    }

    #[test]
    fn current_backgrounds_validate_choices_and_clamp_saved_values() {
        let value = serde_json::to_value(normalize_background(&json!({
            "version":8, "id":"unknown", "mode":"invalid", "dim":120,
            "blur":14, "glassBlur":100, "glassOpacity":0, "customRevision":-2
        })))
        .unwrap();
        assert_eq!(value["id"], "none");
        assert_eq!(value["mode"], "solid");
        assert_eq!(value["dim"], 85.);
        assert_eq!(value["blur"], 1.);
        assert_eq!(value["glassBlur"], 60.);
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

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DropdownPosition {
    top: f64,
    bottom: f64,
    left: f64,
    width: f64,
    max_h: f64,
    #[ts(type = "'top' | 'bottom'")]
    placement: &'static str,
}
pub fn dropdown_position(input: &serde_json::Value) -> DropdownPosition {
    if !input["rect"].is_object() {
        return DropdownPosition {
            top: 0.,
            bottom: 0.,
            left: 0.,
            width: 0.,
            max_h: 300.,
            placement: "bottom",
        };
    }
    let value = |key: &str| input[key].as_f64().unwrap_or_default();
    let rect = |key: &str| input["rect"][key].as_f64().unwrap_or_default();
    let above = rect("top") - 4.;
    let below = value("height") - rect("bottom") - 4.;
    let top = input["placement"] == "top" || (input["placement"] == "auto" && above > below);
    let count = value("count");
    let visible = if value("maxVisible") > 0. {
        count.min(value("maxVisible"))
    } else {
        count
    };
    let content = (visible * value("rowHeight") + if count > 5. { 38. } else { 0. } + 2.).min(400.);
    let width = rect("width").max(value("minWidth"));
    DropdownPosition {
        top: if top { 0. } else { rect("bottom") + 4. },
        bottom: if top {
            value("height") - rect("top") + 4.
        } else {
            0.
        },
        left: rect("left")
            .max(8.)
            .min((value("width") - width - 8.).max(8.)),
        width,
        max_h: content.min(if top { above } else { below }).max(0.),
        placement: if top { "top" } else { "bottom" },
    }
}

#[derive(Clone, Copy, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SidebarResize {
    pub width: f64,
    pub resizing: bool,
    pub start_x: f64,
    pub start_width: f64,
    pub drag_width: f64,
    pub persist: Option<f64>,
}

pub fn sidebar_resize(input: &Value) -> SidebarResize {
    const DEFAULT_WIDTH: f64 = 292.;
    const MIN_WIDTH: f64 = 188.;
    const MAX_WIDTH: f64 = 340.;
    let clamp = |width: f64| width.clamp(MIN_WIDTH, MAX_WIDTH);
    let Some(state) = input.get("state") else {
        let stored = input["stored"]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite())
            .unwrap_or(DEFAULT_WIDTH);
        return SidebarResize {
            width: clamp(stored),
            resizing: false,
            start_x: 0.,
            start_width: 0.,
            drag_width: 0.,
            persist: None,
        };
    };
    let number = |key: &str| state[key].as_f64().unwrap_or_default();
    let mut next = SidebarResize {
        width: number("width"),
        resizing: state["resizing"].as_bool().unwrap_or(false),
        start_x: number("startX"),
        start_width: number("startWidth"),
        drag_width: number("dragWidth"),
        persist: None,
    };
    match input["action"].as_str().unwrap_or_default() {
        "start"
            if !next.resizing
                && !input["disposed"].as_bool().unwrap_or(false)
                && !input["collapsed"].as_bool().unwrap_or(false)
                && input["button"].as_i64() == Some(0) =>
        {
            next.start_x = input["x"].as_f64().unwrap_or_default();
            next.start_width = next.width;
            next.drag_width = next.width;
            next.resizing = true;
        }
        "move" if next.resizing => {
            next.drag_width =
                clamp(next.start_width + input["x"].as_f64().unwrap_or_default() - next.start_x);
            next.width = next.drag_width;
        }
        "finish" if next.resizing => {
            next.width = next.drag_width;
            next.resizing = false;
            next.persist = Some(next.drag_width);
        }
        "cancel" if next.resizing => {
            next.width = next.start_width;
            next.resizing = false;
        }
        _ => {}
    }
    next
}
