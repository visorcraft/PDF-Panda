#!/usr/bin/env sh
# Fetch the prebuilt PDFium runtime library required for PDF rendering.
#
# PDF rendering uses `pdfium-render`, which needs a standard PDFium build (the C
# `FPDF_*` API). This downloads the official prebuilt from bblanchon/pdfium-
# binaries into `src-tauri/vendor/pdfium/`, where the app's loader looks for it.
# The library is not committed to the repo (it is large and platform-specific).
#
# Usage: scripts/fetch-pdfium.sh [release-tag]   (defaults to the latest release)
set -eu

version="${1:-latest}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/src-tauri/vendor/pdfium"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)   asset="pdfium-linux-x64.tgz" ;;
  Linux-aarch64)  asset="pdfium-linux-arm64.tgz" ;;
  Darwin-x86_64)  asset="pdfium-mac-x64.tgz" ;;
  Darwin-arm64)   asset="pdfium-mac-arm64.tgz" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m). See https://github.com/bblanchon/pdfium-binaries/releases" >&2; exit 1 ;;
esac

if [ "$version" = latest ]; then
  url="https://github.com/bblanchon/pdfium-binaries/releases/latest/download/$asset"
else
  url="https://github.com/bblanchon/pdfium-binaries/releases/download/$version/$asset"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $url"
curl -fSL "$url" -o "$tmp/pdfium.tgz"
tar xzf "$tmp/pdfium.tgz" -C "$tmp" lib
mkdir -p "$dest"
cp "$tmp"/lib/libpdfium.* "$dest"/
echo "PDFium installed to $dest"
