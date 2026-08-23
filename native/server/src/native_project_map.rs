//! Read-only source analysis used by the project atlas.
//!
//! The module deliberately returns a compact, transport-friendly model. It
//! understands enough common import and declaration syntax to reveal real
//! project topology without pretending to be a language server.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

const MAX_PROJECT_FILES: usize = 360;
const MAX_SOURCE_BYTES: u64 = 384 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 10;
const MAX_SYMBOLS_PER_FILE: usize = 18;
const MAX_IMPORTS_PER_FILE: usize = 48;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMapSymbol {
    pub kind: String,
    pub name: String,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMapFile {
    pub name: String,
    pub path: String,
    pub directory: String,
    pub extension: String,
    pub language: String,
    pub lines: usize,
    pub bytes: u64,
    pub symbols: Vec<ProjectMapSymbol>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMapEdge {
    pub source: String,
    pub target: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMap {
    pub name: String,
    pub cwd: String,
    pub files: Vec<ProjectMapFile>,
    pub edges: Vec<ProjectMapEdge>,
    pub total_files: usize,
    pub total_lines: usize,
    pub total_bytes: u64,
    pub directory_count: usize,
    pub symbol_count: usize,
    pub language_counts: BTreeMap<String, usize>,
    pub truncated: bool,
}

#[derive(Debug)]
struct ScannedFile {
    file: ProjectMapFile,
    imports: Vec<String>,
}

struct SymbolRegexes {
    function: Regex,
    declaration: Regex,
    component: Regex,
    route: Regex,
    axum_route: Regex,
    native_route: Regex,
}

fn symbol_regexes() -> &'static SymbolRegexes {
    static REGEXES: OnceLock<SymbolRegexes> = OnceLock::new();
    REGEXES.get_or_init(|| SymbolRegexes {
        function: Regex::new(
            r"(?x)^\s*(?:pub(?:\([^)]*\))?\s+|export\s+|default\s+|async\s+|static\s+|private\s+|protected\s+|public\s+)*(?:async\s+)?(?:fn|function|def|func)\s+([A-Za-z_$][\w$]*)",
        )
        .expect("valid function regex"),
        declaration: Regex::new(
            r"(?x)^\s*(?:pub(?:\([^)]*\))?\s+|export\s+|default\s+|private\s+|protected\s+|public\s+)*(?:class|struct|enum|trait|interface|type)\s+([A-Za-z_$][\w$]*)",
        )
        .expect("valid declaration regex"),
        component: Regex::new(
            r"^\s*(?:export\s+)?const\s+([A-Z][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:memo\s*\()?\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
        )
        .expect("valid component regex"),
        route: Regex::new(
            r#"(?i)(?:\.|@)(get|post|put|patch|delete)\s*\(\s*[\"']([^\"']+)[\"']"#,
        )
        .expect("valid route regex"),
        axum_route: Regex::new(
            r#"\.route\s*\(\s*[\"']([^\"']+)[\"']\s*,\s*(get|post|put|patch|delete)"#,
        )
        .expect("valid axum route regex"),
        native_route: Regex::new(
            r#"path\s*==\s*[\"']([^\"']+)[\"'].*Method::(GET|POST|PUT|PATCH|DELETE)"#,
        )
        .expect("valid native route regex"),
    })
}

fn import_regexes() -> &'static [Regex] {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES
        .get_or_init(|| {
            [
                r#"(?:from|require\s*\(|import\s*\()\s*[\"']([^\"']+)[\"']"#,
                r#"^\s*import\s+[\"']([^\"']+)[\"']"#,
                r"^\s*(?:pub\s+)?(?:use|mod)\s+([A-Za-z_][A-Za-z0-9_:]*)",
                r"^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+",
                r"^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)",
            ]
            .into_iter()
            .map(|pattern| Regex::new(pattern).expect("valid import regex"))
            .collect()
        })
        .as_slice()
}

pub fn build_project_map(root: &Path) -> ProjectMap {
    let mut paths = Vec::new();
    collect_source_paths(root, root, 0, &mut paths);
    paths.sort();

    let truncated = paths.len() > MAX_PROJECT_FILES;
    paths.truncate(MAX_PROJECT_FILES);

    let scanned = paths
        .iter()
        .filter_map(|path| scan_file(root, path))
        .collect::<Vec<_>>();
    let files = scanned
        .iter()
        .map(|entry| entry.file.clone())
        .collect::<Vec<_>>();
    let edges = resolve_edges(&scanned);
    let total_lines = files.iter().map(|file| file.lines).sum();
    let total_bytes = files.iter().map(|file| file.bytes).sum();
    let symbol_count = files.iter().map(|file| file.symbols.len()).sum();
    let directory_count = files
        .iter()
        .map(|file| file.directory.as_str())
        .collect::<HashSet<_>>()
        .len();
    let mut language_counts = BTreeMap::new();
    for file in &files {
        *language_counts.entry(file.language.clone()).or_insert(0) += 1;
    }

    ProjectMap {
        name: root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
        cwd: root.to_string_lossy().into_owned(),
        total_files: files.len(),
        total_lines,
        total_bytes,
        directory_count,
        symbol_count,
        language_counts,
        files,
        edges,
        truncated,
    }
}

fn collect_source_paths(root: &Path, directory: &Path, depth: usize, paths: &mut Vec<PathBuf>) {
    if depth > MAX_DIRECTORY_DEPTH || paths.len() > MAX_PROJECT_FILES * 2 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries = entries.flatten().collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if !ignored_directory(&name) {
                collect_source_paths(root, &path, depth + 1, paths);
            }
            continue;
        }
        if !kind.is_file() || !is_source_file(&path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() <= MAX_SOURCE_BYTES && path.starts_with(root) {
            paths.push(path);
        }
    }
}

fn ignored_directory(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | "coverage"
                | "vendor"
                | "Pods"
                | "DerivedData"
                | "__pycache__"
        )
}

fn is_source_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some(
            "ts" | "tsx"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "rs"
                | "py"
                | "go"
                | "swift"
                | "kt"
                | "kts"
                | "java"
                | "rb"
                | "php"
                | "cs"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "vue"
                | "svelte"
                | "astro"
                | "sql"
                | "graphql"
                | "gql"
        )
    )
}

fn language_for(extension: &str) -> &'static str {
    match extension {
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "swift" => "Swift",
        "kt" | "kts" => "Kotlin",
        "java" => "Java",
        "rb" => "Ruby",
        "php" => "PHP",
        "cs" => "C#",
        "c" | "h" => "C",
        "cpp" | "hpp" => "C++",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "astro" => "Astro",
        "sql" => "SQL",
        "graphql" | "gql" => "GraphQL",
        _ => "Source",
    }
}

fn scan_file(root: &Path, path: &Path) -> Option<ScannedFile> {
    let metadata = std::fs::metadata(path).ok()?;
    let content = std::fs::read_to_string(path).ok()?;
    let relative = path
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let name = path.file_name()?.to_string_lossy().into_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let directory = Path::new(&relative)
        .parent()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".into());
    let lines = if content.is_empty() {
        0
    } else {
        content.lines().count()
    };

    Some(ScannedFile {
        file: ProjectMapFile {
            name,
            path: relative,
            directory,
            language: language_for(&extension).into(),
            extension,
            lines,
            bytes: metadata.len(),
            symbols: extract_symbols(&content),
        },
        imports: extract_imports(&content),
    })
}

fn capture(regex: &Regex, line: &str, index: usize) -> Option<String> {
    regex
        .captures(line)
        .and_then(|captures| captures.get(index))
        .map(|value| value.as_str().trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn extract_symbols(content: &str) -> Vec<ProjectMapSymbol> {
    let regexes = symbol_regexes();
    let mut symbols = Vec::new();
    let mut seen = HashSet::new();

    for (index, line) in content.lines().enumerate() {
        let candidate = if let Some(captures) = regexes.route.captures(line) {
            Some((
                "route",
                format!(
                    "{} {}",
                    captures
                        .get(1)
                        .map_or("", |value| value.as_str())
                        .to_uppercase(),
                    captures.get(2).map_or("", |value| value.as_str())
                ),
            ))
        } else if let Some(captures) = regexes.axum_route.captures(line) {
            Some((
                "route",
                format!(
                    "{} {}",
                    captures
                        .get(2)
                        .map_or("", |value| value.as_str())
                        .to_uppercase(),
                    captures.get(1).map_or("", |value| value.as_str())
                ),
            ))
        } else if let Some(captures) = regexes.native_route.captures(line) {
            Some((
                "route",
                format!(
                    "{} {}",
                    captures.get(2).map_or("", |value| value.as_str()),
                    captures.get(1).map_or("", |value| value.as_str())
                ),
            ))
        } else if let Some(name) = capture(&regexes.function, line, 1) {
            Some(("function", name))
        } else if let Some(name) = capture(&regexes.declaration, line, 1) {
            Some(("type", name))
        } else {
            capture(&regexes.component, line, 1).map(|name| ("component", name))
        };
        let Some((kind, name)) = candidate else {
            continue;
        };
        let key = format!("{kind}:{name}");
        if seen.insert(key) {
            symbols.push(ProjectMapSymbol {
                kind: kind.into(),
                name,
                line: index + 1,
            });
        }
        if symbols.len() >= MAX_SYMBOLS_PER_FILE {
            break;
        }
    }
    symbols
}

fn extract_imports(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    let mut seen = HashSet::new();
    for line in content.lines() {
        for regex in import_regexes() {
            for captures in regex.captures_iter(line) {
                let Some(value) = captures.get(1).map(|value| value.as_str().trim()) else {
                    continue;
                };
                if !value.is_empty() && seen.insert(value.to_owned()) {
                    imports.push(value.to_owned());
                }
                if imports.len() >= MAX_IMPORTS_PER_FILE {
                    return imports;
                }
            }
        }
    }
    imports
}

fn path_key(path: &str) -> String {
    let mut parts = Vec::new();
    for part in path.replace('\\', "/").split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part.to_owned()),
        }
    }
    let mut value = parts.join("/");
    let last_slash = value.rfind('/').map_or(0, |index| index + 1);
    if let Some(extension_offset) = value[last_slash..].rfind('.') {
        value.truncate(last_slash + extension_offset);
    }
    value.trim_end_matches("/index").to_owned()
}

fn import_candidates(source_path: &str, import: &str) -> Vec<String> {
    let source_directory = Path::new(source_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let normalized = import
        .trim_matches(';')
        .trim_start_matches("crate::")
        .trim_start_matches("self::")
        .replace("::", "/")
        .replace('.', "/");
    let mut candidates = Vec::new();
    if import.starts_with('.') {
        let joined = source_directory.join(import);
        candidates.push(path_key(&joined.to_string_lossy()));
    } else {
        candidates.push(path_key(
            &source_directory.join(&normalized).to_string_lossy(),
        ));
        candidates.push(path_key(&normalized));
        candidates.push(path_key(&format!("src/{normalized}")));
        candidates.push(path_key(&format!("app/{normalized}")));
    }
    candidates
}

fn resolve_edges(scanned: &[ScannedFile]) -> Vec<ProjectMapEdge> {
    let mut exact = HashMap::<String, String>::new();
    for entry in scanned {
        let key = path_key(&entry.file.path);
        exact.insert(key.clone(), entry.file.path.clone());
        if let Some(stripped) = key.strip_prefix("src/") {
            exact
                .entry(stripped.into())
                .or_insert_with(|| entry.file.path.clone());
        }
    }

    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    for entry in scanned {
        for import in &entry.imports {
            let target = import_candidates(&entry.file.path, import)
                .into_iter()
                .find_map(|candidate| exact.get(&candidate).cloned());
            let Some(target) = target else {
                continue;
            };
            if target == entry.file.path {
                continue;
            }
            let key = format!("{}>{target}", entry.file.path);
            if seen.insert(key) {
                edges.push(ProjectMapEdge {
                    source: entry.file.path.clone(),
                    target,
                });
            }
        }
    }
    edges.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));
    edges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_real_files_symbols_and_relative_imports() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("src/ui")).unwrap();
        std::fs::write(
            root.path().join("src/main.ts"),
            "import { Panel } from './ui/Panel';\nexport function boot() {}\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join("src/ui/Panel.tsx"),
            "export const Panel = () => <div />;\n",
        )
        .unwrap();

        let map = build_project_map(root.path());

        assert_eq!(map.total_files, 2);
        assert_eq!(map.directory_count, 2);
        assert!(map.files.iter().any(|file| {
            file.path == "src/main.ts"
                && file
                    .symbols
                    .iter()
                    .any(|symbol| symbol.name == "boot" && symbol.kind == "function")
        }));
        assert!(map.files.iter().any(|file| {
            file.path == "src/ui/Panel.tsx"
                && file
                    .symbols
                    .iter()
                    .any(|symbol| symbol.name == "Panel" && symbol.kind == "component")
        }));
        assert_eq!(
            map.edges,
            vec![ProjectMapEdge {
                source: "src/main.ts".into(),
                target: "src/ui/Panel.tsx".into(),
            }]
        );
    }

    #[test]
    fn ignores_generated_and_dependency_directories() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.path().join("target/debug")).unwrap();
        std::fs::write(root.path().join("app.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.path().join("node_modules/pkg/index.js"), "export {}\n").unwrap();
        std::fs::write(root.path().join("target/debug/build.rs"), "fn build() {}\n").unwrap();

        let map = build_project_map(root.path());

        assert_eq!(map.total_files, 1);
        assert_eq!(map.files[0].path, "app.rs");
    }

    #[test]
    fn resolves_native_routes_and_rust_modules_without_invented_edges() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("native/server/src")).unwrap();
        std::fs::write(
            root.path().join("native/server/src/lib.rs"),
            "mod project_map;\nif path == \"/api/map\" && request.method() == Method::GET {}\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join("native/server/src/project_map.rs"),
            "pub fn build() {}\n",
        )
        .unwrap();

        let map = build_project_map(root.path());

        assert!(map.files.iter().any(|file| {
            file.path == "native/server/src/lib.rs"
                && file
                    .symbols
                    .iter()
                    .any(|symbol| symbol.kind == "route" && symbol.name == "GET /api/map")
        }));
        assert_eq!(
            map.edges,
            vec![ProjectMapEdge {
                source: "native/server/src/lib.rs".into(),
                target: "native/server/src/project_map.rs".into(),
            }]
        );
    }
}
