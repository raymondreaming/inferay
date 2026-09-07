//! CSS shadow layers become native descriptions of the SVG filter passes.
use serde::Serialize;

#[derive(Debug, Serialize, ts_rs::TS)]
pub struct ShadowLayer {
    pub x: f64,
    pub y: f64,
    pub blur: f64,
    pub spread: f64,
    pub color: String,
    pub inset: bool,
}

fn space(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn split_top(input: &str, comma: bool) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut depth = 0i32;
    for (index, ch) in input.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth == 0 && if comma { ch == ',' } else { space(ch) } {
            let part = input[start..index].trim_matches(space);
            if !part.is_empty() {
                parts.push(part);
            }
            start = index + ch.len_utf8();
        }
    }
    let part = input[start..].trim_matches(space);
    if !part.is_empty() {
        parts.push(part);
    }
    parts
}

fn length(token: &str) -> Option<f64> {
    let number = token.strip_suffix("px").unwrap_or(token);
    let unsigned = number.strip_prefix(['+', '-']).unwrap_or(number);
    let mut dots = 0;
    let mut digits = 0;
    for ch in unsigned.chars() {
        if ch.is_ascii_digit() {
            digits += 1;
        } else if ch == '.' {
            dots += 1;
        } else {
            return None;
        }
    }
    if digits == 0 || dots > 1 {
        return None;
    }
    number.parse().ok()
}

pub fn parse(input: &str) -> Vec<ShadowLayer> {
    if input.trim_matches(space).is_empty() || input.trim_matches(space) == "none" {
        return Vec::new();
    }
    split_top(input, true)
        .into_iter()
        .map(|layer| {
            let mut nums = Vec::new();
            let mut color = Vec::new();
            let mut inset = false;
            for token in split_top(layer, false) {
                if token == "inset" {
                    inset = true;
                } else if let Some(value) = length(token).filter(|_| nums.len() < 4) {
                    nums.push(value);
                } else {
                    color.push(token);
                }
            }
            let at = |index| nums.get(index).copied().unwrap_or(0.);
            ShadowLayer {
                x: at(0),
                y: at(1),
                blur: at(2),
                spread: at(3),
                inset,
                color: if color.is_empty() {
                    "rgba(0, 0, 0, 0.35)".into()
                } else {
                    color.join(" ")
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_nested_colors_and_signed_decimal_lengths() {
        let layers = parse(
            "inset -.5px +2px 3. 0 color-mix(in srgb, red 30%, blue), 0 4px rgba(0, 0, 0, .2)",
        );
        assert_eq!(layers.len(), 2);
        assert!(layers[0].inset);
        assert_eq!(layers[0].x, -0.5);
        assert_eq!(layers[0].y, 2.);
        assert_eq!(layers[0].blur, 3.);
        assert_eq!(layers[0].color, "color-mix(in srgb, red 30%, blue)");
        assert_eq!(layers[1].color, "rgba(0, 0, 0, .2)");
    }

    #[test]
    fn defaults_missing_lengths_and_keeps_unrecognized_units_in_the_color() {
        let layers = parse("1e2 2rem 0 1px");
        assert_eq!(layers[0].x, 0.);
        assert_eq!(layers[0].y, 1.);
        assert_eq!(layers[0].color, "1e2 2rem");
        assert_eq!(parse("0 1px")[0].color, "rgba(0, 0, 0, 0.35)");
        assert!(parse("\u{feff}none\u{feff}").is_empty());
    }
}
