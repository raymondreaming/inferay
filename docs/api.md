# HTTP contracts and generated references

Inferay's Rust server is the API boundary; Solid feature services call it through `src/shared/lib/native.tsx`. Rust request/response types exported by `ts-rs` supply `@contracts`. Keep parsing, validation, permission checks and database access on the server. Shared renderer contracts do not replace runtime validation.

## Contract coverage

| Artifact | Generated from | Coverage |
|---|---|---|
| [openapi.json](reference/openapi.json) | Database route registry + Rust request/response types through Schemars | OpenAPI 3.1 for every database explorer operation and the spec endpoint |
| [mcp-openapi.json](reference/mcp-openapi.json) | Native bridge transport contract + actual native tool definitions | Per-turn MCP HTTP/JSON-RPC envelope and tool argument alternatives; separate ephemeral server |
| [mcp-tools.json](reference/mcp-tools.json) | The live skill/project/memory/library-tool definition owners and project command help | Native tool catalogue superset and action examples; actual turn scope can expose less |
| [database-schema.json](reference/database-schema.json) | Production initializers against a disposable empty profile, then SQLite introspection | Complete fresh-profile schema of all five databases, including SQLite internal/FTS objects |
| [http-routes.json](reference/http-routes.json) | Static path/method branches in `dispatch_api`, plus the database route registry | Application route inventory, not typed client coverage |
| `build/presentation/contracts/` | Rust `ts-rs` exports | Renderer request/response vocabulary, including explorer types; generated build output |

The OpenAPI document intentionally identifies its boundary. The entire legacy HTTP API is **not yet described with precise OpenAPI payloads**. An untyped JSON placeholder for every route would give a misleading generated client. The route inventory makes that remaining work visible. Provider WebSocket messages and external MCP servers are different protocols, not REST operations in this document.

Run:

```sh
bun run generate:api
cargo test -p inferay-server api_reference
cargo test -p inferay-server database_explorer
bun run build:renderer
bun run verify:database
```

The generator writes deterministic reference artifacts under `docs/reference/`. It creates and removes a temporary profile; it does not inspect the user's databases, run automations, contact providers or export data rows. A regression test compares committed artifacts to the same production generators.

## Authentication and request context

Main-app `/api/*` requests must have a loopback Host, trusted request context and local authorization. For ordinary HTTP clients, provide `X-Inferay-Auth` or the `inferay_local_auth` cookie and a loopback Origin; requests without Origin require `Sec-Fetch-Site: same-origin` or `none`. Cross-site fetch metadata is rejected. A bare token with no trusted request context is insufficient. The native `views:` origin is a separately trusted application-host path in the current server policy. OpenAPI security describes the ordinary header/cookie path, not a portable remote authentication service.

Do not hardcode or log tokens. The renderer/native host handles its own authorization. The MCP bridge uses a different per-turn bearer token and rejects all Origin headers; see [MCP](mcp.md). Opening the main application API to a network interface is outside these contracts.

## Database explorer endpoints

All operations are GET-only; invalid query arguments, unavailable stores/tables/rows, SQLite errors and exhausted read budgets return HTTP 400 with `{ "error": "…" }`. Failed local authentication/origin checks return HTTP 403 plain text. Unexpected worker failures can return HTTP 500. Successful inspection responses have `Cache-Control: no-store`. Unknown HTTP methods/routes are rejected by the normal dispatcher.

| Endpoint | Input | Result |
|---|---|---|
| `/api/databases` | None | Allowlisted IDs, filenames, purposes, owners, source-of-truth description, existence |
| `/api/databases/schema` | `database` | SQLite version, user version, journal mode, all tables/views/shadow objects with columns, indexes, foreign keys and triggers |
| `/api/databases/rows` | `database`, `table`; optional `offset`, `limit`, `sort`, `direction`, `column`, `filter` | Ordered column names, rows of typed cell previews, opaque row keys, offset and `hasMore` |
| `/api/databases/cell` | `database`, `table`, `column`, opaque `key`; optional `offset` | One current cell chunk, SQLite storage class and truncation flag |
| `/api/openapi.json` | None | Current database OpenAPI document; also downloadable from the explorer |

Database IDs: `projects`, `memory`, `chat`, `skills`, `client-storage`. They are enums, not filenames or arbitrary paths. No operation creates a missing store or invokes migrations/index refresh.

Rows default to 50, allow 1–100, and accept offsets through 1,000,000. `direction` is `asc` or `desc`. Filtering is case-sensitive literal substring matching on the chosen column after text conversion; `%` and `_` are ordinary characters, not LIKE wildcards. A filter requires a valid column and is limited to 1,000 UTF-8 bytes. Sort ties use rowid or ordered primary-key fields; keyless views use visible columns as a fallback. There is no exact total-count scan. `hasMore` comes from one extra row.

Cells have `{ kind, value, truncated }`. `kind` is SQLite's runtime storage class (`null`, `integer`, `real`, `text`, `blob`), distinct from a column's declared affinity. `value` is nullable text: decimal integers, SQLite real text, literal text, or hexadecimal blob bytes. Never convert 64-bit integers to JavaScript numbers. NULL differs from an empty string or an empty blob.

Previews are bounded to 512 text characters/blob bytes; full inspection uses 65,536-unit chunks. Pass the row's opaque `key` unchanged and increase cell offset by 65,536 while `truncated` is true. A key is nullable for keyless views or oversized key payloads. Composite `WITHOUT ROWID` primary keys are supported. Each request is a new read snapshot; rows can change between pages/chunks. The UI keeps raw text so JSON numbers and provider payloads are not silently reformatted or rounded.

SQLite reads run in blocking workers with a short busy timeout and VM progress budget. This limits expensive sorts/filters without holding application writer mutexes. The API does not accept arbitrary SQL, database paths, joins, mutations, schema changes or maintenance commands.

## Existing application surfaces and actions

The generated static inventory provides exact path/method pairs. These are the semantic groups and owners to consult for payloads:

| Area | Main routes / owner | Behavior |
|---|---|---|
| Projects | `/api/projects`, `/history`, `/command`; `project_file_store`, `project_file_commands`, `project_runs` | Catalogue/index refresh, history, typed project commands and run lifecycle |
| Proposals | `/api/projects/proposal`, `/proposal-review`; `project_proposals` | Concrete preview/edit/review/save/decline with identity/hash checks |
| Effects | `/api/projects/effects`, `/effects/dismiss`, `/effects/cancel`; `project_effects` | Intent inbox and review state; not unrestricted external delivery |
| Connections | `/api/projects/connections`; `connections` | Typed project credential/connection operations, Keychain boundary |
| Project files | `/api/projects/documents`, `/document`, `/plugin-import`; file/proposal owners | Managed uploads/reads and library import; path/size/content checks |
| Run chat | `/api/projects/run-chat`; `project_chat` | Open/restore a run's conversation without overwriting a live transcript |
| Memory | `/api/memory`, `/note`, `/graph`, `/save`, `/delete`; `memory_store` | Search/read/graph, validated user-directed file changes |
| Skills | `/api/prompts`, `/proposal`, `/api/prompts/{id}`; `prompt_store` | List/create, accepted proposal, update/delete by ID |
| Preferences | `/api/client-storage`; `client_storage` | Selected reads and validated per-key updates |
| Chat queues | `/api/chat-queues/{paneId}` GET/PATCH; `chat_persistence` adapter | Read, edit, remove, or explicitly retry a queued entry with its captured settings |
| Provider requests | `POST /api/chat-requests/{paneId}` | `{requestId, answer}` responds to one live provider request; stale IDs and invalid answers return 400 |
| Chat diagnostics | `GET /api/chat-diagnostics/{paneId}` | Last-run context byte counts and provider startup milestones, without prompt contents |
| Workspace | `/api/agent/state*`, `/api/workspace/panels`, `/dock`, `/documents`; workspace owners | Typed state transitions, panel/dock sessions, retained documents |
| Context/settings | `/api/agent-context`, `/api/config/*`; context/settings/native owners | Instructions, folder configuration, background upload and native directory picker |
| Provider/MCP | `/api/agents/account-status`, `/mcp-status`, `/mcp-action`, `/api/native/provider-config`, `/api/agent/commands` | Provider configuration/status, external tool connection discovery/actions |
| Git/GitHub | `/api/git/*`, `/api/forge/*`; native Git engine and forge | Status/graph/diff/details; validated checkout/ref/stage/commit/stash/discard operations; account/repository/clone actions |
| Files/media | `/api/files/*`, `/api/file`, `/api/video`, `/api/upload-temp`; file/media owners | Allowed-path search, content/preview/media serving and bounded uploads |
| Rendering | `/api/native/markdown`, `/markdown/stream`, `/highlight`, `/diff` | Native parsing/render projections; not database commands |
| App metadata | `/api/app-info`, `/api/native/update`, `/api/link-metadata`, `/api/mcp-icons`, `/api/mcp-icon` | Metadata, update status/action, link preview and cached icon delivery |

Parameterized JSON route families outside the static inventory are `PUT/DELETE /api/prompts/{id}`, `GET/PATCH /api/chat-queues/{paneId}`, `POST /api/chat-requests/{paneId}`, and `GET /api/chat-diagnostics/{paneId}`. `/ws` is the authenticated native WebSocket carrying workspace/chat messages, not an OpenAPI request/response route. Static renderer assets and media response details have their own serving rules. Read each owning request type before adding a client; the route inventory alone is insufficient.

## Adding or changing a contract

1. Put behavior and serialized types in the existing semantic owner. Keep `native/core` independent of HTTP, SQLite and filesystem access; server-owned inspection contracts belong in the server.
2. Derive/export Rust types through `ts-rs`; renderer services import from `@contracts` and do not redeclare response shapes. For a typed OpenAPI operation, derive its JSON Schema from the same Rust input/output types.
3. Keep route registration and its OpenAPI metadata together, as in `database_explorer/http.rs`. Use explicit runtime limits, known identifiers, bound values and meaningful error responses.
4. Add a behavioral test for relevant trust/data-integrity failures, then regenerate artifacts. Check generated schemas against actual serialized responses, not just a hand-authored schema mirror.
5. Reuse `useQueryResource` for cancellation/loading/error lifecycles and release private row data when the view is unused. Keep endpoint paths and HTTP parsing in feature services.

Remaining contract work is explicit: legacy request/response bodies and dynamic native tool inputs are only partly generated; route grouping is not a full OpenAPI migration. Expand typed coverage by semantic owner when changing those endpoints, avoiding an app-wide generic routing framework or a second manually maintained TypeScript model set.

The schema generation uses [Schemars JSON Schema 2020-12](https://docs.rs/schemars/latest/schemars/generate/struct.SchemaSettings.html), compatible with [OpenAPI 3.1’s schema dialect](https://learn.openapis.org/upgrading/v3.0-to-v3.1.html).
