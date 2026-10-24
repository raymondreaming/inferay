use super::*;
use serde_json::json;

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let db = Connection::open(root.path().join("projects.sqlite3")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE parent(id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE, body TEXT DEFAULT 'hello', derived TEXT GENERATED ALWAYS AS (body || '!') VIRTUAL);
        CREATE UNIQUE INDEX child_body ON child(lower(body) DESC) WHERE parent_id IS NOT NULL;
        CREATE TRIGGER child_added AFTER INSERT ON child BEGIN UPDATE parent SET name='changed' WHERE id=new.parent_id; END;
        CREATE TABLE composite(project TEXT, id TEXT, body TEXT, PRIMARY KEY(project,id)) WITHOUT ROWID;
        CREATE VIEW names AS SELECT name FROM parent;
        CREATE TABLE \"odd\"\"table\" (\"a\"\"b\" TEXT, n INTEGER, empty TEXT, nil TEXT, bin BLOB);
        INSERT INTO \"odd\"\"table\" VALUES('100% literal',9223372036854775807,'',NULL,x'00FF');
        INSERT INTO parent VALUES(1,'one'),(2,'two'),(3,'three');
        INSERT INTO child(id,parent_id,body) VALUES(1,1,'hi');").unwrap();
    db.execute(
        "INSERT INTO composite VALUES('p','n',?1)",
        ["🦀".repeat(70000)],
    )
    .unwrap();
    root
}
fn query(table: &str) -> DatabaseRowsQuery {
    serde_json::from_value(json!({"database":"projects","table":table})).unwrap()
}
#[test]
fn schema_is_live_and_includes_generated_columns_relations_indexes_and_triggers() {
    let root = fixture();
    let schema = schema(root.path(), DatabaseId::Projects).unwrap();
    let child = schema.objects.iter().find(|t| t.name == "child").unwrap();
    assert_eq!(child.columns[3].hidden, 2);
    assert_eq!(child.foreign_keys[0].table, "parent");
    assert_eq!(child.foreign_keys[0].on_delete, "CASCADE");
    assert_eq!(child.indexes[0].columns[0].column_id, -2);
    assert!(child.indexes[0].partial);
    assert!(child.indexes[0].columns[0].descending);
    assert_eq!(schema.triggers[0].name, "child_added");
    assert!(
        schema
            .objects
            .iter()
            .find(|t| t.name == "composite")
            .unwrap()
            .without_rowid
    );
}
#[test]
fn browse_preserves_sqlite_values_and_quotes_identifiers() {
    let root = fixture();
    let page = rows(root.path(), &query("odd\"table")).unwrap();
    assert_eq!(
        page.rows[0].cells[1].value.as_deref(),
        Some("9223372036854775807")
    );
    assert_eq!(page.rows[0].cells[2].value.as_deref(), Some(""));
    assert_eq!(page.rows[0].cells[3].kind, DatabaseStorageClass::Null);
    assert_eq!(page.rows[0].cells[3].value, None);
    assert_eq!(page.rows[0].cells[4].value.as_deref(), Some("00FF"));
    let mut q = query("odd\"table");
    q.column = Some("a\"b".into());
    q.filter = Some("%".into());
    assert_eq!(rows(root.path(), &q).unwrap().rows.len(), 1);
    q.filter = Some("' OR 1=1 --".into());
    assert!(rows(root.path(), &q).unwrap().rows.is_empty());
    q.sort = Some("not_a_column".into());
    assert!(rows(root.path(), &q).is_err());
    assert!(rows(root.path(), &query("parent;DROP TABLE child")).is_err());
}
#[test]
fn pagination_and_large_composite_key_cells_are_bounded_and_complete() {
    let root = fixture();
    let mut q = query("parent");
    q.limit = 2;
    let first = rows(root.path(), &q).unwrap();
    assert!(first.has_more);
    assert_eq!(first.rows.len(), 2);
    q.offset = 2;
    let last = rows(root.path(), &q).unwrap();
    assert!(!last.has_more);
    assert_eq!(last.rows.len(), 1);
    q.limit = 101;
    assert!(rows(root.path(), &q).is_err());
    let page = rows(root.path(), &query("composite")).unwrap();
    assert!(page.rows[0].cells[2].truncated);
    assert_eq!(
        page.rows[0].cells[2]
            .value
            .as_ref()
            .unwrap()
            .chars()
            .count(),
        512
    );
    let mut q = DatabaseCellQuery {
        database: DatabaseId::Projects,
        table: "composite".into(),
        column: "body".into(),
        key: page.rows[0].key.clone().unwrap(),
        offset: 0,
    };
    let first = cell(root.path(), &q).unwrap();
    assert!(first.truncated);
    q.offset = 65536;
    let last = cell(root.path(), &q).unwrap();
    assert!(!last.truncated);
    assert_eq!(
        format!("{}{}", first.value.unwrap(), last.value.unwrap()),
        "🦀".repeat(70000)
    );
}
#[test]
fn inspection_never_initializes_or_mutates_stores() {
    let root = fixture();
    assert!(
        !catalog(root.path())
            .iter()
            .find(|d| matches!(d.id, DatabaseId::Skills))
            .unwrap()
            .exists
    );
    assert!(schema(root.path(), DatabaseId::Skills).is_err());
    assert!(!root.path().join("skills.sqlite3").exists());
    let db = open(root.path(), DatabaseId::Projects).unwrap();
    assert!(db.execute("DELETE FROM parent", []).is_err());
    assert!(db.execute_batch("PRAGMA user_version=99").is_err());
    assert_eq!(
        schema(root.path(), DatabaseId::Projects)
            .unwrap()
            .user_version,
        0
    );
}
#[cfg(unix)]
#[test]
fn rejects_database_symlinks_outside_profile() {
    let source = fixture();
    let profile = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(
        source.path().join("projects.sqlite3"),
        profile.path().join("projects.sqlite3"),
    )
    .unwrap();
    assert!(schema(profile.path(), DatabaseId::Projects).is_err());
}
#[tokio::test]
async fn http_requires_auth_and_serves_typed_schema_rows_and_spec() {
    let root = tempfile::tempdir().unwrap();
    let mut config =
        crate::ServerConfig::new("127.0.0.1:0".parse().unwrap(), root.path().join("app"));
    config.user_data_dir = root.path().join("profile");
    config.home_directory = root.path().join("home");
    config.run_automations = false;
    let auth = config.auth_token.clone();
    let mut server = crate::ServerHandle::start(config).unwrap();
    let base = format!("http://{}", server.local_addr());
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{base}/api/databases"))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    for path in [
        "/api/databases",
        "/api/databases/schema?database=projects",
        "/api/databases/rows?database=projects&table=runs",
        "/api/openapi.json",
    ] {
        let response = client
            .get(format!("{base}{path}"))
            .header("X-Inferay-Auth", &auth)
            .header("sec-fetch-site", "same-origin")
            .header("origin", "http://localhost:9999")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            200,
            "{path}: {}",
            response.text().await.unwrap()
        );
    }
    for path in [
        "/api/databases/schema?database=../../other",
        "/api/databases/rows?database=projects&table=runs&limit=0",
        "/api/databases/rows?database=projects&table=runs&offset=bad",
        "/api/databases/rows?database=projects&table=runs&unknown=1",
    ] {
        assert_eq!(
            client
                .get(format!("{base}{path}"))
                .header("X-Inferay-Auth", &auth)
                .header("sec-fetch-site", "same-origin")
                .header("origin", "http://localhost:9999")
                .send()
                .await
                .unwrap()
                .status(),
            400,
            "{path}"
        );
    }
    assert_ne!(
        client
            .post(format!("{base}/api/databases/rows"))
            .header("X-Inferay-Auth", &auth)
            .header("sec-fetch-site", "same-origin")
            .header("origin", "http://localhost:9999")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.shutdown();
}

#[test]
fn composite_keys_retain_real_and_blob_identity_and_deleted_rows_error() {
    let root = fixture();
    let writer = Connection::open(root.path().join("projects.sqlite3")).unwrap();
    writer
        .execute_batch(
            "CREATE TABLE mixed(k REAL,b BLOB,value TEXT,PRIMARY KEY(k,b)) WITHOUT ROWID;",
        )
        .unwrap();
    writer
        .execute(
            "INSERT INTO mixed VALUES(?1,x'00FF','exact')",
            [1.2345678901234567_f64],
        )
        .unwrap();
    let page = rows(root.path(), &query("mixed")).unwrap();
    let q = DatabaseCellQuery {
        database: DatabaseId::Projects,
        table: "mixed".into(),
        column: "value".into(),
        key: page.rows[0].key.clone().unwrap(),
        offset: 0,
    };
    assert_eq!(
        cell(root.path(), &q).unwrap().value.as_deref(),
        Some("exact")
    );
    writer.execute("DELETE FROM mixed", []).unwrap();
    assert!(cell(root.path(), &q).is_err());
}
