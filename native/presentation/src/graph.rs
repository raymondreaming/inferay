use crate::{array, flag, number, string};
use serde_json::{Value, json};

const COLUMNS: [&str; 6] = ["date", "refs", "graph", "message", "author", "sha"];
const DEFAULT_WIDTHS: [f64; 6] = [132., 192., 96., 340., 136., 76.];
const MIN_WIDTHS: [f64; 6] = [84., 96., 48., 160., 88., 56.];

pub fn preferences(stored: &Value) -> Value {
    let mut widths = json!({});
    for (i, column) in COLUMNS.iter().enumerate() {
        widths[column] = json!(
            stored["widths"][column]
                .as_f64()
                .filter(|v| v.is_finite())
                .unwrap_or(DEFAULT_WIDTHS[i])
                .clamp(MIN_WIDTHS[i], 480.)
        );
    }
    let mut order = Vec::new();
    for column in array(&stored["order"]) {
        if COLUMNS.contains(&string(column)) && !order.contains(column) {
            order.push(column.clone());
        }
    }
    for column in COLUMNS {
        if !order.iter().any(|c| c == column) {
            order.push(json!(column));
        }
    }
    let refs = |key: &str| {
        array(&stored[key])
            .iter()
            .filter(|v| v.is_string())
            .cloned()
            .collect::<Vec<_>>()
    };
    json!({"columns":{
        "author":stored["columns"]["author"].as_bool().unwrap_or(true),
        "sha":stored["columns"]["sha"].as_bool().unwrap_or(true),
        "date":stored["columns"]["date"].as_bool().unwrap_or(true)},
        "widths":widths, "order":order,
        "hiddenRefs":refs("hiddenRefs"), "soloRefs":refs("soloRefs"), "pinnedRefs":refs("pinnedRefs")})
}
pub fn move_column(i: &Value) -> Value {
    let mut order = array(&i["order"]).to_vec();
    if let (Some(source), Some(target)) = (
        order.iter().position(|c| c == &i["source"]),
        order.iter().position(|c| c == &i["target"]),
    ) {
        let column = order.remove(source);
        order.insert(target, column);
    }
    json!(order)
}
pub fn layout(i: &Value) -> Value {
    let max_column = array(&i["commitColumns"])
        .iter()
        .map(|c| number(c) as usize)
        .max()
        .unwrap_or(0)
        .min(100_000);
    let mut positions = Vec::new();
    for column in array(&i["pinnedColumns"]) {
        if let Some(column) = column.as_u64().filter(|c| *c <= max_column as u64) {
            let column = column as usize;
            if !positions.contains(&column) {
                positions.push(column);
            }
        }
    }
    let pinned: std::collections::HashSet<_> = positions.iter().copied().collect();
    positions.extend((0..=max_column).filter(|column| !pinned.contains(column)));
    let mut display = vec![0; max_column + 1];
    for (index, column) in positions.iter().enumerate() {
        display[*column] = index;
    }
    let graph_width = number(&i["widths"]["graph"]).max((max_column + 1) as f64 * 18. + 36.);
    let columns: Vec<_> = array(&i["order"])
        .iter()
        .filter(|c| {
            !matches!(string(c), "date" | "author" | "sha") || flag(&i["columns"][string(c)])
        })
        .collect();
    let width = |c: &Value| {
        if c == "graph" {
            graph_width
        } else {
            number(&i["widths"][string(c)])
        }
    };
    let left: f64 = columns
        .iter()
        .take_while(|c| ***c != "graph")
        .map(|c| width(c))
        .sum();
    let height = array(&i["commitColumns"]).len() as f64 * 23.;
    json!({"displayColumns":display,"graphHeight":height,"graphLeft":left,"graphWidth":graph_width,
        "tableWidth":columns.iter().map(|c|width(c)).sum::<f64>() + 32.,"totalHeight":23. + height})
}
pub fn path(i: &Value) -> Value {
    let row = number(&i["row"]);
    let from = 27. + number(&i["fromCol"]) * 18.;
    let to = 27. + number(&i["toCol"]) * 18.;
    let y = row * 23. + 11.5;
    let radius = 9_f64.min((to - from).abs() / 2.);
    if flag(&i["convergence"]) {
        let direction = if to < from { -1. } else { 1. };
        json!(format!(
            "M {from} {} L {from} {} A {radius} {radius} 0 0 {} {} {y} L {to} {y}",
            row * 23.,
            y - radius,
            if direction < 0. { 1 } else { 0 },
            from + direction * radius
        ))
    } else {
        let direction = if from > to { 1. } else { -1. };
        json!(format!(
            "M {to} {} L {to} {} A {radius} {radius} 0 0 {} {} {y} L {from} {y}",
            y + 23.,
            y + radius,
            if direction > 0. { 1 } else { 0 },
            to + direction * radius
        ))
    }
}
