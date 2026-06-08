#!/usr/bin/env sh
# Prefetch linuxdeploy tooling used by Tauri AppImage bundles.
#
# Tauri downloads these into ~/.cache/tauri on first AppImage build; this script
# makes that explicit for CI/offline-friendly workflows. deb/rpm bundles do not
# need these tools.
#
# Usage: scripts/fetch-appimage-tools.sh
set -eu

if [ "$(uname -s)" != Linux ]; then
  echo "AppImage tooling is Linux-only (current OS: $(uname -s))." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) ldarch=x86_64 ;;
  aarch64) ldarch=aarch64 ;;
  *)
    echo "Unsupported Linux arch for AppImage prefetch: $arch" >&2
    exit 1
    ;;
esac

cache="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
mkdir -p "$cache"

fetch() {
  url="$1"
  dest="$2"
  if [ -f "$dest" ]; then
    echo "OK $(basename "$dest")"
    return 0
  fi
  echo "Downloading $(basename "$dest")"
  curl -fSL "$url" -o "$dest"
}

base="https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy"
fetch "$base/linuxdeploy-${ldarch}.AppImage" "$cache/linuxdeploy-${ldarch}.AppImage"
fetch "$base/linuxdeploy-plugin-appimage.AppImage" "$cache/linuxdeploy-plugin-appimage.AppImage"
fetch "$base/linuxdeploy-plugin-gtk.sh" "$cache/linuxdeploy-plugin-gtk.sh"
fetch "$base/linuxdeploy-plugin-gstreamer.sh" "$cache/linuxdeploy-plugin-gstreamer.sh"
fetch "https://github.com/AppImage/AppImageKit/releases/download/continuous/AppRun-${ldarch}" "$cache/AppRun-${ldarch}"

chmod +x \
  "$cache/linuxdeploy-${ldarch}.AppImage" \
  "$cache/linuxdeploy-plugin-appimage.AppImage" \
  "$cache/linuxdeploy-plugin-gtk.sh" \
  "$cache/linuxdeploy-plugin-gstreamer.sh" \
  "$cache/AppRun-${ldarch}"

echo "AppImage tools ready in $cache"
