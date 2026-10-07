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
