# Agent tool behavior evals

These cases evaluate Inferay's own instructions and tool contracts on an explicitly selected Claude or OpenAI model. They import current production text and schemas through `export-api-reference --agent-eval`; prompts and schemas are never copied into fixtures. All tool effects are mocked. No shell commands, repository changes, or product writes requested by a model are executed.

This is a product-contract eval, not a captured Claude Code/Codex harness replay. It does not measure native harness tools, provider authentication, steering, transport recovery, or end-to-end coding quality. Rust subprocess and integration tests cover those deterministic boundaries. The initial cases are guards derived from product contracts, not claims of measured historical regressions.

## Setup and offline verification

From the repository root:

```sh
python3 -m venv evals/.venv
evals/.venv/bin/pip install -r evals/agent-tools/requirements.txt
evals/.venv/bin/python evals/agent-tools/run.py --dry-run
cargo run --quiet -p inferay-tooling --bin export-api-reference -- --agent-eval > /tmp/inferay-agent-contract.json
INFERAY_EVAL_CONTRACT=/tmp/inferay-agent-contract.json evals/.venv/bin/python -m unittest discover -s evals/agent-tools -v
```

The dry run checks the production schemas and reports instruction/schema bytes and a contract fingerprint. Tests cover both API conversations, argument validation, call ordering, forbidden calls, final answers, and action-dependent production schema requirements.

## Live runs

Use the current model ID available to your account; the runner never chooses a substitute. `--provider codex` uses OpenAI's Responses API and requires `OPENAI_API_KEY`. `--provider claude` uses Anthropic's Messages API and requires `ANTHROPIC_API_KEY`. CLI subscription authentication is not used. Live runs consume paid API usage and are not part of ordinary CI.

```sh
evals/.venv/bin/python evals/agent-tools/run.py --provider codex --model "$OPENAI_EVAL_MODEL" --case named-skill --samples 1 --out evals/runs/smoke.jsonl
evals/.venv/bin/python evals/agent-tools/run.py --provider claude --model "$CLAUDE_EVAL_MODEL" --samples 3 --out evals/runs/claude.jsonl
```

`--baseline previous.jsonl` requires the same provider, model, and unchanged case definitions. A case passes only when a majority of samples passes; an all-pass baseline losing any sample is flagged as a regression. Results retain exact tool calls, final answers, failures, API usage, latency, model ID, and case/contract hashes. No dollar estimate is fabricated from stale model prices. Output files must be new, so a run cannot overwrite its baseline. An API error aborts and preserves completed rows rather than counting an unavailable model as a behavior failure.

Add cases to `cases.json` with a source, a concrete user request, deterministic mock results, ordered argument checks, forbidden actions, and final-answer checks. Use synthetic data. Add ordinary-work controls alongside new tool-use instructions. Compare repeated runs before claiming a prompt change improves model behavior; deterministic tests alone cannot establish that.

API references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Anthropic tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
