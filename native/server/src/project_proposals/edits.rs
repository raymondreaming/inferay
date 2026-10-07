//! User edits keep the card's target and concurrency precondition unchanged.
use super::*;

pub(super) fn validate(original: &ProjectFileCommand, edited: &ProjectFileCommand) -> Result<()> {
    if serde_json::to_value(original)? == serde_json::to_value(edited)? {
        return Ok(());
    }
    match (original, edited) {
        (
            ProjectFileCommand::CreatePlugin {
                project_id: a,
                slug: b,
                files: before,
            },
            ProjectFileCommand::CreatePlugin {
                project_id: c,
                slug: d,
                files: after,
            },
        ) if a == c && b == d => {
            let old: PluginDefinition = parse(
                "plugin.json",
                before
                    .get("plugin.json")
                    .ok_or("Original plugin manifest missing")?
                    .as_bytes(),
            )?;
            let new: PluginDefinition = parse(
                "plugin.json",
                after
                    .get("plugin.json")
                    .ok_or("Edited plugin manifest missing")?
                    .as_bytes(),
            )?;
            if old.id != new.id {
                return Err("Editing cannot change the plugin identity".into());
            }
            Ok(())
        }
        (
            ProjectFileCommand::UpdatePlugin {
                project_id: a,
                slug: b,
                expected_hash: h1,
                ..
            },
            ProjectFileCommand::UpdatePlugin {
                project_id: c,
                slug: d,
                expected_hash: h2,
                ..
            },
        ) if a == c && b == d && h1 == h2 => Ok(()),
        _ => Err("Editing must preserve the plugin target, operation and expected hash".into()),
    }
}
