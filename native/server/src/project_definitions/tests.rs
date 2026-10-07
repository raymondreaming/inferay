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
    write(&project, "resources/brand.brand/wrong.json", json!({"schema":"inferay.resource/1","id":uuid::Uuid::new_v4().to_string(),"type":"brand.genome","typeVersion":1,"name":"Wrong","archived":false,"body":{"brandId":"x"}}).to_string().as_bytes(), None).unwrap();
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
