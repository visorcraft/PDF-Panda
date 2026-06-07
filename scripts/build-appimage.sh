#!/usr/bin/env sh
# Build a Linux AppImage for PDF Panda.
#
# Requires appimagetool (or APPIMAGETOOL pointing at it). deb/rpm bundles work
# without it; AppImage packaging does not.
#
# Usage: scripts/build-appimage.sh
set -eu

if [ "$(uname -s)" != Linux ]; then
  echo "AppImage builds are Linux-only (current OS: $(uname -s))." >&2
  exit 1
fi

if ! command -v appimagetool >/dev/null 2>&1 && [ -z "${APPIMAGETOOL:-}" ]; then
  echo "appimagetool is required for AppImage bundles." >&2
  echo "Install it from https://github.com/AppImage/AppImageKit or set APPIMAGETOOL." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ ! -f src-tauri/vendor/pdfium/libpdfium.so ]; then
  echo "PDFium not found; fetching prebuilt library..."
  "$root/scripts/fetch-pdfium.sh"
fi

echo "Building AppImage..."
exec npx tauri build --bundles appimage
