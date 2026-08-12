use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    let package: serde_json::Value = serde_json::from_slice(
        &fs::read(&package_json)
            .map_err(|error| format!("failed to read {}: {error}", package_json.display()))?,
    )
    .map_err(|error| format!("failed to parse {}: {error}", package_json.display()))?;
    let version = package
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "packages/inferay/package.json is missing version".to_owned())?;

    let contents = app_path.join("Contents");
    let plist = contents.join("Info.plist");
    let resources = contents.join("Resources");
    let version_json = resources.join("version.json");

    assert_file(&plist)?;
    assert_file(&contents.join("MacOS/inferay"))?;
    assert_file(&resources.join("dist/index.html"))?;
    assert_file(&resources.join("dist/main.js"))?;
    assert_file(&resources.join("data/prompts.json"))?;
    assert_file(&resources.join("public/app-icon.png"))?;
    assert_file(&resources.join("packages/inferay/package.json"))?;

    plist_set(&plist, "CFBundleName", APP_NAME)?;
    plist_set(&plist, "CFBundleDisplayName", APP_NAME)?;
    plist_set(&plist, "CFBundleIdentifier", APP_IDENTIFIER)?;
    plist_set(&plist, "CFBundleShortVersionString", version)?;
    plist_set(&plist, "CFBundleVersion", &bundle_version(version)?)?;

    let content_hash = hash_tree(&app_path, &["Contents/Resources/version.json"])?;
    let json_string = |value: &str| {
        serde_json::to_string(value)
            .map_err(|error| format!("failed to encode version.json: {error}"))
    };
    // Keep the same key order and tab indentation as JSON.stringify(value, null, "\t").
    let encoded = format!(
        "{{\n\t\"version\": {},\n\t\"hash\": {},\n\t\"channel\": \"stable\",\n\t\"baseUrl\": \"\",\n\t\"name\": \"inferay\",\n\t\"identifier\": \"com.inferay.app\"\n}}\n",
        json_string(version)?,
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

fn bundle_version(version: &str) -> Result<String, String> {
    let components: Vec<&str> = version.split('.').collect();
    if components.len() != 3
        || components.iter().any(|component| {
            component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(format!("invalid package version: {version}"));
    }
    let parse = |component: &str| {
        component
            .parse::<u64>()
            .map_err(|_| format!("invalid package version: {version}"))
    };
    let major = parse(components[0])?;
    let minor = parse(components[1])?;
    let patch = parse(components[2])?;
    major
        .checked_mul(1_000_000)
        .and_then(|value| {
            minor
                .checked_mul(1_000)
                .and_then(|minor| value.checked_add(minor))
        })
        .and_then(|value| value.checked_add(patch))
        .map(|value| value.to_string())
        .ok_or_else(|| format!("invalid package version: {version}"))
}

fn hash_tree(root: &Path, skip: &[&str]) -> Result<String, String> {
    let mut hash = Sha256::new();
    visit_hash_tree(root, root, skip, &mut hash)?;
    let digest = format!("{:x}", hash.finalize());
    Ok(digest[..12].to_owned())
}

fn visit_hash_tree(
    root: &Path,
    directory: &Path,
    skip: &[&str],
    hash: &mut Sha256,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("failed to read {}: {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {}: {error}", directory.display()))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("failed to hash {}: {error}", path.display()))?;
        let relative_text = relative_path(relative)?;
        if skip.contains(&relative_text.as_str()) || entry.file_name() == OsStr::new(".DS_Store") {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            hash.update(format!("dir:{relative_text}\0"));
            visit_hash_tree(root, &path, skip, hash)?;
        } else if file_type.is_file() {
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
            hash.update(format!("file:{relative_text}:{}\0", metadata.mode()));
            let mut file = File::open(&path)
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = file
                    .read(&mut buffer)
                    .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
                if read == 0 {
                    break;
                }
                hash.update(&buffer[..read]);
            }
        }
    }
    Ok(())
}

fn relative_path(path: &Path) -> Result<String, String> {
    let parts =
        path.components()
            .map(|component| {
                component.as_os_str().to_str().ok_or_else(|| {
                    format!("release app contains a non-UTF-8 path: {}", path.display())
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join("/"))
}

fn list_mach_o_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    visit_mach_o_files(root, &mut files)?;
    Ok(files)
}

fn visit_mach_o_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("failed to read {}: {error}", directory.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read {}: {error}", directory.display()))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            visit_mach_o_files(&path, files)?;
        } else if file_type.is_file() {
            let output = run_command(Command::new("file").args(["-b"]).arg(&path))?;
            if output.contains("Mach-O") {
                files.push(path);
            }
        }
    }
    Ok(())
}

fn ad_hoc_sign_app(app_path: &Path) -> Result<(), String> {
    let temp_dir = tempfile::Builder::new()
        .prefix("inferay-sign-")
        .tempdir()
        .map_err(|error| format!("failed to create signing directory: {error}"))?;
    let entitlements = temp_dir.path().join("entitlements.plist");
    let mut file = File::create(&entitlements)
        .map_err(|error| format!("failed to create {}: {error}", entitlements.display()))?;
    file.write_all(ENTITLEMENTS.as_bytes())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn bundle_version_matches_release_script() {
        assert_eq!(bundle_version("1.2.3").unwrap(), "1002003");
        assert_eq!(bundle_version("0.20.104").unwrap(), "20104");
        assert!(bundle_version("1.2").is_err());
        assert!(bundle_version("1.2.3-beta.1").is_err());
    }

    #[test]
    fn tree_hash_is_deterministic_and_honors_exclusions() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("Contents/Resources")).unwrap();
        fs::write(temp.path().join("z.txt"), b"last").unwrap();
        fs::write(temp.path().join("a.txt"), b"first").unwrap();
        fs::write(temp.path().join(".DS_Store"), b"ignored").unwrap();
        let version = temp.path().join("Contents/Resources/version.json");
        fs::write(&version, b"old").unwrap();
        fs::set_permissions(temp.path().join("a.txt"), fs::Permissions::from_mode(0o640)).unwrap();

        let first = hash_tree(temp.path(), &["Contents/Resources/version.json"]).unwrap();
        fs::write(&version, b"new metadata").unwrap();
        fs::write(temp.path().join(".DS_Store"), b"changed ignored metadata").unwrap();
        let second = hash_tree(temp.path(), &["Contents/Resources/version.json"]).unwrap();
        assert_eq!(first, second);

        fs::write(temp.path().join("a.txt"), b"changed").unwrap();
        let third = hash_tree(temp.path(), &["Contents/Resources/version.json"]).unwrap();
        assert_ne!(first, third);
    }
}
