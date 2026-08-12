use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const BUN_CACHE: &str = "/private/tmp/inferay-bun-cache";
const DEFAULT_RELEASE_REPO: &str = "raymondreaming/inferay";

#[derive(Debug, Clone, PartialEq, Eq)]
struct Options {
    bump_or_version: String,
    publish_existing: bool,
    repo: String,
    help: bool,
}

fn usage() {
    println!(
        "Usage:\n  bun run release [patch|minor|major|new|x.y.z] [--repo owner/repo]\n  bun run release --resume [--repo owner/repo]\n\nExamples:\n  bun run release\n  bun run release minor\n  bun run release 0.2.0\n  bun run release --resume\n"
    );
}

fn parse_args_with_repo_env(args: &[String], repo_env: Option<&str>) -> Result<Options, String> {
    let help = args.iter().any(|arg| arg == "--help" || arg == "-h");
    if help {
        return Ok(Options {
            bump_or_version: "patch".to_owned(),
            publish_existing: false,
            repo: DEFAULT_RELEASE_REPO.to_owned(),
            help: true,
        });
    }
    let repo_index = args.iter().position(|arg| arg == "--repo");
    let repo = match repo_index {
        Some(index) => args.get(index + 1).cloned(),
        None => repo_env
            .map(str::to_owned)
            .or_else(|| Some(DEFAULT_RELEASE_REPO.to_owned())),
    }
    .filter(|repo| !repo.is_empty())
    .ok_or_else(|| "--repo requires owner/repo".to_owned())?;

    let positional = args
        .iter()
        .enumerate()
        .filter(|(index, arg)| {
            !arg.starts_with("--") && repo_index.is_none_or(|repo| *index != repo + 1)
        })
        .map(|(_, arg)| arg.clone())
        .collect::<Vec<_>>();

    Ok(Options {
        bump_or_version: positional
            .first()
            .cloned()
            .unwrap_or_else(|| "patch".to_owned()),
        publish_existing: args
            .iter()
            .any(|arg| arg == "--resume" || arg == "--publish-existing"),
        repo,
        help,
    })
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    parse_args_with_repo_env(args, env::var("INFERAY_RELEASE_REPO").ok().as_deref())
}

fn quote_arg(arg: &str) -> String {
    if arg
        .chars()
        .any(|character| character.is_whitespace() || character == '"')
    {
        serde_json::to_string(arg).unwrap_or_else(|_| arg.to_owned())
    } else {
        arg.to_owned()
    }
}

fn command_text(command: &[String]) -> String {
    command
        .iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

fn run_command(
    root: &Path,
    command: &[String],
    cwd: Option<&Path>,
    quiet: bool,
    allow_failure: bool,
) -> Result<i32, String> {
    if !quiet {
        println!("$ {}", command_text(command));
    }
    let (program, arguments) = command
        .split_first()
        .ok_or_else(|| "cannot run an empty command".to_owned())?;
    let mut process = Command::new(program);
    process.args(arguments).current_dir(cwd.unwrap_or(root));
    if quiet {
        process
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
    } else {
        process
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    }
    let status = process
        .status()
        .map_err(|error| format!("failed to run {}: {error}", command_text(command)))?;
    let exit_code = status.code().unwrap_or(1);
    if exit_code != 0 && !allow_failure {
        return Err(format!(
            "command failed ({exit_code}): {}",
            command_text(command)
        ));
    }
    Ok(exit_code)
}

fn capture(root: &Path, command: &[String], cwd: Option<&Path>) -> Result<String, String> {
    let (program, arguments) = command
        .split_first()
        .ok_or_else(|| "cannot run an empty command".to_owned())?;
    let output = Command::new(program)
        .args(arguments)
        .current_dir(cwd.unwrap_or(root))
        .output()
        .map_err(|error| format!("failed to run {}: {error}", command_text(command)))?;
    if !output.status.success() {
        return Err(format!(
            "command failed ({}): {}\n{}",
            output.status.code().unwrap_or(1),
            command_text(command),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn prompt_line(question: &str) -> Result<String, String> {
    print!("{question}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .map_err(|error| error.to_string())?;
    Ok(answer.trim().to_owned())
}

fn parse_version(version: &str) -> Result<(u64, u64, u64), String> {
    let components = version.split('.').collect::<Vec<_>>();
    if components.len() != 3
        || components.iter().any(|component| {
            component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(format!("invalid version: {version}"));
    }
    Ok((
        components[0]
            .parse::<u64>()
            .map_err(|_| format!("invalid version: {version}"))?,
        components[1]
            .parse::<u64>()
            .map_err(|_| format!("invalid version: {version}"))?,
        components[2]
            .parse::<u64>()
            .map_err(|_| format!("invalid version: {version}"))?,
    ))
}

fn bump_version(current: &str, requested: &str) -> Result<String, String> {
    if parse_version(requested).is_ok() {
        return Ok(requested.to_owned());
    }
    let bump = if requested == "new" {
        "patch"
    } else {
        requested
    };
    if !matches!(bump, "major" | "minor" | "patch") {
        return Err(format!(
            "expected patch, minor, major, new, or x.y.z; got {requested}"
        ));
    }
    let (major, minor, patch) = parse_version(current)?;
    Ok(match bump {
        "major" => format!("{}.0.0", major + 1),
        "minor" => format!("{major}.{}.0", minor + 1),
        _ => format!("{major}.{minor}.{}", patch + 1),
    })
}

fn read_package_version(path: &Path) -> Result<String, String> {
    let package: Value =
        serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    package
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "packages/inferay/package.json is missing version".to_owned())
}

fn replace_cli_version(source: &str, version: &str) -> Result<Option<String>, String> {
    const PREFIX: &str = "const VERSION = \"";
    if let Some(start) = source.find(PREFIX) {
        let value_start = start + PREFIX.len();
        if let Some(end) = source[value_start..].find("\";") {
            let end = value_start + end;
            if parse_version(&source[value_start..end]).is_ok() {
                let mut next = source.to_owned();
                next.replace_range(value_start..end, version);
                return Ok(Some(next));
            }
        }
    }
    if source.contains("version: VERSION") {
        Ok(None)
    } else {
        Err("could not update CLI VERSION constant".to_owned())
    }
}

fn set_cli_version(package_json: &Path, cli_source: &Path, version: &str) -> Result<(), String> {
    let package_source = fs::read_to_string(package_json).map_err(|error| error.to_string())?;
    let _: Value = serde_json::from_str(&package_source).map_err(|error| error.to_string())?;
    let next_package = replace_json_string_field(&package_source, "version", version)
        .ok_or_else(|| "packages/inferay/package.json is missing version".to_owned())?;
    fs::write(package_json, next_package).map_err(|error| error.to_string())?;

    let source = fs::read_to_string(cli_source).map_err(|error| error.to_string())?;
    if let Some(next) = replace_cli_version(&source, version)? {
        fs::write(cli_source, next).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn replace_json_string_field(source: &str, field: &str, value: &str) -> Option<String> {
    let marker = format!("\"{field}\"");
    let field_start = source.find(&marker)?;
    let mut cursor = field_start + marker.len();
    while source
        .as_bytes()
        .get(cursor)
        .is_some_and(u8::is_ascii_whitespace)
    {
        cursor += 1;
    }
    if source.as_bytes().get(cursor) != Some(&b':') {
        return None;
    }
    cursor += 1;
    while source
        .as_bytes()
        .get(cursor)
        .is_some_and(u8::is_ascii_whitespace)
    {
        cursor += 1;
    }
    if source.as_bytes().get(cursor) != Some(&b'"') {
        return None;
    }
    let value_start = cursor;
    cursor += 1;
    let bytes = source.as_bytes();
    let mut escaped = false;
    while let Some(byte) = bytes.get(cursor) {
        if *byte == b'"' && !escaped {
            let encoded = serde_json::to_string(value).ok()?;
            let mut next = source.to_owned();
            next.replace_range(value_start..=cursor, &encoded);
            return Some(next);
        }
        escaped = *byte == b'\\' && !escaped;
        if *byte != b'\\' {
            escaped = false;
        }
        cursor += 1;
    }
    None
}

fn replace_assignment_version(source: &str, version: &str) -> Option<String> {
    let start = source.find("version")?;
    let mut cursor = start + "version".len();
    while source
        .as_bytes()
        .get(cursor)
        .is_some_and(u8::is_ascii_whitespace)
    {
        cursor += 1;
    }
    if source.as_bytes().get(cursor) != Some(&b'=') {
        return None;
    }
    cursor += 1;
    while source
        .as_bytes()
        .get(cursor)
        .is_some_and(u8::is_ascii_whitespace)
    {
        cursor += 1;
    }
    if source.as_bytes().get(cursor) != Some(&b'"') {
        return None;
    }
    let value_start = cursor + 1;
    let value_end = value_start + source[value_start..].find('"')?;
    if parse_version(&source[value_start..value_end]).is_err() {
        return None;
    }
    let mut next = source.to_owned();
    next.replace_range(start..=value_end, &format!("version = \"{version}\""));
    Some(next)
}

fn replace_plist_value(source: &str, key: &str, value: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let key_start = source.find(&marker)?;
    let tail = &source[key_start + marker.len()..];
    let string_offset = tail.find("<string>")? + "<string>".len();
    let value_start = key_start + marker.len() + string_offset;
    let value_end = value_start + source[value_start..].find('<')?;
    let mut next = source.to_owned();
    next.replace_range(value_start..value_end, value);
    Some(next)
}

fn set_native_app_version(
    cargo_toml: &Path,
    info_plist: &Path,
    version: &str,
) -> Result<(), String> {
    let cargo = fs::read_to_string(cargo_toml).map_err(|error| error.to_string())?;
    let next_cargo = replace_assignment_version(&cargo, version)
        .ok_or_else(|| "could not update Rust native app version".to_owned())?;
    if next_cargo == cargo {
        return Err("could not update Rust native app version".to_owned());
    }
    fs::write(cargo_toml, next_cargo).map_err(|error| error.to_string())?;

    let (major, minor, patch) = parse_version(version)?;
    let bundle_version = (major * 1_000_000 + minor * 1_000 + patch).to_string();
    let plist = fs::read_to_string(info_plist).map_err(|error| error.to_string())?;
    let short_version = replace_plist_value(&plist, "CFBundleShortVersionString", version)
        .unwrap_or_else(|| plist.clone());
    let next_plist = replace_plist_value(&short_version, "CFBundleVersion", &bundle_version)
        .unwrap_or(short_version);
    if next_plist == plist {
        return Err("could not update native app Info.plist version".to_owned());
    }
    fs::write(info_plist, next_plist).map_err(|error| error.to_string())?;
    Ok(())
}

struct Paths {
    root: PathBuf,
    cli_dir: PathBuf,
    package_json: PathBuf,
    cli_source: PathBuf,
    native_app_cargo_toml: PathBuf,
    native_app_info_plist: PathBuf,
    artifacts_dir: PathBuf,
    installer_dmg: PathBuf,
    platform_dmg: PathBuf,
    checksums: PathBuf,
}

impl Paths {
    fn from_root(root: PathBuf) -> Self {
        let cli_dir = root.join("packages/inferay");
        let artifacts_dir = root.join("artifacts");
        Self {
            package_json: cli_dir.join("package.json"),
            cli_source: cli_dir.join("src/cli.js"),
            native_app_cargo_toml: root.join("native/desktop-host/Cargo.toml"),
            native_app_info_plist: root.join("native/desktop-host/Info.plist"),
            installer_dmg: artifacts_dir.join("inferay-installer.dmg"),
            platform_dmg: artifacts_dir.join("inferay-macos-arm64.dmg"),
            checksums: artifacts_dir.join("checksums.txt"),
            root,
            cli_dir,
            artifacts_dir,
        }
    }

    fn relative(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned()
    }
}

fn command(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

fn assert_clean_git(paths: &Paths) -> Result<(), String> {
    let status = capture(&paths.root, &command(&["git", "status", "--short"]), None)?;
    if status.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "git worktree must be clean before release:\n{status}"
        ))
    }
}

fn write_checksums(paths: &Paths, files: &[&Path]) -> Result<(), String> {
    let mut lines = Vec::new();
    for path in files {
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let digest = format!("{:x}", Sha256::digest(bytes));
        let basename = path
            .file_name()
            .ok_or_else(|| format!("invalid artifact path: {}", path.display()))?
            .to_string_lossy();
        lines.push(format!("{digest}  artifacts/{basename}"));
    }
    fs::write(&paths.checksums, format!("{}\n", lines.join("\n")))
        .map_err(|error| error.to_string())
}

fn build_artifacts(paths: &Paths, version: &str) -> Result<(), String> {
    fs::create_dir_all(&paths.artifacts_dir).map_err(|error| error.to_string())?;
    run_command(
        &paths.root,
        &command(&["bash", "scripts/build-dmg.sh"]),
        None,
        false,
        false,
    )?;
    fs::copy(&paths.installer_dmg, &paths.platform_dmg).map_err(|error| error.to_string())?;
    run_command(
        &paths.root,
        &command(&["bun", "pm", "pack", "--destination", "../../artifacts"]),
        Some(&paths.cli_dir),
        false,
        false,
    )?;
    write_checksums(paths, &[&paths.installer_dmg, &paths.platform_dmg])?;
    for dmg in [&paths.installer_dmg, &paths.platform_dmg] {
        run_command(
            &paths.root,
            &[
                "hdiutil".to_owned(),
                "verify".to_owned(),
                dmg.to_string_lossy().into_owned(),
            ],
            None,
            false,
            false,
        )?;
    }
    let tarball = paths.artifacts_dir.join(format!("inferay-{version}.tgz"));
    println!(
        "Created release artifacts:\n  {}\n  {}\n  {}\n  {}",
        paths.relative(&paths.installer_dmg),
        paths.relative(&paths.platform_dmg),
        paths.relative(&tarball),
        paths.relative(&paths.checksums)
    );
    Ok(())
}

fn commit_and_tag(paths: &Paths, version: &str) -> Result<(), String> {
    let tag = format!("v{version}");
    let mut verify = command(&["git", "rev-parse", "-q", "--verify"]);
    verify.push(tag.clone());
    if run_command(&paths.root, &verify, None, true, true)? == 0 {
        return Err(format!("tag already exists: {tag}"));
    }
    run_command(
        &paths.root,
        &command(&[
            "git",
            "add",
            "native/desktop-host/Cargo.toml",
            "Cargo.lock",
            "native/desktop-host/Info.plist",
            "packages/inferay/package.json",
            "packages/inferay/src/cli.js",
        ]),
        None,
        false,
        false,
    )?;
    run_command(
        &paths.root,
        &[
            "git".to_owned(),
            "commit".to_owned(),
            "-m".to_owned(),
            format!("release {tag}"),
        ],
        None,
        false,
        false,
    )?;
    run_command(
        &paths.root,
        &["git".to_owned(), "tag".to_owned(), tag],
        None,
        false,
        false,
    )?;
    Ok(())
}

fn release_exists(paths: &Paths, tag: &str, repo: &str) -> Result<bool, String> {
    Ok(run_command(
        &paths.root,
        &command(&["gh", "release", "view", tag, "--repo", repo]),
        None,
        true,
        true,
    )? == 0)
}

fn publish_npm_package(paths: &Paths) -> Result<(), String> {
    let base = command(&[
        "bun",
        "publish",
        "--access",
        "public",
        "--cache-dir",
        BUN_CACHE,
    ]);
    let mut otp: Option<String> = None;
    for attempt in 1..=3 {
        let mut invocation = base.clone();
        if let Some(value) = &otp {
            invocation.extend(["--otp".to_owned(), value.clone()]);
        }
        if run_command(&paths.root, &invocation, Some(&paths.cli_dir), false, true)? == 0 {
            return Ok(());
        }
        if attempt < 3 {
            let answer = prompt_line(
                "Complete npm browser auth and press Enter to retry, or enter an npm OTP: ",
            )?;
            otp = (!answer.is_empty()).then_some(answer);
        }
    }
    Err("npm publish failed after auth retries. Authenticate Bun with an npm token via NPM_CONFIG_TOKEN or an .npmrc entry, then run bun run release:resume.".to_owned())
}

fn publish_release(paths: &Paths, version: &str, repo: &str) -> Result<(), String> {
    let tag = format!("v{version}");
    run_command(
        &paths.root,
        &command(&["gh", "auth", "status"]),
        None,
        false,
        false,
    )?;
    run_command(
        &paths.root,
        &command(&["git", "push", "origin", "HEAD", "--tags"]),
        None,
        false,
        false,
    )?;
    let assets = [&paths.platform_dmg, &paths.installer_dmg, &paths.checksums];
    let mut release = if release_exists(paths, &tag, repo)? {
        command(&["gh", "release", "upload", &tag])
    } else {
        command(&["gh", "release", "create", &tag])
    };
    release.extend(
        assets
            .iter()
            .map(|asset| asset.to_string_lossy().into_owned()),
    );
    release.extend(["--repo".to_owned(), repo.to_owned()]);
    if release.get(2).is_some_and(|action| action == "upload") {
        release.push("--clobber".to_owned());
    } else {
        release.extend([
            "--title".to_owned(),
            tag.clone(),
            "--notes".to_owned(),
            format!("Inferay {tag}"),
        ]);
    }
    run_command(&paths.root, &release, None, false, false)?;
    publish_npm_package(paths)
}

fn publish_existing(paths: &Paths, repo: &str) -> Result<(), String> {
    let version = read_package_version(&paths.package_json)?;
    for artifact in [&paths.platform_dmg, &paths.installer_dmg, &paths.checksums] {
        run_command(
            &paths.root,
            &[
                "test".to_owned(),
                "-f".to_owned(),
                artifact.to_string_lossy().into_owned(),
            ],
            None,
            false,
            false,
        )?;
    }
    publish_release(paths, &version, repo)?;
    println!("Published v{version}");
    Ok(())
}

fn repository_root() -> Result<PathBuf, String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "could not resolve repository root".to_owned())
}

pub fn run(args: &[String]) -> Result<(), String> {
    let options = parse_args(args)?;
    if options.help {
        usage();
        return Ok(());
    }
    let paths = Paths::from_root(repository_root()?);
    if options.publish_existing {
        return publish_existing(&paths, &options.repo);
    }

    assert_clean_git(&paths)?;
    let current = read_package_version(&paths.package_json)?;
    let next = bump_version(&current, &options.bump_or_version)?;
    let tag = format!("v{next}");
    println!("Preparing {tag}");
    set_cli_version(&paths.package_json, &paths.cli_source, &next)?;
    set_native_app_version(
        &paths.native_app_cargo_toml,
        &paths.native_app_info_plist,
        &next,
    )?;
    build_artifacts(&paths, &next)?;
    commit_and_tag(&paths, &next)?;
    publish_release(&paths, &next, &options.repo)?;
    println!("Published {tag}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn parses_release_arguments_like_the_script() {
        assert_eq!(
            parse_args_with_repo_env(&strings(&["minor", "--repo", "owner/project"]), None)
                .unwrap(),
            Options {
                bump_or_version: "minor".to_owned(),
                publish_existing: false,
                repo: "owner/project".to_owned(),
                help: false,
            }
        );
        assert_eq!(
            parse_args_with_repo_env(&strings(&["--resume"]), Some("env/repo")).unwrap(),
            Options {
                bump_or_version: "patch".to_owned(),
                publish_existing: true,
                repo: "env/repo".to_owned(),
                help: false,
            }
        );
        assert_eq!(
            parse_args_with_repo_env(&strings(&["--publish-existing"]), None)
                .unwrap()
                .repo,
            DEFAULT_RELEASE_REPO
        );
        assert_eq!(
            parse_args_with_repo_env(&strings(&["--repo"]), None).unwrap_err(),
            "--repo requires owner/repo"
        );
        assert!(
            parse_args_with_repo_env(&strings(&["--help", "--repo"]), None)
                .unwrap()
                .help
        );
    }

    #[test]
    fn bumps_or_accepts_exact_versions() {
        assert_eq!(bump_version("1.2.3", "patch").unwrap(), "1.2.4");
        assert_eq!(bump_version("1.2.3", "new").unwrap(), "1.2.4");
        assert_eq!(bump_version("1.2.3", "minor").unwrap(), "1.3.0");
        assert_eq!(bump_version("1.2.3", "major").unwrap(), "2.0.0");
        assert_eq!(bump_version("1.2.3", "4.5.6").unwrap(), "4.5.6");
        assert_eq!(
            bump_version("1.2.3", "beta").unwrap_err(),
            "expected patch, minor, major, new, or x.y.z; got beta"
        );
    }

    #[test]
    fn replaces_cli_and_native_app_version_text() {
        assert_eq!(
            replace_cli_version("const VERSION = \"1.2.3\";\n", "2.0.0")
                .unwrap()
                .unwrap(),
            "const VERSION = \"2.0.0\";\n"
        );
        assert_eq!(
            replace_assignment_version("[package]\nversion = \"1.2.3\"\n", "2.0.0").unwrap(),
            "[package]\nversion = \"2.0.0\"\n"
        );
        assert_eq!(
            replace_plist_value(
                "<key>CFBundleVersion</key>\n<string>1002003</string>",
                "CFBundleVersion",
                "2000000"
            )
            .unwrap(),
            "<key>CFBundleVersion</key>\n<string>2000000</string>"
        );
    }

    #[test]
    fn quotes_command_arguments_like_json_stringify() {
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg("two words"), "\"two words\"");
        assert_eq!(quote_arg("a\"b"), "\"a\\\"b\"");
    }

    #[test]
    fn replaces_package_version_without_reordering_json() {
        assert_eq!(
            replace_json_string_field(
                "{\n\t\"name\": \"inferay\",\n\t\"version\": \"1.2.3\",\n\t\"private\": true\n}\n",
                "version",
                "2.0.0"
            )
            .unwrap(),
            "{\n\t\"name\": \"inferay\",\n\t\"version\": \"2.0.0\",\n\t\"private\": true\n}\n"
        );
    }
}
