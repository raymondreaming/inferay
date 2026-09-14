use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn summaries(input: &Value) -> Value {
    let mut groups = BTreeMap::<String, (Value, Vec<f64>)>::new();
    for sample in input.as_array().into_iter().flatten() {
        if sample["result"] != "frame-ready" || sample["context"]["alreadySelected"] == true {
            continue;
        }
        let identity = json!([sample["kind"], sample["target"], sample["context"]]);
        let key = serde_json::to_string(&identity).unwrap_or_default();
        let entry = groups
            .entry(key)
            .or_insert_with(|| (sample.clone(), Vec::new()));
        if let Some(duration) = sample["frameReadyMs"].as_f64() {
            entry.1.push(duration);
        }
    }
    json!(
        groups
            .into_values()
            .filter_map(|(sample, mut durations)| {
                if durations.is_empty() {
                    return None;
                }
                durations.sort_by(f64::total_cmp);
                let count = durations.len();
                let median = (durations[(count - 1) / 2] + durations[count / 2]) / 2.;
                let p95 =
                    (count >= 20).then(|| durations[((count as f64 * 0.95).ceil() as usize) - 1]);
                Some(json!({
                    "kind": sample["kind"], "target": sample["target"],
                    "context": sample["context"], "count": count,
                    "medianMs": median, "p95Ms": p95,
                }))
            })
            .collect::<Vec<_>>()
    )
}

#[derive(Default, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UiTimingContext {
    retained: bool,
    already_selected: bool,
    visible_chats: usize,
    active_runs: usize,
    viewport_width: f64,
    viewport_height: f64,
    target_width: Option<f64>,
}
#[derive(Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UiLongTasks {
    count: usize,
    total_ms: f64,
    max_ms: f64,
}
#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UiRequestTiming {
    path: String,
    start_ms: f64,
    headers_ms: Option<f64>,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct UiStageTiming {
    name: String,
    ms: f64,
}
#[derive(Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct UiTiming {
    #[ts(type = "'repository' | 'send'")]
    kind: String,
    #[ts(type = "'frame-ready' | 'timeout' | 'superseded' | 'background'")]
    result: String,
    target: String,
    context: UiTimingContext,
    input_delay_ms: f64,
    shell_ready_ms: Option<f64>,
    content_ready_ms: Option<f64>,
    frame_wait_ms: Option<f64>,
    frame_ready_ms: f64,
    max_frame_gap_ms: f64,
    frame_gaps_ms: Vec<f64>,
    frames_over34_ms: usize,
    frames_over50_ms: usize,
    measurement_cost_ms: f64,
    waiting_for: String,
    long_tasks: Option<UiLongTasks>,
    requests: Vec<UiRequestTiming>,
    stages: Vec<UiStageTiming>,
}

/// Accumulate bounded measurements without serializing the sample on each frame.
#[wasm_bindgen::prelude::wasm_bindgen]
#[derive(Default)]
pub struct UiTimingRecorder {
    sample: UiTiming,
    start: f64,
    last_frame: f64,
    ready_frame: bool,
    sent: bool,
}
#[wasm_bindgen::prelude::wasm_bindgen]
impl UiTimingRecorder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    pub fn begin(
        &mut self,
        kind: String,
        target: String,
        context: &str,
        timestamp: f64,
        now: f64,
        long_tasks: bool,
    ) -> Result<f64, wasm_bindgen::JsValue> {
        let context = serde_json::from_str(context)
            .map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))?;
        self.start = if timestamp > 0. && timestamp <= now {
            timestamp
        } else {
            now
        };
        self.last_frame = now;
        self.ready_frame = false;
        self.sent = false;
        let target = if kind == "repository" {
            target
                .rsplit('/')
                .find(|p| !p.is_empty())
                .unwrap_or(&target)
                .to_owned()
        } else {
            target
        };
        self.sample = UiTiming {
            kind,
            target,
            context,
            input_delay_ms: now - self.start,
            result: "timeout".into(),
            waiting_for: "activation".into(),
            long_tasks: long_tasks.then(UiLongTasks::default),
            ..Default::default()
        };
        Ok(self.start)
    }
    pub fn stage(&mut self, name: String, now: f64) {
        if self.sample.stages.len() < 256 {
            self.sent |= name == "chat:send";
            self.sample.stages.push(UiStageTiming {
                name,
                ms: now - self.start,
            });
        }
    }
    fn shell(&mut self, width: f64, now: f64) {
        if self.sample.shell_ready_ms.is_none() {
            self.sample.shell_ready_ms = Some(now - self.start);
            self.sample.context.target_width = Some(width.round());
            self.stage("shell-visible".into(), now);
        }
    }
    pub fn long_task(&mut self, start: f64, duration: f64, now: f64) {
        let Some(tasks) = &mut self.sample.long_tasks else {
            return;
        };
        let overlap = now.min(start + duration) - self.start.max(start);
        if overlap > 0. {
            tasks.count += 1;
            tasks.total_ms += overlap;
            tasks.max_ms = tasks.max_ms.max(duration);
        }
    }
    pub fn request(&mut self, path: String, now: f64) -> Option<u32> {
        if self.sample.requests.len() >= 256 {
            return None;
        }
        let index = self.sample.requests.len() as u32;
        self.stage(format!("request:{path}"), now);
        self.sample.requests.push(UiRequestTiming {
            path,
            start_ms: now - self.start,
            headers_ms: None,
        });
        Some(index)
    }
    pub fn response(&mut self, index: Option<u32>, path: &str, now: f64) {
        if let Some(request) = index.and_then(|i| self.sample.requests.get_mut(i as usize)) {
            request.headers_ms = Some(now - self.start - request.start_ms);
        }
        self.stage(format!("response:{path}"), now);
    }
    fn record_frame(&mut self, now: f64, measured: f64, waiting_for: &str) -> bool {
        let gap = (now - self.last_frame).max(0.);
        self.sample.max_frame_gap_ms = self.sample.max_frame_gap_ms.max(gap);
        if self.sample.frame_gaps_ms.len() < 600 {
            self.sample.frame_gaps_ms.push(gap);
        }
        self.sample.frames_over34_ms += usize::from(gap > 34.);
        self.sample.frames_over50_ms += usize::from(gap > 50.);
        self.last_frame = now;
        let ready = waiting_for.is_empty();
        if ready && self.sample.content_ready_ms.is_none() {
            self.sample.content_ready_ms = Some(measured - self.start);
            self.stage("content-ready".into(), measured);
        } else if !ready {
            self.sample.content_ready_ms = None;
        }
        self.sample.waiting_for = if ready {
            "next frame".into()
        } else {
            waiting_for.into()
        };
        let complete = ready && self.ready_frame;
        self.ready_frame = ready;
        complete
    }
    // Keep per-frame browser facts primitive across WASM; avoid serializing a sample each frame.
    #[allow(clippy::too_many_arguments)]
    pub fn frame(
        &mut self,
        frame_time: f64,
        measured: f64,
        active: bool,
        width: f64,
        activity: bool,
        visible_panes: u32,
        expected_panes: f64,
        hydrated: bool,
        formatting: bool,
    ) -> bool {
        let waiting_for = if !active {
            "activation"
        } else {
            self.shell(width, measured);
            if self.sample.kind == "send" && !self.sent {
                "send accepted"
            } else if self.sample.kind == "send" && !activity {
                "activity indicator"
            } else if self.sample.kind == "repository" && f64::from(visible_panes) != expected_panes
            {
                "pane layout"
            } else if self.sample.kind == "repository" && !hydrated {
                "transcript hydration"
            } else if self.sample.kind == "repository" && formatting {
                "Markdown formatting"
            } else {
                ""
            }
        };
        self.record_frame(frame_time, measured, waiting_for)
    }
    pub fn cost(&mut self, elapsed: f64) {
        self.sample.measurement_cost_ms += elapsed;
    }
    pub fn finish(&mut self, result: String, now: f64) -> String {
        self.sample.frame_ready_ms = now - self.start;
        if result == "frame-ready" {
            self.sample.frame_wait_ms = self
                .sample
                .content_ready_ms
                .map(|ready| self.sample.frame_ready_ms - ready);
        }
        self.sample.result = result;
        serde_json::to_string(&self.sample).expect("timing sample")
    }
}
