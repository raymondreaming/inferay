# Project connections

**Implemented:** managing project credentials in macOS Keychain.
**Planned:** approved tool bindings, credential injection, output protection and
remote authenticated MCP. Saving a connection currently does not give a tool or
agent access to its key and does not enable an automation.

Open **Plugins → Connections** to add a named API key, replace its value or remove
it. Replacement starts with an empty password field. The value is cleared from
the form after a successful save and is never returned by the API. Removal needs
an explicit confirmation in the dialog.

## Storage and ownership

The native connection store owns credentials. Project definitions, the project
SQLite index, run snapshots and chat tools do not contain them. The store uses the
Security framework directly; keys are never passed to a shell command.

Each canonical Inferay profile path has one Keychain generic-password item under
an `app.inferay.connections.<profile hash>` service. That item holds the project
IDs, names, stable connection IDs, revision IDs and credential values together.
It is limited to 64 KiB; individual values are limited to 8,192 bytes. The profile
contains only an empty `connections.lock` file for cross-process serialization.
The in-process mutex and file lock cover the entire read/change/write operation.
The last removal deletes the Keychain item.

Moving or copying the profile to a different path does not copy credential
access. Connection names and IDs are local state, not portable project files.
Other platforms return an unsupported-platform error; there is no plaintext
fallback. Keychain access failures are reported without item contents.

## API boundary

`GET /api/projects/connections?projectId=<id>` returns `connections`, each with
`id`, `projectId`, `name` and `revision`. No credential-read endpoint exists.

`POST /api/projects/connections` accepts either:

- `action: "save"`, `projectId`, `id`, `expectedRevision`, `name`, `secret`;
  new entries use null IDs/revisions, replacements require the current revision.
- `action: "delete"`, `projectId`, `id`, `expectedRevision`.

Both routes require the existing trusted local-request authentication and a valid
project. Bodies are capped at 16 KiB. Responses contain metadata only. Replacements
get a fresh revision; stale replacements and removals fail without overwriting.
Commands deliberately have no Debug or serialization implementation. Invalid
request errors do not include submitted values. These commands are not exposed
through agent project tools.

The next step is binding a tool to specific connection IDs/revisions as part of
approval, resolving credentials only for that invocation and protecting outputs
before they enter logs, artifacts or a provider response. Keychain storage alone
does not satisfy those execution requirements.

## Verification

The opt-in native gate writes and removes temporary test-only Keychain entries:

```sh
cargo test -p inferay-server keychain_connections --lib -- --ignored
```

It checks persistence, project/profile isolation, stale-write refusal, rotation,
removal and the absence of credential files. The browser verifier has an opt-in
`INFERAY_VERIFY_CONNECTIONS=1` mode for adding, replacing and removing a test key
through the dialog. Both gates pass; the browser check uses an isolated renderer checkout while the separately owned Memory graph build is unfinished. Both checks clean up their test credentials.
