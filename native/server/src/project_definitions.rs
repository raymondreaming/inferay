//! Managed definition files: bounded reads, validation, and conflict-safe publication.
//! SQLite indexes these bytes; it is never an alternate definition writer.
use crate::project_store::{Result, hash};
use inferay_core::project_files::{self as format, *};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub(crate) enum DefinitionFile {
    Project(ProjectDefinition),
    Resource(ResourceDefinition),
    Plugin(PluginDefinition),
    Tool(ToolDefinition),
    Automation(AutomationDefinition),
    Skill(SkillDefinition),
    ResourceType(serde_json::Value),
}
impl DefinitionFile {
    pub fn id(&self) -> &str {
        match self {
            Self::Project(v) => &v.id,
            Self::Resource(v) => &v.id,
            Self::Plugin(v) => &v.id,
            Self::Tool(v) => &v.id,
            Self::Automation(v) => &v.id,
            Self::Skill(v) => &v.id,
            Self::ResourceType(_) => "",
        }
    }
}
#[derive(Clone, Debug)]
pub(crate) struct IndexedFile {
    pub path: String,
    pub hash: Option<String>,
    pub definition: Option<DefinitionFile>,
    pub error: Option<String>,
}

/// Never follow a symlink, including a dangling link, at any managed component.
pub(crate) fn managed_path(root: &Path, relative: &str, create_parents: bool) -> Result<PathBuf> {
    format::relative_path(relative)?;
    if relative == "." {
        return Err("A file path is required".into());
    }
    if fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err("Managed project root cannot be a symlink".into());
    }
    let mut path = root.to_path_buf();
    let parts: Vec<_> = relative.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        if *part == "." {
            return Err("Use normalized relative paths".into());
        }
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("{relative}: symlinks are not allowed").into());
            }
            Ok(meta) if i + 1 < parts.len() && !meta.is_dir() => {
                return Err(format!("{relative}: parent is not a directory").into());
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if create_parents && i + 1 < parts.len() {
                    fs::create_dir(&path)?;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(path)
}
pub(crate) fn read(root: &Path, relative: &str, limit: usize) -> Result<Vec<u8>> {
    let path = managed_path(root, relative, false)?;
    let file = fs::File::open(&path)?;
    if !file.metadata()?.is_file() {
        return Err(format!("{relative}: not a regular file").into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(format!("{relative}: exceeds {limit} bytes").into());
    }
    Ok(bytes)
}

/// A missing expected hash means create-only. Existing bytes must match exactly.
/// Callers serialize app writes under the profile lease and validate definitions first.
pub(crate) fn write(
    root: &Path,
    relative: &str,
    bytes: &[u8],
    expected: Option<&str>,
) -> Result<String> {
    let path = managed_path(root, relative, true)?;
    let compare = || -> Result<()> {
        let actual = match read(root, relative, PLUGIN_BYTE_LIMIT) {
            Ok(bytes) => Some(hash(&bytes)),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) =>
            {
                None
            }
            Err(error) => return Err(error),
        };
        if actual.as_deref() != expected {
            return Err(format!(
                "{relative}: file changed; reload before saving (expected hash conflict)"
            )
            .into());
        }
        Ok(())
    };
    compare()?;
    let parent = path.parent().ok_or("Missing file parent")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    // Recheck after staging to catch edits made during the write.
    compare()?;
    if expected.is_none() {
        temporary.persist_noclobber(&path)?;
    } else {
        temporary.persist(&path)?;
    }
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(hash(bytes))
}

pub(crate) fn decode(path: &str, bytes: &[u8]) -> Result<DefinitionFile> {
    let parts: Vec<_> = path.split('/').collect();
    let value = match parts.as_slice() {
        ["project.json"] => DefinitionFile::Project(format::parse(path, bytes)?),
        ["resources", kind, file] if *kind != "documents" && file.ends_with(".json") => {
            let value: ResourceDefinition = format::parse(path, bytes)?;
            if value.type_id != *kind {
                return Err(format!("{path}: resource type must match its directory").into());
            }
            DefinitionFile::Resource(value)
        }
        ["plugins", _, "plugin.json"] => DefinitionFile::Plugin(format::parse(path, bytes)?),
        ["plugins", _, "automations", file] if file.ends_with(".json") => {
            DefinitionFile::Automation(format::parse(path, bytes)?)
        }
        ["plugins", _, "tools", _, "tool.json"] => {
            DefinitionFile::Tool(format::parse(path, bytes)?)
        }
        ["plugins", _, "skills", file] if file.ends_with(".md") => {
            DefinitionFile::Skill(format::parse_skill(path, std::str::from_utf8(bytes)?)?)
        }
        ["plugins", _, "types", file] if file.ends_with(".schema.json") => {
            let schema: serde_json::Value = serde_json::from_slice(bytes)?;
            inferay_core::projects::validate_schema_definition(&schema, 0)?;
            DefinitionFile::ResourceType(schema)
        }
        _ => return Err(format!("{path}: not a definition path").into()),
    };
    Ok(value)
}

fn is_definition(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    match parts.as_slice() {
        ["project.json"]
        | ["plugins", _, "plugin.json"]
        | ["plugins", _, "tools", _, "tool.json"] => true,
        ["resources", kind, name] => *kind != "documents" && name.ends_with(".json"),
        ["plugins", _, "automations", name] => name.ends_with(".json"),
        ["plugins", _, "skills", name] => name.ends_with(".md"),
        ["plugins", _, "types", name] => name.ends_with(".schema.json"),
        _ => false,
    }
}

/// Index malformed definitions with their error instead of silently retaining stale data.
/// Ignore documents and run output: they are not executable definitions.
pub(crate) fn scan(root: &Path, globals: &BTreeSet<String>) -> Result<Vec<IndexedFile>> {
    scan_candidate(root, globals, None)
}

/// Validate against the resulting project without publishing a preview to disk.
pub(crate) fn validate_write(
    root: &Path,
    path: &str,
    bytes: &[u8],
    globals: &BTreeSet<String>,
) -> Result<()> {
    managed_path(root, path, false)?;
    decode(path, bytes)?;
    let before = scan(root, globals)?;
    let after = scan_candidate(root, globals, Some((path, bytes)))?;
    for entry in after {
        if let Some(error) = entry.error {
            let existing = before.iter().find(|old| old.path == entry.path);
            if entry.path == path || existing.and_then(|old| old.error.as_ref()) != Some(&error) {
                return Err(format!("{}: {error}", entry.path).into());
            }
        }
    }
    Ok(())
}

fn scan_candidate(
    root: &Path,
    globals: &BTreeSet<String>,
    candidate: Option<(&str, &[u8])>,
) -> Result<Vec<IndexedFile>> {
    let mut paths = vec!["project.json".to_string()];
    let mut pending = vec!["resources".to_string(), "plugins".to_string()];
    let mut entries = 0;
    let mut plugin_sizes = std::collections::BTreeMap::<String, (usize, u64)>::new();
    while let Some(relative) = pending.pop() {
        let directory = managed_path(root, &relative, false)?;
        if !directory.exists() {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            entries += 1;
            if entries > 102_000 {
                return Err("Project exceeds the definition entry limit".into());
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Definition filename is not UTF-8")?;
            if name.starts_with('.') {
                continue;
            }
            let path = format!("{relative}/{name}");
            if path == "resources/documents" {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path())?;
            if let Some(plugin) = path
                .strip_prefix("plugins/")
                .and_then(|p| p.split('/').next())
            {
                let size = plugin_sizes.entry(plugin.into()).or_default();
                size.0 += 1;
                size.1 = size.1.saturating_add(meta.len());
            }
            if meta.file_type().is_symlink() {
                paths.push(path);
            } else if meta.is_dir() {
                if path.split('/').count() > 16 {
                    return Err("Definition tree is too deep".into());
                }
                pending.push(path);
            } else if is_definition(&path) {
                paths.push(path);
            }
        }
    }
    if plugin_sizes.len() > 100 {
        return Err("Project exceeds 100 plugins".into());
    }
    if let Some((path, bytes)) = candidate {
        if !paths.iter().any(|p| p == path) {
            paths.push(path.into());
        }
        if let Some(plugin) = path
            .strip_prefix("plugins/")
            .and_then(|p| p.split('/').next())
        {
            let size = plugin_sizes.entry(plugin.into()).or_default();
            match fs::symlink_metadata(root.join(path)) {
                Ok(meta) => size.1 = size.1.saturating_sub(meta.len()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => size.0 += 1,
                Err(error) => return Err(error.into()),
            }
            size.1 = size.1.saturating_add(bytes.len() as u64);
            if plugin_sizes.len() > 100 {
                return Err("Project exceeds 100 plugins".into());
            }
        }
    }
    paths.sort();
    let mut indexed: Vec<IndexedFile> = paths
        .into_iter()
        .map(|path| {
            let result = match candidate {
                Some((candidate_path, bytes)) if path == candidate_path => Ok(bytes.to_vec()),
                _ => read(root, &path, MANIFEST_LIMIT),
            };
            let hash = result.as_ref().ok().map(|bytes| hash(bytes));
            let result = result.and_then(|bytes| decode(&path, &bytes));
            let (definition, error) = match result {
                Ok(v) => (Some(v), None),
                Err(e) => (None, Some(e.to_string())),
            };
            IndexedFile {
                path,
                hash,
                definition,
                error,
            }
        })
        .collect();
    let project = indexed.iter().find_map(|entry| match &entry.definition {
        Some(DefinitionFile::Project(p)) => Some(p.clone()),
        _ => None,
    });
    if let Some(project) = &project {
        if root.file_name().and_then(|s| s.to_str()) != Some(project.id.as_str()) {
            indexed
                .iter_mut()
                .find(|v| v.path == "project.json")
                .unwrap()
                .error = Some("Project ID must match its directory".into());
        }
    }
    let repositories = project
        .as_ref()
        .map(|p| p.repositories.iter().map(|r| r.id.clone()).collect())
        .unwrap_or_default();
    let resources: BTreeSet<String> = indexed
        .iter()
        .filter_map(|r| match &r.definition {
            Some(DefinitionFile::Resource(v)) if !v.archived => Some(v.id.clone()),
            _ => None,
        })
        .collect();
    for i in 0..indexed.len() {
        let parts: Vec<_> = indexed[i].path.split('/').collect();
        if parts.first() != Some(&"plugins") {
            continue;
        }
        let prefix = format!("plugins/{}/", parts[1]);
        let plugin = indexed.iter().find_map(|r| {
            if r.path == format!("{prefix}plugin.json") {
                match &r.definition {
                    Some(DefinitionFile::Plugin(v)) => Some(v),
                    _ => None,
                }
            } else {
                None
            }
        });
        let error = if let Some((count, bytes)) = plugin_sizes.get(parts[1])
            && (*count > PLUGIN_ENTRY_LIMIT || *bytes > PLUGIN_BYTE_LIMIT as u64)
        {
            Some("Plugin exceeds 1000 entries or 50 MB".into())
        } else if let Some(plugin) = plugin {
            if let Some(DefinitionFile::Automation(automation)) = &indexed[i].definition {
                let mut skills = globals.clone();
                let mut tools = BTreeSet::new();
                for entry in indexed.iter().filter(|e| e.path.starts_with(&prefix)) {
                    match &entry.definition {
                        Some(DefinitionFile::Skill(skill)) => {
                            skills.insert(skill.id.clone());
                        }
                        Some(DefinitionFile::Tool(_)) => {
                            tools.insert(entry.path.split('/').nth(3).unwrap().into());
                        }
                        _ => (),
                    }
                }
                validate_references(
                    automation,
                    plugin,
                    &skills,
                    &tools,
                    &resources,
                    &repositories,
                )
                .err()
            } else {
                None
            }
        } else {
            Some("Plugin manifest is missing or invalid".into())
        };
        if indexed[i].error.is_none() {
            indexed[i].error = error;
        }
    }
    for entry in &mut indexed {
        if entry.error.is_none() {
            if let Some(DefinitionFile::Tool(tool)) = &entry.definition {
                let parent = entry.path.rsplit_once('/').unwrap().0;
                if let Err(error) = read(
                    root,
                    &format!("{parent}/{}", tool.entrypoint),
                    ENTRYPOINT_LIMIT,
                ) {
                    entry.error = Some(format!("Tool entrypoint: {error}"));
                }
            }
        }
    }
    // IDs may be reused by skills/tools copied into different plugins, but never within one scope.
    let mut ids = std::collections::BTreeMap::new();
    for i in 0..indexed.len() {
        if let Some(definition) = &indexed[i].definition {
            let id = definition.id();
            if id.is_empty() {
                continue;
            }
            let scope = match definition {
                DefinitionFile::Skill(_) | DefinitionFile::Tool(_) => indexed[i]
                    .path
                    .split('/')
                    .take(2)
                    .collect::<Vec<_>>()
                    .join("/"),
                _ => String::new(),
            };
            if let Some(previous) = ids.insert((scope, id.to_owned()), i) {
                let error = Some(format!("Duplicate definition ID: {id}"));
                indexed[previous].error = error.clone();
                indexed[i].error = error;
            }
        }
    }
    if indexed
        .iter()
        .filter(|f| matches!(f.definition, Some(DefinitionFile::Resource(_))))
        .count()
        > 512
        || indexed
            .iter()
            .filter(|f| matches!(f.definition, Some(DefinitionFile::Automation(_))))
            .count()
            > 256
    {
        return Err("Project exceeds resource or automation limits".into());
    }
    let schemas: Vec<_> = indexed
        .iter()
        .filter_map(|entry| {
            if entry.error.is_some() {
                return None;
            }
            let Some(DefinitionFile::ResourceType(schema)) = &entry.definition else {
                return None;
            };
            let filename = entry
                .path
                .rsplit('/')
                .next()?
                .strip_suffix(".schema.json")?;
            let (kind, version) = match filename.rsplit_once('@') {
                Some((kind, version)) => (kind.to_owned(), version.parse::<u32>().ok()?),
                None => (filename.to_owned(), 1),
            };
            Some((kind, version, schema.clone()))
        })
        .collect();
    for entry in &mut indexed {
        if entry.error.is_some() {
            continue;
        }
        if let Some(DefinitionFile::Resource(resource)) = &entry.definition {
            if builtin_resource_schema(&resource.type_id).is_some() {
                continue;
            }
            let matching: Vec<_> = schemas
                .iter()
                .filter(|(kind, version, _)| {
                    kind == &resource.type_id && *version == resource.type_version
                })
                .collect();
            entry.error = match matching.as_slice() {
                [(_, _, schema)] => {
                    inferay_core::projects::validate_json(schema, &resource.body).err()
                }
                [] => Some("Resource schema is missing or invalid".into()),
                _ => Some("Resource schema is ambiguous".into()),
            };
        }
    }
    let project_error = indexed
        .iter()
        .find(|f| f.path == "project.json")
        .and_then(|f| f.error.clone());
    let broken_plugins: BTreeSet<String> = indexed
        .iter()
        .filter(|f| f.error.is_some() && f.path.starts_with("plugins/"))
        .map(|f| f.path.split('/').take(2).collect::<Vec<_>>().join("/"))
        .collect();
    let broken_resources: BTreeSet<String> = indexed
        .iter()
        .filter(|f| f.error.is_some())
        .filter_map(|f| match &f.definition {
            Some(DefinitionFile::Resource(v)) => Some(v.id.clone()),
            _ => None,
        })
        .collect();
    for entry in &mut indexed {
        if entry.error.is_some() {
            continue;
        }
        if let Some(error) = &project_error {
            entry.error = Some(format!("Project blocked: {error}"));
            continue;
        }
        if broken_plugins
            .iter()
            .any(|p| entry.path.starts_with(&format!("{p}/")))
        {
            entry.error = Some("Plugin contains an invalid definition or file".into());
        }
        if let Some(DefinitionFile::Automation(AutomationDefinition {
            execution: DefinitionExecution::Agent { resources, .. },
            ..
        })) = &entry.definition
        {
            if resources.iter().any(|id| broken_resources.contains(id)) {
                entry.error = Some("Referenced resource is invalid".into());
            }
        }
    }
    Ok(indexed)
}

#[cfg(test)]
mod tests;
