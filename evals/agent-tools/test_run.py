import unittest
import run


class EvalTests(unittest.TestCase):
    def test_grader_checks_order_arguments_forbidden_calls_and_final_answer(self):
        case = {"expect": {"ordered_calls": [{"name": "read"}, {"name": "update", "arguments": {"revision": 17}}],
                           "forbidden_calls": [{"name": "save"}], "text_must": ["approval"], "text_must_not": ["I saved"]}}
        calls = [{"name": "read"}, {"name": "update", "arguments": {"revision": 17, "extra": True}}]
        self.assertEqual(run.grade(case, calls, "Ready for approval", []), [])
        self.assertTrue(run.grade(case, list(reversed(calls)), "Ready for approval", []))
        self.assertTrue(run.grade(case, calls + [{"name": "save"}], "I saved it", []))
        self.assertTrue(run.grade(case, calls, "", []))
        self.assertTrue(run.grade(case, calls, "Ready for approval", ["invalid arguments"]))

    def test_both_transports_return_mock_results_and_preserve_schema_errors(self):
        contract = {"instructions": {"shared": "product text", "codex": "workflow"}, "tools": [
            {"name": "read", "description": "Read", "inputSchema": {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}}
        ]}
        case = {"id": "fixture", "prompt": "read it", "mocks": [{"call": {"name": "read"}, "result": {"text": "fixture"}}], "expect": {"ordered_calls": [{"name": "read"}], "text_must": ["done"]}}
        for provider in ["claude", "codex"]:
            for arguments in [{"id": "one"}, {}]:
                requests = []
                def api(kind, payload):
                    requests.append(payload)
                    if len(requests) == 1:
                        if kind == "claude":
                            return {"content": [{"type": "tool_use", "id": "call-1", "name": "read", "input": arguments}]}
                        return {"output": [{"type": "function_call", "call_id": "call-1", "name": "read", "arguments": run.json.dumps(arguments)}]}
                    history = payload["messages" if kind == "claude" else "input"]
                    self.assertIn("tool_result" if kind == "claude" else "function_call_output", str(history))
                    if kind == "claude":
                        return {"content": [{"type": "text", "text": "done"}]}
                    return {"output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}]}
                result = run.evaluate(contract, case, provider, "fixture-model", 3, api)
                self.assertEqual(result["passed"], bool(arguments))
                self.assertEqual(len(requests), 2)

    def test_production_schema_conditionals(self):
        # Supplied by the dry-run/export step; use exactly the product contract.
        import os
        path = os.environ.get("INFERAY_EVAL_CONTRACT")
        if not path:
            self.skipTest("set INFERAY_EVAL_CONTRACT to an exported production contract")
        with open(path) as source:
            contract = run.json.load(source)
        for name, bad, good in [
            ("inferay_projects", {"action": "command"}, {"action": "command", "command": {}}),
            ("inferay_memory", {"action": "read"}, {"action": "read", "id": "note"}),
            ("inferay_propose_skill", {"action": "update", "name": "n", "command": "c", "description": "d", "promptTemplate": "p", "reason": "r"},
             {"action": "update", "name": "n", "command": "c", "description": "d", "promptTemplate": "p", "reason": "r", "skillId": "i", "expectedUpdatedAt": 17}),
        ]:
            schema = next(t["inputSchema"] for t in contract["tools"] if t["name"] == name)
            validator = run.Draft202012Validator(schema)
            self.assertFalse(validator.is_valid(bad))
            self.assertTrue(validator.is_valid(good))


if __name__ == "__main__":
    unittest.main()
