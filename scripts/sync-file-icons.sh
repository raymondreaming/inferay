#!/usr/bin/env bash
# The vscode-icons SVGs are static assets, not modules. Importing them through
# import.meta.glob({eager:true}) built a 1553-entry name->hashed-URL map and cost
# ~340KB of JavaScript that every view importing FileTypeIcon had to parse.
# Copying them into public/ lets the browser request only the icons it renders.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${ROOT}/node_modules/@yutengjing/vscode-icons/assets/icons"
TARGET="${ROOT}/public/file-icons"

if [[ ! -d "${SOURCE}" ]]; then
  echo "[file-icons] ${SOURCE} missing; run bun install" >&2
  exit 1
fi
mkdir -p "${TARGET}"
rsync -a --delete --include='*.svg' --exclude='*' "${SOURCE}/" "${TARGET}/"
echo "[file-icons] synced $(ls -1 "${TARGET}" | wc -l | tr -d ' ') icons to public/file-icons"
