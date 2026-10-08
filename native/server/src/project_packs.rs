use crate::{
    project_definitions as files,
    project_store::{Result, hash},
};
use inferay_core::{
    project_files::{ENTRYPOINT_LIMIT, ProjectDefinition, ToolDefinition},
    projects::ProjectPath,
};
use rusqlite::{Connection, params};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};
use wait_timeout::ChildExt;

fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let output = tempfile::tempfile()?;
    let mut command = Command::new("git");
    command
        .args([
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .stdin(Stdio::null())
        .stdout(output.try_clone()?)
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let status = child.wait_timeout(Duration::from_secs(5))?;
    if status.is_none() {
        crate::agent_runner::tree_kill(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err("Repository pack check timed out".into());
    }
    if !status.unwrap().success() {
        return Err(format!(
            "Repository pack Git check failed: {}",
            args.first().unwrap_or(&"git")
        )
        .into());
    }
    if output.metadata()?.len() > 4_000_000 {
        return Err("Repository pack check exceeds size limit".into());
    }
    use std::io::{Seek, SeekFrom};
    let mut output = output;
    output.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    output.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn validate_links(repository: &Path) -> Result<()> {
    let tree = git(repository, &["ls-tree", "-r", "-z", "HEAD"])?;
    let mut tracked = BTreeSet::new();
    let mut links = Vec::new();
    for record in tree.split(|c| *c == 0).filter(|r| !r.is_empty()) {
        let record = std::str::from_utf8(record)?;
        let (header, path) = record
            .split_once('\t')
            .ok_or("Invalid repository tree record")?;
        if header.starts_with("160000 ") {
            return Err("Repository packs cannot contain submodules".into());
        }
        tracked.insert(Path::new(path));
        if header.starts_with("120000 ") {
            links.push(path);
        }
    }
    for link in links {
        let target = repository
            .join(link)
            .canonicalize()
            .map_err(|_| format!("Tool pack link has a missing or cyclic target: {link}"))?;
        let relative = target
            .strip_prefix(repository)
            .map_err(|_| format!("Tool pack link escapes the checkout: {link}"))?;
        if relative.as_os_str().is_empty()
            || !tracked
                .iter()
                .any(|path| *path == relative || path.starts_with(relative))
        {
            return Err(format!("Tool pack link must target tracked content: {link}").into());
        }
    }
    Ok(())
}

pub(crate) fn resolve(
    db: &Connection,
    root: &Path,
    project: &ProjectDefinition,
    tool: &ToolDefinition,
    directory: &str,
    repositories: &mut BTreeMap<String, String>,
) -> Result<(ProjectPath, ProjectPath, String)> {
    let Some(pack) = &tool.pack else {
        let path = format!("{directory}/{}", tool.entrypoint);
        let bytes = files::read(root, &path, ENTRYPOINT_LIMIT)?;
        return Ok((
            ProjectPath::Project { path },
            ProjectPath::Project {
                path: directory.into(),
            },
            hash(&bytes),
        ));
    };
    if !project
        .repositories
        .iter()
        .any(|repo| repo.id == pack.repository_id)
    {
        return Err("Tool pack repository is not declared in this project".into());
    }
    let binding: String = db
        .query_row(
            "SELECT path FROM repository_paths WHERE project_id=? AND repository_id=?",
            params![project.id, pack.repository_id],
            |r| r.get(0),
        )
        .map_err(|_| "Tool pack repository is not linked on this machine")?;
    let repository = Path::new(&binding).canonicalize()?;
    let top = git(&repository, &["rev-parse", "--show-toplevel"])?;
    if Path::new(std::str::from_utf8(&top)?.trim()).canonicalize()? != repository {
        return Err("Tool pack must bind the root of a Git checkout".into());
    }
    let head = git(&repository, &["rev-parse", "HEAD"])?;
    if std::str::from_utf8(&head)?.trim() != pack.commit.to_ascii_lowercase() {
        return Err("Tool pack revision changed; review and update its commit pin".into());
    }
    let flags = git(&repository, &["ls-files", "-v", "-z"])?;
    if flags
        .split(|c| *c == 0)
        .filter(|s| !s.is_empty())
        .any(|s| s[0] != b'H')
    {
        return Err(
            "Tool pack cannot use sparse, unmerged or assume-unchanged index entries".into(),
        );
    }
    if !git(
        &repository,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignored=matching",
            "--ignore-submodules=none",
        ],
    )?
    .is_empty()
    {
        return Err(
            "Tool pack checkout contains changed, untracked or ignored files; use a clean checkout"
                .into(),
        );
    }
    validate_links(&repository)?;
    let bytes = files::read(&repository, &tool.entrypoint, ENTRYPOINT_LIMIT)?;
    let digest = hash(&bytes);
    if digest != pack.sha256.to_ascii_lowercase() {
        return Err("Tool pack entrypoint differs from its approved SHA-256".into());
    }
    let committed = git(
        &repository,
        &[
            "cat-file",
            "blob",
            &format!("{}:{}", pack.commit, tool.entrypoint),
        ],
    )?;
    if hash(&committed) != digest {
        return Err("Tool pack entrypoint differs from the pinned Git blob".into());
    }
    repositories.insert(
        pack.repository_id.clone(),
        repository.to_string_lossy().into_owned(),
    );
    Ok((
        ProjectPath::External {
            path: repository
                .join(&tool.entrypoint)
                .to_string_lossy()
                .into_owned(),
        },
        ProjectPath::External {
            path: repository.to_string_lossy().into_owned(),
        },
        digest,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[cfg(unix)]
    #[test]
    fn pack_links_allow_tracked_aliases_and_refuse_escapes_metadata_and_cycles() {
        use std::os::unix::fs::symlink;
        let checkout = tempfile::tempdir().unwrap();
        let root = checkout.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("kit")).unwrap();
        std::fs::write(root.join("kit/run.py"), "print('ok')").unwrap();
        symlink("kit", root.join("Studio")).unwrap();
        git(&root, &["init", "-q"]).unwrap();
        git(&root, &["add", "."]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "-qm",
                "kit",
            ],
        )
        .unwrap();
        validate_links(&root).unwrap();
        let outside = tempfile::tempdir().unwrap();
        for target in [
            outside.path(),
            Path::new(".git/config"),
            Path::new("missing"),
            Path::new("Studio"),
            Path::new("."),
        ] {
            std::fs::remove_file(root.join("Studio")).unwrap();
            symlink(target, root.join("Studio")).unwrap();
            assert!(
                validate_links(&root).is_err(),
                "Accepted {}",
                target.display()
            );
        }
    }

    #[test]
    fn pack_resolution_checks_checkout_binding_revision_and_bytes() {
        let checkout = tempfile::tempdir().unwrap();
        let code = b"print('report')\n";
        std::fs::write(checkout.path().join("report.py"), code).unwrap();
        git(checkout.path(), &["init", "-q"]).unwrap();
        git(checkout.path(), &["add", "report.py"]).unwrap();
        git(
            checkout.path(),
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "-qm",
                "fixture",
            ],
        )
        .unwrap();
        let commit = String::from_utf8(git(checkout.path(), &["rev-parse", "HEAD"]).unwrap())
            .unwrap()
            .trim()
            .to_owned();
        let project_id = uuid::Uuid::new_v4().to_string();
        let repository_id = uuid::Uuid::new_v4().to_string();
        let project: ProjectDefinition = serde_json::from_value(json!({"schema":"inferay.project/1","id":project_id,"name":"Proof","description":"","instructions":"","repositories":[{"id":repository_id,"name":"Kit"}]})).unwrap();
        let mut tool: ToolDefinition = serde_json::from_value(json!({"schema":"inferay.tool/1","id":uuid::Uuid::new_v4().to_string(),"name":"Report","program":"python3","entrypoint":"report.py","args":[],"timeoutSeconds":30,"inputSchema":{},"outputSchema":{},"pack":{"repositoryId":repository_id,"commit":commit,"sha256":hash(code)}})).unwrap();
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE repository_paths(project_id TEXT,repository_id TEXT,path TEXT)",
        )
        .unwrap();
        let project_root = tempfile::tempdir().unwrap();
        let mut bindings = BTreeMap::new();
        assert!(
            resolve(
                &db,
                project_root.path(),
                &project,
                &tool,
                "plugins/reports/tools/report",
                &mut bindings
            )
            .unwrap_err()
            .to_string()
            .contains("not linked")
        );
        db.execute(
            "INSERT INTO repository_paths VALUES(?,?,?)",
            params![project_id, repository_id, checkout.path().to_string_lossy()],
        )
        .unwrap();
        let (entrypoint, cwd, _) = resolve(
            &db,
            project_root.path(),
            &project,
            &tool,
            "plugins/reports/tools/report",
            &mut bindings,
        )
        .unwrap();
        assert_eq!(
            crate::project_store::resolve_path(project_root.path(), &entrypoint).unwrap(),
            checkout.path().join("report.py").canonicalize().unwrap()
        );
        assert_eq!(
            crate::project_store::resolve_path(project_root.path(), &cwd).unwrap(),
            checkout.path().canonicalize().unwrap()
        );
        assert!(
            std::fs::read_dir(project_root.path())
                .unwrap()
                .next()
                .is_none()
        );
        std::fs::write(checkout.path().join("helper.py"), b"unreviewed").unwrap();
        assert!(
            resolve(&db, project_root.path(), &project, &tool, "", &mut bindings)
                .unwrap_err()
                .to_string()
                .contains("clean checkout")
        );
        std::fs::remove_file(checkout.path().join("helper.py")).unwrap();
        std::fs::write(checkout.path().join("report.py"), b"changed").unwrap();
        assert!(resolve(&db, project_root.path(), &project, &tool, "", &mut bindings).is_err());
        std::fs::write(checkout.path().join("report.py"), code).unwrap();
        tool.pack.as_mut().unwrap().sha256 = "0".repeat(64);
        assert!(
            resolve(&db, project_root.path(), &project, &tool, "", &mut bindings)
                .unwrap_err()
                .to_string()
                .contains("SHA-256")
        );
        tool.pack.as_mut().unwrap().sha256 = hash(code);
        tool.pack.as_mut().unwrap().commit = "0".repeat(40);
        assert!(
            resolve(&db, project_root.path(), &project, &tool, "", &mut bindings)
                .unwrap_err()
                .to_string()
                .contains("revision changed")
        );
    }
}
