#!/usr/bin/env bash
set -euo pipefail

if [[ "${TEST_EXEMPT:-}" == "1" ]]; then
	echo "Test-first check exempted with TEST_EXEMPT=1. Use only for documented non-behavioral changes."
	exit 0
fi

staged_source="$(git diff --cached --name-only --diff-filter=ACMR | rg '^src/.*\.(ts|tsx)$' || true)"
[[ -z "$staged_source" ]] && exit 0

staged_tests="$(git diff --cached --name-only --diff-filter=ACMR | rg '^(scripts/tests/.*\.test\.(ts|tsx)|native/.*/tests/.*\.rs|native/.*_tests\.rs)$' || true)"
if [[ -z "$staged_tests" ]]; then
	echo "Source changes need a relevant test change. Set TEST_EXEMPT=1 only for copy, styling, dependency, or behavior-preserving move/extraction changes." >&2
	exit 1
fi
