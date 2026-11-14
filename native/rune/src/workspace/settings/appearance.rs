use super::*;
use inferay_presentation::appearance::AppBackgroundId;
use std::sync::LazyLock;

static CITY: &[u8] = include_bytes!("../../../../../public/background-city-rain.png");
static NATURE: &[u8] = include_bytes!("../../../../../public/background-nature-sanctuary.png");
static ORBIT: &[u8] = include_bytes!("../../../../../public/background-orbital-study.png");
static SIGNALS: &[u8] = include_bytes!("../../../../../public/inferay-vibespace.png");

static THUMBNAILS: LazyLock<HashMap<&'static str, rune::Pixels>> = LazyLock::new(|| {
    [
        ("city", CITY),
        ("nature", NATURE),
        ("orbit", ORBIT),
        ("signals", SIGNALS),
    ]
    .into_iter()
    .map(|(id, bytes)| {
        let pixels = rune::Pixels::new();
        let target = pixels.clone();
        std::thread::spawn(move || {
            if let Ok(image) = image::load_from_memory(bytes) {
                let image = image.into_rgba8();
                target.set(image.width(), image.height(), image.into_raw());
            }
        });
        (id, pixels)
    })
    .collect()
});

pub(super) fn scene_bytes(id: AppBackgroundId) -> Option<&'static [u8]> {
    match id {
        AppBackgroundId::City => Some(CITY),
        AppBackgroundId::Nature => Some(NATURE),
        AppBackgroundId::Orbit => Some(ORBIT),
        AppBackgroundId::Signals => Some(SIGNALS),
        _ => None,
    }
}

impl Workspace {
    pub(super) fn appearance_settings(&self) -> El {
        let data = self
            .settings_state
            .data
            .get("appearance")
            .unwrap_or(&Value::Null);
        let background: Value = data["background"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        let settings = inferay_presentation::appearance::normalize_background(&background);
        let catalog = inferay_presentation::appearance::catalog();
        let current_mode = background["mode"].as_str().unwrap_or("solid");
        let font_options = catalog
            .fonts
            .into_iter()
            .map(|font| {
                (
                    serde_json::to_value(font.id)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                        .unwrap_or_default(),
                    font.label,
                )
            })
            .collect();
        let mut modes = row().padding(ui(3.)).radius(ui(6.)).fill(rgba(0xffffff08));
        for (mode, label) in [("solid", "Solid"), ("scene", "Scene"), ("glass", "Glass")] {
            modes = modes.child(
                selected(mode, label, mode == current_mode)
                    .on_press(move |s: &mut Workspace| s.update_background("mode", mode.into())),
            );
        }
        let mut panel = section(
            "Background",
            "Choose a clean solid background, a scene, or desktop glass.",
        )
        .child(setting_row("Style").child(modes));
        if current_mode == "scene" {
            let mut scenes = row().flex_wrap().gap(ui(8.)).py(ui(12.));
            for scene in catalog.backgrounds {
                let id = serde_json::to_value(scene.id).unwrap_or(Value::Null);
                let key = id.as_str().unwrap_or("").to_owned();
                let mut tile = pressable(
                    col().items_center(),
                    format!("scene-{}", scene.name),
                    &scene.name,
                    (background["id"] == id).then_some(0xffffff17),
                )
                .w(ui(150.))
                .padding(ui(6.));
                let mut image = el().w_full().h(ui(80.)).radius(ui(4.));
                if let Some(pixels) = THUMBNAILS.get(key.as_str()) {
                    image = image.pixels_fit(pixels, rune::SurfaceFit::Fill);
                }
                tile = tile
                    .child(image)
                    .child(text(Ink::small(), scene.name.clone()))
                    .on_press(move |s: &mut Workspace| s.update_background("id", id.clone()));
                scenes = scenes.child(tile);
            }
            panel = panel.child(scenes).child(
                button("Choose image…")
                    .key("custom-background")
                    .on_press_tx(|s: &mut Workspace, tx| s.choose_background(tx)),
            );
            if settings.custom_revision > 0. {
                panel = panel.child(
                    button("Your image")
                        .key("use-custom-background")
                        .on_press(|s: &mut Workspace| s.update_background("id", "custom".into())),
                );
            }
        }
        let adjustments = if current_mode == "glass" {
            vec![(
                "glassOpacity",
                "Transparency",
                100. - settings.glass_opacity,
                92.,
            )]
        } else if current_mode == "scene" {
            vec![
                ("dim", "Dim", settings.dim, 85.),
                ("blur", "Blur", settings.blur, 20.),
            ]
        } else {
            vec![]
        };
        for (key, label, value, max) in adjustments {
            let stored = move |next: f64| {
                json!(if key == "glassOpacity" {
                    100. - next
                } else {
                    next
                })
            };
            panel = panel.child(
                setting_row(label)
                    .child(button("−").key(format!("decrease-{key}")).on_press(
                        move |s: &mut Workspace| {
                            s.update_background(key, stored((value - 5.).max(0.)))
                        },
                    ))
                    .child(text(
                        Ink::body(),
                        format!(
                            "{}{}",
                            value.round(),
                            if key == "blur" { "px" } else { "%" }
                        ),
                    ))
                    .child(button("+").key(format!("increase-{key}")).on_press(
                        move |s: &mut Workspace| {
                            s.update_background(key, stored((value + 5.).min(max)))
                        },
                    )),
            );
        }
        let themes = [
            ("vscode-black", "Black"),
            ("contrast", "High Contrast"),
            ("vitesse", "Vitesse"),
            ("one-dark", "One Dark"),
            ("dracula", "Dracula"),
            ("slack", "Slack"),
        ]
        .into_iter()
        .map(|(a, b)| (a.into(), b.into()))
        .collect();
        let text_and_code = section(
            "Text and code",
            "How Inferay renders interface text, diffs, and source.",
        )
        .child(setting_row("Interface font").child(self.settings_choice(
            "font",
            data["font"].as_str().unwrap_or("vscode"),
            font_options,
        )))
        .child(setting_row("Code theme").child(self.settings_choice(
            "theme",
            data["theme"].as_str().unwrap_or("vscode-black"),
            themes,
        )));
        col().child(panel).child(text_and_code)
    }

    fn update_background(&mut self, key: &str, value: Value) {
        let stored = self
            .settings_state
            .data
            .get("appearance")
            .and_then(|v| v["background"].as_str())
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(Value::Null);
        let settings = serde_json::to_value(inferay_presentation::appearance::background_model(
            &json!({"stored": stored, "patch": {key: value}}),
        ))
        .unwrap_or(Value::Null)["background"]
            .clone();
        self.save_settings(
            Method::POST,
            "/api/client-storage".into(),
            json!({"entries": {"inferay-app-background": settings.to_string()}}),
        );
    }

    fn choose_background(&mut self, tx: &mut rune::Tx) {
        if self.settings_state.busy {
            return;
        }
        let Some(backend) = self.backend.get().cloned() else {
            return;
        };
        self.settings_state.busy = true;
        let _ = tx;
        let prompt = crate::platform::PathPrompt {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose a background image"),
        };
        crate::platform::prompt_for_paths(prompt, move |s: &mut Workspace, paths, _| {
            match paths.and_then(|paths| paths.into_iter().next()) {
                Some(path) => {
                    s.settings_state.mutation = Some(crate::task::spawn(
                        async move { backend.upload_background(path).await },
                        |s: &mut Workspace, result, _| {
                            s.settings_state.busy = false;
                            match result {
                                Ok(value) => {
                                    s.update_background("customRevision", value["revision"].clone())
                                }
                                Err(error) => s.settings_state.error = Some(error.to_string()),
                            }
                        },
                    ));
                }
                None => s.settings_state.busy = false,
            }
        });
    }
}
