use super::*;
use serde_json::json;

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let project = root.path().join(&id);
    fs::create_dir(&project).unwrap();
    write(&project, "project.json", json!({"schema":"inferay.project/1","id":id,"name":"Research","description":"","instructions":"","repositories":[]}).to_string().as_bytes(), None).unwrap();
    write(&project, "plugins/daily/plugin.json", json!({"schema":"inferay.plugin/1","id":uuid::Uuid::new_v4().to_string(),"name":"Daily","version":"1","description":"","may":[]}).to_string().as_bytes(), None).unwrap();
    write(&project, "plugins/daily/automations/daily.json", json!({"schema":"inferay.automation/1","id":uuid::Uuid::new_v4().to_string(),"name":"Daily","trigger":{"kind":"manual"},"overlap":"skip","execution":{"kind":"agent","provider":"codex","instructions":"Read sources","skills":[],"resources":[],"repositories":[],"workingDirectory":{"base":"project","path":"."},"timeoutSeconds":300},"may":[]}).to_string().as_bytes(), None).unwrap();
    (root, project)
}
#[test]
fn external_edits_change_hash_and_invalid_manifest_blocks_its_automation() {
    let (_root, project) = fixture();
    let first = scan(&project, &BTreeSet::new()).unwrap();
    assert!(first.iter().all(|f| f.error.is_none()), "{first:?}");
    let manifest = "plugins/daily/plugin.json";
    let old = first
        .iter()
        .find(|f| f.path == manifest)
        .unwrap()
        .hash
        .clone()
        .unwrap();
    fs::write(project.join(manifest), b"{broken").unwrap();
    let second = scan(&project, &BTreeSet::new()).unwrap();
    let changed = second.iter().find(|f| f.path == manifest).unwrap();
    assert_ne!(changed.hash.as_deref(), Some(old.as_str()));
    assert!(changed.error.is_some());
    assert!(changed.definition.is_none());
    assert!(
        second
            .iter()
            .find(|f| f.path.ends_with("automations/daily.json"))
            .unwrap()
            .error
            .is_some()
    );
    assert!(write(&project, manifest, b"{}", Some(&old)).is_err());
    assert_eq!(fs::read(project.join(manifest)).unwrap(), b"{broken");
}
#[test]
fn resource_directory_and_project_identity_are_checked() {
    let (_root, project) = fixture();
    write(&project, "memory/brand.brand/wrong.json", json!({"schema":"inferay.resource/1","id":uuid::Uuid::new_v4().to_string(),"type":"brand.genome","typeVersion":1,"name":"Wrong","archived":false,"body":{"brandId":"x"}}).to_string().as_bytes(), None).unwrap();
    let indexed = scan(&project, &BTreeSet::new()).unwrap();
    assert!(
        indexed
            .iter()
            .find(|f| f.path.contains("wrong.json"))
            .unwrap()
            .error
            .as_deref()
            .unwrap()
            .contains("directory")
    );
    let value = fs::read(project.join("project.json")).unwrap();
    let mut value: serde_json::Value = serde_json::from_slice(&value).unwrap();
    value["id"] = json!(uuid::Uuid::new_v4().to_string());
    fs::write(project.join("project.json"), value.to_string()).unwrap();
    let indexed = scan(&project, &BTreeSet::new()).unwrap();
    assert!(indexed.iter().all(|f| f.error.is_some()));
}
#[cfg(unix)]
#[test]
fn symlink_inside_plugin_blocks_bundle_without_reading_target() {
    let (_root, project) = fixture();
    std::os::unix::fs::symlink("/does-not-exist", project.join("plugins/daily/external")).unwrap();
    let indexed = scan(&project, &BTreeSet::new()).unwrap();
    assert!(
        indexed
            .iter()
            .filter(|f| f.path.starts_with("plugins/"))
            .all(|f| f.error.is_some())
    );
    assert!(
        indexed
            .iter()
            .find(|f| f.path.ends_with("external"))
            .unwrap()
            .hash
            .is_none()
    );
}

#[test]
fn complete_plugin_bundle_is_validated_before_exclusive_publication() {
    let (_profile, root) = fixture();
    let id = uuid::Uuid::new_v4().to_string();
    let mut bundle = std::collections::BTreeMap::from([
        ("plugin.json".into(),json!({"schema":"inferay.plugin/1","id":id,"name":"Reports","version":"1","description":"","may":[]}).to_string()),
        ("tools/report/tool.json".into(),json!({"schema":"inferay.tool/1","id":uuid::Uuid::new_v4().to_string(),"name":"Report","program":"python3","entrypoint":"main.py","args":[],"timeoutSeconds":30,"inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}).to_string()),
    ]);
    assert!(create_plugin(&root, "reports", &bundle, &BTreeSet::new()).is_err());
    assert!(!root.join("plugins/reports").exists());
    bundle.insert("tools/report/main.py".into(), "print('{}')".into());
    validate_bundle(&root, "reports", &bundle, &BTreeSet::new()).unwrap();
    assert!(!root.join("plugins/reports").exists());
    assert_eq!(
        create_plugin(&root, "reports", &bundle, &BTreeSet::new()).unwrap(),
        id
    );
    assert!(
        scan(&root, &BTreeSet::new())
            .unwrap()
            .iter()
            .all(|file| file.error.is_none())
    );
    bundle.insert("tools/report/main.py".into(), "print('overwritten')".into());
    assert!(create_plugin(&root, "reports", &bundle, &BTreeSet::new()).is_err());
    assert_eq!(
        fs::read_to_string(root.join("plugins/reports/tools/report/main.py")).unwrap(),
        "print('{}')"
    );
    assert!(fs::read_dir(root.join("plugins")).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".staging-")
    }));
}

#[test]
fn reusable_code_plugin_needs_no_skill_tool_or_automation() {
    let (_profile, root) = fixture();
    let id = uuid::Uuid::new_v4().to_string();
    let bundle = std::collections::BTreeMap::from([
        ("plugin.json".into(), json!({"schema":"inferay.plugin/1","id":id,"name":"Scene kit","version":"1","description":"Reusable scene composition helpers","may":[]}).to_string()),
        ("README.md".into(), "Import src.scene to compose a scene. No scheduled work.".into()),
        ("src/scene.py".into(), "def scene():\n    return {'objects': []}\n".into()),
        ("assets/palette.json".into(), "{\"background\":\"#101010\"}".into()),
    ]);
    assert_eq!(
        create_plugin(&root, "scene-kit", &bundle, &BTreeSet::new()).unwrap(),
        id
    );
    let indexed = scan(&root, &BTreeSet::new()).unwrap();
    assert!(indexed.iter().all(|entry| entry.error.is_none()));
    for (path, content) in &bundle {
        assert_eq!(
            fs::read_to_string(root.join("plugins/scene-kit").join(path)).unwrap(),
            *content
        );
        let hashes = crate::project_index::package_files(&root, "plugins/scene-kit").unwrap();
        assert_eq!(
            hashes.get(&format!("plugins/scene-kit/{path}")),
            Some(&hash(content.as_bytes()))
        );
    }
}

#[test]
fn raw_library_intake_preserves_binary_and_never_installs_embedded_jobs() {
    let (_root, project) = fixture();
    let original = std::collections::BTreeMap::from([
        ("models/scene.blend".to_owned(), vec![0, 255, 1, 128]),
        (
            "scripts/render.py".to_owned(),
            b"print('render')\n".to_vec(),
        ),
        (
            "plugin.json".to_owned(),
            b"original manifest kept verbatim".to_vec(),
        ),
        (
            "automations/post.json".to_owned(),
            b"not an installed automation".to_vec(),
        ),
    ]);
    let id = import_library(&project, "Blender kit", &original).unwrap();
    let indexed = scan(&project, &BTreeSet::new()).unwrap();
    let entry = indexed.iter().find(|entry| matches!(&entry.definition, Some(DefinitionFile::Plugin(plugin)) if plugin.id == id)).unwrap();
    assert!(entry.error.is_none());
    let prefix = entry.path.strip_suffix("/plugin.json").unwrap();
    for (path, bytes) in &original {
        assert_eq!(
            read(
                &project,
                &format!("{prefix}/source/{path}"),
                PLUGIN_BYTE_LIMIT
            )
            .unwrap(),
            *bytes
        );
    }
    assert!(
        !indexed
            .iter()
            .any(|entry| entry.path.starts_with(&format!("{prefix}/source/")))
    );
    let before = fs::read_dir(project.join("plugins")).unwrap().count();
    let invalid = std::collections::BTreeMap::from([("../escape".into(), vec![1])]);
    assert!(import_library(&project, "Bad import", &invalid).is_err());
    let collision =
        std::collections::BTreeMap::from([("a".into(), vec![1]), ("a/file".into(), vec![2])]);
    assert!(import_library(&project, "Conflicting files", &collision).is_err());
    assert_eq!(
        fs::read_dir(project.join("plugins")).unwrap().count(),
        before
    );
}
