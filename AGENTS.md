# AGENTS.md — PDF Editor

Context and conventions for AI agents working in this repo. **Read this before
making changes.**

## What this is

A cross-platform desktop PDF editor (MVP). Tauri 2 backend (Rust) + React/
TypeScript frontend. Page management, viewing, annotation, Markdown conversion,
and optimized export. GPL v3. Remote: `visorcraft/PDF-Panda`. Current tag:
`v0.1.1`.

## Tech stack

- **Backend:** Rust (edition 2021), Tauri 2.x
- **Frontend:** Vite 8 + React 19 + TypeScript 6 — the entire UI is one file,
  `src/App.tsx`
- **PDF rendering:** `pdfium-render` (needs a real PDFium lib — see below)
- **PDF structure edits:** `lopdf`
- **Build accel:** `mold` (Linux-only linker), `sccache` (both required locally;
  configured in `.cargo/config.toml`)

## CRITICAL: PDFium library

Rendering needs a **standard PDFium build** (the C `FPDF_*` API).

- The system `libdeepin-pdfium` is a **different, incompatible C++ API** (exports
  no `FPDF_*` symbols). Never bind to it.
- **Fetch the prebuilt lib before rendering:** `scripts/fetch-pdfium.sh`
  → installs into `src-tauri/vendor/pdfium/` (gitignored, not committed).
- Loader search order (`bind_pdfium` in `main.rs`): `PDFIUM_LIB_PATH` env → next
  to the executable → Tauri resource dir (packaged builds) → `src-tauri/vendor/
  pdfium/` → system library. If none is found, the render commands return an
  error string (they no longer panic/abort the app).
- Packaged builds ship it via `bundle.resources` in `tauri.conf.json`; it lands
  at `<resource_dir>/vendor/pdfium/` and is resolved during Tauri `setup`.
- The process-wide PDFium binding is protected by a `Mutex`. Keep PDFium-backed
  commands serialized unless you have evidence the loaded PDFium build is safe
  for concurrent page render/text extraction in this app.

## Build & run

**Always use the Tauri CLI, never plain `cargo`:**

- Dev: `npm run tauri dev`
- Binary only: `npx tauri build --no-bundle` → `src-tauri/target/release/pdf-editor`
- Packages: `npx tauri build` → deb/rpm/appimage (AppImage needs `appimagetool`)

⚠️ **Plain `cargo build --release` produces a DEV-MODE binary** that tries to load
the Vite dev server (`localhost:5173`) and shows "connection refused". Only the
Tauri CLI enables production asset embedding (it sets the `custom-protocol`
feature). The CI build step uses `npx tauri build --no-bundle`.

## Linux / Wayland gotcha

`main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux at startup. WebKitGTK's
DMABUF renderer crashes with `Gdk Error 71 (Protocol error)` on some bleeding-edge
multi-GPU Wayland stacks. This keeps GPU compositing but drops zero-copy
presentation. A user-set value wins. Remove it once webkit2gtk ships a working
DMABUF renderer for the target hardware.

## Testing & quality gates (CI runs all on Linux, macOS, Windows)

Run from `src-tauri/` unless noted:

- `cargo test` — unit tests for every lopdf-based command (no PDFium needed).
- Ignored end-to-end smoke test (needs PDFium + a file):
  `PDF_EDITOR_TEST_PDF=/path/to.pdf cargo test render_real_pdf_smoke -- --ignored --nocapture`
  This smoke test covers render → thumbnails → Markdown extraction → render
  page 2 after Markdown, which guards the Markdown-to-PDF transition path.
- `cargo clippy --all-targets` (CI sets `RUSTFLAGS=-Dwarnings`)
- `cargo fmt --check` (one `rustfmt.toml` at repo root — don't reintroduce a
  second `.rustfmt.toml`)
- `npx tsc --noEmit`

CI does **not** install PDFium — the lib is loaded at runtime only, so compilation
and the default test suite don't need it.

## Architecture

- `src-tauri/src/main.rs` — all Tauri commands, the PDFium binding, and the test
  module. Commands: `list_pdf_browser_entries`, `get_pdf_page_count`,
  `render_pdf_page`, `get_pdf_thumbnails`, `delete_page`, `move_page`,
  `rotate_page`, `split_pdf`, `insert_pdf`, `convert_pdf_to_markdown`,
  `save_pdf_markdown`, `optimize_pdf`, `add_highlight`, `remove_highlight`,
  `get_annotations`.
- `src/App.tsx` — the whole UI (toolbar, scrollable viewer, thumbnail sidebar,
  split/insert modals, highlight overlays, print surface).
- `src-tauri/capabilities/default.json` — Tauri ACL (`core:default`). Custom app
  commands don't need ACL entries; plugins do.
- Page-tree edits assume a **flat page tree** (every `/Kids` entry is a leaf
  page). `/Count` is kept in sync in `set_pages_kids`.
- Annotation coords are stored in **natural (unscaled) image pixels**; the viewer
  applies zoom as a CSS transform so overlays stay aligned.

## Current status (accurate)

**Working & verified:** open (in-app path modal + built-in PDF browser), view + zoom (25–400%) + thumbnails,
prev/next + mouse-wheel page-turn at scroll boundaries, editable page/zoom fields,
fixed (non-scrolling) toolbar, drag-reorder, delete, rotate, insert, split,
optimize (metadata strip + image recompress + prune + stream compress), print
(native print dialog via `window.print()`), highlight (click-to-start →
click-to-finish, persists, click-an-existing-highlight to remove), PDF/Markdown
view toggle with sibling `.md` auto-save and overwrite confirmation, Markdown
conversion (PDFium text extraction — decodes CID/Type0 fonts).

**Crash notes from v0.1.1 work:** native PDF file dialogs were removed after the
Open PDF dialog path froze on the target Linux/Wayland stack. Thumbnail clicks
while in Markdown view must switch back to PDF mode before rendering the target
page; the UI currently defers that render by animation frames to avoid racing
the WebKitGTK view transition.

**Known gaps / future work:**
- Markdown output is plain text grouped by `## Page N` — no heading/bold/list
  structure, no images.
- Markdown always saves beside the open PDF as `<pdf-name>.md`; there is no custom
  destination picker yet.
- Native PDF file dialogs are intentionally avoided on the current Linux/Wayland
  target because the WebKitGTK/portal path can hang the app when opening a file.
- AppImage bundling needs `appimagetool` installed (deb/rpm work out of the box).

## Conventions

- **Commit attribution:** commits are authored by the human committer **only**.
  NEVER add AI/agent attribution anywhere: no assistant credit lines, co-author
  trailers, assistant names, model names, vendor names, or tool names in messages,
  code, or docs. Grep the staged diff for attribution markers before committing.
- Keep the **Status & Verification** section in `PLAN.md` and this file accurate
  when features change.
- Match existing style; run fmt + clippy + tsc and the test suite before claiming
  work is done. Verify behavior with evidence, not assertions.
