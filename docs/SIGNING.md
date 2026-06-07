# Release Signing

PDF-Panda release packages are **unsigned by default**. Use this guide when you have
platform signing credentials.

## macOS (notarization)

Prerequisites: Apple Developer ID Application certificate, `notarytool` credentials.

```sh
# After: scripts/build-macos.sh
codesign --force --options runtime --sign "Developer ID Application: …" \
  src-tauri/target/release/bundle/macos/*.app
xcrun notarytool submit … --wait
xcrun stapler staple …
```

## Windows (Authenticode)

Prerequisites: EV or standard code-signing certificate on a token or store.

```sh
# After: scripts/build-windows.sh
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 \
  /f your.pfx /p … src-tauri/target/release/pdf-panda.exe
```

## Linux

Debian/RPM/AppImage builds are unsigned. Distribute checksums (SHA-256) alongside
release artifacts.
