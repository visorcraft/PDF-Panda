#!/usr/bin/env sh
# Headless WebDriver smoke suite for the Tauri WebView shell.
# Usage: scripts/e2e-test.sh
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/src-tauri/target}"

if [ ! -d node_modules ]; then
  npm ci
fi
npm ci --prefix e2e

if [ ! -f e2e/fixtures/sample.pdf ] || [ ! -f e2e/fixtures/sample-3p.pdf ] || [ ! -f e2e/fixtures/sample-b.pdf ]; then
  echo "Generating e2e/fixtures/*.pdf..."
  cargo test --manifest-path src-tauri/Cargo.toml export_e2e_fixtures -- --ignored --nocapture
fi

"$root/scripts/e2e-build.sh"

cleanup() { rm -f src-tauri/capabilities/e2e.json; }
trap cleanup EXIT INT TERM

if [ "$(uname -s)" = Linux ] && [ -z "${DISPLAY:-}" ]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a npm run test --prefix e2e
  fi
  echo "DISPLAY is unset and xvfb-run is unavailable; install xvfb-run for headless Linux e2e." >&2
  exit 1
fi

exec npm run test --prefix e2e
