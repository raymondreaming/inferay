use regex::Regex;
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

fn parse_version(version: &str) -> Result<[u64; 3], String> {
    version
        .split('.')
        .map(|part| {
            part.parse::<u64>()
                .ok()
                .filter(|_| part.bytes().all(|byte| byte.is_ascii_digit()))
        })
        .collect::<Option<Vec<_>>>()
        .and_then(|parts| parts.try_into().ok())
        .ok_or_else(|| format!("invalid version: {version}"))
}

pub(crate) fn bundle_version(version: &str) -> Result<String, String> {
    let invalid = || format!("invalid package version: {version}");
    let [major, minor, patch] = parse_version(version).map_err(|_| invalid())?;
    major
        .checked_mul(1_000_000)
        .and_then(|value| value.checked_add(minor.checked_mul(1_000)?))
        .and_then(|value| value.checked_add(patch))
        .map(|value| value.to_string())
        .ok_or_else(invalid)
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
    let [major, minor, patch] = parse_version(current)?;
    Ok(match bump {
        "major" => format!("{}.0.0", major + 1),
        "minor" => format!("{major}.{}.0", minor + 1),
        _ => format!("{major}.{minor}.{}", patch + 1),
    })
}

pub(crate) fn read_package_version(path: &Path) -> Result<String, String> {
    let package: Value =
        serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    package
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "packages/inferay/package.json is missing version".to_owned())
}

fn set_package_version(package_json: &Path, version: &str) -> Result<(), String> {
    let package_source = fs::read_to_string(package_json).map_err(|error| error.to_string())?;
    let _: Value = serde_json::from_str(&package_source).map_err(|error| error.to_string())?;
    let next_package = replace_json_string_field(&package_source, "version", version)
        .ok_or_else(|| "packages/inferay/package.json is missing version".to_owned())?;
    fs::write(package_json, next_package).map_err(|error| error.to_string())?;

    Ok(())
}

fn replace_capture(source: &str, pattern: &str, value: &str) -> Option<String> {
    let expression = Regex::new(pattern).ok()?;
    let field = expression.captures(source)?.get(1)?;
    let mut next = source.to_owned();
    next.replace_range(field.range(), value);
    Some(next)
}

fn replace_json_string_field(source: &str, field: &str, value: &str) -> Option<String> {
    replace_capture(
        source,
        &format!(r#""{}"\s*:\s*("(?:\\.|[^"\\])*")"#, regex::escape(field)),
        &serde_json::to_string(value).ok()?,
    )
}

fn replace_assignment_version(source: &str, version: &str) -> Option<String> {
    replace_capture(
        source,
        r#"(?m)^\s*version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)""#,
        version,
    )
}

fn replace_plist_value(source: &str, key: &str, value: &str) -> Option<String> {
    replace_capture(
        source,
        &format!(
            r"<key>{}</key>\s*<string>([^<]*)</string>",
            regex::escape(key)
        ),
        value,
    )
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
    let bundle_version = bundle_version(version)?;
    let plist = fs::read_to_string(info_plist).map_err(|error| error.to_string())?;
    let short_version = replace_plist_value(&plist, "CFBundleShortVersionString", version)
        .unwrap_or_else(|| plist.clone());
    let next_plist = replace_plist_value(&short_version, "CFBundleVersion", &bundle_version)
        .unwrap_or(short_version);
    if next_plist == plist {
        return Err("could not update native app Info.plist version".to_owned());
    }
    fs::write(cargo_toml, next_cargo).map_err(|error| error.to_string())?;
    fs::write(info_plist, next_plist).map_err(|error| error.to_string())?;
    Ok(())
}

struct Paths {
    root: PathBuf,
    cli_dir: PathBuf,
    package_json: PathBuf,
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
    set_package_version(&paths.package_json, &next)?;
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
