//! Bounded chat retention metadata. Browser-owned replicas, messages, and viewport maps stay in
//! the renderer; this model owns recency, weights, and closed-pane eviction.
use crate::wasm_json;
use std::collections::{HashMap, HashSet, VecDeque};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ChatSessionRetention {
    entries: HashMap<String, (String, f64)>,
    order: VecDeque<String>,
    weight: f64,
    pane_ids: Option<HashSet<String>>,
    max_entries: usize,
    max_weight: f64,
}

#[wasm_bindgen]
impl ChatSessionRetention {
    #[wasm_bindgen(constructor)]
    pub fn new(max_entries: u32, max_weight: f64) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            weight: 0.,
            pane_ids: None,
            max_entries: max_entries as usize,
            max_weight,
        }
    }

    pub fn take(&mut self, identity: &str) -> bool {
        self.remove(identity).is_some()
    }

    pub fn retain(&mut self, identity: String, pane_id: String, weight: f64) -> String {
        self.remove(&identity);
        if self
            .pane_ids
            .as_ref()
            .is_some_and(|pane_ids| !pane_ids.contains(&pane_id))
        {
            return serde_json::json!([false, []]).to_string();
        }

        self.weight += weight;
        self.order.push_back(identity.clone());
        self.entries.insert(identity, (pane_id, weight));
        let mut evicted = Vec::new();
        while self.entries.len() > self.max_entries || self.weight > self.max_weight {
            let Some(oldest) = self.order.front().cloned() else {
                break;
            };
            self.remove(&oldest);
            evicted.push(oldest);
        }
        serde_json::json!([true, evicted]).to_string()
    }

    pub fn set_pane_ids(&mut self, pane_ids: &str) -> Result<String, JsValue> {
        let pane_ids: HashSet<String> = wasm_json::parse(pane_ids)?;
        let evicted = self
            .order
            .iter()
            .filter(|identity| {
                self.entries
                    .get(*identity)
                    .is_some_and(|(pane_id, _)| !pane_ids.contains(pane_id))
            })
            .cloned()
            .collect::<Vec<_>>();
        for identity in &evicted {
            self.remove(identity);
        }
        self.pane_ids = Some(pane_ids);
        Ok(wasm_json::stringify(&evicted, "chat session evictions"))
    }
}

impl ChatSessionRetention {
    fn remove(&mut self, identity: &str) -> Option<()> {
        let (_, weight) = self.entries.remove(identity)?;
        self.order.retain(|entry| entry != identity);
        self.weight -= weight;
        Some(())
    }
}

#[wasm_bindgen]
pub struct ChatViewportRetention {
    entries: HashSet<String>,
    order: VecDeque<String>,
    max_entries: usize,
}

#[wasm_bindgen]
impl ChatViewportRetention {
    #[wasm_bindgen(constructor)]
    pub fn new(max_entries: u32) -> Self {
        Self {
            entries: HashSet::new(),
            order: VecDeque::new(),
            max_entries: max_entries as usize,
        }
    }

    pub fn touch(&mut self, pane_id: String) -> String {
        if self.entries.remove(&pane_id) {
            self.order.retain(|entry| entry != &pane_id);
        }
        self.entries.insert(pane_id.clone());
        self.order.push_back(pane_id);
        let mut evicted = Vec::new();
        while self.entries.len() > self.max_entries {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.entries.remove(&oldest);
            evicted.push(oldest);
        }
        wasm_json::stringify(&evicted, "viewport eviction identities")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn session_retention_enforces_weight_and_closed_panes() {
        let mut cache = ChatSessionRetention::new(2, 10.);
        cache.retain("a".into(), "pane-a".into(), 6.);
        let retained: Value =
            serde_json::from_str(&cache.retain("b".into(), "pane-b".into(), 6.)).unwrap();
        assert_eq!(retained, json!([true, ["a"]]));
        assert!(!cache.take("a"));
        assert_eq!(cache.set_pane_ids(r#"["pane-a"]"#).unwrap(), r#"["b"]"#);
        assert_eq!(cache.retain("b".into(), "pane-b".into(), 1.), "[false,[]]");
        assert!(!cache.take("b"));
    }

    #[test]
    fn session_retention_enforces_identity_weight_and_closed_panes() {
        let mut retention = ChatSessionRetention::new(1, 10.);
        assert_eq!(retention.retain("a".into(), "pane".into(), 5.), "[true,[]]");
        assert_eq!(
            retention.retain("b".into(), "pane".into(), 5.),
            "[true,[\"a\"]]"
        );
        assert!(!retention.take("a"));
        assert!(retention.take("b"));
        retention.set_pane_ids("[]").unwrap();
        assert_eq!(
            retention.retain("c".into(), "pane".into(), 5.),
            "[false,[]]"
        );
    }

    #[test]
    fn viewport_retention_refreshes_recency_and_evicts_oldest() {
        let mut retention = ChatViewportRetention::new(2);
        assert_eq!(retention.touch("a".into()), "[]");
        assert_eq!(retention.touch("b".into()), "[]");
        assert_eq!(retention.touch("a".into()), "[]");
        assert_eq!(retention.touch("c".into()), "[\"b\"]");
    }
}
