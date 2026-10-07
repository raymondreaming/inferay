# Project connections

**Implemented:** managing project credentials in macOS Keychain and capturing
selected connection metadata in automation approval inputs.
**Planned:** credential delivery, binding controls, output protection and
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

## Tool references and approval

A tool definition may contain `connections: {"SERVICE": "connection-uuid"}`.
Aliases use 1–64 uppercase letters, digits or underscores, starting with a
letter; a tool may select at most 16 connections. IDs resolve only within the
current project and profile. Copying a library does not copy its credentials;
unresolved references require a new local selection.

Only tools selected by the automation contribute connections. Input capture
reads selected metadata under the connection-store lock and includes the alias,
ID, display name, project ID and revision in the approval hash. It never captures
credential values. Replacement changes the revision. The existing approval check
then refuses execution and turns the schedule off. Deleting a referenced
connection also refuses capture. Tools without references do not access Keychain
while capturing inputs.

Credential-dependent runs currently fail before starting a tool or provider:
credential delivery is not implemented. Capturing metadata does not grant raw key
access. The remaining work is user-facing binding controls, invocation-only
credential resolution and output protection before logs, artifacts or provider
responses are retained.

## Verification

The opt-in native gate writes and removes temporary test-only Keychain entries:

```sh
cargo test -p inferay-server keychain_connections --lib -- --ignored
```

It checks persistence, project/profile isolation, stale-write refusal, rotation,
removal and the absence of credential files. It also launches `/usr/bin/security`
through the native automation sandbox with network and project-write grants,
checks that the test credential cannot be retrieved, and confirms that Inferay
can still read its Keychain entry. This covers that direct lookup path; it is not
a claim about every possible credential-exfiltration technique. The browser verifier has an opt-in
`INFERAY_VERIFY_CONNECTIONS=1` mode for adding, replacing and removing a test key
through the dialog. Both gates pass and clean up their test credentials. The integrated renderer now
builds and passes the project browser checks.
