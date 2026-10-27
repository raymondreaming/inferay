"""Evaluate production Inferay instructions against mocked tools, never real effects."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]


def matches(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and matches(actual[k], v) for k, v in expected.items())
    return actual == expected


def grade(case, calls, text, errors):
    failures = list(errors)
    expected = case["expect"]
    if len(calls) > expected.get("max_calls", 8):
        failures.append("too many tool calls")
    offset = 0
    for required in expected.get("ordered_calls", []):
        found = next((i for i in range(offset, len(calls)) if matches(calls[i], required)), None)
        if found is None:
            failures.append(f"missing ordered call: {required}")
        else:
            offset = found + 1
    for forbidden in expected.get("forbidden_calls", []):
        if any(matches(call, forbidden) for call in calls):
            failures.append(f"forbidden call: {forbidden}")
    for pattern in expected.get("text_must", []):
        if not re.search(pattern, text, re.I):
            failures.append(f"missing final text: {pattern}")
    for pattern in expected.get("text_must_not", []):
        if re.search(pattern, text, re.I):
            failures.append(f"forbidden final text: {pattern}")
    if not text.strip():
        failures.append("no final response")
    return failures


def mock_call(contract, case, call):
    tool = next((tool for tool in contract["tools"] if tool["name"] == call["name"]), None)
    if tool is None:
        raise ValueError("unknown tool")
    Draft202012Validator(tool["inputSchema"]).validate(call["arguments"])
    for mock in case.get("mocks", []):
        if matches(call, mock["call"]):
            return mock["result"]
    if call["name"] == "inferay_projects" and call["arguments"].get("action") == "help":
        return {"commands": json.dumps(contract["projectHelp"])}
    raise ValueError("unexpected call: no fixture result")


def request(provider, payload):
    if provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}
    else:
        url = "https://api.openai.com/v1/responses"
        headers = {"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]}
    headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never print request headers or credentials in reports.
        raise RuntimeError(f"Model API returned HTTP {error.code}") from None


def evaluate(contract, case, provider, model, max_steps, call_api=request):
    instructions = contract["instructions"]["shared"]
    if provider == "codex":
        instructions += "\n\n" + contract["instructions"]["codex"]
    instructions += "\n\n" + case.get("context", "")
    messages = [{"role": "user", "content": case["prompt"]}]
    tools = [dict(name=t["name"], description=t["description"], **(
        {"input_schema": t["inputSchema"]} if provider == "claude" else
        {"type": "function", "parameters": t["inputSchema"], "strict": False}
    )) for t in contract["tools"]]
    calls, errors, usage = [], [], []
    text = ""
    started = time.monotonic()
    for _ in range(max_steps):
        payload = {"model": model, "tools": tools}
        if provider == "claude":
            payload.update(system=instructions, messages=messages, max_tokens=4096)
        else:
            payload.update(instructions=instructions, input=messages, max_output_tokens=4096, store=False)
        response = call_api(provider, payload)
        usage.append(response.get("usage", {}))
        if provider == "claude":
            output = response["content"]
            messages.append({"role": "assistant", "content": output})
            pending = [(x["id"], {"name": x["name"], "arguments": x["input"]}) for x in output if x["type"] == "tool_use"]
            text = "\n".join(x["text"] for x in output if x["type"] == "text")
            truncated = response.get("stop_reason") == "max_tokens"
        else:
            output = response["output"]
            messages.extend(output)
            pending = []
            for item in output:
                if item["type"] == "function_call":
                    try:
                        arguments = json.loads(item["arguments"])
                    except json.JSONDecodeError:
                        arguments = None
                    pending.append((item["call_id"], {"name": item["name"], "arguments": arguments}))
            text = "\n".join(part["text"] for item in output if item["type"] == "message" for part in item["content"] if part["type"] == "output_text")
            truncated = response.get("status") == "incomplete"
        if truncated:
            errors.append("model output truncated")
        if not pending:
            break
        results = []
        for identity, call in pending:
            calls.append(call)
            try:
                result = mock_call(contract, case, call)
                failed = False
            except Exception as error:
                result = {"error": str(error)}
                errors.append(f"invalid or unexpected call: {call['name']}")
                failed = True
            if provider == "claude":
                results.append({"type": "tool_result", "tool_use_id": identity, "content": json.dumps(result), "is_error": failed})
            else:
                messages.append({"type": "function_call_output", "call_id": identity, "output": json.dumps(result)})
        if results:
            messages.append({"role": "user", "content": results})
    else:
        errors.append("step limit reached")
    failures = grade(case, calls, text, errors)
    return {"case": case["id"], "model": model, "provider": provider, "passed": not failures,
            "failures": failures, "calls": calls, "text": text, "usage": usage,
            "seconds": round(time.monotonic() - started, 3)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["claude", "codex"], default="codex")
    parser.add_argument("--model", help="Explicit current API model ID; no automatic model substitution")
    parser.add_argument("--case", action="append")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--max-steps", type=int, default=8)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.samples < 1 or args.max_steps < 1:
        parser.error("samples and max-steps must be positive")
    if not args.dry_run and (not args.model or not args.out):
        parser.error("live evals require --model and --out")
    contract = json.loads(subprocess.check_output(["cargo", "run", "--quiet", "-p", "inferay-tooling", "--bin", "export-api-reference", "--", "--agent-eval"], cwd=ROOT))
    cases = json.loads(Path(__file__).with_name("cases.json").read_text())
    if args.case:
        unknown = set(args.case) - {c["id"] for c in cases}
        if unknown:
            parser.error(f"unknown cases: {sorted(unknown)}")
        cases = [c for c in cases if c["id"] in args.case]
    for tool in contract["tools"]:
        Draft202012Validator.check_schema(tool["inputSchema"])
    digest = hashlib.sha256(json.dumps(contract, sort_keys=True).encode()).hexdigest()
    if args.dry_run:
        print(json.dumps({"cases": [c["id"] for c in cases], "contract_sha256": digest,
                          "instruction_bytes": len(json.dumps(contract["instructions"]).encode()),
                          "tool_schema_bytes": len(json.dumps(contract["tools"]).encode())}, indent=2))
        return
    key = "ANTHROPIC_API_KEY" if args.provider == "claude" else "OPENAI_API_KEY"
    if not os.environ.get(key):
        parser.error(f"{key} is required for live evals")
    baseline = [json.loads(line) for line in args.baseline.read_text().splitlines()] if args.baseline else []
    if any(row["model"] != args.model or row["provider"] != args.provider for row in baseline):
        parser.error("baseline must use the same provider and model")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    passed = True
    with args.out.open("x") as output:
        for case in cases:
            case_hash = hashlib.sha256(json.dumps(case, sort_keys=True).encode()).hexdigest()
            prior = [row for row in baseline if row["case"] == case["id"]]
            if any(row.get("case_sha256") != case_hash for row in prior):
                raise ValueError("baseline case changed: " + case["id"])
            rows = []
            for sample in range(args.samples):
                row = evaluate(contract, case, args.provider, args.model, args.max_steps)
                row.update(sample=sample, contract_sha256=digest, case_sha256=case_hash)
                output.write(json.dumps(row) + "\n")
                output.flush()
                rows.append(row)
            success = sum(row["passed"] for row in rows) > len(rows) / 2
            regression = bool(prior) and all(row["passed"] for row in prior) and not all(row["passed"] for row in rows)
            passed &= success and not regression
            print(f"{case['id']}: {sum(row['passed'] for row in rows)}/{len(rows)} passed" + (" REGRESSION" if regression else ""))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
