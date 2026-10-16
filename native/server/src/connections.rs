pub(crate) mod relay;
use crate::project_store::{Result, hash};
use inferay_core::connections::{ConnectionCommand as Command, ConnectionInfo};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const LIMIT: usize = 65_536;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    info: ConnectionInfo,
    secret: String,
}

pub(crate) struct Store {
    profile: PathBuf,
    service: String,
    lock: std::sync::Mutex<()>,
}
impl Store {
    pub(crate) fn open(profile: &Path) -> Result<Self> {
        let profile = profile.canonicalize()?;
        let service = format!(
            "app.inferay.connections.{}",
            hash(profile.to_string_lossy().as_bytes())
        );
        Ok(Self {
            profile,
            service,
            lock: std::sync::Mutex::new(()),
        })
    }
    fn edit<T>(&self, f: impl FnOnce(&mut Vec<Credential>) -> Result<(T, bool)>) -> Result<T> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "Connection store lock failed")?;
        let _file = profile_lock(&self.profile)?;
        let mut entries: Vec<Credential> = match read_keychain(&self.service)? {
            Some(bytes) => {
                if bytes.len() > LIMIT {
                    return Err("Connection store exceeds its size limit".into());
                }
                serde_json::from_slice(&bytes).map_err(|_| "Connection store is invalid")?
            }
            None => Vec::new(),
        };
        let (result, changed) = f(&mut entries)?;
        if changed {
            if entries.is_empty() {
                delete_keychain(&self.service)?;
            } else {
                let bytes =
                    serde_json::to_vec(&entries).map_err(|_| "Could not encode connections")?;
                if bytes.len() > LIMIT {
                    return Err("Connection store exceeds 64 KB".into());
                }
                write_keychain(&self.service, &bytes)?;
            }
        }
        Ok(result)
    }
    pub(crate) fn list(&self, project: &str) -> Result<Vec<ConnectionInfo>> {
        self.edit(|entries| {
            Ok((
                entries
                    .iter()
                    .filter(|entry| entry.info.project_id == project)
                    .map(|entry| entry.info.clone())
                    .collect(),
                false,
            ))
        })
    }
    pub(crate) fn capture(
        &self,
        project: &str,
        requested: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    ) -> Result<
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, ConnectionInfo>>,
    > {
        self.edit(|entries| {
            let mut captured = std::collections::BTreeMap::new();
            for (tool, aliases) in requested {
                let mut bindings = std::collections::BTreeMap::new();
                for (alias, id) in aliases {
                    let entry = entries
                        .iter()
                        .find(|entry| entry.info.id == *id && entry.info.project_id == project)
                        .ok_or_else(|| {
                            format!(
                                "Connection {alias} for tool {tool} is not linked in this project"
                            )
                        })?;
                    bindings.insert(alias.clone(), entry.info.clone());
                }
                captured.insert(tool.clone(), bindings);
            }
            Ok((captured, false))
        })
    }
    pub(crate) fn apply(&self, command: Command) -> Result<Option<ConnectionInfo>> {
        self.edit(|entries| match command {
            Command::Save {
                project_id,
                id,
                expected_revision,
                name,
                secret,
            } => {
                let name = name.trim();
                if name.is_empty()
                    || name.chars().count() > 100
                    || name.chars().any(char::is_control)
                {
                    return Err(
                        "Connection name must contain 1–100 characters without control characters"
                            .into(),
                    );
                }
                if secret.is_empty() || secret.len() > 8192 || secret.contains('\0') {
                    return Err(
                        "Credential must contain 1–8192 bytes without a null character".into(),
                    );
                }
                let info = if let Some(id) = id {
                    let entry = entries
                        .iter_mut()
                        .find(|entry| entry.info.id == id && entry.info.project_id == project_id)
                        .ok_or("Connection not found")?;
                    if expected_revision.as_deref() != Some(entry.info.revision.as_str()) {
                        return Err("Connection changed; refresh before replacing it".into());
                    }
                    entry.info.name = name.into();
                    entry.info.revision = uuid::Uuid::new_v4().to_string();
                    entry.secret = secret;
                    entry.info.clone()
                } else {
                    if expected_revision.is_some() {
                        return Err("New connections cannot have an expected revision".into());
                    }
                    let info = ConnectionInfo {
                        id: uuid::Uuid::new_v4().to_string(),
                        project_id,
                        name: name.into(),
                        revision: uuid::Uuid::new_v4().to_string(),
                    };
                    entries.push(Credential {
                        info: info.clone(),
                        secret,
                    });
                    info
                };
                Ok((Some(info), true))
            }
            Command::Delete {
                project_id,
                id,
                expected_revision,
            } => {
                let index = entries
                    .iter()
                    .position(|entry| entry.info.id == id && entry.info.project_id == project_id)
                    .ok_or("Connection not found")?;
                if entries[index].info.revision != expected_revision {
                    return Err("Connection changed; refresh before removing it".into());
                }
                entries.remove(index);
                Ok((None, true))
            }
        })
    }
}

#[cfg(target_os = "macos")]
fn profile_lock(profile: &Path) -> Result<std::fs::File> {
    use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(profile.join("connections.lock"))?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err("Could not lock connections".into());
    }
    Ok(file)
}
#[cfg(not(target_os = "macos"))]
fn profile_lock(_: &Path) -> Result<std::fs::File> {
    Err("Connections require macOS Keychain".into())
}

#[cfg(target_os = "macos")]
fn read_keychain(service: &str) -> Result<Option<Vec<u8>>> {
    use security_framework::passwords::{PasswordOptions, generic_password};
    match generic_password(PasswordOptions::new_generic_password(
        service,
        "project-credentials",
    )) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("Could not read Inferay connections from Keychain".into()),
    }
}
#[cfg(target_os = "macos")]
fn write_keychain(service: &str, bytes: &[u8]) -> Result<()> {
    security_framework::passwords::set_generic_password(service, "project-credentials", bytes)
        .map_err(|_| "Could not save Inferay connections in Keychain".into())
}
#[cfg(target_os = "macos")]
fn delete_keychain(service: &str) -> Result<()> {
    match security_framework::passwords::delete_generic_password(service, "project-credentials") {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("Could not remove Inferay connections from Keychain".into()),
    }
}
#[cfg(not(target_os = "macos"))]
fn read_keychain(_: &str) -> Result<Option<Vec<u8>>> {
    Err("Connections require macOS Keychain".into())
}
#[cfg(not(target_os = "macos"))]
fn write_keychain(_: &str, _: &[u8]) -> Result<()> {
    Err("Connections require macOS Keychain".into())
}
#[cfg(not(target_os = "macos"))]
fn delete_keychain(_: &str) -> Result<()> {
    Err("Connections require macOS Keychain".into())
}

pub(crate) async fn http(
    state: &crate::ServerState,
    request: axum::extract::Request,
) -> crate::ApiResult {
    use crate::{api_error, query_value};
    use axum::http::StatusCode;
    let command = if request.method() == axum::http::Method::POST {
        let bytes = axum::body::to_bytes(request.into_body(), 16_384)
            .await
            .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Connection request exceeds 16 KB"))?;
        Some(
            serde_json::from_slice::<Command>(&bytes)
                .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid connection request"))?,
        )
    } else {
        let project = query_value(&request, "projectId").unwrap_or_default();
        return handle(state, project, None).await;
    };
    let project = command.as_ref().unwrap().project().to_owned();
    handle(state, project, command).await
}
async fn handle(
    state: &crate::ServerState,
    project: String,
    command: Option<Command>,
) -> crate::ApiResult {
    use crate::api_error;
    use axum::http::StatusCode;
    let runtime = state.projects.clone();
    tokio::task::spawn_blocking(move || -> Result<serde_json::Value> {
        let store = runtime
            .store
            .lock()
            .map_err(|_| "Project store lock failed")?;
        let exists: bool = store.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=? AND valid=1)",
            [&project],
            |row| row.get(0),
        )?;
        if !exists {
            return Err("Project not found".into());
        }
        drop(store);
        if let Some(command) = command {
            runtime.connections.apply(command)?;
        }
        Ok(serde_json::json!({"connections":runtime.connections.list(&project)?}))
    })
    .await
    .map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Connection operation failed",
        )
    })?
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "writes temporary test-only entries to the macOS Keychain"]
    fn keychain_connections_invalidate_automation_approval_on_rotation() {
        use serde_json::json;
        let profile = tempfile::tempdir().unwrap();
        let connections = Store::open(profile.path()).unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete_keychain(&self.0);
            }
        }
        let _cleanup = Cleanup(connections.service.clone());
        let project = uuid::Uuid::new_v4().to_string();
        let automation = uuid::Uuid::new_v4().to_string();
        let tool = uuid::Uuid::new_v4().to_string();
        let secret = format!("temporary-test-key-{}", uuid::Uuid::new_v4());
        let saved = connections
            .apply(Command::Save {
                project_id: project.clone(),
                id: None,
                expected_revision: None,
                name: "Test".into(),
                secret: secret.clone(),
            })
            .unwrap()
            .unwrap();
        let root = profile.path().join("projects").join(&project);
        let package = root.join("automations/job");
        let tool_dir = package.join("tools/read");
        std::fs::create_dir_all(&tool_dir).unwrap();
        std::fs::write(root.join("project.json"), json!({"schema":"inferay.project/1","id":project,"name":"Connections","description":"","instructions":"","repositories":[]}).to_string()).unwrap();
        std::fs::write(package.join("automation.json"), json!({"schema":"inferay.automation/1","id":automation,"name":"Read","trigger":{"kind":"interval","seconds":86400},"overlap":"skip","may":[],"execution":{"kind":"tool","tool":"read","input":{}}}).to_string()).unwrap();
        std::fs::write(tool_dir.join("tool.json"), json!({"schema":"inferay.tool/1","id":tool,"name":"Read","program":"python3","entrypoint":"run.py","args":[],"timeoutSeconds":60,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"},"connections":{"SERVICE":{"id":saved.id,"baseUrl":"https://api.example.test/v1/","header":"Authorization","prefix":"Bearer "}}}).to_string()).unwrap();
        std::fs::write(tool_dir.join("run.py"), "print('{}')").unwrap();
        let store = crate::project_file_store::FileProjectStore::open(profile.path(), &[]).unwrap();
        let before =
            crate::project_index::execution_inputs(&store.db, profile.path(), &automation, &[])
                .unwrap();
        assert_eq!(
            before["connections"][&tool]["SERVICE"]["revision"],
            saved.revision
        );
        assert!(!before.to_string().contains(&secret));
        let fingerprint = hash(&serde_json::to_vec(&before).unwrap());
        let tx = store.db.unchecked_transaction().unwrap();
        crate::project_index::approve(
            &tx,
            profile.path(),
            crate::project_index::Approval::Automation(&automation),
            &fingerprint,
            true,
            &[],
        )
        .unwrap();
        tx.commit().unwrap();
        connections
            .apply(Command::Save {
                project_id: project,
                id: Some(saved.id),
                expected_revision: Some(saved.revision),
                name: "Test".into(),
                secret: "rotated-test-key".into(),
            })
            .unwrap();
        assert!(
            crate::project_index::approved_inputs(
                &store.db,
                profile.path(),
                &automation,
                false,
                &[]
            )
            .is_err()
        );
        let enabled: i64 = store
            .db
            .query_row(
                "SELECT enabled FROM automation_state WHERE automation_id=?",
                [&automation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enabled, 0);
    }

    #[test]
    #[ignore = "writes temporary test-only entries to the macOS Keychain"]
    fn keychain_connections_are_scoped_conflict_safe_and_never_written_to_disk() {
        let profile = tempfile::tempdir().unwrap();
        let other_profile = tempfile::tempdir().unwrap();
        let store = Store::open(profile.path()).unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete_keychain(&self.0);
            }
        }
        let _cleanup = Cleanup(store.service.clone());
        let project = uuid::Uuid::new_v4().to_string();
        let secret = format!("inferay-test-only-{}", uuid::Uuid::new_v4());
        let saved = store
            .apply(Command::Save {
                project_id: project.clone(),
                id: None,
                expected_revision: None,
                name: "Test service".into(),
                secret: secret.clone(),
            })
            .unwrap()
            .unwrap();
        let work = tempfile::tempdir().unwrap();
        let output = work.path().join("output");
        let scratch = work.path().join("scratch");
        std::fs::create_dir(&output).unwrap();
        std::fs::create_dir(&scratch).unwrap();
        let permissions = std::collections::BTreeSet::from([
            inferay_core::project_files::Permission::Network,
            inferay_core::project_files::Permission::WriteProjectFiles,
        ]);
        let policy = crate::automation_sandbox::AutomationSandbox::new(
            &permissions,
            &serde_json::json!({}),
            work.path(),
        );
        let args = vec![
            "find-generic-password".into(),
            "-s".into(),
            store.service.clone(),
            "-a".into(),
            "project-credentials".into(),
            "-w".into(),
        ];
        let mut command = policy
            .tool_command("/usr/bin/security", &args, &output, &scratch)
            .unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let result = runtime.block_on(async {
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                command.kill_on_drop(true).output(),
            )
            .await
            .expect("sandboxed Keychain lookup timed out")
            .unwrap()
        });
        assert!(
            !result.status.success(),
            "tool obtained ambient Keychain access"
        );
        assert!(!String::from_utf8_lossy(&result.stdout).contains(&secret));
        assert!(!String::from_utf8_lossy(&result.stderr).contains(&secret));
        assert!(read_keychain(&store.service).unwrap().is_some());
        let requested = std::collections::BTreeMap::from([(
            "tool-id".into(),
            std::collections::BTreeMap::from([("SERVICE".into(), saved.id.clone())]),
        )]);
        let captured = store.capture(&project, &requested).unwrap();
        assert_eq!(captured["tool-id"]["SERVICE"].revision, saved.revision);
        assert!(!serde_json::to_string(&captured).unwrap().contains(&secret));
        assert!(store.capture("another-project", &requested).is_err());
        assert!(
            Store::open(other_profile.path())
                .unwrap()
                .capture(&project, &requested)
                .is_err()
        );
        let visible = serde_json::to_string(&store.list(&project).unwrap()).unwrap();
        assert!(!visible.contains(&secret));
        assert_eq!(store.list("another-project").unwrap().len(), 0);
        assert_eq!(
            Store::open(other_profile.path())
                .unwrap()
                .list(&project)
                .unwrap()
                .len(),
            0
        );
        let reopened = Store::open(profile.path()).unwrap();
        assert_eq!(reopened.list(&project).unwrap()[0].revision, saved.revision);
        let replace = |revision: String, value: String| Command::Save {
            project_id: project.clone(),
            id: Some(saved.id.clone()),
            expected_revision: Some(revision),
            name: "Test service".into(),
            secret: value,
        };
        assert!(
            reopened
                .apply(replace("stale".into(), "replacement".into()))
                .is_err()
        );
        assert!(
            reopened
                .apply(Command::Delete {
                    project_id: "another-project".into(),
                    id: saved.id.clone(),
                    expected_revision: saved.revision.clone()
                })
                .is_err()
        );
        let updated = reopened
            .apply(replace(saved.revision.clone(), "replacement".into()))
            .unwrap()
            .unwrap();
        assert_ne!(updated.revision, saved.revision);
        let rotated = reopened.capture(&project, &requested).unwrap();
        assert_ne!(
            serde_json::to_value(&captured).unwrap(),
            serde_json::to_value(&rotated).unwrap()
        );
        assert_eq!(rotated["tool-id"]["SERVICE"].revision, updated.revision);
        assert!(
            store
                .apply(Command::Delete {
                    project_id: project.clone(),
                    id: saved.id.clone(),
                    expected_revision: saved.revision
                })
                .is_err()
        );
        let raw = read_keychain(&store.service).unwrap().unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains(&secret));
        for entry in std::fs::read_dir(profile.path()).unwrap() {
            let entry = entry.unwrap();
            assert_eq!(entry.file_name(), "connections.lock");
            assert!(std::fs::read(entry.path()).unwrap().is_empty());
        }
        store
            .apply(Command::Delete {
                project_id: project.clone(),
                id: updated.id,
                expected_revision: updated.revision,
            })
            .unwrap();
        assert!(read_keychain(&store.service).unwrap().is_none());
        assert!(store.list(&project).unwrap().is_empty());
        assert!(store.capture(&project, &requested).is_err());
    }
}
