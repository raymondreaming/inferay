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
