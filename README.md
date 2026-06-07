# PDF Panda

A fast, cross-platform PDF editor built with **Rust** and **Tauri**. Open a document, rearrange pages, annotate, export to Markdown, and save optimized copies — without leaving a lightweight native app.

**Current release:** v0.2.0 · **License:** [GPL v3](LICENSE)

## Why PDF Panda?

PDF Panda targets the everyday PDF workflow: view, reorganize, lightly annotate, and export. Edits use a **working copy**, so your original file stays untouched until you save. Keyboard shortcuts cover navigation, zoom, undo/redo, and common tools.

Runs on **Linux**, **macOS**, and **Windows**.

## Features

### Open & navigate
- In-app path entry, **Recently Opened** list, and built-in PDF browser
- Smooth viewer with **25%–400%** zoom and a thumbnail sidebar
- Page navigation via toolbar, thumbnails, keyboard, and mouse wheel at scroll edges

### Page editing
- **Delete**, **rotate** (90° steps), and **drag-and-drop reorder**
- **Insert** pages from another PDF (range + position)
- **Split** into multiple files by page ranges

### Save & history
- Non-destructive **working-copy** editing
- **Save** / **Save As** with unsaved-changes prompts
- **Undo** / **Redo** (50-entry snapshot history)

### Annotations
- **Highlights** — draw rectangles, persisted in the PDF (`H`)
- **Sticky notes** — place text notes on a page (`N`)

### Conversion & export
- **PDF → Markdown** with heuristic headings, tables, and TOC formatting
- **Save Markdown** beside the PDF or to a custom path; exports page renders and embedded images to a sibling `_assets` folder
- **Optimize** — strip metadata, recompress images, prune unused objects
- **Print** via the system print dialog

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [Rust](https://rustup.rs/) (edition 2021)
- Linux: GTK/WebKit dev packages (see CI workflow for the apt list)
- Linux (optional): `mold` linker and `sccache` (configured in `.cargo/config.toml`)

### PDFium (required for rendering)

Rendering uses [`pdfium-render`](https://crates.io/crates/pdfium-render) and a standard PDFium build (`FPDF_*` API). Fetch the prebuilt library before running:

```sh
scripts/fetch-pdfium.sh
```

This installs into `src-tauri/vendor/pdfium/` (gitignored). The app resolves PDFium via `PDFIUM_LIB_PATH`, next to the executable, the bundled resource path, `src-tauri/vendor/pdfium/`, then the system library.

> **Note:** Distro packages such as `libdeepin-pdfium` expose a different C++ API and are **not** compatible.

### Run in development

```sh
npm install
npm run tauri dev
```

Always use the **Tauri CLI** for dev and release builds — plain `cargo build --release` produces a dev-mode binary that expects the Vite dev server.

### Build a release binary

```sh
npx tauri build --no-bundle
# → src-tauri/target/release/pdf-panda
```

Packaging helpers live under `scripts/` (`build-linux-packages.sh`, `build-appimage.sh`, `build-macos.sh`, `build-windows.sh`).

## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Rust, [Tauri 2](https://v2.tauri.app/) |
| Frontend | Vite, React 19, TypeScript |
| Render | [pdfium-render](https://crates.io/crates/pdfium-render) |
| Structure edits | [lopdf](https://crates.io/crates/lopdf) |
| Build accel (Linux) | mold, sccache |

## Development

```sh
scripts/smoke-test.sh               # unit tests, clippy, fmt, and tsc (CI parity)
```

Optional smoke test with a real PDF and PDFium installed:

```sh
PDF_PANDA_TEST_PDF=/path/to/file.pdf \
  cargo test render_real_pdf_smoke --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

Implementation status and post-MVP backlog: [`PLAN.md`](PLAN.md).  
Release signing notes: [`docs/SIGNING.md`](docs/SIGNING.md).  
Manual QA checklist: [`docs/MANUAL_E2E.md`](docs/MANUAL_E2E.md).

## Contributing

Contributions are welcome. Match existing style, run the quality gates above, and keep commits focused. This project is GPL v3 — derivative works must remain open source under compatible terms.

## License

Copyright © VisorCraft LLC. Licensed under the [GNU General Public License v3.0](LICENSE).
