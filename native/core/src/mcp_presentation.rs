//! MCP tool names carry their own provenance: `mcp__<server>__<tool>`.
//! Resolving that into a brand and a sentence keeps the transcript readable
//! without curating a logo for every server a workspace happens to install.
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSource {
    /// Stable lookup key for a bundled brand mark; also seeds the fallback tint.
    pub server_id: String,
    pub server_label: String,
    /// Initials drawn when no brand mark is known for `server_id`.
    pub monogram: String,
    /// Deterministic hue so an unbranded server keeps one identity everywhere.
    pub hue: u16,
}

/// Connector namespaces the host prepends; they name the host, not the server.
const NAMESPACES: &[&str] = &["claude_ai_", "claude_ai:", "plugin_", "plugin:"];
/// Segment pairs that read as one noun, joined before the verb search.
const PHRASES: &[(&str, &str)] = &[("pull", "request"), ("merge", "request")];
/// Verbs are stored bare and rendered as the gerund the transcript reads in.
const VERBS: &[(&str, &str)] = &[
    ("add", "Adding"),
    ("analyze", "Analyzing"),
    ("apply", "Applying"),
    ("assign", "Assigning"),
    ("authenticate", "Connecting"),
    ("build", "Building"),
    ("call", "Calling"),
    ("cancel", "Cancelling"),
    ("check", "Checking"),
    ("checkout", "Checking out"),
    ("clone", "Cloning"),
    ("close", "Closing"),
    ("commit", "Committing"),
    ("complete", "Completing"),
    ("connect", "Connecting"),
    ("convert", "Converting"),
    ("copy", "Copying"),
    ("create", "Creating"),
    ("delete", "Deleting"),
    ("deploy", "Deploying"),
    ("describe", "Describing"),
    ("download", "Downloading"),
    ("duplicate", "Duplicating"),
    ("edit", "Editing"),
    ("exec", "Running"),
    ("execute", "Running"),
    ("export", "Exporting"),
    ("fetch", "Fetching"),
    ("find", "Finding"),
    ("generate", "Generating"),
    ("get", "Reading"),
    ("import", "Importing"),
    ("insert", "Inserting"),
    ("invoke", "Running"),
    ("list", "Listing"),
    ("load", "Loading"),
    ("lookup", "Looking up"),
    ("make", "Creating"),
    ("merge", "Merging"),
    ("modify", "Updating"),
    ("move", "Moving"),
    ("open", "Opening"),
    ("patch", "Updating"),
    ("publish", "Publishing"),
    ("pull", "Pulling"),
    ("push", "Pushing"),
    ("query", "Querying"),
    ("read", "Reading"),
    ("recolor", "Recoloring"),
    ("remove", "Removing"),
    ("rename", "Renaming"),
    ("reserve", "Reserving"),
    ("resize", "Resizing"),
    ("resolve", "Resolving"),
    ("restart", "Restarting"),
    ("review", "Reviewing"),
    ("run", "Running"),
    ("save", "Saving"),
    ("search", "Searching"),
    ("send", "Sending"),
    ("set", "Setting"),
    ("show", "Reading"),
    ("start", "Starting"),
    ("stash", "Stashing"),
    ("stop", "Stopping"),
    ("submit", "Submitting"),
    ("sync", "Syncing"),
    ("take", "Taking"),
    ("update", "Updating"),
    ("upload", "Uploading"),
    ("view", "Reading"),
    ("write", "Writing"),
];
/// Words whose conventional casing survives humanization.
const BRANDS: &[(&str, &str)] = &[
    ("2d", "2D"),
    ("3d", "3D"),
    ("ai", "AI"),
    ("api", "API"),
    ("aws", "AWS"),
    ("cli", "CLI"),
    ("css", "CSS"),
    ("csv", "CSV"),
    ("db", "DB"),
    ("gcp", "GCP"),
    ("gif", "GIF"),
    ("github", "GitHub"),
    ("gitkraken", "GitKraken"),
    ("gitlab", "GitLab"),
    ("gitlens", "GitLens"),
    ("graphql", "GraphQL"),
    ("html", "HTML"),
    ("http", "HTTP"),
    ("id", "ID"),
    ("js", "JS"),
    ("json", "JSON"),
    ("jwt", "JWT"),
    ("mcp", "MCP"),
    ("npm", "npm"),
    ("openai", "OpenAI"),
    ("pdf", "PDF"),
    ("png", "PNG"),
    ("postgres", "Postgres"),
    ("pr", "PR"),
    ("sdk", "SDK"),
    ("seo", "SEO"),
    ("sql", "SQL"),
    ("svg", "SVG"),
    ("ui", "UI"),
    ("url", "URL"),
    ("ux", "UX"),
    ("yaml", "YAML"),
];
/// A verb further right than this reads as part of the object, not the action.
const NAMESPACE_DEPTH: usize = 2;
/// Shorter matches collide with unrelated object words, so they never elide.
const ELISION_MIN_LENGTH: usize = 3;
/// Evenly spaced tints, offset off the primaries they would otherwise land on.
const TINT_STEPS: u16 = 12;
const TINT_OFFSET: u16 = 15;

fn lookup<'a>(table: &[(&str, &'a str)], word: &str) -> Option<&'a str> {
    table
        .iter()
        .find(|(key, _)| *key == word)
        .map(|(_, value)| *value)
}
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}
/// Preserve deliberate casing (`GitKraken`), otherwise defer to the brand table.
fn brand_case(word: &str) -> String {
    let lowered = word.to_lowercase();
    if let Some(brand) = lookup(BRANDS, &lowered) {
        return brand.into();
    }
    if word.chars().any(char::is_uppercase) {
        return word.into();
    }
    lowered
}
fn capitalize(text: &str) -> String {
    let mut characters = text.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().collect::<String>() + characters.as_str()
    })
}
fn title_case(word: &str) -> String {
    let cased = brand_case(word);
    if cased == word.to_lowercase() {
        capitalize(&cased)
    } else {
        cased
    }
}
fn join(parts: &[String]) -> String {
    let mut rendered: Vec<String> = Vec::with_capacity(parts.len());
    for part in parts {
        let cased = brand_case(part);
        // `3d_generate_3d_model` names its dimension twice; say it once.
        if rendered.contains(&cased) {
            continue;
        }
        rendered.push(cased);
    }
    rendered.join(" ")
}
fn strip_namespace(server: &str) -> &str {
    NAMESPACES
        .iter()
        .find_map(|prefix| server.strip_prefix(prefix))
        .unwrap_or(server)
}
/// `plugin:vercel:vercel` names the marketplace, the plugin, and the server.
fn dedupe(parts: Vec<String>) -> Vec<String> {
    let mut unique: Vec<String> = Vec::with_capacity(parts.len());
    for part in parts {
        if unique
            .last()
            .is_some_and(|last| last.eq_ignore_ascii_case(&part))
        {
            continue;
        }
        unique.push(part);
    }
    unique
}
fn hue(server_id: &str) -> u16 {
    let hash = server_id.bytes().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
    });
    // FNV's low bits cluster, and the ring only has twelve steps to give away,
    // so the hash is avalanched before the ones that pick a step are read.
    let mixed = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    let mixed = (mixed ^ (mixed >> 15)).wrapping_mul(0x846c_a68b);
    let mixed = mixed ^ (mixed >> 16);
    // Two servers sharing a step read as a deliberate pair; two servers a few
    // degrees apart read as a rendering wobble. So the ring is quantized.
    let step = u16::try_from(mixed % u32::from(TINT_STEPS)).unwrap_or_default();
    step * (360 / TINT_STEPS) + TINT_OFFSET
}
fn monogram(label: &str) -> String {
    let capitals: String = label.chars().filter(|c| c.is_uppercase()).take(2).collect();
    if capitals.len() > 1 {
        return capitals;
    }
    label
        .chars()
        .find(char::is_ascii_alphanumeric)
        .map(|first| first.to_uppercase().collect())
        .unwrap_or_else(|| "?".into())
}
/// Split `mcp__<server>__<tool>`; the tool half may hold no further separator.
fn split(tool_name: &str) -> Option<(&str, &str)> {
    let (server, tool) = tool_name.strip_prefix("mcp__")?.split_once("__")?;
    (!server.is_empty() && !tool.is_empty()).then_some((server, tool))
}
/// Collapse compound nouns so their leading half is not read as the action.
fn phrases(parts: Vec<String>) -> Vec<String> {
    let mut joined: Vec<String> = Vec::with_capacity(parts.len());
    let mut index = 0;
    while index < parts.len() {
        let pair = parts.get(index + 1).and_then(|next| {
            PHRASES
                .iter()
                .find(|(left, right)| parts[index] == *left && next == right)
        });
        if pair.is_some() {
            joined.push(format!("{} {}", parts[index], parts[index + 1]));
            index += 2;
        } else {
            joined.push(parts[index].clone());
            index += 1;
        }
    }
    joined
}
fn action(server_id: &str, tool: &str) -> String {
    let parts = phrases(words(tool));
    let verb = parts
        .iter()
        .take(NAMESPACE_DEPTH + 1)
        .position(|part| lookup(VERBS, part.as_str()).is_some());
    let Some(verb) = verb else {
        // No action to name, so the tool reads as the noun it already is, minus
        // any leading restatement of the server that owns it.
        let elided = parts
            .iter()
            .enumerate()
            .filter(|(index, part)| *index > 0 || !elides(server_id, part))
            .map(|(_, part)| part.clone())
            .collect::<Vec<_>>();
        let rendered = join(if elided.is_empty() { &parts } else { &elided });
        return rendered.split_once(' ').map_or_else(
            || title_case(&rendered),
            |(first, rest)| format!("{} {rest}", title_case(first)),
        );
    };
    let gerund = lookup(VERBS, parts[verb].as_str()).unwrap_or_default();
    // Namespace segments qualify the object; the server's own name does not.
    let object = parts[..verb]
        .iter()
        .filter(|part| !elides(server_id, part))
        .chain(parts[verb + 1..].iter())
        .cloned()
        .collect::<Vec<_>>();
    let rendered = join(&object);
    if rendered.is_empty() {
        gerund.into()
    } else {
        format!("{gerund} {rendered}")
    }
}
fn elides(server_id: &str, word: &str) -> bool {
    word.len() >= ELISION_MIN_LENGTH && server_id.contains(&word.to_lowercase())
}
/// Brand and sentence for one MCP tool call, or `None` for a first-party tool.
pub fn resolve(tool_name: &str) -> Option<(McpToolSource, String)> {
    let (server, tool) = split(tool_name)?;
    let parts = dedupe(words(strip_namespace(server)));
    let server_label = parts
        .iter()
        .map(|part| title_case(part))
        .collect::<Vec<_>>()
        .join(" ");
    if server_label.is_empty() {
        return None;
    }
    let server_id = parts.join("").to_lowercase();
    Some((
        McpToolSource {
            monogram: monogram(&server_label),
            hue: hue(&server_id),
            server_id: server_id.clone(),
            server_label,
        },
        action(&server_id, tool),
    ))
}
