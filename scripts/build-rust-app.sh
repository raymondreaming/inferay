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
bun run build:native
cargo build --release --manifest-path "${HOST_DIR}/Cargo.toml"

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${HOST_DIR}/target/release/inferay-desktop" "${MACOS_DIR}/inferay"
bun build --compile src/server/standalone.ts --outfile "${MACOS_DIR}/inferay-server"
cp "${HOST_DIR}/Info.plist" "${CONTENTS_DIR}/Info.plist"
cp "${HOST_DIR}/AppIcon.icns" "${RESOURCES_DIR}/AppIcon.icns"
rsync -a --delete "${ROOT}/dist/" "${RESOURCES_DIR}/dist/"
rsync -a --delete "${ROOT}/public/" "${RESOURCES_DIR}/public/"
rsync -a --delete "${ROOT}/data/" "${RESOURCES_DIR}/data/"
rsync -a --delete "${ROOT}/native/bin/" "${RESOURCES_DIR}/native/bin/"
mkdir -p "${RESOURCES_DIR}/packages/inferay"
cp "${ROOT}/packages/inferay/package.json" "${RESOURCES_DIR}/packages/inferay/package.json"

chmod +x "${MACOS_DIR}/inferay" "${MACOS_DIR}/inferay-server"
codesign --force --sign - "${MACOS_DIR}/inferay-server"
codesign --force --sign - "${MACOS_DIR}/inferay"
codesign --force --sign - --entitlements "${HOST_DIR}/entitlements.plist" "${APP_DIR}"

echo "[rust-host] built ${APP_DIR}"
