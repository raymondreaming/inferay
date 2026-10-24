use super::*;
use crate::{ApiResult, Request, Response, ServerState, json_response};
use axum::{extract::Query, http::StatusCode};
use serde_json::{Value, json};

// Dispatch and OpenAPI use this same list. Adding an endpoint requires its
// typed query and response schema in the OpenAPI match below.
#[derive(Clone, Copy)]
enum Operation {
    Catalog,
    Schema,
    Rows,
    Cell,
}
const ENDPOINTS: &[(&str, &str, Operation)] = &[
    ("/api/databases", "listDatabases", Operation::Catalog),
    (
        "/api/databases/schema",
        "getDatabaseSchema",
        Operation::Schema,
    ),
    ("/api/databases/rows", "getDatabaseRows", Operation::Rows),
    ("/api/databases/cell", "getDatabaseCell", Operation::Cell),
];
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct SchemaQuery {
    database: DatabaseId,
}
#[derive(Serialize, JsonSchema)]
struct ErrorResponse {
    error: String,
}

pub(crate) fn handles(path: &str) -> bool {
    ENDPOINTS.iter().any(|e| e.0 == path)
}
pub(crate) async fn read(state: &ServerState, request: Request) -> ApiResult<Response> {
    let operation = ENDPOINTS
        .iter()
        .find(|e| e.0 == request.uri().path())
        .expect("database route")
        .2;
    let root = state.user_data_dir.clone();
    let uri = request.uri().clone();
    // SQLite reads never hold an application writer mutex or block the async runtime.
    let result = tokio::task::spawn_blocking(move || -> Result<Value> {
        Ok(match operation {
            Operation::Catalog => serde_json::to_value(catalog(&root))?,
            Operation::Schema => serde_json::to_value(schema(
                &root,
                Query::<SchemaQuery>::try_from_uri(&uri)?.database,
            )?)?,
            Operation::Rows => serde_json::to_value(rows(
                &root,
                &Query::<DatabaseRowsQuery>::try_from_uri(&uri)?.0,
            )?)?,
            Operation::Cell => serde_json::to_value(cell(
                &root,
                &Query::<DatabaseCellQuery>::try_from_uri(&uri)?.0,
            )?)?,
        })
    })
    .await?;
    let mut response = match result {
        Ok(value) => json_response(StatusCode::OK, value),
        Err(error) => json_response(
            StatusCode::BAD_REQUEST,
            ErrorResponse {
                error: error.to_string(),
            },
        ),
    };
    response
        .headers_mut()
        .insert("Cache-Control", "no-store".parse().unwrap());
    Ok(response)
}
fn json_schema<T: JsonSchema>() -> Value {
    serde_json::to_value(
        schemars::generate::SchemaSettings::draft2020_12()
            .with(|s| s.inline_subschemas = true)
            .into_generator()
            .into_root_schema_for::<T>(),
    )
    .unwrap()
}
/// Complete contract for the database inspection surface. Other application
/// routes are documented separately, not mislabeled as typed OpenAPI coverage.
pub fn openapi() -> Value {
    let mut paths = serde_json::Map::new();
    for (path, name, operation) in ENDPOINTS {
        let (query, response, description) = match operation {
            Operation::Catalog => (
                json!({}),
                json_schema::<Vec<DatabaseInfo>>(),
                "List allowlisted stores in the active profile, including stores not created yet. Does not initialize or migrate databases.",
            ),
            Operation::Schema => (
                json_schema::<SchemaQuery>(),
                json_schema::<DatabaseSchema>(),
                "Live SQLite schema: tables, views, shadow tables, hidden/generated columns, foreign keys, index expressions and triggers. PRAGMAs describe this read-only connection, not another connection's settings.",
            ),
            Operation::Rows => (
                json_schema::<DatabaseRowsQuery>(),
                json_schema::<DatabaseRows>(),
                "Read 1–100 rows, offset up to 1000000. Optional case-sensitive literal substring filter (maximum 1000 bytes) on one column; sort column validated against schema. Cells preview 512 characters or blob bytes. Integers are decimal strings, blobs hex, NULL is null. Each request has its own SQLite snapshot; live writes can shift pages. Query execution budget: 2 seconds; busy timeout: 500ms. At most 200 visible columns.",
            ),
            Operation::Cell => (
                json_schema::<DatabaseCellQuery>(),
                json_schema::<DatabaseCell>(),
                "Read one cell by its opaque row key, in 65536-character text or 65536-byte blob chunks. Increment offset by 65536 while truncated is true. Keys use rowid or the ordered primary key for WITHOUT ROWID tables. Views without a key support previews only. Keys larger than 65536 bytes are not returned. A later read can observe updates or deletion; row keys are not durable business identifiers.",
            ),
        };
        let parameters:Vec<_> = query["properties"].as_object().into_iter().flatten().map(|(name,schema)| json!({"name":name,"in":"query","required":query["required"].as_array().is_some_and(|r|r.iter().any(|v|v==name)),"schema":schema})).collect();
        paths.insert((*path).into(),json!({"get":{"operationId":name,"tags":["Database explorer"],"description":description,"parameters":parameters,"responses":{
            "200":{"description":"Successful inspection","content":{"application/json":{"schema":response}}},
            "400":{"description":"Invalid query, unavailable store/table/row, query budget exhausted, or SQLite error","content":{"application/json":{"schema":json_schema::<ErrorResponse>()}}},
            "403":{"description":"Local authentication or origin rejected"}
        }}}));
    }
    paths.insert("/api/openapi.json".into(),json!({"get":{"operationId":"getOpenApi","responses":{"200":{"description":"This OpenAPI document","content":{"application/json":{"schema":{"type":"object"}}}},"403":{"description":"Local authentication or origin rejected"}}}}));
    json!({"openapi":"3.1.0","info":{"title":"Inferay database inspection API","version":"1.0.0","description":"Authenticated, read-only internal SQLite inspection. Requests require a valid local token plus trusted loopback Origin or same-origin/none Sec-Fetch-Site context; see docs/api.md. This spec covers every database explorer operation; it is not a claim of coverage for all legacy application routes. MCP uses its separate per-turn JSON-RPC transport; see mcp-tools.json and docs/mcp.md."},"servers":[{"url":"/"}],"security":[{"localHeader":[]},{"localCookie":[]}],"components":{"securitySchemes":{"localHeader":{"type":"apiKey","in":"header","name":"X-Inferay-Auth"},"localCookie":{"type":"apiKey","in":"cookie","name":"inferay_local_auth"}}},"paths":paths})
}
