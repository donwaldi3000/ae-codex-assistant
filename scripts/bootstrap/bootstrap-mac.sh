#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[bootstrap-mac] Installing Node dependencies"
npm install

echo "[bootstrap-mac] Installing Python package in editable mode"
python3 -m pip install -e ".[dev]"

echo "[bootstrap-mac] Build panel package (ZXP workflow is optional)"
echo "Run: npm run build:zxp"

echo "[bootstrap-mac] Bridge health check command"
echo "Run: ae-cli health --base-url http://127.0.0.1:8080"
