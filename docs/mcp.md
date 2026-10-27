# MCP and native agent tools

Inferay has two related integration surfaces: **native Inferay tools** for its own data and **external MCP servers** configured for each agent provider. They share a tools UI, but have different ownership, transports and authority. The database explorer is an authenticated app feature; no unrestricted database/SQL tool is advertised to agents.

## Native tools and scope

[Generated tool definitions](reference/mcp-tools.json) reuse the actual definitions supplied by the running app. They are a superset, not proof that a particular turn has every tool. Always discover that turn's available tools.

| Tool | Availability | What it can do |
|---|---|---|
| `inferay_list_skills` | Native skill tool set | Search the loaded bundled/custom skill library |
| `inferay_read_skill` | Native skill tool set | Read by ID, command or name and display a skill card |
| `inferay_propose_skill` | Native skill tool set | Validate a create/update proposal and emit a review card; does not save |
| `inferay_projects` | Project runtime attached | Catalogue/help; read/review commands; plugin/automation proposal cards; mutating or executing commands are refused in agent mode |
| `inferay_memory` | A project memory scope exists | Search/read notes; save only when that scope permits it and the user requests it; automation scope disallows save |
| `inferay_tools` | Automation explicitly grants library tools | List/call captured tools by plugin/tool IDs; undeclared grants are refused; required calls must finish successfully |

Native project commands have a separate host-authority check. `reviewPlugin`, `readPlugin`, and `reviewAutomation` are agent-readable. `createPlugin`/`updatePlugin` and automation `saveDefinition` become concrete proposals. Approval, enablement, running/stopping work and direct definition mutations require the authorized user/host path. Prompt text, tool results and memory do not grant those permissions.

`inferay_projects` help exposes the current command examples and file formats, also included in the generated reference. Schemas describe the outer tool input; domain validation still checks conditional required fields, names, path containment, hashes, permissions and state. A schema-valid tool input can still be refused. `inferay_memory` returns short search hits before a full read; automation reads are recorded as run evidence. Tool outputs can include a separate persisted UI card in addition to result text.

## Provider transports

**Codex:** the app-server session receives native dynamic tool definitions and dispatches calls through `AgentProcessHandle`. External MCP server configuration/status comes from the Codex app server. Native Inferay tools are not an independently discoverable persistent HTTP service.

**Claude:** `agent_tools_mcp::ToolBridge` creates an ephemeral loopback HTTP server and temporary MCP configuration for the active invocation. It merges the internal Inferay server with an explicitly scoped external configuration when needed. Both providers therefore have access to native project/memory/skill tools when their turn scope allows them; “Claude has no native memory tools” is obsolete.

The [MCP OpenAPI document](reference/mcp-openapi.json) describes this bridge's HTTP envelope. It is separate from the [database OpenAPI document](reference/openapi.json): `/mcp` runs on a different, dynamically allocated loopback port, not the main app server.

| Bridge detail | Current behavior |
|---|---|
| Transport | `POST /mcp`, JSON-RPC 2.0 over HTTP; no persistent public port |
| Authentication | Per-turn random bearer token, written only to the temporary provider config |
| Origin | Any `Origin` header is rejected; this endpoint is for the local agent, not browser scripts |
| Protocol handshake | `initialize` returns protocol version `2025-11-25` and tools capability |
| Methods | `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/initialized` |
| Notifications | Missing request ID accepted only for initialized notification (HTTP 202) |
| Results | JSON-RPC result; tool content is text containing serialized JSON; `isError` marks tool failures |
| Unknown method | JSON-RPC error code `-32601` |
| Lifetime | Dropping the bridge invalidates scope and aborts its server task; cancelled/inactive turns return HTTP 410 if the handler is reached |
| Body bound | 52,000,000 bytes; malformed JSON/content-type errors are handled by Axum |

The bridge is a focused native-tool adapter, not an implementation of every optional MCP capability. There is no resources/prompts/subscriptions API here, no persistent session lookup, and no general SQL execution method. Cancellation closes the turn scope; a previously copied token is not authorization for future turns.

`ToolScope` owns captured automation grants, lifecycle, serialized calls, outcomes and artifacts. Closing it prevents new calls and waits for its serialized operation boundary. Required tools must have been called and their latest attempt must succeed; an earlier success followed by a failed attempt is not completion. Inputs, definitions and implementation hashes are pinned by the automation review/execution capture. Adding a new native tool must update its actual owner and scope/dispatch logic, not just the reference document.

## External MCP connections

`mcp_connections.rs` owns the Settings adapter. `GET /api/agents/mcp-status` requests `provider=codex|claude` and optional `refresh=true`. It returns generated `McpProviderStatus`/connection types: checking state, timestamp/error, server status, tool count, source, icon/version and toggle capability. Checking is asynchronous; stale entries can remain visible while a refresh runs.

Codex status uses app-server config and `mcpServerStatus/list`. Claude status uses its CLI under the same environment and denial policy as launches. `POST /api/agents/mcp-action` owns the typed connection action. Provider-specific failures stay specific; connected status or a known icon is not evidence that every tool call will succeed.

`agent_mcp.rs` applies per-provider overrides and optional requested-server scoping. Requested servers must be configured and enabled. GitKraken is disabled at launch without editing global provider configuration. Git uses local Git/`gh`; Linear uses its direct connector. External MCP server authentication/configuration remains with its provider, distinct from Inferay project connection secrets and from the native bridge token.

MCP icons are cached/displayed through `mcp_icons.rs`; they do not alter permission scope. UI presentation belongs to core MCP presentation types and the Settings components. Tool results are untrusted data and can contain instruction-shaped content; they do not override user authorization.

## Development rules and current improvement opportunities

- Keep each tool's definition beside its semantic owner. The reference generator calls the same definition functions/constants, and a test compares committed artifacts with generated output.
- Keep `tools/list` scoped. Never publish a token, provider environment or private result in generated examples. Reference generation uses empty temporary stores.
- Return an honest proposal/result. Creating a card is not saving, approving, enabling or sending an external action.
- Validate arguments at the actual storage/execution boundary. Do not expose a SQL passthrough to make one tool easier to implement.
- Do not represent MCP JSON-RPC methods as independent REST paths. External servers' schemas belong to those servers and are not included in Inferay's native-tool snapshot.
- Skill updates, project commands, and memory reads/saves declare their action-dependent required fields in the tool schemas. Improvements to consider: derive more inputs from Rust enums instead of hand-maintained JSON; add versioned result schemas where clients need them; keep provider connection diagnostics structured. Those changes need compatibility review rather than silently claiming all existing dynamic responses are fully typed.

Run `bun run generate:api` after changing tool definitions or database contracts. See [API generation and coverage](api.md) for exact artifacts and verification.
