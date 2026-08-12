#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_DIR="${ROOT}/native/desktop-host"
BUILD_DIR="${ROOT}/build/rust-macos-arm64"
APP_DIR="${BUILD_DIR}/inferay.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

cd "${ROOT}"
bun run build:renderer
cargo build --release -p inferay-desktop

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${ROOT}/target/release/inferay-desktop" "${MACOS_DIR}/inferay"
cp "${HOST_DIR}/Info.plist" "${CONTENTS_DIR}/Info.plist"
cp "${HOST_DIR}/AppIcon.icns" "${RESOURCES_DIR}/AppIcon.icns"
rsync -a --delete "${ROOT}/dist/" "${RESOURCES_DIR}/dist/"
rsync -a --delete "${ROOT}/public/" "${RESOURCES_DIR}/public/"
rsync -a --delete "${ROOT}/data/" "${RESOURCES_DIR}/data/"
mkdir -p "${RESOURCES_DIR}/packages/inferay"
cp "${ROOT}/packages/inferay/package.json" "${RESOURCES_DIR}/packages/inferay/package.json"

chmod +x "${MACOS_DIR}/inferay"
codesign --force --sign - "${MACOS_DIR}/inferay"
codesign --force --sign - --entitlements "${HOST_DIR}/entitlements.plist" "${APP_DIR}"

echo "[rust-host] built ${APP_DIR} with the Octane renderer and native Rust server"
