use crate::{array, flag, number, string};
use serde_json::{Value, json};

const COLUMNS: [&str; 6] = ["date", "refs", "graph", "message", "author", "sha"];
/// Where a column lands when nothing has been saved yet.
const DEFAULT_ORDER: [&str; 6] = ["refs", "graph", "message", "date", "author", "sha"];
const DEFAULT_WIDTHS: [f64; 6] = [132., 216., 96., 340., 136., 76.];
const MIN_WIDTHS: [f64; 6] = [84., 96., 48., 160., 88., 56.];
const ROW_HEIGHT: f64 = 23.;
const TOOLS_WIDTH: f64 = 32.;

#[derive(serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct GraphKeyboardNavigation {
    handled: bool,
    select_item: Option<String>,
    select_index: Option<usize>,
    open_item: Option<String>,
}

pub fn navigation(input: &Value) -> GraphKeyboardNavigation {
    let action = crate::shortcuts::action(input, "graph");
    let items = array(&input["items"]);
    let count = items.len();
    let current = items.iter().position(|item| item == &input["current"]);
    let mut result = GraphKeyboardNavigation {
        handled: action == Some("consume")
            || (count > 0
                && matches!(
                    action,
                    Some(
                        "previousCommit"
                            | "nextCommit"
                            | "previousBranchCommit"
                            | "nextBranchCommit"
                            | "firstCommit"
                            | "lastCommit"
                            | "openSelection"
                    )
                )),
        select_item: None,
        select_index: None,
        open_item: None,
    };
    if !result.handled || action == Some("consume") {
        return result;
    }
    if matches!(action, Some("previousBranchCommit" | "nextBranchCommit")) {
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
    if action == Some("openSelection") {
        if flag(&input["canOpen"]) {
            result.open_item = current
                .and_then(|index| items[index].as_str())
                .or_else(|| input["current"].as_str())
                .map(str::to_owned);
        }
    } else {
        let index = match action {
            Some("firstCommit") => Some(0),
            Some("lastCommit") => Some(count - 1),
            Some("previousCommit") => {
                Some(current.map_or(count - 1, |index| index.saturating_sub(1)))
            }
            Some("nextCommit") => Some(current.map_or(0, |index| (index + 1).min(count - 1))),
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

fn column_width(index: usize, width: f64) -> f64 {
    let width = width.max(MIN_WIDTHS[index]);
    if COLUMNS[index] == "message" {
        width
    } else {
        width.min(480.)
    }
}

pub fn resize_column(input: &Value) -> Value {
    let index = COLUMNS
        .iter()
        .position(|column| *column == string(&input["column"]))
        .unwrap_or(0);
    json!(column_width(index, number(&input["width"])))
}

pub fn preferences(stored: &Value) -> Value {
    let mut widths = json!({});
    for (i, column) in COLUMNS.iter().enumerate() {
        widths[column] = json!(column_width(
            i,
            stored["widths"][column]
                .as_f64()
                .filter(|v| v.is_finite())
                .unwrap_or(DEFAULT_WIDTHS[i])
        ));
    }
    let mut order = Vec::new();
    for column in array(&stored["order"]) {
        if COLUMNS.contains(&string(column)) && !order.contains(column) {
            order.push(column.clone());
        }
    }
    for column in DEFAULT_ORDER {
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
    let columns: serde_json::Map<String, Value> = COLUMNS
        .iter()
        .map(|column| {
            (
                (*column).to_owned(),
                json!(stored["columns"][column].as_bool().unwrap_or(true)),
            )
        })
        .collect();
    json!({"columns":columns,
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
    let columns: Vec<_> = array(&i["order"])
        .iter()
        .filter(|c| i["columns"][string(c)].as_bool().unwrap_or(true))
        .collect();
    let mut widths: serde_json::Map<String, Value> = COLUMNS
        .iter()
        .enumerate()
        .map(|(index, column)| {
            (
                (*column).to_owned(),
                json!(number(&i["widths"][column]).max(MIN_WIDTHS[index])),
            )
        })
        .collect();
    let content = |widths: &serde_json::Map<String, Value>| -> f64 {
        columns.iter().map(|c| number(&widths[string(c)])).sum()
    };
    let slack = number(&i["availableWidth"]) - content(&widths) - TOOLS_WIDTH;
    if flag(&i["stretch"]) && slack > 0.5 && columns.iter().any(|c| **c == "message") {
        widths["message"] = json!(number(&widths["message"]) + slack);
    }
    let left: f64 = columns
        .iter()
        .take_while(|c| ***c != "graph")
        .map(|c| number(&widths[string(c)]))
        .sum();
    let height = array(&i["commitColumns"]).len() as f64 * 23.;
    let graph_width = number(&widths["graph"]);
    let table_width = content(&widths) + TOOLS_WIDTH;
    json!({"visibleOrder":columns,"displayColumns":display,"graphHeight":height,"graphLeft":left,
        "graphWidth":graph_width,"columnWidths":widths,
        "tableWidth":table_width,"totalHeight":23. + height})
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
    dashed: bool,
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
    dashed: bool,
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
                            dashed: flag(&segment["dashed"]),
                            key: format!("{prefix}-{}-{}", row["row"], segment["column"]),
                            row: number(&row["row"]),
                            column: number(&segment["column"]),
                            x: 27. + display(&segment["column"]) * 18.,
                            top: y + if field == "truncatedEdges" {
                                8.
                            } else if flag(&segment["startsAtNode"]) {
                                if flag(&segment["dashed"]) { 20.5 } else { 11.5 }
                            } else {
                                0.
                            },
                            bottom: y
                                + if field != "truncatedEdges" && flag(&segment["endsAtNode"]) {
                                    if flag(&segment["dashed"]) { 2.5 } else { 11.5 }
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
                        dashed: flag(&curve["dashed"]),
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
mod column_layout_tests {
    use super::*;

    #[test]
    fn dashed_rails_stop_at_node_outlines() {
        let result = lines(&json!({
            "colors": ["cyan"],
            "rows": [{"row": 0, "rails": [
                {"column": 0, "dashed": true, "startsAtNode": true},
                {"column": 1, "dashed": true, "endsAtNode": true},
                {"column": 2, "dashed": true}
            ]}]
        }));
        // An 18px node is centered in a 23px row. Only through-rails may
        // span the row; attached dashed rails meet the outside of the node.
        assert_eq!((result.rails[0].top, result.rails[0].bottom), (20.5, 23.));
        assert_eq!((result.rails[1].top, result.rails[1].bottom), (0., 2.5));
        assert_eq!((result.rails[2].top, result.rails[2].bottom), (0., 23.));
    }

    #[test]
    fn message_width_can_exceed_480_and_survives_reload() {
        let width = resize_column(&json!({"column":"message", "width":1400}));
        assert_eq!(width, 1400.);
        let restored = preferences(&json!({"widths":{"message":width}}));
        assert_eq!(restored["widths"]["message"], 1400.);
    }

    #[test]
    fn all_columns_can_be_hidden_and_restored() {
        let stored = json!({"columns": {"date":false, "refs":false, "graph":false, "message":false, "author":false, "sha":false}});
        let mut input = preferences(&stored);
        assert_eq!(input["order"].as_array().unwrap().len(), 6);
        assert_eq!(layout(&input)["visibleOrder"], json!([]));
        input["columns"]["graph"] = json!(true);
        input["columns"]["message"] = json!(true);
        assert_eq!(layout(&input)["visibleOrder"], json!(["graph", "message"]));
        assert_eq!(
            preferences(&json!({"columns":{"author":false}}))["columns"]["refs"],
            true
        );
    }

    #[test]
    fn fullscreen_fills_leftover_width_with_the_message_column() {
        let input = json!({
            "commitColumns": [0],
            "pinnedColumns": [],
            "widths": { "graph": 96, "message": 340, "author": 136 },
            "order": ["graph", "message", "author"],
            "columns": {},
            "availableWidth": 1200
        });
        let freeform = layout(&input);
        assert_eq!(freeform["columnWidths"]["message"], 340.);
        assert_eq!(freeform["tableWidth"], 604.);
        let mut stretched = input.clone();
        stretched["stretch"] = json!(true);
        let stretched = layout(&stretched);
        assert_eq!(stretched["columnWidths"]["message"], 936.);
        assert_eq!(stretched["columnWidths"]["author"], 136.);
        assert_eq!(stretched["tableWidth"], 1200.);
    }

    #[test]
    fn narrow_windows_keep_stored_widths_even_in_fullscreen() {
        let result = layout(&json!({
            "commitColumns": [0],
            "pinnedColumns": [],
            "widths": { "graph": 96, "message": 340 },
            "order": ["graph", "message"],
            "columns": {},
            "availableWidth": 300,
            "stretch": true
        }));
        assert_eq!(result["columnWidths"]["message"], 340.);
        assert_eq!(result["tableWidth"], 468.);
    }

    #[test]
    fn resizing_graph_allows_message_to_cover_distant_lanes() {
        let result = layout(&json!({
            "commitColumns": [0, 12],
            "pinnedColumns": [],
            "widths": { "graph": 48, "message": 340 },
            "order": ["graph", "message"],
            "columns": {}
        }));
        assert_eq!(result["graphWidth"], 48.);
        assert_eq!(result["tableWidth"], 420.);
        assert_eq!(result["displayColumns"].as_array().unwrap().len(), 13);
    }
}
