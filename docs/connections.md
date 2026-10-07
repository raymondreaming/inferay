# Project connections

**Implemented:** project credentials in macOS Keychain, approval of selected
connection metadata, and authenticated GET requests through an invocation-scoped
host relay, with tool connection controls in the library editor. **Planned:**
remote authenticated MCP. Saving a
connection does not enable an automation or give a tool the raw key.

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

A tool definition declares the credential and its request destination together:

```json
"connections": {
  "SERVICE": {
    "id": "connection-uuid",
    "baseUrl": "https://api.example.com/v1/",
    "header": "Authorization",
    "prefix": "Bearer "
  }
}
```

`baseUrl` must use HTTPS, end in `/`, and contain no embedded credentials, query
or fragment. `header` is a bounded header name; routing, framing, proxy and cookie
headers are refused. `prefix` defines formatting such as `Bearer ` or an
empty string for `X-Api-Key`, never a place to store a key. It is required in the
format and limited to 64 printable ASCII characters.
Aliases use 1–64 uppercase letters, digits or underscores, starting with a
letter; a tool may select at most 16 connections. IDs resolve only within the
current project and profile. Copying a library does not copy its credentials;
unresolved references require a new local selection.

Only tools selected by the automation contribute connections. Input capture
reads selected metadata under the connection-store lock and includes the alias,
ID, display name, project ID and revision in the approval hash. It never captures
credential values. Automation and plugin review dialogs list each requested
connection by name, tool and alias, alongside its request destination and header. Replacement changes the revision. The existing approval check
then refuses execution and turns the schedule off. Deleting a referenced
connection also refuses capture. Tools without references do not access Keychain
while capturing inputs.

## Configuring a library tool

Open a library, select its `tools/<name>/tool.json`, then choose **Configure
connections**. Add an alias, choose a saved project key, and enter the HTTPS base
URL, header name and prefix. The URL ends in `/`; the prefix includes any required
space, such as `Bearer `. You can remove a binding without deleting its key.

The form saves the tool definition using its expected file hash. A concurrent
edit is refused; invalid bindings leave the existing file untouched. Unsaved
changes block Escape and backdrop dismissal; **Discard changes** leaves the file
as it was. Saving changes invalidates dependent approvals. The subsequent approval
review shows the key name and destination, never its value. Network permission
still belongs to the automation and is not granted by this form.

## Credential delivery

Tools receive `INFERAY_CONNECTIONS_URL`, a random loopback URL valid only for that
invocation. This applies to CLI scripts, JSON-stdin tools and local MCP tools,
whether called directly or granted to an agent. The automation must declare
`network`; otherwise it fails before launching a tool or provider.

A Python tool can make an authenticated request like this:

```python
import os
import urllib.parse
import urllib.request

query = urllib.parse.urlencode({"path": "items?limit=10"})
url = os.environ["INFERAY_CONNECTIONS_URL"] + "/SERVICE?" + query
with urllib.request.urlopen(url, timeout=30) as response:
    body = response.read()
```

`SERVICE` must be declared in that tool's `connections`. The path must be relative
and remain under its reviewed HTTPS base URL. The host checks the project, ID and
approved revision at startup and on each request, then attaches the configured
header. Raw keys never enter process arguments, environment variables, stdin or
provider context. Replacement invalidates subsequent requests; it cannot undo a
request already delivered to the service.

The relay accepts GET requests only, with at most 64 requests per invocation,
30 seconds per request and 1 MiB per response. It refuses redirects, encoded
responses, browser Origin headers, and paths outside the approved base. TLS
certificate verification remains enabled and inherited HTTP proxies are disabled.
It forwards the remote status and body, with a fixed binary content type, rather
than remote response headers. Ending or cancelling the invocation revokes the URL
and cancels pending relay requests.

Before returning a body, the host rejects literal credential echoes and selected
common representations: standard Base64, percent encoding and JSON escaping.
This is bounded output protection, not a guarantee against arbitrary encodings
chosen by a malicious remote service. The approved service receives the key as
part of authentication and must be trusted with it. Tools should not persist the
temporary URL; it is a capability while the invocation remains active.

This transport does not implement publishing, POST requests, an outbox or
publication receipts. Those remain separate effects work.

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
through the dialog. It also configures a library tool, verifies invalid HTTP destinations leave the file unchanged, preserves unsaved edits on Escape, and checks the saved binding in automation review. Both gates pass and clean up their test credentials. The integrated renderer now
builds and passes the project browser checks.

The relay gates use temporary Keychain entries and disposable profiles:

```sh
cargo test -p inferay-server credential_relay --lib -- --ignored
```

The HTTPS fixture requires Python 3 and OpenSSL. It proves authenticated requests,
redirect and credential-echo refusal, response bounds, revision checks and access
revocation. The native runtime gate proves network permission is required, a
sandboxed tool can reach its relay, the URL expires, and saved run files contain
no raw test key. It does not replace authenticated real-service integration tests.
