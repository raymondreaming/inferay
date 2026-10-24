//! Read-only inspection of the five application stores. Never initialize a store here.
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{Duration, Instant},
};

pub(crate) mod http;
#[cfg(test)]
mod tests;

type Result<T> = crate::project_store::Result<T>;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DatabaseId {
    Projects,
    Memory,
    Chat,
    Skills,
    ClientStorage,
}
impl DatabaseId {
    fn filename(self) -> &'static str {
        match self {
            Self::Projects => "projects.sqlite3",
            Self::Memory => "memory.sqlite3",
            Self::Chat => "chat.sqlite3",
            Self::Skills => "skills.sqlite3",
            Self::ClientStorage => "client-storage.sqlite3",
        }
    }
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub id: DatabaseId,
    pub filename: String,
    pub purpose: String,
    pub owner: String,
    pub source_of_truth: String,
    pub exists: bool,
}
pub fn catalog(root: &Path) -> Vec<DatabaseInfo> {
    [
        (DatabaseId::Projects, "Projects, approvals and run history", "project_store / project_index / project_file_store", "Definition files own the index; approvals, runs and local bindings exist only in this database."),
        (DatabaseId::Memory, "Memory search and links", "memory_store", "Notes and documents under each project's memory folder. The database is a rebuildable index."),
        (DatabaseId::Chat, "Conversations and transcripts", "chat_persistence", "Authoritative conversation state. Do not delete or rebuild from an index."),
        (DatabaseId::Skills, "Global custom skills", "prompt_store", "Authoritative custom skill library. Bundled skills are supplied separately."),
        (DatabaseId::ClientStorage, "Appearance, drafts and panel state", "client_storage", "Authoritative interface state after the one-time JSON import."),
    ].into_iter().map(|(id, purpose, owner, source_of_truth)| DatabaseInfo {
        id, filename: id.filename().into(), purpose: purpose.into(), owner: owner.into(),
        source_of_truth: source_of_truth.into(), exists: root.join(id.filename()).is_file(),
    }).collect()
}
fn open(root: &Path, id: DatabaseId) -> Result<Connection> {
    let path = root.join(id.filename());
    // IDs are an allowlist, not paths. Reject symlinks out of the active profile too.
    if path.canonicalize()?.parent() != Some(root.canonicalize()?.as_path()) {
        return Err("Database must belong to the active profile".into());
    }
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(Duration::from_millis(500))?;
    db.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;")?;
    let started = Instant::now();
    db.progress_handler(
        1000,
        Some(move || started.elapsed() > Duration::from_secs(2)),
    )?;
    Ok(db)
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumn {
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub primary_key_position: i64,
    pub hidden: i64,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseForeignKey {
    pub id: i64,
    pub sequence: i64,
    pub table: String,
    pub from: String,
    pub to: Option<String>,
    pub on_update: String,
    pub on_delete: String,
    pub match_rule: String,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseIndexColumn {
    pub sequence: i64,
    pub column_id: i64,
    pub name: Option<String>,
    pub descending: bool,
    pub collation: String,
    pub key: bool,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseIndex {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub partial: bool,
    pub sql: Option<String>,
    pub columns: Vec<DatabaseIndexColumn>,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub name: String,
    pub kind: String,
    pub sql: Option<String>,
    pub without_rowid: bool,
    pub strict: bool,
    pub columns: Vec<DatabaseColumn>,
    pub foreign_keys: Vec<DatabaseForeignKey>,
    pub indexes: Vec<DatabaseIndex>,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
pub struct DatabaseTrigger {
    pub name: String,
    pub table: String,
    pub sql: Option<String>,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSchema {
    pub database: DatabaseId,
    pub sqlite_version: String,
    pub user_version: i64,
    pub journal_mode: String,
    pub objects: Vec<DatabaseObject>,
    pub triggers: Vec<DatabaseTrigger>,
}
fn columns(db: &Connection, table: &str) -> Result<Vec<DatabaseColumn>> {
    Ok(db
        .prepare("SELECT name,type,\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo(?1)")?
        .query_map([table], |r| {
            Ok(DatabaseColumn {
                name: r.get(0)?,
                declared_type: r.get(1)?,
                not_null: r.get(2)?,
                default_value: r.get(3)?,
                primary_key_position: r.get(4)?,
                hidden: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
}
pub fn schema(root: &Path, id: DatabaseId) -> Result<DatabaseSchema> {
    let db = open(root, id)?;
    let mut objects = db
        .prepare(
            "SELECT name,type,wr,strict FROM pragma_table_list WHERE schema='main' ORDER BY name",
        )?
        .query_map([], |r| {
            Ok(DatabaseObject {
                name: r.get(0)?,
                kind: r.get(1)?,
                without_rowid: r.get(2)?,
                strict: r.get(3)?,
                sql: None,
                columns: vec![],
                foreign_keys: vec![],
                indexes: vec![],
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for object in &mut objects {
        object.sql = db
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE name=?1",
                [&object.name],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        object.columns = columns(&db, &object.name)?;
        object.foreign_keys = db.prepare("SELECT id,seq,\"table\",\"from\",\"to\",on_update,on_delete,\"match\" FROM pragma_foreign_key_list(?1)")?
            .query_map([&object.name], |r| Ok(DatabaseForeignKey { id:r.get(0)?, sequence:r.get(1)?, table:r.get(2)?, from:r.get(3)?, to:r.get(4)?, on_update:r.get(5)?, on_delete:r.get(6)?, match_rule:r.get(7)? }))?.collect::<rusqlite::Result<_>>()?;
        object.indexes = db
            .prepare("SELECT name,\"unique\",origin,partial FROM pragma_index_list(?1)")?
            .query_map([&object.name], |r| {
                Ok(DatabaseIndex {
                    name: r.get(0)?,
                    unique: r.get(1)?,
                    origin: r.get(2)?,
                    partial: r.get(3)?,
                    sql: None,
                    columns: vec![],
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        for index in &mut object.indexes {
            index.sql = db
                .query_row(
                    "SELECT sql FROM sqlite_schema WHERE name=?1",
                    [&index.name],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();
            index.columns = db
                .prepare("SELECT seqno,cid,name,desc,coll,\"key\" FROM pragma_index_xinfo(?1)")?
                .query_map([&index.name], |r| {
                    Ok(DatabaseIndexColumn {
                        sequence: r.get(0)?,
                        column_id: r.get(1)?,
                        name: r.get(2)?,
                        descending: r.get(3)?,
                        collation: r.get(4)?,
                        key: r.get(5)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
        }
    }
    let triggers = db
        .prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")?
        .query_map([], |r| {
            Ok(DatabaseTrigger {
                name: r.get(0)?,
                table: r.get(1)?,
                sql: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(DatabaseSchema {
        database: id,
        sqlite_version: db.query_row("SELECT sqlite_version()", [], |r| r.get(0))?,
        user_version: db.pragma_query_value(None, "user_version", |r| r.get(0))?,
        journal_mode: db.pragma_query_value(None, "journal_mode", |r| r.get(0))?,
        objects,
        triggers,
    })
}
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn table_info(db: &Connection, name: &str) -> Result<(Vec<DatabaseColumn>, Option<String>)> {
    let (kind, without): (String, bool) = db.query_row(
        "SELECT type,wr FROM pragma_table_list WHERE schema='main' AND name=?1",
        [name],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let columns = columns(db, name)?;
    let rowid = if !without && kind != "view" {
        ["_rowid_", "rowid", "oid"]
            .into_iter()
            .find(|name| !columns.iter().any(|c| c.name.eq_ignore_ascii_case(name)))
            .map(str::to_owned)
    } else {
        None
    };
    Ok((columns, rowid))
}
#[derive(Clone, Copy, Default, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseDirection {
    #[default]
    Asc,
    Desc,
}
#[derive(Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseRowsQuery {
    pub database: DatabaseId,
    pub table: String,
    #[serde(default)]
    #[schemars(range(max = 1000000))]
    pub offset: u32,
    #[serde(default = "page_size")]
    #[schemars(range(min = 1, max = 100))]
    pub limit: u32,
    pub sort: Option<String>,
    #[serde(default)]
    pub direction: DatabaseDirection,
    pub column: Option<String>,
    pub filter: Option<String>,
}
fn page_size() -> u32 {
    50
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseStorageClass {
    Null,
    Integer,
    Real,
    Text,
    Blob,
}
impl rusqlite::types::FromSql for DatabaseStorageClass {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        match value.as_str()? {
            "null" => Ok(Self::Null),
            "integer" => Ok(Self::Integer),
            "real" => Ok(Self::Real),
            "text" => Ok(Self::Text),
            "blob" => Ok(Self::Blob),
            _ => Err(rusqlite::types::FromSqlError::InvalidType),
        }
    }
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
pub struct DatabaseCell {
    /// SQLite storage class: null, integer, real, text, blob. Integers are decimal strings; blobs are hex.
    pub kind: DatabaseStorageClass,
    pub value: Option<String>,
    pub truncated: bool,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
pub struct DatabaseRow {
    pub key: Option<String>,
    pub cells: Vec<DatabaseCell>,
}
#[derive(Serialize, ts_rs::TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRows {
    pub columns: Vec<String>,
    pub rows: Vec<DatabaseRow>,
    pub offset: u32,
    pub has_more: bool,
}
fn key_columns(columns: &[DatabaseColumn], rowid: &Option<String>) -> Vec<String> {
    if let Some(rowid) = rowid {
        return vec![rowid.clone()];
    }
    let mut keys: Vec<_> = columns
        .iter()
        .filter(|c| c.primary_key_position > 0)
        .collect();
    keys.sort_by_key(|c| c.primary_key_position);
    keys.into_iter().map(|c| c.name.clone()).collect()
}
// Bound cell payloads in SQL before allocating Rust strings.
fn cell_select(column: &str, start: u32, size: u32) -> String {
    let c = quote(column);
    format!(
        "typeof({c}), CASE typeof({c}) WHEN 'blob' THEN hex(substr({c},{start},{size})) WHEN 'text' THEN substr({c},{start},{size}) WHEN 'real' THEN printf('%!.17g',{c}) ELSE CAST({c} AS TEXT) END, CASE WHEN typeof({c}) IN ('text','blob') THEN length({c}) > {} ELSE 0 END",
        u64::from(start) - 1 + u64::from(size)
    )
}
pub fn rows(root: &Path, query: &DatabaseRowsQuery) -> Result<DatabaseRows> {
    if !(1..=100).contains(&query.limit)
        || query.offset > 1_000_000
        || query.filter.as_ref().is_some_and(|v| v.len() > 1000)
    {
        return Err("Use limit 1–100, offset 0–1000000, and a filter of at most 1000 bytes".into());
    }
    let db = open(root, query.database)?;
    let (columns, rowid) = table_info(&db, &query.table)?;
    let columns: Vec<_> = columns.into_iter().filter(|c| c.hidden != 1).collect();
    if columns.is_empty() || columns.len() > 200 {
        return Err("Table must have 1–200 visible columns".into());
    }
    for name in [&query.sort, &query.column].into_iter().flatten() {
        if !columns.iter().any(|c| &c.name == name) {
            return Err("Unknown column".into());
        }
    }
    if query.filter.is_some() && query.column.is_none() {
        return Err("Choose a filter column".into());
    }
    let keys = key_columns(&columns, &rowid);
    let mut order = Vec::new();
    if let Some(sort) = &query.sort {
        order.push(format!(
            "{} {}",
            quote(sort),
            match query.direction {
                DatabaseDirection::Asc => "ASC",
                DatabaseDirection::Desc => "DESC",
            }
        ));
    }
    order.extend(keys.iter().map(|key| quote(key)));
    if keys.is_empty() {
        order.extend(columns.iter().map(|c| quote(&c.name)));
    }
    let filter = query
        .column
        .as_ref()
        .filter(|_| query.filter.is_some())
        .map(|c| format!("WHERE instr(CAST({} AS TEXT),?1)>0", quote(c)))
        .unwrap_or_else(|| "WHERE ?1 IS NOT NULL".into());
    let locator = if keys.is_empty() {
        "NULL".into()
    } else {
        format!("json_array({})", keys.iter().map(|k| {let c=quote(k);format!("json_object('kind',typeof({c}),'value',CASE typeof({c}) WHEN 'blob' THEN hex({c}) WHEN 'real' THEN printf('%!.17g',{c}) ELSE CAST({c} AS TEXT) END)")}).collect::<Vec<_>>().join(","))
    };
    let sql = format!(
        "SELECT {},{} FROM {} {filter} ORDER BY {} LIMIT ?2 OFFSET ?3",
        locator,
        columns
            .iter()
            .map(|c| cell_select(&c.name, 1, 512))
            .collect::<Vec<_>>()
            .join(","),
        quote(&query.table),
        order.join(",")
    );
    let mut rows = db
        .prepare(&sql)?
        .query_map(
            params![
                query.filter.as_deref().unwrap_or(""),
                query.limit + 1,
                query.offset
            ],
            |r| {
                let cells = (0..columns.len())
                    .map(|i| {
                        Ok(DatabaseCell {
                            kind: r.get(1 + i * 3)?,
                            value: r.get(2 + i * 3)?,
                            truncated: r.get(3 + i * 3)?,
                        })
                    })
                    .collect::<rusqlite::Result<_>>()?;
                Ok(DatabaseRow {
                    key: r
                        .get::<_, Option<String>>(0)?
                        .filter(|key| key.len() <= 65536),
                    cells,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = rows.len() > query.limit as usize;
    rows.truncate(query.limit as usize);
    Ok(DatabaseRows {
        columns: columns.into_iter().map(|c| c.name).collect(),
        rows,
        offset: query.offset,
        has_more,
    })
}
#[derive(Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseCellQuery {
    pub database: DatabaseId,
    pub table: String,
    pub column: String,
    /// Opaque row key returned by the rows endpoint. Do not parse or modify it.
    pub key: String,
    /// Character offset for text, byte offset for blobs. Fixed 65536-unit chunks.
    #[serde(default)]
    pub offset: u32,
}
pub fn cell(root: &Path, query: &DatabaseCellQuery) -> Result<DatabaseCell> {
    let db = open(root, query.database)?;
    let (columns, rowid) = table_info(&db, &query.table)?;
    let keys = key_columns(&columns, &rowid);
    if keys.is_empty() || query.key.len() > 65536 {
        return Err("This object has no usable row key".into());
    }
    if !columns
        .iter()
        .any(|c| c.name == query.column && c.hidden != 1)
    {
        return Err("Unknown column".into());
    }
    #[derive(Deserialize)]
    struct KeyValue {
        kind: String,
        value: Option<String>,
    }
    let values: Vec<KeyValue> = serde_json::from_str(&query.key)?;
    if values.len() != keys.len() {
        return Err("Invalid row key".into());
    }
    let values = values
        .into_iter()
        .map(|v| -> Result<rusqlite::types::Value> {
            use rusqlite::types::Value;
            Ok(match (v.kind.as_str(), v.value) {
                ("null", None) => Value::Null,
                ("integer", Some(s)) => Value::Integer(s.parse()?),
                ("real", Some(s)) => Value::Real(s.parse()?),
                ("text", Some(s)) => Value::Text(s),
                ("blob", Some(s)) if s.len() % 2 == 0 && s.is_ascii() => Value::Blob(
                    (0..s.len())
                        .step_by(2)
                        .map(|i| u8::from_str_radix(&s[i..i + 2], 16))
                        .collect::<std::result::Result<Vec<_>, _>>()?,
                ),
                _ => return Err("Invalid row key value".into()),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let start = query
        .offset
        .checked_add(1)
        .ok_or("Cell offset is too large")?;
    let sql = format!(
        "SELECT {} FROM {} WHERE {}",
        cell_select(&query.column, start, 65536),
        quote(&query.table),
        keys.iter()
            .map(|k| format!("{} IS ?", quote(k)))
            .collect::<Vec<_>>()
            .join(" AND ")
    );
    Ok(db.query_row(&sql, rusqlite::params_from_iter(values), |r| {
        Ok(DatabaseCell {
            kind: r.get(0)?,
            value: r.get(1)?,
            truncated: r.get(2)?,
        })
    })?)
}
