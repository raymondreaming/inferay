#!/bin/bash

# Build a polished DMG installer for inferay
# Usage: bash scripts/build-dmg.sh

set -e

APP_NAME="inferay"
DMG_NAME="inferay-installer"
BUILD_DIR="build/rust-macos-arm64"
OUTPUT_DIR="artifacts"

create_dmg() {
  local dmg_root
  dmg_root="$(mktemp -d "${TMPDIR:-/tmp}/inferay-dmg.XXXXXX")"

  cp -R "${BUILD_DIR}/${APP_NAME}.app" "${dmg_root}/"
  ln -s /Applications "${dmg_root}/Applications"

  hdiutil create \
    -volname "${APP_NAME}" \
    -srcfolder "${dmg_root}" \
    -ov \
    -format UDZO \
    "${OUTPUT_DIR}/${DMG_NAME}.dmg"

  rm -rf "${dmg_root}"
}

echo "Building inferay..."

# Remove stale distribution bundle before building.
rm -rf "${BUILD_DIR}/${APP_NAME}.app"

# Build the Rust-hosted app first.
bun run build

echo "Creating DMG installer..."

if [ -d "${BUILD_DIR}/${APP_NAME}.app" ]; then
  bun scripts/prepare-release-app.ts "${BUILD_DIR}/${APP_NAME}.app"
else
  echo "Expected app bundle not found: ${BUILD_DIR}/${APP_NAME}.app"
  exit 1
fi

# Remove old DMGs
rm -f "${OUTPUT_DIR}/${DMG_NAME}.dmg"
rm -f "${OUTPUT_DIR}/stable-macos-arm64-inferay.dmg"

# Build directly with Apple's supported disk-image utility. This avoids a
# native Node dependency and produces the verified artifact used by releases.
create_dmg

if [ ! -f "${OUTPUT_DIR}/${DMG_NAME}.dmg" ]; then
  echo "Expected DMG not found: ${OUTPUT_DIR}/${DMG_NAME}.dmg"
  exit 1
fi

echo ""
echo "Done! DMG created at: ${OUTPUT_DIR}/${DMG_NAME}.dmg"
echo ""
echo "To test: open ${OUTPUT_DIR}/${DMG_NAME}.dmg"
