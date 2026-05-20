#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${ROOT}/native/diff-engine"
OUT_DIR="${ROOT}/native/bin"
BIN_NAME="inferay-native-diff"

if ! command -v cargo >/dev/null 2>&1 && [ -x "${HOME:-}/.cargo/bin/cargo" ]; then
	export PATH="${HOME}/.cargo/bin:${PATH}"
fi

if ! command -v cargo >/dev/null 2>&1; then
	echo "[native] cargo not found; Rust is required for this build" >&2
	exit 1
fi

mkdir -p "${OUT_DIR}"

PROFILE="${1:-release}"
if [ "${PROFILE}" != "release" ] && [ "${PROFILE}" != "debug" ]; then
	echo "[native] invalid profile: ${PROFILE}"
	exit 1
fi

pushd "${CRATE_DIR}" >/dev/null
cargo build $( [ "${PROFILE}" = "release" ] && printf '%s' '--release' )
popd >/dev/null

SOURCE_BIN="${CRATE_DIR}/target/${PROFILE}/${BIN_NAME}"
if [ ! -f "${SOURCE_BIN}" ]; then
	echo "[native] built binary not found at ${SOURCE_BIN}"
	exit 1
fi

cp "${SOURCE_BIN}" "${OUT_DIR}/${BIN_NAME}"
chmod +x "${OUT_DIR}/${BIN_NAME}"
echo "[native] copied ${BIN_NAME} -> ${OUT_DIR}/${BIN_NAME}"
