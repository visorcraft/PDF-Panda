# Release Signing

PDF Panda release packages are **unsigned by default**. When signing credentials are
configured as GitHub Actions secrets, the release workflow signs macOS and Windows
artifacts automatically before publishing.

## Automated releases (GitHub Actions)

Run the **Release** workflow manually (**Actions → Release → Run workflow**). The pipeline:

1. Builds Linux deb/rpm, macOS `.app`/`.dmg`, and Windows `.msi`/`.exe` packages.
2. Signs macOS and Windows artifacts when the secrets below are present.
3. Writes `SHA256SUMS.txt` for all uploaded files.
4. Publishes a GitHub Release with every artifact attached.

Workflow file: `.github/workflows/release.yml`

### Required GitHub secrets

| Secret | Platform | Purpose |
| --- | --- | --- |
| `APPLE_CERTIFICATE_BASE64` | macOS | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | Password for the `.p12` import |
| `APPLE_SIGNING_IDENTITY` | macOS | `codesign` identity string (e.g. `Developer ID Application: …`) |
| `APPLE_ID` | macOS | Apple ID for `notarytool` (optional but recommended) |
| `APPLE_APP_PASSWORD` | macOS | App-specific password for notarization (optional) |
| `APPLE_TEAM_ID` | macOS | 10-character Team ID for notarization (optional) |
| `WINDOWS_CERTIFICATE_BASE64` | Windows | Base64-encoded `.pfx` code-signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | Password for the `.pfx` |

When macOS secrets are omitted, unsigned macOS bundles are still published. The same
applies to Windows. Linux packages are always unsigned; distribute `SHA256SUMS.txt`
alongside them.

### Local helper scripts

| Script | Purpose |
| --- | --- |
| `scripts/import-apple-cert.sh` | Import a `.p12` into a temporary keychain (CI/local) |
| `scripts/sign-macos.sh` | `codesign` + optional `notarytool` staple for `.app`/`.dmg` |
| `scripts/sign-windows.sh` | Authenticode-sign `.exe`/`.msi`/installer artifacts |
| `scripts/release-checksums.sh` | Generate `SHA256SUMS.txt` for a directory of release files |

## macOS (manual)

Prerequisites: Apple Developer ID Application certificate, `notarytool` credentials.

```sh
scripts/build-macos.sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: …"
# Optional notarization:
export APPLE_ID=… APPLE_APP_PASSWORD=… APPLE_TEAM_ID=…
scripts/sign-macos.sh
```

## Windows (manual)

Prerequisites: EV or standard code-signing certificate on a token or store.

```sh
scripts/build-windows.sh
export WINDOWS_CERTIFICATE_PASSWORD=…
scripts/sign-windows.sh /path/to/certificate.pfx
```

## Linux

Debian/RPM/AppImage builds are unsigned (AppImage via `scripts/build-appimage.sh` /
release workflow). Distribute checksums (SHA-256) alongside
release artifacts:

```sh
scripts/release-checksums.sh path/to/release-artifacts
```
