use super::*;
use crate::colors;
use resvg::{tiny_skia, usvg};

pub(super) struct GraphImage {
    pub(super) svg: String,
    pub(super) pixels: Pixels,
}

pub(super) fn rasterize_svg(bytes: &[u8], scale: f32) -> Option<Pixels> {
    let tree = usvg::Tree::from_data(bytes, &usvg::Options::default()).ok()?;
    let size = tree.size();
    let width = (size.width() * scale).ceil().max(1.) as u32;
    let height = (size.height() * scale).ceil().max(1.) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let rgba = pixmap
        .pixels()
        .iter()
        .flat_map(|pixel| {
            let color = pixel.demultiply();
            [color.red(), color.green(), color.blue(), color.alpha()]
        })
        .collect();
    let pixels = Pixels::new();
    pixels.set(width, height, rgba);
    Some(pixels)
}

pub(super) fn decode_raster(bytes: &[u8]) -> Option<Pixels> {
    let decoded = image::load_from_memory(bytes).ok()?.to_rgba8();
    let pixels = Pixels::new();
    pixels.set(decoded.width(), decoded.height(), decoded.into_raw());
    Some(pixels)
}

pub(super) fn svg(graph: &GitGraphSnapshot, display: &Value, background: u32, i: usize) -> String {
    let commit = &graph.commits[i];
    let width = 27. + (display.as_array().map_or(1, Vec::len) + 1) as f64 * 18.;
    let rows =
        &graph.rows[i.saturating_sub(1).min(graph.rows.len())..(i + 1).min(graph.rows.len())];
    let lines = serde_json::to_value(inferay_presentation::graph::lines(
        &json!({"rows":rows,"colors":colors::GRAPH_LANES,"displayColumns":display}),
    ))
    .unwrap();
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"46\" viewBox=\"0 {} {width} 23\"><g fill=\"none\" stroke-width=\"2\" stroke-linecap=\"round\">",
        width * 2.,
        i as f64 * 23.
    );
    for field in ["rails", "truncated"] {
        for line in lines[field].as_array().unwrap() {
            let dash = if line["dashed"] == true || field == "truncated" {
                format!(
                    "stroke-dasharray=\"1 2\" stroke-width=\"1\" stroke-dashoffset=\"{}\"",
                    line["top"]
                )
            } else {
                String::new()
            };
            svg.push_str(&format!(
                "<path d=\"M {} {} L {} {}\" stroke=\"{}\" {dash}/>",
                line["x"],
                line["top"],
                line["x"],
                line["bottom"],
                line["color"].as_str().unwrap()
            ));
            if field == "truncated" {
                svg.push_str(&format!(
                    "<circle cx=\"{}\" cy=\"{}\" r=\"2\" fill=\"{}\"/>",
                    line["x"],
                    line["bottom"].as_f64().unwrap() - 1.,
                    line["color"].as_str().unwrap()
                ));
            }
        }
    }
    for field in ["transitions", "convergences"] {
        for line in lines[field].as_array().unwrap() {
            svg.push_str(&format!(
                "<path d=\"{}\" stroke=\"{}\" stroke-linejoin=\"round\" {}/>",
                line["path"].as_str().unwrap(),
                line["color"].as_str().unwrap(),
                if line["dashed"] == true {
                    "stroke-dasharray=\"1 2\" stroke-width=\"1\""
                } else {
                    ""
                }
            ));
        }
    }
    let x = 27.
        + display[commit.column]
            .as_f64()
            .unwrap_or(commit.column as f64)
            * 18.;
    let y = i as f64 * 23. + 11.5;
    let color = colors::GRAPH_LANES[commit.color_index % colors::GRAPH_LANES.len()];
    svg.push_str("</g>");
    match commit.item_kind {
        GitGraphItemKind::WorktreeWip => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"8.5\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-dasharray=\"1 2\" pathLength=\"54\" stroke-dashoffset=\"0.5\"/>")),
        GitGraphItemKind::Stash => svg.push_str(&format!("<g transform=\"translate({} {})\"><rect x=\"0.5\" y=\"0.5\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-dasharray=\"1 2\" pathLength=\"63\" stroke-dashoffset=\"0.5\"/><path d=\"M4.5 5.5h9v2h-9z M5.5 7.5v5h7v-5 M7.5 9.5h3\" fill=\"none\" stroke=\"{color}\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>", x - 9., y - 9.)),
        GitGraphItemKind::Commit if commit.parents.len() > 1 => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"6\" fill=\"{color}\" opacity=\"0.32\"/><circle cx=\"{x}\" cy=\"{y}\" r=\"5\" fill=\"{color}\"/>")),
        _ => svg.push_str(&format!("<circle cx=\"{x}\" cy=\"{y}\" r=\"8.5\" fill=\"#{background:06x}\" stroke=\"{color}\" stroke-width=\"1\"/>")),
    }
    svg.push_str("</svg>");
    svg
}

pub(super) fn images(
    graph: &GitGraphSnapshot,
    display: &Value,
    background: u32,
    previous: &[Arc<GraphImage>],
) -> Vec<Arc<GraphImage>> {
    let previous: HashMap<&str, &Arc<GraphImage>> = previous
        .iter()
        .map(|image| (image.svg.as_str(), image))
        .collect();
    (0..graph.commits.len())
        .map(|i| {
            let svg = svg(graph, display, background, i);
            if let Some(image) = previous.get(svg.as_str()) {
                Arc::clone(image)
            } else {
                let pixels = rasterize_svg(svg.as_bytes(), 2.).unwrap_or_default();
                Arc::new(GraphImage { svg, pixels })
            }
        })
        .collect()
}
