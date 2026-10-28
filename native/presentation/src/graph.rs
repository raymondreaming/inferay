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
    let scroll = number(&input["scrollTop"]).max(0.);
    let height = number(&input["height"]).max(0.);
    GraphViewport {
        visible_start: ((scroll / ROW_HEIGHT).floor() as usize).saturating_sub(6),
        visible_end: (((scroll + height) / ROW_HEIGHT).ceil() as usize)
            .saturating_add(6)
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

fn keep_branch_before_graph(order: &mut Vec<Value>) {
    if order.iter().any(|column| column == "graph")
        && let Some(index) = order.iter().position(|column| column == "refs")
    {
        let branch = order.remove(index);
        let graph = order.iter().position(|column| column == "graph").unwrap();
        order.insert(graph, branch);
    }
}

pub fn preferences(stored: &Value) -> Value {
    let mut widths = json!({});
    let mut compact_widths = json!({});
    for (i, column) in COLUMNS.iter().enumerate() {
        if let Some(width) = stored["compactWidths"][column]
            .as_f64()
            .filter(|v| v.is_finite())
        {
            compact_widths[column] = json!(column_width(i, width));
        }
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
    keep_branch_before_graph(&mut order);
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
        "widths":widths, "compactWidths":compact_widths, "order":order,
        "hiddenRefs":refs("hiddenRefs"), "soloRefs":refs("soloRefs"), "pinnedRefs":refs("pinnedRefs")})
}
pub fn move_column(i: &Value) -> Value {
    let mut order = array(&i["order"]).to_vec();
    if let (Some(source), Some(target)) = (
        order.iter().position(|c| c == &i["source"]),
        order.iter().position(|c| c == &i["target"]),
    ) {
        if matches!(string(&i["source"]), "refs" | "graph") {
            if !matches!(string(&i["target"]), "refs" | "graph") {
                let pair: Vec<_> = ["refs", "graph"]
                    .into_iter()
                    .filter(|column| order.iter().any(|value| value == column))
                    .map(Value::from)
                    .collect();
                order.retain(|column| !matches!(string(column), "refs" | "graph"));
                let target_index = order
                    .iter()
                    .position(|column| column == &i["target"])
                    .unwrap();
                order.splice(
                    target_index + usize::from(source < target)
                        ..target_index + usize::from(source < target),
                    pair,
                );
            }
        } else {
            let column = order.remove(source);
            order.insert(target, column);
        }
    }
    keep_branch_before_graph(&mut order);
    json!(order)
}
pub fn layout(i: &Value) -> Value {
    let max_column = (number(&i["maxColumn"]) as usize).min(100_000);
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
    let tools_width = i["toolsWidth"].as_f64().unwrap_or(TOOLS_WIDTH).max(0.);
    let available = number(&i["availableWidth"]);
    let compact = available > 0. && available < 760.;
    let mut order = array(&i["order"]).to_vec();
    keep_branch_before_graph(&mut order);
    let columns: Vec<_> = order
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
    if compact {
        widths["graph"] = json!(((max_column + 1) as f64 * 18. + 36.).clamp(48., 96.));
        widths["refs"] = json!((available * 0.24).clamp(96., 144.));
        widths["date"] = json!(160.);
        widths["author"] = json!(104.);
        widths["sha"] = json!(64.);
        for (index, column) in COLUMNS.iter().enumerate() {
            if let Some(width) = i["compactWidths"][column]
                .as_f64()
                .filter(|v| v.is_finite())
            {
                widths[*column] = json!(column_width(index, width));
            }
        }
        // Reserve room for the branch, graph and timestamp before the message.
        // Enabled columns scroll horizontally when the panel cannot fit them.
        let other: f64 = columns
            .iter()
            .filter(|c| matches!(string(c), "refs" | "graph" | "date"))
            .map(|c| number(&widths[string(c)]))
            .sum();
        if i["compactWidths"]["message"].as_f64().is_none() {
            widths["message"] = json!((available - other - tools_width).max(96.));
        }
    }
    let content = |widths: &serde_json::Map<String, Value>| -> f64 {
        columns.iter().map(|c| number(&widths[string(c)])).sum()
    };
    let slack = number(&i["availableWidth"]) - content(&widths) - tools_width;
    if flag(&i["stretch"]) && slack > 0.5 && columns.iter().any(|c| **c == "message") {
        widths["message"] = json!(number(&widths["message"]) + slack);
    }
    let left: f64 = columns
        .iter()
        .take_while(|c| ***c != "graph")
        .map(|c| number(&widths[string(c)]))
        .sum();
    let height = number(&i["count"]).max(0.).floor() * ROW_HEIGHT;
    let graph_width = number(&widths["graph"]);
    let table_width = content(&widths) + tools_width;
    json!({"compact":compact,"visibleOrder":columns,"displayColumns":display,"graphHeight":height,"graphLeft":left,
        "graphWidth":graph_width,"columnWidths":widths,
        "tableWidth":table_width})
}
fn path(row: f64, from: f64, to: f64, convergence: bool) -> String {
    let from = 27. + from * 18.;
    let to = 27. + to * 18.;
    let y = row * 23. + 11.5;
    let radius = 9_f64.min((to - from).abs() / 2.);
    if convergence {
        let direction = if to < from { -1. } else { 1. };
        format!(
            "M {from} {} L {from} {} A {radius} {radius} 0 0 {} {} {y} L {to} {y}",
            row * 23.,
            y - radius,
            if direction < 0. { 1 } else { 0 },
            from + direction * radius
        )
    } else {
        let direction = if from > to { 1. } else { -1. };
        format!(
            "M {to} {} L {to} {} A {radius} {radius} 0 0 {} {} {y} L {from} {y}",
            y + 23.,
            y + radius,
            if direction > 0. { 1 } else { 0 },
            to + direction * radius
        )
    }
}

#[derive(serde::Serialize, ts_rs::TS)]
pub struct GraphLine {
    dashed: bool,
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
    let colors = array(&i["colors"]);
    let color = |value: &Value| {
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
    };
    let display = |column: &Value| {
        i["displayColumns"]
            .get(number(column) as usize)
            .map(number)
            .unwrap_or_else(|| number(column))
    };
    let segments = |field: &str| {
        array(&i["rows"])
            .iter()
            .flat_map(|row| {
                array(&row[field]).iter().map(move |segment| {
                    let y = number(&row["row"]) * 23.;
                    GraphLine {
                        dashed: flag(&segment["dashed"]),
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
                        bottom: y + if field != "truncatedEdges" && flag(&segment["endsAtNode"]) {
                            if flag(&segment["dashed"]) { 2.5 } else { 11.5 }
                        } else {
                            23.
                        },
                        color: color(segment).to_owned(),
                    }
                })
            })
            .collect()
    };
    let curves = |field: &str, convergence: bool| {
        array(&i["rows"])
            .iter()
            .flat_map(|row| {
                array(&row[field]).iter().map(move |curve| GraphCurve {
                    dashed: flag(&curve["dashed"]),
                    path: path(
                        number(&row["row"]),
                        display(&curve["fromColumn"]),
                        display(&curve["toColumn"]),
                        convergence,
                    ),
                    color: color(curve).to_owned(),
                })
            })
            .collect()
    };
    GraphLines {
        rails: segments("rails"),
        truncated: segments("truncatedEdges"),
        transitions: curves("transitions", false),
        convergences: curves("convergences", true),
    }
}

#[cfg(test)]
mod column_layout_tests {
    use super::*;

    #[test]
    fn branch_stays_immediately_before_graph_after_restore_reorder_and_resize() {
        let saved = json!({"order": ["date", "graph", "message", "sha", "refs", "author"]});
        let restored = preferences(&saved);
        assert_eq!(
            restored["order"],
            json!(["date", "refs", "graph", "message", "sha", "author"])
        );
        for source in COLUMNS {
            for target in COLUMNS {
                let moved = move_column(
                    &json!({"order": restored["order"], "source": source, "target": target}),
                );
                let order = moved.as_array().unwrap();
                let graph = order.iter().position(|column| column == "graph").unwrap();
                assert!(graph > 0);
                assert_eq!(order[graph - 1], "refs");
            }
        }
        for width in [360., 520., 1200.] {
            let mut input = restored.clone();
            input["order"] = saved["order"].clone();
            input["availableWidth"] = json!(width);
            let result = layout(&input);
            let order = result["visibleOrder"].as_array().unwrap();
            let graph = order.iter().position(|column| column == "graph").unwrap();
            assert_eq!(order[graph - 1], "refs");
            input["columns"]["refs"] = json!(false);
            assert!(
                !layout(&input)["visibleOrder"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("refs"))
            );
        }
    }

    #[test]
    fn sidebar_column_dragging_survives_restore_and_expansion() {
        let mut input =
            preferences(&json!({"compactWidths": {"refs": 180., "message": 240., "date": 190.}}));
        input["order"] =
            move_column(&json!({"order": input["order"], "source": "date", "target": "message"}));
        input["availableWidth"] = json!(520.);
        let compact = layout(&input);
        assert_eq!(
            compact["visibleOrder"],
            json!(["refs", "graph", "date", "message", "author", "sha"])
        );
        assert_eq!(compact["columnWidths"]["refs"], 180.);
        assert_eq!(compact["columnWidths"]["message"], 240.);
        assert_eq!(compact["columnWidths"]["date"], 190.);
        input["availableWidth"] = json!(1200.);
        let expanded = layout(&input);
        assert_eq!(expanded["visibleOrder"], compact["visibleOrder"]);
        assert_eq!(expanded["columnWidths"]["refs"], 216.);
        assert_eq!(expanded["columnWidths"]["date"], 132.);
        assert_eq!(preferences(&input)["compactWidths"], input["compactWidths"]);
        for source in ["refs", "graph"] {
            assert_eq!(
                move_column(
                    &json!({"order": input["order"], "source": source, "target": "message"})
                ),
                json!(["date", "message", "refs", "graph", "author", "sha"])
            );
        }
    }

    #[test]
    fn rows_use_the_scroll_viewport_without_a_header_offset() {
        let view = viewport(&json!({"count":100,"scrollTop":230,"height":46}));
        assert_eq!((view.visible_start, view.visible_end), (4, 18));
        assert_eq!(reveal(&json!({"index":10,"scrollTop":0,"height":92})), 207.);
        assert_eq!(reveal(&json!({"index":0,"scrollTop":230,"height":92})), 0.);
    }

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
            "count": 1, "maxColumn": 0,
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
        let mut native = input.clone();
        native["toolsWidth"] = json!(0);
        native["stretch"] = json!(true);
        let native = layout(&native);
        assert_eq!(native["columnWidths"]["message"], 968.);
        assert_eq!(native["tableWidth"], 1200.);
    }

    #[test]
    fn resizing_graph_allows_message_to_cover_distant_lanes() {
        let result = layout(&json!({
            "count": 2, "maxColumn": 12,
            "pinnedColumns": [],
            "widths": { "graph": 48, "message": 340 },
            "order": ["graph", "message"],
            "columns": {}
        }));
        assert_eq!(result["graphWidth"], 48.);
        assert_eq!(result["tableWidth"], 420.);
        assert_eq!(result["displayColumns"].as_array().unwrap().len(), 13);
        assert_eq!(result["graphHeight"], 46.);
    }
}
