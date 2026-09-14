//! Repository-tab interaction state. The browser owns DOM measurement and listeners.
use crate::workbench::{reorder_tabs, tab_drag, tab_order};
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[derive(Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTabsSnapshot {
    #[serde(skip_serializing)]
    #[ts(skip)]
    pending_order: Option<Vec<String>>,
    dragging: Option<String>,
    target: Option<RepositoryTabsTarget>,
    error: String,
}

#[derive(Serialize, ts_rs::TS)]
struct RepositoryTabsTarget {
    before: Option<String>,
}

#[derive(Default)]
struct Drag {
    cwd: String,
    start_x: f64,
    start_y: f64,
    active: bool,
    valid: bool,
    before: Option<String>,
}

#[wasm_bindgen]
#[derive(Default)]
pub struct RepositoryTabs {
    snapshot: RepositoryTabsSnapshot,
    drag: Option<Drag>,
    suppress_click: bool,
    sequence: u32,
}

#[wasm_bindgen]
impl RepositoryTabs {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.snapshot).expect("repository tabs snapshot")
    }

    pub fn order(&self, paths: &str) -> Result<String, JsValue> {
        let paths: Value = serde_json::from_str(paths).map_err(js_error)?;
        Ok(tab_order(&json!({
            "paths": paths,
            "pending": self.snapshot.pending_order,
        }))
        .to_string())
    }

    pub fn begin(&mut self, cwd: String, x: f64, y: f64) {
        self.cancel();
        self.suppress_click = false;
        self.drag = Some(Drag {
            cwd,
            start_x: x,
            start_y: y,
            ..Default::default()
        });
    }

    pub fn pointer_move(&mut self, x: f64, y: f64) -> u8 {
        let Some(drag) = &mut self.drag else {
            return 0;
        };
        if !drag.active && (x - drag.start_x).hypot(y - drag.start_y) < 5. {
            return 0;
        }
        let started = !drag.active;
        if !drag.active {
            drag.active = true;
            self.suppress_click = true;
            self.snapshot.dragging = Some(drag.cwd.clone());
        }
        if started { 1 } else { 2 }
    }

    pub fn active(&self) -> bool {
        self.drag.as_ref().is_some_and(|drag| drag.active)
    }

    pub fn hit(&mut self, input: &str) -> Result<String, JsValue> {
        let input: Value = serde_json::from_str(input).map_err(js_error)?;
        let hit = tab_drag(&input);
        if let Some(drag) = &mut self.drag {
            drag.valid = hit.valid;
            drag.before = hit.before.clone();
            self.snapshot.target = drag.valid.then(|| RepositoryTabsTarget {
                before: drag.before.clone(),
            });
        }
        serde_json::to_string(&hit).map_err(js_error)
    }

    pub fn drop(&mut self, paths: &str) -> Result<String, JsValue> {
        let paths: Value = serde_json::from_str(paths).map_err(js_error)?;
        let move_input = self
            .drag
            .as_ref()
            .filter(|drag| drag.active && drag.valid)
            .map(|drag| {
                json!({
                    "paths": paths,
                    "cwd": drag.cwd,
                    "before": drag.before,
                })
            });
        self.cancel();
        self.move_tabs(move_input.as_ref())
    }

    pub fn keyboard(
        &mut self,
        paths: &str,
        cwd: String,
        direction: i32,
    ) -> Result<String, JsValue> {
        let paths: Value = serde_json::from_str(paths).map_err(js_error)?;
        self.cancel();
        self.move_tabs(Some(&json!({
            "paths": paths,
            "cwd": cwd,
            "before": null,
            "direction": direction,
        })))
    }

    pub fn settle(&mut self, sequence: u32, saved: bool) {
        if sequence != self.sequence {
            return;
        }
        self.snapshot.pending_order = None;
        if !saved {
            self.snapshot.error = "Tab order could not be saved. Please try again.".into();
        }
    }

    pub fn cancel(&mut self) {
        self.drag = None;
        self.snapshot.dragging = None;
        self.snapshot.target = None;
    }

    pub fn consume_click(&mut self, detail: i32) -> bool {
        let suppressed = self.suppress_click && detail != 0;
        self.suppress_click = false;
        suppressed
    }
}

impl RepositoryTabs {
    fn move_tabs(&mut self, input: Option<&Value>) -> Result<String, JsValue> {
        let Some(next) = input.and_then(reorder_tabs) else {
            return Ok("null".into());
        };
        self.sequence = self.sequence.wrapping_add(1);
        self.snapshot.pending_order = Some(next.order);
        self.snapshot.error.clear();
        serde_json::to_string(&json!({
            "sequence": self.sequence,
            "cwd": input.expect("tab move input")["cwd"],
            "before": next.before,
        }))
        .map_err(js_error)
    }
}

fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}
