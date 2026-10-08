use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
pub struct DraftPreview {
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub details: Vec<DraftDetail>,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
pub struct DraftDetail {
    pub label: String,
    pub value: String,
}

impl DraftPreview {
    pub fn from_content(filename: &str, content: &str) -> Result<Option<Self>, String> {
        if !filename.to_ascii_lowercase().ends_with(".draft.json") {
            return Ok(None);
        }
        if content.len() > 1024 * 1024 {
            return Err("Draft preview is limited to 1 MB. View the source instead.".into());
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Document {
            schema: String,
            draft: DraftPreview,
        }
        let document: Document = serde_json::from_str(content)
            .map_err(|error| format!("Cannot display this draft: {error}"))?;
        if document.schema != "inferay.draft/1" {
            return Err("Unsupported draft format. View the source instead.".into());
        }
        let draft = document.draft;
        if draft.title.trim().is_empty() || draft.title.len() > 512 || draft.text.trim().is_empty()
        {
            return Err("A draft needs a title (up to 512 bytes) and text.".into());
        }
        if draft.details.len() > 32
            || draft.details.iter().any(|detail| {
                detail.label.trim().is_empty()
                    || detail.label.len() > 128
                    || detail.value.len() > 4096
            })
        {
            return Err("Draft details allow up to 32 labeled values (128-byte labels and 4096-byte values).".into());
        }
        Ok(Some(draft))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_artifacts_are_explicit_and_keep_text_literal() {
        let content = r#"{"schema":"inferay.draft/1","draft":{"title":"Launch","text":"<script>literal</script>\n#tag","details":[{"label":"Channel","value":"Instagram"}]}}"#;
        assert!(
            DraftPreview::from_content("ordinary.json", content)
                .unwrap()
                .is_none()
        );
        let draft = DraftPreview::from_content("launch.DRAFT.JSON", content)
            .unwrap()
            .unwrap();
        assert_eq!(draft.title, "Launch");
        assert_eq!(draft.text, "<script>literal</script>\n#tag");
        assert_eq!(draft.details[0].value, "Instagram");
        assert!(
            DraftPreview::from_content("launch.draft.json", &content.replace("draft/1", "draft/2"))
                .is_err()
        );
        assert!(
            DraftPreview::from_content(
                "launch.draft.json",
                &content.replace("\"Launch\"", "\" \"")
            )
            .is_err()
        );
        assert!(
            DraftPreview::from_content("launch.draft.json", &"x".repeat(1024 * 1024 + 1)).is_err()
        );
        assert!(DraftPreview::from_content("launch.draft.json", r#"{"schema":"inferay.draft/1","draft":{"title":"Test","text":"Text","publish":true}}"#).is_err());
    }
}
