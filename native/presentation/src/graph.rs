use crate::{array, flag, number, string};
use serde_json::{Value, json};

const COLUMNS: [&str; 6] = ["date", "refs", "graph", "message", "author", "sha"];
const DEFAULT_WIDTHS: [f64; 6] = [132., 192., 96., 340., 136., 76.];
const MIN_WIDTHS: [f64; 6] = [84., 96., 48., 160., 88., 56.];
const ROW_HEIGHT: f64 = 23.;

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphKeyboardNavigation {
    handled: bool,
    select_item: Option<String>,
    select_index: Option<usize>,
    open_item: Option<String>,
}

pub fn navigation(input: &Value) -> GraphKeyboardNavigation {
    let key = string(&input["key"]);
    let items = array(&input["items"]);
    let count = items.len();
    let current = items.iter().position(|item| item == &input["current"]);
    let mut result = GraphKeyboardNavigation {
        handled: count > 0
            && matches!(
                key,
                "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End"
            ),
        select_item: None,
        select_index: None,
        open_item: None,
    };
    if !result.handled {
        return result;
    }
    if flag(&input["branch"]) && matches!(key, "ArrowUp" | "ArrowDown") {
        result.select_item = input["branchTarget"]
            .as_str()
            .filter(|target| !target.is_empty())
            .map(str::to_owned);
        result.select_index = result
            .select_item
            .as_ref()
            .and_then(|target| items.iter().position(|item| item.as_str() == Some(target)));
        return result;
    }
    if key == "ArrowRight" {
        if flag(&input["canOpen"]) {
            result.open_item = current
                .and_then(|index| items[index].as_str())
                .map(str::to_owned);
        }
    } else {
        let index = match key {
            "Home" => Some(0),
            "End" => Some(count - 1),
            "ArrowUp" => Some(current.map_or(count - 1, |index| index.saturating_sub(1))),
            "ArrowDown" => Some(current.map_or(0, |index| (index + 1).min(count - 1))),
            _ => None,
        };
        result.select_index = index;
        result.select_item = index
            .and_then(|index| items[index].as_str())
            .map(str::to_owned);
    }
    result
}

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphViewport {
    visible_start: usize,
    visible_end: usize,
}

pub fn viewport(input: &Value) -> GraphViewport {
    let count = number(&input["count"]).max(0.).floor() as usize;
    let scroll = (number(&input["scrollTop"]) - ROW_HEIGHT).max(0.);
    let height = number(&input["height"]).max(0.);
    GraphViewport {
        visible_start: ((scroll / ROW_HEIGHT).floor() as usize).saturating_sub(12),
        visible_end: (((scroll + height) / ROW_HEIGHT).ceil() as usize)
            .saturating_add(12)
            .min(count),
    }
}

pub fn reveal(input: &Value) -> Value {
    let row_top = number(&input["index"]) * ROW_HEIGHT;
    let scroll = number(&input["scrollTop"]);
    let height = number(&input["height"]);
    let padding = ROW_HEIGHT * 2.;
    json!(if row_top < scroll + padding {
        (row_top - padding).max(0.)
    } else if row_top + ROW_HEIGHT > scroll + height - padding {
        row_top + ROW_HEIGHT - height + padding
    } else {
        scroll
    })
}

pub fn resize_column(input: &Value) -> Value {
    let index = COLUMNS
        .iter()
        .position(|column| *column == string(&input["column"]))
        .unwrap_or(0);
    json!(number(&input["width"]).clamp(MIN_WIDTHS[index], 480.))
}

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
    json!({"visibleOrder":columns,"displayColumns":display,"graphHeight":height,"graphLeft":left,"graphWidth":graph_width,
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

#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphLine {
    key: String,
    row: f64,
    column: f64,
    x: f64,
    top: f64,
    bottom: f64,
    color: String,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphCurve {
    key: String,
    path: String,
    color: String,
}
#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphLines {
    rails: Vec<GraphLine>,
    transitions: Vec<GraphCurve>,
    convergences: Vec<GraphCurve>,
    truncated: Vec<GraphLine>,
}
pub fn lines(i: &Value) -> GraphLines {
    let color = |value: &Value| {
        let colors = array(&i["colors"]);
        colors
            .get(
                value["colorIndex"]
                    .as_i64()
                    .unwrap_or_default()
                    .unsigned_abs() as usize
                    % colors.len().max(1),
            )
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let display = |column: &Value| {
        i["displayColumns"]
            .get(number(column) as usize)
            .map(number)
            .unwrap_or_else(|| number(column))
    };
    let segments = |field: &str, prefix: &str| {
        array(&i["rows"])
            .iter()
            .flat_map(|row| {
                array(&row[field])
                    .iter()
                    .map(|segment| {
                        let y = number(&row["row"]) * 23.;
                        GraphLine {
                            key: format!("{prefix}-{}-{}", row["row"], segment["column"]),
                            row: number(&row["row"]),
                            column: number(&segment["column"]),
                            x: 27. + display(&segment["column"]) * 18.,
                            top: y + if field == "truncatedEdges" {
                                8.
                            } else if flag(&segment["startsAtNode"]) {
                                11.5
                            } else {
                                0.
                            },
                            bottom: y
                                + if field != "truncatedEdges" && flag(&segment["endsAtNode"]) {
                                    11.5
                                } else {
                                    23.
                                },
                            color: color(segment),
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    };
    let curves = |field: &str, convergence: bool| {
        array(&i["rows"])
            .iter()
            .flat_map(|row| {
                array(&row[field])
                    .iter()
                    .map(|curve| GraphCurve {
                        key: format!(
                            "{}{}:{}:{}:{}",
                            if convergence { "convergence:" } else { "" },
                            row["row"],
                            curve["fromColumn"],
                            curve["toColumn"],
                            color(curve)
                        ),
                        path: string(&path(
                            &json!({"row":row["row"], "fromCol":display(&curve["fromColumn"]),
                "toCol":display(&curve["toColumn"]), "convergence":convergence}),
                        ))
                        .into(),
                        color: color(curve),
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    };
    GraphLines {
        rails: segments("rails", "rail"),
        truncated: segments("truncatedEdges", "truncated"),
        transitions: curves("transitions", false),
        convergences: curves("convergences", true),
    }
}

#[cfg(test)]
mod line_tests {
    use super::*;

    #[test]
    fn visible_lines_keep_pinned_columns_node_endpoints_and_curve_identity() {
        let result = lines(&json!({
            "displayColumns":[1,0], "colors":["red","blue"],
            "rows":[{
                "row":2,
                "rails":[
                    {"column":0,"colorIndex":0,"startsAtNode":true},
                    {"column":1,"colorIndex":1,"endsAtNode":true}
                ],
                "truncatedEdges":[{"column":0,"colorIndex":0}],
                "transitions":[{"fromColumn":0,"toColumn":1,"colorIndex":0}],
                "convergences":[{"fromColumn":1,"toColumn":0,"colorIndex":1}]
            }]
        }));
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(
            value["rails"][0],
            json!({"key":"rail-2-0", "row":2.0,"column":0.0,"x":45.0,"top":57.5,"bottom":69.0,"color":"red"})
        );
        assert_eq!(value["rails"][1]["top"], 46.0);
        assert_eq!(value["rails"][1]["bottom"], 57.5);
        assert_eq!(value["truncated"][0]["top"], 54.0);
        assert_eq!(value["truncated"][0]["bottom"], 69.0);
        assert_eq!(value["transitions"][0]["key"], "2:0:1:red");
        assert_eq!(
            value["transitions"][0]["path"],
            "M 27 80.5 L 27 66.5 A 9 9 0 0 1 36 57.5 L 45 57.5"
        );
        assert_eq!(value["convergences"][0]["key"], "convergence:2:1:0:blue");
        assert_eq!(
            value["convergences"][0]["path"],
            "M 27 46 L 27 48.5 A 9 9 0 0 0 36 57.5 L 45 57.5"
        );
        let empty = serde_json::to_value(lines(&json!({"rows":[]}))).unwrap();
        assert!(
            empty
                .as_object()
                .unwrap()
                .values()
                .all(|items| items.as_array().unwrap().is_empty())
        );
    }
}
