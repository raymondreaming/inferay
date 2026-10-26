//! Graph computation over metadata; browser nodes remain the canonical render records.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

// Use the browser's trigonometry when seeding WASM layouts. Tiny differences
// from native libm amplify during the force simulation and move existing nodes.
#[cfg(target_arch = "wasm32")]

extern "C" {

    fn sin(value: f64) -> f64;

    fn cos(value: f64) -> f64;
}

#[derive(Deserialize, TS)]
pub struct LayoutNode {
    pub id: String,
}
#[derive(Deserialize, TS)]
pub struct LayoutEdge {
    pub from: String,
    pub to: String,
}
#[derive(Deserialize, TS)]
pub struct MemoryGraphLayout {
    pub nodes: Vec<LayoutNode>,
    pub edges: Vec<LayoutEdge>,
}
#[derive(Serialize, TS)]
pub struct GraphPoint {
    pub x: f64,
    pub y: f64,
}

fn seed(id: &str) -> f64 {
    let hash = id.encode_utf16().fold(2166136261u32, |hash, unit| {
        (hash ^ u32::from(unit)).wrapping_mul(16777619)
    });
    f64::from(hash) / 4294967295.0
}

pub fn layout(graph: MemoryGraphLayout) -> Vec<(String, GraphPoint)> {
    let count = graph.nodes.len();
    let index: HashMap<_, _> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let radius = 40.0 * ((count + 1) as f64).sqrt();
    let mut x = Vec::with_capacity(count);
    let mut y = Vec::with_capacity(count);
    #[cfg(not(target_arch = "wasm32"))]
    let (sin, cos) = (f64::sin, f64::cos);
    for node in &graph.nodes {
        let angle = seed(&node.id) * std::f64::consts::PI * 2.0;
        let r = radius * seed(&format!("{}#r", node.id)).sqrt();
        x.push(cos(angle) * r);
        y.push(sin(angle) * r);
    }
    let links: Vec<_> = graph
        .edges
        .iter()
        .filter_map(|e| Some((*index.get(e.from.as_str())?, *index.get(e.to.as_str())?)))
        .collect();
    let mut degree = vec![0.0f64; count];
    for &(a, b) in &links {
        degree[a] += 1.0;
        degree[b] += 1.0;
    }
    let iterations = if count > 1200 {
        60
    } else if count > 400 {
        120
    } else {
        260
    };
    let mut fx = vec![0.0; count];
    let mut fy = vec![0.0; count];
    for step in 0..iterations {
        let heat = 1.0 - step as f64 / iterations as f64;
        fx.fill(0.0);
        fy.fill(0.0);
        let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for i in 0..count {
            grid.entry(((x[i] / 90.0).floor() as i64, (y[i] / 90.0).floor() as i64))
                .or_default()
                .push(i);
        }
        for i in 0..count {
            let cx = (x[i] / 90.0).floor() as i64;
            let cy = (y[i] / 90.0).floor() as i64;
            for gx in cx - 1..=cx + 1 {
                for gy in cy - 1..=cy + 1 {
                    for &j in grid.get(&(gx, gy)).into_iter().flatten() {
                        if j <= i {
                            continue;
                        }
                        let mut dx = x[i] - x[j];
                        let mut dy = y[i] - y[j];
                        let mut d2 = dx * dx + dy * dy;
                        if d2 < 0.01 {
                            dx = seed(&format!("{i}:{j}")) - 0.5;
                            dy = 0.5 - seed(&format!("{j}:{i}"));
                            d2 = dx * dx + dy * dy;
                        }
                        let push = 2600.0 / d2;
                        fx[i] += dx * push;
                        fy[i] += dy * push;
                        fx[j] -= dx * push;
                        fy[j] -= dy * push;
                    }
                }
            }
        }
        for &(a, b) in &links {
            let dx = x[b] - x[a];
            let dy = y[b] - y[a];
            let d = (dx * dx + dy * dy).sqrt();
            let d = if d == 0.0 { 1.0 } else { d };
            let pull = ((d - 90.0) / d) * 0.06;
            fx[a] += dx * pull * (1.0 / (degree[a] / 4.0).max(1.0));
            fy[a] += dy * pull * (1.0 / (degree[a] / 4.0).max(1.0));
            fx[b] -= dx * pull * (1.0 / (degree[b] / 4.0).max(1.0));
            fy[b] -= dy * pull * (1.0 / (degree[b] / 4.0).max(1.0));
        }
        for i in 0..count {
            fx[i] -= x[i] * 0.004;
            fy[i] -= y[i] * 0.004;
            let limit = 24.0 * heat + 1.0;
            x[i] += fx[i].clamp(-limit, limit);
            y[i] += fy[i].clamp(-limit, limit);
        }
    }
    graph
        .nodes
        .into_iter()
        .enumerate()
        .map(|(i, n)| (n.id, GraphPoint { x: x[i], y: y[i] }))
        .collect()
}
