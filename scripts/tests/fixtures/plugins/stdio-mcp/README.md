# Local stdio MCP fixture

`server.py` is a dependency-free conformance server for the production plugin-tool
runner. It needs no credentials or external service. It is not launched on import.

A library tool can use this interface in its normal `tool.json`:

```json
{
  "interface": { "mcp": { "tool": "report" } },
  "program": "python3",
  "entrypoint": "server.py",
  "args": [],
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" }
}
```

These fields supplement the required tool ID, name, schema version and timeout;
see [the canonical format](../../../../../docs/reference/project-files.md).

The runtime test installs a complete disposable project, reviews it, queues it and
checks report artifacts, paginated discovery, refused sampling, ping replies,
permission boundaries, failure logs, timeout/output limits and process cleanup.
A separate agent-grant test checks required-tool completion and revocation after
an outside edit. This fixture does not prove authenticated remote MCP or Spline.

## Real providers

```sh
cargo test -p inferay-server calls_mcp_library_tool --lib -- --ignored --nocapture
```

This opt-in gate consumes Claude and Codex account usage. Each provider runs in a
disposable Inferay project, reads a fresh marker with normal chat tools, discovers
the granted Report tool and invokes it through `inferay_tools`. The gate requires
the exact marker in the generated report and MCP structured response, and checks
both report and agent response in run history. Both provider checks pass. No user
schedule is enabled and no real repository is changed. This proves the local
stdio path; it does not prove authenticated remote services.
