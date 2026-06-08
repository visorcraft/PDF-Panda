<p align="center">
  <img src="src/assets/panda.png" alt="PDF Panda logo" width="200" />
</p>

<h1 align="center">PDF Panda</h1>

<p align="center">
  <a href="https://github.com/visorcraft/PDF-Panda/releases/latest"><img src="https://img.shields.io/github/v/release/visorcraft/PDF-Panda?sort=semver" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg" alt="License: GPL-3.0-only" /></a>
  <img src="https://img.shields.io/badge/built%20with-Rust-000000?logo=rust&amp;logoColor=white" alt="Built with Rust" />
  <img src="https://img.shields.io/badge/Tauri%202-FFC131?logo=tauri&amp;logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-333333?logo=linux&amp;logoColor=white" alt="Platform: Linux, macOS, Windows" />
</p>

<p align="center">
  <b>The friendly, fast, cross-platform PDF editor.</b><br />
  Open a document, rearrange pages, annotate, sign, and export to Markdown — all in one lightweight native app.
</p>

---

## Screenshots

> _Placeholder — drop a real capture here._ The app shows a fixed toolbar, a
> scrollable page viewer with 25–400% zoom, a thumbnail + bookmarks sidebar, and
> tool overlays for highlights, notes, shapes, stamps, and forms.

---

## What is PDF Panda?

PDF Panda is a desktop PDF editor for the everyday workflow: **view, reorganize,
annotate, sign, and export** — without firing up a heavyweight suite or uploading
your files to someone else's server. It's a small, snappy native app that gets out
of your way.

Three things we care about:

- **Native & cross-platform** — one lightweight [Tauri 2](https://v2.tauri.app/) app that feels at home on **Linux**, **macOS**, and **Windows**.
- **Non-destructive** — every edit lands in a working copy, so your original file stays untouched until you choose to save. Undo/redo has your back (50 steps).
- **Offline & private** — no cloud, no accounts, no telemetry. Your documents never leave your machine.

### What it covers today

**View & navigate**
- Smooth viewer with **25%–400%** zoom and a thumbnail sidebar
- Page navigation via toolbar, thumbnails, keyboard, mouse wheel at scroll edges, and a clickable **Bookmarks** outline
- **Find text** across the document with match highlighting (Ctrl/Cmd+F)
- Open via in-app path entry, a **Recently Opened** list, a built-in PDF browser, or **native open/save dialogs**

**Organize pages**
- **Delete**, **duplicate**, **rotate** (90° steps), and **drag-and-drop reorder**
- **Insert** pages from another PDF (range + position; merges form fields, dedups fonts)
- **Merge** another PDF by appending its pages to the end (page range supported)
- **Split** into multiple files by page range
- **Extract** a page range into a new PDF without changing the open document
- **Reverse** page order, **rotate all** pages, insert a **blank page**, or **delete a page range**
- **Export PNG/JPEG/WebP/BMP/TIFF/GIF/PPM/TGA/ICO** or **export current page / each page as PDF**
- **Rotate 180°**, **rotate all CCW**, **move page to first/last/up/down**, **swap pages**, **blank before/after**
- **Insert image as new page**, **page header/footer** text, **duplicate page range** or **duplicate all**
- **Replace** current page, **interleave** or **prepend** another PDF, **split odd/even** or **split every N**, **set page size** (Letter/A4/Legal)
- **Rotate/move/keep/reverse page range**, **reset rotation range**, **crop range**, **crop/expand/shrink odd/even**, **clear crop odd/even**, **insert blank pages**, **blank between/before/after odd/even**, **duplicate range to start/end/before**, **duplicate page/odd/even** (append, before, to start, or to end), **rotate odd/even** (CW/CCW/180/reset), **rotate all 180°**, **keep/delete odd/even**, **flatten odd/even**, **sort by rotation/size** (all or odd/even parity), **delete every Nth**, **move range to start/end**, **reverse odd/even**, **move odd/even to start/end**, **extract/export odd/even** (PDF or PNG/JPEG/WebP/BMP/TIFF/GIF/PPM/TGA/ICO), **parity tools** (1766 commands: in-range global/local/mod-3…mod-6/half/third-range + sort desc + document-wide mod-3…mod-6 via Parity Range modal), **split at page**, **shrink margins**, **bookmark/size odd/even**
- **Page border**, **expand margins**, **bookmark all pages**, **flatten all**, **sort by page size**, **clear metadata**
- **Add/rename/remove/clear bookmarks**, **page dimensions**, **page numbers**, **headers/footers/borders/watermarks** (all or odd/even parity), **crop** (single/all/clear), **flatten** annotations
- View and edit document **metadata** (title, author, subject, keywords, creator, producer)

**Annotate & mark up**
- **Highlights** (`H`), **sticky notes** (`N`), **freehand ink** (`D`), **shapes** (`S` — rectangle/ellipse/line)
- **Stamps** (`T` — APPROVED, DRAFT, CONFIDENTIAL, REVIEWED, plus image stamps) and **redaction** boxes (`X`)
- **In-PDF text blocks** (`E`) and **vector rectangles** (`G`), embedded **images** (`I`) — all persisted in the PDF

**Forms & signatures**
- **Interactive forms** (`F`) — list, fill, and create text / checkbox / choice / radio fields
- **PAdES digital signatures** — sign with a PKCS#12 certificate (`.p12`/`.pfx`); list and verify in the Signatures panel
- **Password protect** — export an encrypted copy; **decrypt** to `_decrypted.pdf`; open encrypted PDFs with a prompt

**Convert & export**
- **PDF → Markdown** — tagged-PDF structure when available, PDFium heuristic layout otherwise; on save, scanned/sparse pages and embedded images are OCR'd via Tesseract (when installed) into `<md-stem>_assets/`; auto-save sibling `.md` or **Save As…** for a custom path
- **Summarize** — extractive overview, key points, and extracted headings/emails/URLs/dates
- **Optimize** — strip metadata, recompress images, prune unused objects, compress streams
- **Export PNG/JPEG/WebP/BMP/TIFF/GIF/PPM/TGA/ICO** — save rendered pages as image files (Ctrl/Cmd+Shift+B)
- **Print** via the system print dialog

---

## Setup (build from source)

### Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [Rust](https://rustup.rs/) (edition 2021)
- **Linux:** GTK/WebKit dev packages (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the exact apt list)
- **Linux (optional):** `mold` linker and `sccache` for faster builds (configured in `.cargo/config.toml`)

### Fetch PDFium (required for rendering)

Rendering uses [`pdfium-render`](https://crates.io/crates/pdfium-render) against a
standard PDFium build (the C `FPDF_*` API). Fetch the prebuilt library first:

```sh
scripts/fetch-pdfium.sh
```

This installs into `src-tauri/vendor/pdfium/` (gitignored). The app also resolves
PDFium via `PDFIUM_LIB_PATH`, next to the executable, the bundled resource path,
then the system library.

> **Note:** distro packages such as `libdeepin-pdfium` expose a *different* C++ API and are **not** compatible.

### Run in development

```sh
npm install
npm run tauri dev
```

> Always use the **Tauri CLI** for dev and release builds — a plain
> `cargo build --release` produces a dev-mode binary that expects the Vite dev
> server.

---

## Install

Grab a prebuilt package from the [**Releases**](https://github.com/visorcraft/PDF-Panda/releases/latest)
page, or build your own with the helpers under [`scripts/`](scripts/):

| Target | Command |
| --- | --- |
| Linux — `.deb` / `.rpm` | `scripts/build-linux-packages.sh` |
| Linux — AppImage | `scripts/build-appimage.sh` (prefetches linuxdeploy; `NO_STRIP=1` default on glibc 2.38+) |
| macOS — `.app` / `.dmg` | `scripts/build-macos.sh` |
| Windows — `.msi` / `.exe` | `scripts/build-windows.sh` |
| Any — standalone binary | `npx tauri build --no-bundle` → `src-tauri/target/release/pdf-panda` |

Run the GitHub Actions [release workflow](.github/workflows/release.yml) manually
(**Actions → Release → Run workflow**) to build and publish `.deb`, `.rpm`,
AppImage, macOS, and Windows artifacts (unsigned by default; optional
macOS/Windows **package** signing via repository secrets — see
[`docs/SIGNING.md`](docs/SIGNING.md)).

---

## Tweak

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+O | Open PDF |
| Ctrl/Cmd+S / Ctrl/Cmd+Shift+S | Save / Save As |
| Ctrl/Cmd+W | Close PDF |
| Ctrl/Cmd+Z / Ctrl/Cmd+Y | Undo / Redo |
| Ctrl/Cmd+R | Rotate page |
| Ctrl/Cmd+P | Print |
| Ctrl/Cmd+Shift+M | PDF ↔ Markdown |
| Ctrl/Cmd+Shift+O | Optimize |
| Ctrl/Cmd+Shift+E | Summarize |
| Ctrl/Cmd+Shift+U | Digital sign |
| Ctrl/Cmd+F | Find text in PDF |
| Ctrl/Cmd+Shift+I / Ctrl/Cmd+Shift+G / Ctrl/Cmd+Shift+J / Ctrl/Cmd+Shift+K / Ctrl/Cmd+Shift+B | Insert / Merge / Extract / Split / Export image |
| Ctrl/Cmd+Shift+N / Ctrl/Cmd+Shift+Y | Insert blank page / Reverse page order |
| Ctrl/Cmd+0, Ctrl/Cmd +/− | Reset / change zoom |
| H N D S T X E G I F | Highlight / note / draw / shape / stamp / redact / page text / vector / image / forms |
| Delete · Escape | Delete page (confirm) · exit tool or close modal |

### Linux (Wayland & GPU)

- **File dialogs:** Open/Save default to in-app path entry and the built-in PDF browser on **Linux Wayland** — the XDG desktop-portal picker can hang WebKitGTK on some stacks. macOS, Windows, and Linux X11 use native **Choose file…** buttons by default. Set `PDF_PANDA_NATIVE_DIALOGS=1` to opt in on Wayland; `PDF_PANDA_DISABLE_NATIVE_DIALOGS=1` forces in-app paths everywhere.
- **DMABUF renderer:** At startup the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` when unset, avoiding `Gdk Error 71 (Protocol error)` crashes on some multi-GPU Wayland setups. GPU compositing stays on; only zero-copy presentation is disabled. Set your own value before launch to override.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PDFIUM_LIB_PATH` | Override path to the PDFium shared library |
| `PDF_PANDA_OCR_LANG` | Tesseract language code (default `eng`) |
| `TESSERACT_CMD` | Path to the `tesseract` executable |
| `PDF_PANDA_NATIVE_DIALOGS` | `1` = enable native file dialogs on Linux Wayland |
| `PDF_PANDA_DISABLE_NATIVE_DIALOGS` | `1` = in-app path entry only (all platforms) |
| `WEBKIT_DISABLE_DMABUF_RENDERER` | `1` = disable WebKitGTK DMABUF (set automatically on Linux when unset) |
| `PDF_PANDA_TEST_PDF` | PDF path for the ignored `render_real_pdf_smoke` integration test |

---

## Contribute

Contributions are welcome — issues, fixes, and features alike.

**Quick rules:**

- Match the existing style, and keep commits focused.
- Run the quality gates before you push: `scripts/smoke-test.sh` (Rust unit tests, `clippy`, `fmt`, `tsc`) and, on Linux, `npm run test:e2e`.
- PDF Panda is **GPL v3** — derivative works must stay open source under compatible terms.

---

## Licence

PDF Panda is licensed under the [GNU General Public License v3.0](LICENSE). Copyright © VisorCraft LLC.
