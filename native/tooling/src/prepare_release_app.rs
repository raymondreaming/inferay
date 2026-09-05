use crate::release::{bundle_version, read_package_version};
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs::{self, File};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

const APP_NAME: &str = "inferay";
const APP_IDENTIFIER: &str = "com.inferay.app";
const ENTITLEMENTS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.device.microphone</key>
	<true/>
	<key>com.apple.security.personal-information.speech-recognition</key>
	<true/>
</dict>
</plist>
"#;

/// Faithful native implementation of the release-app preparation workflow.
///
/// `args` contains command arguments after the program/subcommand name. The
/// first argument must name an existing `.app` bundle; additional arguments
/// are ignored, matching the Bun script.
pub fn run(args: &[String]) -> Result<(), String> {
    let app_argument = args.first().ok_or_else(usage)?;
    let app_path = absolute_path(Path::new(app_argument))?;
    if app_path.extension() != Some(OsStr::new("app")) || !app_path.exists() {
        return Err(usage());
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let package_json = root.join("packages/inferay/package.json");
    let version = read_package_version(&package_json)?;

    let contents = app_path.join("Contents");
    let plist = contents.join("Info.plist");
    let resources = contents.join("Resources");
    let version_json = resources.join("version.json");

    assert_file(&plist)?;
    assert_file(&contents.join("MacOS/inferay"))?;
    let renderer_dist = resources.join("dist");
    let renderer_index = renderer_dist.join("index.html");
    assert_file(&renderer_index)?;
    assert_renderer_entries(&renderer_dist, &renderer_index)?;
    assert_file(&resources.join("data/prompts.json"))?;
    assert_file(&resources.join("public/app-icon.png"))?;
    assert_file(&resources.join("packages/inferay/package.json"))?;

    plist_set(&plist, "CFBundleName", APP_NAME)?;
    plist_set(&plist, "CFBundleDisplayName", APP_NAME)?;
    plist_set(&plist, "CFBundleIdentifier", APP_IDENTIFIER)?;
    plist_set(&plist, "CFBundleShortVersionString", &version)?;
    plist_set(&plist, "CFBundleVersion", &bundle_version(&version)?)?;

    let content_hash = hash_tree(&app_path, &["Contents/Resources/version.json"])?;
    let json_string = |value: &str| {
        serde_json::to_string(value)
            .map_err(|error| format!("failed to encode version.json: {error}"))
    };
    // Keep the same key order and tab indentation as JSON.stringify(value, null, "\t").
    let encoded = format!(
        "{{\n\t\"version\": {},\n\t\"hash\": {},\n\t\"channel\": \"stable\",\n\t\"baseUrl\": \"\",\n\t\"name\": \"inferay\",\n\t\"identifier\": \"com.inferay.app\"\n}}\n",
        json_string(&version)?,
        json_string(&content_hash)?,
    );
    fs::write(&version_json, encoded)
        .map_err(|error| format!("failed to write {}: {error}", version_json.display()))?;

    ad_hoc_sign_app(&app_path)?;
    println!("[release-app] prepared {APP_NAME}.app {version} ({content_hash})");
    Ok(())
}

fn usage() -> String {
    "Usage: inferay-tooling prepare-release-app <path-to-app>".to_owned()
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_owned())
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(|error| format!("failed to resolve app path: {error}"))
    }
}

fn assert_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        Ok(())
    } else {
        Err(format!("missing release app file: {}", path.display()))
    }
}

fn assert_renderer_entries(dist: &Path, index: &Path) -> Result<(), String> {
    let html = fs::read_to_string(index)
        .map_err(|error| format!("failed to read {}: {error}", index.display()))?;
    let entries = html
        .split("src=\"")
        .skip(1)
        .filter_map(|part| part.split_once('"').map(|(source, _)| source))
        .filter(|source| source.starts_with("/assets/") && source.ends_with(".js"))
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err(format!(
            "release renderer has no JavaScript entry in {}",
            index.display()
        ));
    }
    for entry in entries {
        assert_file(&dist.join(entry.trim_start_matches('/')))?;
    }
    Ok(())
}

fn plist_set(plist: &Path, key: &str, value: &str) -> Result<(), String> {
    let set = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", &format!("Set :{key} {value}")])
        .arg(plist)
        .output()
        .map_err(|error| format!("failed to run PlistBuddy: {error}"))?;
    if set.status.success() {
        return Ok(());
    }
    run_command(
        Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", &format!("Add :{key} string {value}")])
            .arg(plist),
    )?;
    Ok(())
}

fn hash_tree(root: &Path, skip: &[&str]) -> Result<String, String> {
    let mut hash = Sha256::new();
    let mut entries = WalkDir::new(root)
        .min_depth(1)
        .sort_by_file_name()
        .into_iter();
    while let Some(entry) = entries.next() {
        let entry = entry.map_err(|error| format!("failed to read {}: {error}", root.display()))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("failed to hash {}: {error}", path.display()))?;
        let relative_text = relative.to_str().ok_or_else(|| {
            format!(
                "release app contains a non-UTF-8 path: {}",
                relative.display()
            )
        })?;
        if skip.contains(&relative_text) || entry.file_name() == OsStr::new(".DS_Store") {
            if entry.file_type().is_dir() {
                entries.skip_current_dir();
            }
            continue;
        }
        if entry.file_type().is_dir() {
            hash.update(format!("dir:{relative_text}\0"));
        } else if entry.file_type().is_file() {
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
            hash.update(format!("file:{relative_text}:{}\0", metadata.mode()));
            let mut file = File::open(path)
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
            std::io::copy(&mut file, &mut hash)
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        }
    }
    let digest = format!("{:x}", hash.finalize());
    Ok(digest[..12].to_owned())
}

fn list_mach_o_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root).min_depth(1) {
        let entry = entry.map_err(|error| format!("failed to read {}: {error}", root.display()))?;
        if entry.file_type().is_file() {
            let output = run_command(Command::new("file").args(["-b"]).arg(entry.path()))?;
            if output.contains("Mach-O") {
                files.push(entry.into_path());
            }
        }
    }
    Ok(files)
}

fn ad_hoc_sign_app(app_path: &Path) -> Result<(), String> {
    let temp_dir = tempfile::Builder::new()
        .prefix("inferay-sign-")
        .tempdir()
        .map_err(|error| format!("failed to create signing directory: {error}"))?;
    let entitlements = temp_dir.path().join("entitlements.plist");
    fs::write(&entitlements, ENTITLEMENTS)
        .map_err(|error| format!("failed to write {}: {error}", entitlements.display()))?;

    for path in list_mach_o_files(app_path)? {
        run_command(
            Command::new("codesign")
                .args(["--force", "--sign", "-"])
                .arg(path),
        )?;
    }
    run_command(
        Command::new("codesign")
            .args(["--force", "--sign", "-", "--entitlements"])
            .arg(&entitlements)
            .arg(app_path),
    )?;
    Ok(())
}

fn run_command(command: &mut Command) -> Result<String, String> {
    let rendered = format!("{command:?}");
    let output = command
        .output()
        .map_err(|error| format!("failed to run {rendered}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "command failed ({}): {rendered}\n{}{}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
