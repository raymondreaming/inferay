//! Stable syntax vocabulary and bounded renderer preflight, independent of grammars.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SyntaxKind {
    Attribute,
    Comment,
    Constant,
    Control,
    Variable,
    Function,
    Keyword,
    Number,
    Operator,
    Plain,
    Punctuation,
    String,
    Tag,
    Type,
}

pub const MAX_LINES: usize = 50_000;
pub const MAX_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_LINE_BYTES: usize = 4_000;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxInput {
    pub enabled: bool,
    pub content_key: String,
    pub line_types_key: String,
}
fn key(lines: &[String]) -> String {
    let mut hash = 2_166_136_261u32;
    let mut length = 0;
    for line in lines {
        let mut units = 0;
        for unit in line.encode_utf16() {
            hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
            units += 1;
        }
        hash = (hash ^ 10).wrapping_mul(16_777_619);
        length += units;
    }
    format!("{}:{length}:{hash}", lines.len())
}
/// Keep UTF-16 cache identity stable across browser/native runtimes. The server
/// additionally caps encoded bytes before passing input to the grammar.
pub fn input(lines: &[String], types: Option<&[String]>, enabled: bool) -> SyntaxInput {
    let mut characters = 0;
    let mut bytes = lines.len().saturating_sub(1);
    let enabled = enabled
        && !lines.is_empty()
        && lines.len() <= MAX_LINES
        && lines.iter().all(|line| {
            if line.len() > MAX_LINE_BYTES {
                return false;
            }
            characters += line.encode_utf16().count();
            bytes += line.len();
            characters <= 2_000_000 && bytes <= MAX_BYTES
        });
    SyntaxInput {
        enabled,
        content_key: if enabled {
            key(lines)
        } else {
            lines.len().to_string()
        },
        line_types_key: types.map(key).unwrap_or_else(|| "source".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_utf16_browser_hashes_and_preserve_line_boundaries() {
        let model = input(
            &["a".into(), "😀".into()],
            Some(&["add".into(), "remove".into()]),
            true,
        );
        assert_eq!(model.content_key, "2:3:678920311");
        assert_eq!(model.line_types_key, "2:9:3106578908");
        assert_ne!(
            input(&["a\nb".into()], None, true).content_key,
            input(&["a".into(), "b".into()], None, true).content_key
        );
        assert_eq!(input(&["text".into()], None, false).content_key, "1");
    }

    #[test]
    fn admission_preserves_character_limits_and_checks_the_native_byte_limits() {
        assert!(!input(&[], None, true).enabled);
        assert!(!input(&["text".into()], None, false).enabled);
        assert!(input(&vec![String::new(); MAX_LINES], None, true).enabled);
        assert!(!input(&vec![String::new(); MAX_LINES + 1], None, true).enabled);
        assert!(input(&["x".repeat(4000)], None, true).enabled);
        assert!(!input(&["x".repeat(4001)], None, true).enabled);
        assert!(input(&vec!["x".repeat(4000); 500], None, true).enabled);
        assert!(!input(&vec!["x".repeat(4000); 501], None, true).enabled);
        assert!(input(&["😀".repeat(1000)], None, true).enabled);
        assert!(!input(&["😀".repeat(1001)], None, true).enabled);
        assert!(!input(&vec!["漢".repeat(1333); 1100], None, true).enabled);
    }
}
