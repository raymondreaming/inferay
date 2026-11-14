#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --locked --manifest-path native/rune/Cargo.toml
app="build/rust-macos-arm64/inferay.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/packages/inferay"
cp native/rune/target/release/inferay "$app/Contents/MacOS/inferay"
cp native/rune/Info.plist "$app/Contents/Info.plist"
iconutil -c icns public/icon.iconset -o "$app/Contents/Resources/AppIcon.icns"
mkdir -p "$app/Contents/Resources/data" "$app/Contents/Resources/public"
cp data/prompts.json "$app/Contents/Resources/data/"
cp public/*.png public/*.svg "$app/Contents/Resources/public/"
cp packages/inferay/package.json "$app/Contents/Resources/packages/inferay/"
codesign --force --sign "${INFERAY_CODESIGN_IDENTITY:--}" --entitlements native/rune/entitlements.plist "$app"
printf 'Built Inferay app: %s\n' "$app"
