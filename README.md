# PDF Panda

A fast, cross-platform PDF editor built with **Rust** and **Tauri**. Open a document, rearrange pages, annotate, sign, export to Markdown, and save optimized copies — without leaving a lightweight native app.

**Current release:** v0.2.0 · **License:** [GPL v3](LICENSE)

## Why PDF Panda?

PDF Panda targets the everyday PDF workflow: view, reorganize, lightly annotate, sign, and export. Edits use a **working copy**, so your original file stays untouched until you save. Keyboard shortcuts cover navigation, zoom, undo/redo, and common tools. A WebdriverIO smoke suite covers launch, open-via-path, and edit flows (`scripts/e2e-test.sh`).

Runs on **Linux**, **macOS**, and **Windows**.

## Features

### Open & navigate
- In-app path entry, **Recently Opened** list, built-in PDF browser, and **native open/save dialogs** on macOS/Windows (Linux X11 by default; Wayland: set `PDF_PANDA_NATIVE_DIALOGS=1`)
- **Close** current document (Ctrl/Cmd+W) with unsaved-changes prompt
- Smooth viewer with **25%–400%** zoom and a thumbnail sidebar
- Page navigation via toolbar, thumbnails, keyboard, mouse wheel at scroll edges, and **Bookmarks** outline panel

### Page editing
- **Delete**, **rotate** (90° steps), and **drag-and-drop reorder**
- **Insert** pages from another PDF (range + position; merges AcroForm fields, dedups fonts)
- **Split** into multiple files by page ranges
- **In-PDF text** — place Helvetica text blocks in page content (`E`); edit or remove via the **Edits** modal
- **Vector rectangles** — draw stroke rectangles in page content (`G`); manage via **Edits** modal

### Security
- **Digital signatures** — PAdES signing with a PKCS#12 certificate (.p12/.pfx); list and verify signatures in the **Signatures** sidebar panel (Ctrl/Cmd+Shift+U)
- **Password protect** — export an encrypted `_protected.pdf` copy; open encrypted PDFs with a password prompt

### Save & history
- Non-destructive **working-copy** editing
- **Save** / **Save As** with unsaved-changes prompts; **Save As** opens a native save dialog when available
- **Undo** / **Redo** (50-entry history; compact deltas for files &gt; 32 MB)

### Annotations
- **Highlights** — draw rectangles, persisted in the PDF (`H`)
- **Freehand drawing** — ink strokes on the page, persisted in the PDF (`D`)
- **Shape outlines** — rectangle, ellipse, and line annotations (`S`)
- **Stamps** — text and image preset stamps (`T`) — APPROVED, DRAFT, CONFIDENTIAL, REVIEWED
- **Redaction** — black-box redaction annotations persisted in the PDF (`X`)
- **Page image insert** — embed PNG/JPEG images into page content (`I`)
- **Form fields** — list, fill, and create text/checkbox/choice/radio fields (`F`)
- **Sticky notes** — place text notes on a page (`N`)

### Conversion & export
- **Summarize** — extractive overview, key points, and extracted headings/emails/URLs/dates; save as sibling `.summary.md` (Ctrl/Cmd+Shift+E)
- **PDF ↔ Markdown** view toggle (Ctrl/Cmd+Shift+M)
- **PDF → Markdown** with tagged-PDF structure (`/StructTreeRoot` headings, lists, tables) plus heuristic PDFium layout and TOC formatting; untagged pages use PDFium/OCR fallback
- **Save Markdown** beside the PDF or to a custom path; exports page renders and embedded images (JPEG/PNG/Gray/CMYK/Indexed/JPX) to a sibling `_assets` folder; **Tesseract OCR** for scanned pages without a text layer (`tesseract-ocr` on PATH, optional `PDF_PANDA_OCR_LANG`)
- **Optimize** — strip metadata, recompress images, prune unused objects (Ctrl/Cmd+Shift+O)
- **Print** via the system print dialog (Ctrl/Cmd+P)

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+O | Open PDF |
| Ctrl/Cmd+S | Save (when dirty) |
| Ctrl/Cmd+Shift+S | Save As |
| Ctrl/Cmd+W | Close PDF |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z | Redo |
| Ctrl/Cmd+R | Rotate page |
| Ctrl/Cmd+P | Print |
| Ctrl/Cmd+Shift+M | PDF ↔ Markdown |
| Ctrl/Cmd+Shift+O | Optimize |
| Ctrl/Cmd+Shift+E | Summarize |
| Ctrl/Cmd+Shift+U | Digital sign |
| Ctrl/Cmd+Shift+I | Insert PDF |
| Ctrl/Cmd+Shift+K | Split PDF |
| Ctrl/Cmd+0 | Reset zoom to 100% |
| Ctrl/Cmd +/− | Zoom in/out |
| H / N / D / S / T / X / E / G / I / F | Highlight / note / draw / shape / stamp / redact / page text / vector / image / forms |
| Delete | Delete page (with confirmation) |
| Escape | Exit active tool or dismiss modals |

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

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PDFIUM_LIB_PATH` | Override path to the PDFium shared library |
| `PDF_PANDA_OCR_LANG` | Tesseract language code (default `eng`) |
| `TESSERACT_CMD` | Path to the `tesseract` executable |
| `PDF_PANDA_NATIVE_DIALOGS` | Set to `1` to enable native file dialogs on Linux Wayland |
| `PDF_PANDA_DISABLE_NATIVE_DIALOGS` | Set to `1` to disable native dialogs and use in-app path entry only |
| `PDF_PANDA_TEST_PDF` | PDF path for the ignored `render_real_pdf_smoke` integration test |

## Tech stack

| Layer | Stack |
| --- | --- |
| Backend | Rust, [Tauri 2](https://v2.tauri.app/) |
| Frontend | Vite 8, React 19, TypeScript 6 |
| Render | [pdfium-render](https://crates.io/crates/pdfium-render) |
| Structure edits | [lopdf](https://crates.io/crates/lopdf) |
| Digital signatures | [underskrift](https://crates.io/crates/underskrift) (PAdES PKCS#12) |
| File dialogs | [tauri-plugin-dialog](https://v2.tauri.app/plugin/dialog/) |
| Build accel (Linux) | mold, sccache |

## Development

```sh
scripts/smoke-test.sh               # unit tests, clippy, fmt, and tsc (CI parity)
npm run test:e2e                    # WebdriverIO smoke (Linux; needs xvfb-run)
```

From `src-tauri/`: `cargo test` runs **137** unit tests (+ 3 ignored integration
smokes that need PDFium, a sample PDF, or Tesseract).

Optional smoke test with a real PDF and PDFium installed:

```sh
PDF_PANDA_TEST_PDF=/path/to/file.pdf \
  cargo test render_real_pdf_smoke --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
```

**Status:** v0.2.x MVP, post-MVP backlog, and vNext roadmap are complete. See
[`PLAN.md`](PLAN.md) for the full feature matrix.

Tagged releases (`git tag v0.2.1 && git push origin v0.2.1`) trigger the GitHub
Actions release workflow (unsigned by default; optional macOS/Windows **package**
signing via repository secrets). See [`docs/SIGNING.md`](docs/SIGNING.md) — that
doc covers release artifacts, not in-PDF cryptographic signatures.  
Manual QA checklist: [`docs/MANUAL_E2E.md`](docs/MANUAL_E2E.md).

## Contributing

Contributions are welcome. Match existing style, run the quality gates above, and keep commits focused. This project is GPL v3 — derivative works must remain open source under compatible terms.

## License

Copyright © VisorCraft LLC. Licensed under the [GNU General Public License v3.0](LICENSE).
