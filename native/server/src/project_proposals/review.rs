use super::*;
use std::{collections::BTreeSet, path::Path};

pub(crate) fn plugin(
    root: &Path,
    command: &ProjectFileCommand,
    globals: &BTreeSet<String>,
) -> Result<PluginProposalReview> {
    let (prefix, before, after) = match command {
        ProjectFileCommand::CreatePlugin {
            slug,
            files: bundle,
            ..
        } => {
            files::validate_bundle(root, slug, bundle, globals)?;
            (
                format!("plugins/{slug}"),
                BTreeMap::new(),
                bundle
                    .iter()
                    .map(|(path, text)| (path.clone(), text.as_bytes().to_vec()))
                    .collect(),
            )
        }
        ProjectFileCommand::UpdatePlugin {
            slug,
            expected_hash,
            files: changes,
            remove,
            ..
        } => {
            let after =
                files::prepare_plugin_update(root, slug, expected_hash, changes, remove, globals)?;
            let prefix = format!("plugins/{slug}");
            let hashes = files::package_files(root, &prefix)?;
            if hash(&serde_json::to_vec(&hashes)?) != *expected_hash {
                return Err("Plugin changed while preparing its review".into());
            }
            let mut before = BTreeMap::new();
            for (path, expected) in &hashes {
                let bytes = files::read(root, path, PLUGIN_BYTE_LIMIT)?;
                if hash(&bytes) != *expected {
                    return Err("Plugin changed while reading review contents".into());
                }
                before.insert(
                    path.strip_prefix(&format!("{prefix}/"))
                        .ok_or("Invalid plugin path")?
                        .to_owned(),
                    bytes,
                );
            }
            if files::package_files(root, &prefix)? != hashes {
                return Err("Plugin changed while preparing its review".into());
            }
            (prefix, before, after)
        }
        _ => return Err("Expected a plugin creation or update proposal".into()),
    };
    let manifest: PluginDefinition = parse("plugin.json", &after["plugin.json"])?;
    let previous_permissions = match before.get("plugin.json") {
        Some(bytes) => parse::<PluginDefinition>("plugin.json", bytes)?.may,
        None => BTreeSet::new(),
    };
    let paths: BTreeSet<_> = before.keys().chain(after.keys()).collect();
    let files = paths
        .into_iter()
        .filter_map(|path| {
            let previous = before.get(path);
            let proposed = after.get(path);
            if previous == proposed {
                return None;
            }
            let text = |bytes: &Vec<u8>| {
                if bytes.len() > ENTRYPOINT_LIMIT {
                    None
                } else {
                    std::str::from_utf8(bytes).ok().map(str::to_owned)
                }
            };
            Some(PluginReviewFile {
                path: format!("{prefix}/{path}"),
                hash: proposed.map(|bytes| hash(bytes)),
                previous_hash: previous.map(|bytes| hash(bytes)),
                content: proposed.and_then(text),
                previous_content: previous.and_then(text),
            })
        })
        .collect();
    Ok(PluginProposalReview {
        name: manifest.name,
        permissions: manifest.may,
        previous_permissions,
        files,
    })
}
