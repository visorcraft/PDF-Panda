# Credits and Attribution

## Copyright

PDF-Panda is © VisorCraft LLC and contributors, distributed under the
[GNU General Public License v3.0](LICENSE).

## Runtime dependencies

PDF-Panda links against or bundles the following components at execution
time. Packaged builds ship PDFium; Linux desktop builds use the system
WebKitGTK and GTK stacks. Tesseract is optional and invoked only when the
user enables scan OCR for Markdown export.

| Component | License | Project |
| --------- | ------- | ------- |
| PDFium | BSD-3-Clause | https://pdfium.googlesource.com/pdfium/ |
| WebKitGTK | LGPL-2.1+ | https://webkitgtk.org/ |
| GTK 3 | LGPL-2.1+ | https://www.gtk.org/ |
| Tesseract OCR (optional) | Apache-2.0 | https://github.com/tesseract-ocr/tesseract |

Full license texts for these runtimes are bundled under [`LICENSES/`](LICENSES/)
and viewable in-app under **Help → Licenses**, **Runtime components** tab.

## Rust crate dependencies

The machine-generated transitive supplement — every Rust crate, its exact
version, and the full text of every distinct license — lives in
[`docs/credits-third-party.md`](docs/credits-third-party.md).
Regenerate it via `scripts/generate-credits.sh` (which runs `cargo-about`
over `src-tauri/Cargo.lock`).

### Direct Rust dependencies

| Crate | License | Project |
| ----- | ------- | ------- |
| `tauri`, `tauri-build`, `tauri-plugin-dialog` | MIT OR Apache-2.0 | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| `pdfium-render` | Apache-2.0 OR MIT | [ajrcarey/pdfium-render](https://github.com/ajrcarey/pdfium-render) |
| `lopdf` | MIT | [J-F-Liu/lopdf](https://github.com/J-F-Liu/lopdf) |
| `image` | MIT OR Apache-2.0 | [image-rs/image](https://github.com/image-rs/image) |
| `fax` | MIT OR Apache-2.0 | [ccgn/fax](https://github.com/ccgn/fax) |
| `underskrift` | Apache-2.0 OR MIT | [visorcraft/underskrift](https://github.com/visorcraft/underskrift) |
| `serde` | MIT OR Apache-2.0 | [serde-rs/serde](https://github.com/serde-rs/serde) |
| `tokio` | MIT | [tokio-rs/tokio](https://github.com/tokio-rs/tokio) |

## Frontend (npm) dependencies

The React shell ships a small set of direct npm packages from root
`package.json` `dependencies`. Dev-only WebdriverIO packages under `e2e/`
are omitted because they are not bundled into release artifacts.

Regenerate `docs/credits-npm.json` and the npm license appendix via
`scripts/generate-credits.sh` after any npm dependency change.
