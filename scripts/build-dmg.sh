#!/bin/bash

# Build a polished DMG installer for inferay
# Usage: bash scripts/build-dmg.sh

set -e

APP_NAME="inferay"
DMG_NAME="inferay-installer"
# Use dev build to avoid Electrobun self-extraction bug (blackboardsh/electrobun#359)
BUILD_DIR="build/dev-macos-arm64"
OUTPUT_DIR="artifacts"
CREATE_DMG="./node_modules/.bin/create-dmg"

echo "Building inferay..."

# Remove stale distribution bundle before building. Otherwise the DMG can
# package an older inferay.app if inferay-dev.app is not renamed over it.
rm -rf "${BUILD_DIR}/${APP_NAME}.app"

# Build the app first
npm run build
bash scripts/electrobun.sh build --env=dev

echo "Creating polished DMG installer..."

# Rename dev app bundle for distribution
if [ -d "${BUILD_DIR}/inferay-dev.app" ]; then
  mv "${BUILD_DIR}/inferay-dev.app" "${BUILD_DIR}/${APP_NAME}.app"
  bun scripts/prepare-release-app.ts "${BUILD_DIR}/${APP_NAME}.app"
else
  echo "Expected app bundle not found: ${BUILD_DIR}/inferay-dev.app"
  exit 1
fi

# Remove old DMGs
rm -f "${OUTPUT_DIR}/${DMG_NAME}.dmg"
rm -f "${OUTPUT_DIR}/stable-macos-arm64-inferay.dmg"

# Create the DMG with create-dmg, then normalize the filename expected by the
# release script.
"${CREATE_DMG}" \
  "${BUILD_DIR}/${APP_NAME}.app" \
  "${OUTPUT_DIR}" \
  --overwrite \
  --no-version-in-filename \
  --dmg-title="${APP_NAME}" \
  --no-code-sign

if [ -f "${OUTPUT_DIR}/${APP_NAME}.dmg" ]; then
  mv "${OUTPUT_DIR}/${APP_NAME}.dmg" "${OUTPUT_DIR}/${DMG_NAME}.dmg"
fi

if [ ! -f "${OUTPUT_DIR}/${DMG_NAME}.dmg" ]; then
  echo "Expected DMG not found: ${OUTPUT_DIR}/${DMG_NAME}.dmg"
  exit 1
fi

echo ""
echo "Done! DMG created at: ${OUTPUT_DIR}/${DMG_NAME}.dmg"
echo ""
echo "To test: open ${OUTPUT_DIR}/${DMG_NAME}.dmg"
