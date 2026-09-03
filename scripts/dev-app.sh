#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

DEV_BACKEND_ADDR="127.0.0.1:4317"
BUILD_MARKER="$(mktemp)"

export INFERAY_DEV_BACKEND_ADDR="${DEV_BACKEND_ADDR}"

node scripts/watch-renderer.mjs &
RENDERER_PID=$!
SERVER_PID=""
DESKTOP_PID=""

cleanup() {
	kill "${RENDERER_PID}" 2>/dev/null || true
	if [[ -n "${DESKTOP_PID}" ]]; then
		kill "${DESKTOP_PID}" 2>/dev/null || true
	fi
	if [[ -n "${SERVER_PID}" ]]; then
		kill "${SERVER_PID}" 2>/dev/null || true
	fi
	rm -f "${BUILD_MARKER}"
}
trap cleanup EXIT INT TERM

for _ in {1..300}; do
	if [[ "${ROOT}/dist/index.html" -nt "${BUILD_MARKER}" ]]; then
		break
	fi
	if ! kill -0 "${RENDERER_PID}" 2>/dev/null; then
		wait "${RENDERER_PID}"
		exit $?
	fi
	sleep 0.1
done

if [[ ! "${ROOT}/dist/index.html" -nt "${BUILD_MARKER}" ]]; then
	echo "Inferay development renderer did not build" >&2
	exit 1
fi
rm -f "${BUILD_MARKER}"

echo "[inferay-dev] live app: http://${DEV_BACKEND_ADDR}"
cargo run -p inferay-server --bin inferay-dev-server &
SERVER_PID=$!

for _ in {1..300}; do
	if curl --silent --fail --output /dev/null "http://${DEV_BACKEND_ADDR}/"; then
		break
	fi
	if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
		wait "${SERVER_PID}"
		exit $?
	fi
	sleep 0.1
done

if ! curl --silent --fail --output /dev/null "http://${DEV_BACKEND_ADDR}/"; then
	echo "Inferay development backend did not start" >&2
	exit 1
fi

INFERAY_EXTERNAL_BACKEND_ADDR="${DEV_BACKEND_ADDR}" cargo run -p inferay-desktop &
DESKTOP_PID=$!

# The browser preview is the durable development surface. Keep serving and
# rebuilding even if the optional desktop window is closed.
wait "${SERVER_PID}"
