use super::*;

pub(crate) fn migrate(db: &Connection, root: &Path) -> Result<()> {
    let projects = root.join("projects");
    if !projects.exists() {
        return Ok(());
    }
    for project in fs::read_dir(projects)? {
        let project = project?;
        if !project.file_type()?.is_dir() {
            continue;
        }
        let directory = project.path();
        if !directory.join("project.json").is_file() {
            continue;
        }
        for container in ["plugins", "automations"] {
            let parent = directory.join(container);
            if !parent.exists() {
                continue;
            }
            for entry in fs::read_dir(parent)? {
                let entry = entry?;
                if !entry.file_type()?.is_dir() {
                    continue;
                }
                let folder = entry.file_name().to_string_lossy().into_owned();
                let source = entry.path();
                let manifest_path = source.join("plugin.json");
                if !manifest_path.is_file() {
                    continue;
                }
                let manifest: PluginDefinition = match fs::read(&manifest_path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                {
                    Some(value) => value,
                    None => continue,
                };
                let id = if container == "plugins" {
                    folder.strip_prefix("automation-").unwrap_or("")
                } else {
                    &folder
                };
                if Uuid::parse_str(id).is_err()
                    || manifest.id != derived_id("automation-plugin", id)
                    || manifest.description
                        != "Migrated capability. Review instructions and declare permissions before enabling."
                {
                    continue;
                }
                let destination = directory.join("automations").join(id);
                let old_file = source.join("automations").join(format!("{id}.json"));
                let new_file = source.join("automation.json");
                let current = if old_file.exists() {
                    &old_file
                } else {
                    &new_file
                };
                let definition: AutomationDefinition = serde_json::from_slice(&fs::read(current)?)?;
                if definition.id != id {
                    return Err("Migrated automation identity does not match its folder".into());
                }
                db.execute("UPDATE automation_state SET enabled=0,next_due_at=NULL,approved_hash=NULL,inputs_changed=1 WHERE automation_id=?", [id])?;
                db.execute(
                    "UPDATE plugin_state SET approved_hash=NULL WHERE plugin_id=?",
                    [&manifest.id],
                )?;
                if container == "plugins" {
                    fs::create_dir_all(directory.join("automations"))?;
                    files::publish_directory(&source, &destination, files::Publication::Create)?;
                }
                let old_file = destination.join("automations").join(format!("{id}.json"));
                let new_file = destination.join("automation.json");
                if old_file.exists() {
                    if new_file.exists() {
                        return Err("Automation migration destination already exists".into());
                    }
                    fs::rename(&old_file, &new_file)?;
                    let _ = fs::remove_dir(destination.join("automations"));
                }
                if destination.join(".migrated-plugin.json").exists() {
                    return Err("Automation migration recovery record already exists".into());
                }
                fs::rename(
                    destination.join("plugin.json"),
                    destination.join(".migrated-plugin.json"),
                )?;
                fs::File::open(&destination)?.sync_all()?;
                fs::File::open(directory.join("automations"))?.sync_all()?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_index;
    use serde_json::json;

    #[test]
    fn generated_wrappers_become_jobs_without_losing_files_or_history() {
        let profile = tempfile::tempdir().unwrap();
        let project = Uuid::new_v4().to_string();
        let job = Uuid::new_v4().to_string();
        let plugin = derived_id("automation-plugin", &job);
        let directory = profile.path().join("projects").join(&project);
        fs::create_dir_all(&directory).unwrap();
        let prefix = format!("plugins/automation-{job}");
        for (path, value) in [
            (
                "project.json".to_owned(),
                json!({"schema":"inferay.project/1","id":project,"name":"Research","description":"","instructions":"","repositories":[]}),
            ),
            (
                format!("{prefix}/plugin.json"),
                json!({"schema":"inferay.plugin/1","id":plugin,"name":"Daily research","version":"1","description":"Migrated capability. Review instructions and declare permissions before enabling.","may":[]}),
            ),
            (
                format!("{prefix}/automations/{job}.json"),
                json!({"schema":"inferay.automation/1","id":job,"name":"Daily research","trigger":{"kind":"interval","seconds":86400},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Read sources","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]}),
            ),
            (
                "plugins/blender/plugin.json".to_owned(),
                json!({"schema":"inferay.plugin/1","id":Uuid::new_v4().to_string(),"name":"Blender toolkit","version":"1","description":"Reusable rendering helpers","may":[]}),
            ),
        ] {
            files::write(&directory, &path, value.to_string().as_bytes(), None).unwrap();
        }
        files::write(
            &directory,
            &format!("{prefix}/assets/model.bin"),
            &[0, 255, 1],
            None,
        )
        .unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        project_index::create_schema(&db).unwrap();
        db.execute_batch("CREATE TABLE runs(id TEXT,automation_id TEXT,result TEXT);")
            .unwrap();
        db.execute(
            "INSERT INTO runs VALUES('old-run',?,'result preserved')",
            [&job],
        )
        .unwrap();
        project_index::refresh(&mut db, profile.path(), &[]).unwrap();
        db.execute(
            "UPDATE automation_state SET enabled=1,approved_hash='old' WHERE automation_id=?",
            [&job],
        )
        .unwrap();
        migrate(&db, profile.path()).unwrap();
        migrate(&db, profile.path()).unwrap();
        project_index::refresh(&mut db, profile.path(), &[]).unwrap();
        let catalog = project_index::catalog(&db, Some(&project)).unwrap();
        assert_eq!(catalog.plugins.len(), 1);
        assert_eq!(
            catalog.plugins[0].file.definition.as_ref().unwrap().name,
            "Blender toolkit"
        );
        assert_eq!(catalog.automations.len(), 1);
        assert_eq!(catalog.automations[0].file.id, job);
        assert!(catalog.automations[0].file.plugin_id.is_none());
        assert!(!catalog.automations[0].enabled);
        assert!(
            catalog.automations[0].file.error.is_none(),
            "{:?}",
            catalog.automations[0].file.error
        );
        assert_eq!(
            fs::read(directory.join(format!("automations/{job}/assets/model.bin"))).unwrap(),
            [0, 255, 1]
        );
        assert!(
            directory
                .join(format!("automations/{job}/.migrated-plugin.json"))
                .exists()
        );
        let history: String = db
            .query_row(
                "SELECT result FROM runs WHERE automation_id=?",
                [&job],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history, "result preserved");
        let snapshot = project_index::execution_inputs(&db, profile.path(), &job, &[]).unwrap();
        assert_eq!(snapshot["automation"]["id"], job);
    }
}
