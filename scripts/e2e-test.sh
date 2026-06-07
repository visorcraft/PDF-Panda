#!/usr/bin/env sh
# Headless WebDriver smoke suite for the Tauri WebView shell.
# Usage: scripts/e2e-test.sh
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/src-tauri/target}"

if [ ! -f e2e/fixtures/sample.pdf ]; then
  echo "Generating e2e/fixtures/sample.pdf..."
  cargo test --manifest-path src-tauri/Cargo.toml export_e2e_sample_pdf -- --ignored --nocapture
fi

"$root/scripts/e2e-build.sh"

cleanup() { rm -f src-tauri/capabilities/e2e.json; }
trap cleanup EXIT INT TERM

if [ "$(uname -s)" = Linux ] && [ -z "${DISPLAY:-}" ]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run -a npx wdio run e2e/wdio.conf.ts
  fi
  echo "DISPLAY is unset and xvfb-run is unavailable; install xvfb-run for headless Linux e2e." >&2
  exit 1
fi

exec npx wdio run e2e/wdio.conf.ts
