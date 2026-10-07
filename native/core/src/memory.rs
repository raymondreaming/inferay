//! Project memory notes: Markdown with a small header. Pure format rules; file access belongs to the server.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const NOTE_LIMIT: usize = 65_536;
pub const TITLE_LIMIT: usize = 200;
pub const TAG_LIMIT: usize = 30;
pub const NOTES_PER_PROJECT: usize = 10_000;
/// Notes live beside project records; the definition indexer ignores Markdown here.
pub const NOTES_DIR: &str = "resources/notes";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNote {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source: String,
    pub created: String,
    pub supersedes: Option<String>,
    pub expires: Option<String>,
    pub body: String,
}

/// A search result: enough to decide whether to read the note, never the whole body.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source: String,
    pub created: String,
    pub snippet: String,
    pub superseded: bool,
    pub expired: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNoteInput {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub supersedes: Option<String>,
    #[serde(default)]
    pub expires: Option<String>,
}

fn text(value: &str, max: usize, field: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max || value.contains(['\0', '\n', '\r']) {
        return Err(format!("{field} must be 1–{max} bytes on one line"));
    }
    Ok(())
}

impl MemoryNote {
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.id).map_err(|_| "note id must be a UUID")?;
        text(&self.title, TITLE_LIMIT, "title")?;
        text(&self.source, 2048, "source")?;
        text(&self.created, 64, "created")?;
        if self.tags.len() > TAG_LIMIT {
            return Err(format!("at most {TAG_LIMIT} tags"));
        }
        for tag in &self.tags {
            text(tag, 64, "tag")?;
            if tag.contains([',', '[', ']']) {
                return Err("tags cannot contain commas or brackets".into());
            }
        }
        if let Some(id) = &self.supersedes {
            uuid::Uuid::parse_str(id).map_err(|_| "supersedes must be a note UUID")?;
        }
        if let Some(date) = &self.expires {
            text(date, 64, "expires")?;
        }
        if self.body.trim().is_empty() || self.body.len() > NOTE_LIMIT || self.body.contains('\0') {
            return Err(format!("body must be 1–{NOTE_LIMIT} bytes"));
        }
        Ok(())
    }

    pub fn from_input(input: MemoryNoteInput, id: String, created: String) -> Result<Self, String> {
        let normalize = |tags: Vec<String>| {
            let mut tags: Vec<String> = tags
                .into_iter()
                .map(|t| t.trim().to_owned())
                .filter(|t| !t.is_empty())
                .collect();
            tags.sort();
            tags.dedup();
            tags
        };
        let note = Self {
            id,
            title: input.title.trim().to_owned(),
            tags: normalize(input.tags),
            source: input
                .source
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "manual".into()),
            created,
            supersedes: input.supersedes.filter(|s| !s.is_empty()),
            expires: input.expires.filter(|s| !s.is_empty()),
            body: input.body.trim().to_owned() + "\n",
        };
        note.validate()?;
        Ok(note)
    }

    pub fn render(&self) -> String {
        let mut out = format!("---\nid: {}\ntitle: {}\n", self.id, self.title);
        out += &format!(
            "tags: [{}]\nsource: {}\ncreated: {}\n",
            self.tags.join(", "),
            self.source,
            self.created
        );
        if let Some(id) = &self.supersedes {
            out += &format!("supersedes: {id}\n");
        }
        if let Some(date) = &self.expires {
            out += &format!("expires: {date}\n");
        }
        out + "---\n" + &self.body
    }

    pub fn parse(path: &str, text: &str) -> Result<Self, String> {
        if text.len() > NOTE_LIMIT + 4096 {
            return Err(format!("{path}: note exceeds {NOTE_LIMIT} bytes"));
        }
        let text = text.replace("\r\n", "\n");
        let (header, body) = text
            .strip_prefix("---\n")
            .and_then(|s| s.split_once("\n---\n"))
            .ok_or_else(|| format!("{path}: front matter required"))?;
        let mut note = Self {
            id: String::new(),
            title: String::new(),
            tags: vec![],
            source: "manual".into(),
            created: String::new(),
            supersedes: None,
            expires: None,
            body: body.to_owned(),
        };
        for line in header.lines() {
            let (key, value) = line
                .split_once(':')
                .ok_or_else(|| format!("{path}: invalid front matter line"))?;
            let value = value.trim().trim_matches('"').to_owned();
            match key.trim() {
                "id" => note.id = value,
                "title" => note.title = value,
                "tags" => {
                    note.tags = value
                        .trim_start_matches('[')
                        .trim_end_matches(']')
                        .split(',')
                        .map(|t| t.trim().trim_matches('"').to_owned())
                        .filter(|t| !t.is_empty())
                        .collect()
                }
                "source" => note.source = value,
                "created" => note.created = value,
                "supersedes" => note.supersedes = (!value.is_empty()).then_some(value),
                "expires" => note.expires = (!value.is_empty()).then_some(value),
                other => return Err(format!("{path}: unknown field {other}")),
            }
        }
        note.validate().map_err(|e| format!("{path}: {e}"))?;
        Ok(note)
    }

    /// `[[Title]]` references in the body, in order, without duplicates.
    pub fn links(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut rest = self.body.as_str();
        while let Some(start) = rest.find("[[") {
            rest = &rest[start + 2..];
            let Some(end) = rest.find("]]") else { break };
            let target = rest[..end]
                .split('|')
                .next()
                .unwrap_or("")
                .trim()
                .to_owned();
            if !target.is_empty() && target.len() <= TITLE_LIMIT && !out.contains(&target) {
                out.push(target);
            }
            rest = &rest[end + 2..];
        }
        out
    }
}

/// A file name for a title: lowercase words joined by dashes, bounded, never empty.
pub fn slug(title: &str) -> String {
    let mut out = String::new();
    for c in title.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 60 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() { "note".into() } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "7c1e9a52-3b0d-4f8e-9a61-2d4c5e8f1a90";

    fn note() -> MemoryNote {
        MemoryNote::from_input(
            MemoryNoteInput {
                title: "Why we dropped the paywall".into(),
                body: "Conversion fell. See [[Launch plan]] and [[Pricing|prices]].".into(),
                tags: vec!["pricing".into(), " bean-break ".into(), "pricing".into()],
                source: Some("chat:pane/message:4".into()),
                supersedes: None,
                expires: None,
            },
            ID.into(),
            "2026-10-06T20:31:00Z".into(),
        )
        .unwrap()
    }

    #[test]
    fn notes_round_trip_through_markdown() {
        let note = note();
        assert_eq!(note.tags, vec!["bean-break", "pricing"]);
        assert_eq!(MemoryNote::parse("n.md", &note.render()).unwrap(), note);
        assert_eq!(note.links(), vec!["Launch plan", "Pricing"]);
    }

    #[test]
    fn invalid_notes_are_refused() {
        let text = note().render();
        assert!(MemoryNote::parse("n.md", &text.replace("id: ", "id: x")).is_err());
        assert!(MemoryNote::parse("n.md", &text.replace("source:", "owner:")).is_err());
        assert!(MemoryNote::parse("n.md", "no header").is_err());
        let mut long = note();
        long.title = "x".repeat(201);
        assert!(long.validate().is_err());
    }

    #[test]
    fn slugs_are_bounded_file_names() {
        assert_eq!(
            slug("Why we dropped the Paywall!"),
            "why-we-dropped-the-paywall"
        );
        assert_eq!(slug("???"), "note");
        assert!(slug(&"word ".repeat(40)).len() <= 60);
    }
}
