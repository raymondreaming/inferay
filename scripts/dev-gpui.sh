#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --locked --manifest-path native/gpui/Cargo.toml
app="build/gpui/Inferay Native.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp native/gpui/target/release/inferay-gpui "$app/Contents/MacOS/inferay-gpui"
mkdir -p "$app/Contents/Resources/data"
cp data/prompts.json "$app/Contents/Resources/data/prompts.json"
mkdir -p "$app/Contents/Resources/public" "$app/Contents/Resources/packages/inferay"
cp public/*.png public/*.svg "$app/Contents/Resources/public/"
cp packages/inferay/package.json "$app/Contents/Resources/packages/inferay/"
iconutil -c icns public/icon.iconset -o "$app/Contents/Resources/Inferay.icns"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>inferay-gpui</string>
<key>CFBundleIdentifier</key><string>com.inferay.gpui-preview</string>
<key>CFBundleIconFile</key><string>Inferay.icns</string>
<key>CFBundleName</key><string>Inferay Native</string>
<key>CFBundleDisplayName</key><string>Inferay Native</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>
PLIST
if [[ -n "${INFERAY_EXTERNAL_BACKEND_ADDR:-}" ]]; then
    /usr/libexec/PlistBuddy -c 'Add :LSEnvironment dict' "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Add :LSEnvironment:INFERAY_EXTERNAL_BACKEND_ADDR string ${INFERAY_EXTERNAL_BACKEND_ADDR}" "$app/Contents/Info.plist"
fi
codesign --force --sign - "$app"
if [[ "${1:-}" != "--build-only" ]]; then
    open "$app"
fi
