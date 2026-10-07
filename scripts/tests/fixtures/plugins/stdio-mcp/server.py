"""Local MCP conformance fixture. No SDK, credentials, or external services."""
import json
import os
from pathlib import Path
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else "success"
output = Path(os.environ["INFERAY_RUN_OUTPUT"])
(output / "server-pid.txt").write_text(str(os.getpid()))


def send(value):
    print(json.dumps({"jsonrpc": "2.0", **value}), flush=True)


for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        assert message["method"] == "notifications/initialized"
        continue
    request_id = message["id"]
    method = message["method"]
    if method == "initialize":
        result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                  "serverInfo": {"name": "inferay-fixture", "version": "1"}}
    elif method == "tools/list":
        if mode == "overflow":
            sys.stdout.write("x" * 1_048_577)
            sys.stdout.flush()
            time.sleep(30)
        if mode == "missing":
            result = {"tools": []}
        elif "cursor" not in message["params"]:
            result = {"tools": [], "nextCursor": "second-page"}
        else:
            assert message["params"]["cursor"] == "second-page"
            result = {"tools": [{"name": "report", "description": "Make a report",
                                 "inputSchema": {"type": "object"}}]}
            if mode == "invalid-schema":
                result["tools"][0]["inputSchema"] = None
    elif method == "tools/call":
        assert message["params"]["name"] == "report"
        (output / "called.txt").write_text("report")
        if mode == "slow":
            print("waiting", file=sys.stderr, flush=True)
            time.sleep(30)
        if mode == "error":
            print("quality check failed", file=sys.stderr, flush=True)
            result = {"content": [{"type": "text", "text": "Fix the missing title"}], "isError": True}
        else:
            # Colliding request IDs must still be handled as server requests.
            send({"id": request_id, "method": "sampling/createMessage", "params": {}})
            refused = json.loads(sys.stdin.readline())
            assert refused["error"]["code"] == -32601
            send({"id": "ping", "method": "ping"})
            assert json.loads(sys.stdin.readline())["result"] == {}
            args = message["params"]["arguments"]
            if args.get("outside"):
                try:
                    Path(args["outside"]).write_text("unapproved")
                except PermissionError:
                    pass
                else:
                    raise RuntimeError("outside write was allowed")
            if mode == "collision":
                (output / "mcp-response.json").write_text("server-owned output")
            (output / "report.md").write_text(args.get("text", "MCP report"))
            result = {"content": [{"type": "text", "text": "Report saved"}],
                      "structuredContent": {"title": args.get("text", "MCP report")}}
    else:
        raise RuntimeError("unexpected method: " + method)
    send({"id": request_id, "result": result})
