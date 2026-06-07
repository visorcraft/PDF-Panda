# AGENTS.md — PDF-Panda

## Agent Working Style

- Be concise. No long explanations. Don't restate the plan unless it changed.
- Never scan `node_modules`, `.venv`, `dist`, `build`, log/archive dirs, or generated files.
- Cap output when searching or reading files. Default to limits, e.g.:
  - `head -n 100` / `tail -n 100`
  - `grep -n "pattern" file | head`
  - `find . -type f | head -n 200`
  - `python script.py --limit 50`

Context and conventions for AI agents working in this repo. **Read this before
making changes.**

## What this is

A cross-platform desktop PDF editor named PDF-Panda (MVP). Tauri 2 backend (Rust) + React/
TypeScript frontend. Page management, viewing, annotation, Markdown conversion,
optimized export, and PAdES digital signatures. GPL v3. Remote: `visorcraft/PDF-Panda`.
Current tag: `v0.2.0`.

## Tech stack

- **Backend:** Rust (edition 2021), Tauri 2.x
- **Frontend:** Vite 8 + React 19 + TypeScript 6 — the entire UI is one file,
  `src/App.tsx`
- **PDF rendering:** `pdfium-render` (needs a real PDFium lib — see below)
- **PDF structure edits:** `lopdf`
- **Digital signatures:** `underskrift` (PAdES PKCS#12 sign/verify) + `tokio` (async
  signing runtime)
- **File dialogs:** `tauri-plugin-dialog`
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
- Binary only: `npx tauri build --no-bundle` → `src-tauri/target/release/pdf-panda`
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
  **137 passed** (+ 3 ignored: `render_real_pdf_smoke`, `export_e2e_sample_pdf`,
  `ocr_rendered_page_smoke`). Includes working-copy/snapshot flows, page-edit
  validation, highlight CRUD, Markdown file-write conflict handling, page
  text/vector edits, and digital-signature roundtrips (`pdf_signature_roundtrip_with_openssl`
  needs `openssl` on PATH).
- Ignored end-to-end smoke test (needs PDFium + a file):
  `PDF_PANDA_TEST_PDF=/path/to.pdf cargo test render_real_pdf_smoke -- --ignored --nocapture`
  This smoke test covers render → thumbnails → Markdown extraction → render
  page 2 after Markdown, which guards the Markdown-to-PDF transition path.
- `cargo clippy --all-targets` (CI sets `RUSTFLAGS=-Dwarnings`)
- `cargo fmt --check` (one `rustfmt.toml` at repo root — don't reintroduce a
  second `.rustfmt.toml`)
- `npx tsc --noEmit`
- E2E (Linux): `scripts/e2e-test.sh` or `npm run test:e2e` (needs `xvfb-run`;
  `wdio` feature)
- Local parity: `scripts/smoke-test.sh`

CI does **not** install PDFium — the lib is loaded at runtime only, so compilation
and the default test suite don't need it.

## Architecture

- `src-tauri/src/main.rs` — all Tauri commands, the PDFium binding, and the test
  module. Commands: `list_pdf_browser_entries`, `get_pdf_page_count`,
  `render_pdf_page`, `get_pdf_thumbnails`, `delete_page`, `move_page`,
  `rotate_page`, `split_pdf`, `insert_pdf`, `convert_pdf_to_markdown`,
  `save_pdf_markdown`, `summarize_pdf`, `save_pdf_summary`, `optimize_pdf`,
  `pdf_is_encrypted`, `verify_pdf_password`, `open_working_copy_with_password`,
  `protect_pdf`, `sign_pdf`, `list_pdf_signatures`, `verify_pdf_signatures`,
  `add_highlight`, `remove_highlight`, `add_text_note`, `remove_text_note`,
  `add_ink_stroke`, `remove_ink_stroke`, `add_square`, `add_circle`, `add_line`,
  `remove_square`, `remove_circle`, `remove_line`, `list_stamp_presets`,
  `add_text_stamp`, `add_image_stamp`, `remove_text_stamp`, `remove_image_stamp`,
  `add_redaction`, `remove_redaction`, `get_image_dimensions`, `add_page_image`,
  `add_page_text`, `list_page_text_edits`, `update_page_text`, `remove_page_text`,
  `add_page_vector_rect`, `list_page_vectors`, `remove_page_vector`,
  `get_pdf_form_fields`, `set_pdf_form_field`, `add_text_form_field`,
  `add_checkbox_form_field`, `add_choice_form_field`, `add_radio_form_field`,
  `get_annotations`, `get_pdf_bookmarks`, `open_working_copy`, `save_working_copy`,
  `discard_working_copy`, `snapshot_pdf`, `snapshot_pdf_entry`,
  `restore_history_entry`, `discard_history_entry`, `prune_history_entry`,
  `file_byte_size`, `native_file_dialogs_enabled`, `ocr_available`, `ocr_pdf_page`.
- `src/App.tsx` — the whole UI (toolbar, scrollable viewer, thumbnail sidebar,
  split/insert modals, highlight overlays, print surface, forms panel, signatures
  panel).
- `src-tauri/capabilities/default.json` — Tauri ACL (`core:default`). Custom app
  commands don't need ACL entries; plugins do (`dialog:default`).
- Page-tree edits assume a **flat page tree** (every `/Kids` entry is a leaf
  page). `/Count` is kept in sync in `set_pages_kids`. Delete/move/insert also
  handle nested trees safely.
- Annotation coords are stored in **natural (unscaled) image pixels**; the viewer
  applies zoom as a CSS transform so overlays stay aligned.

## Current status (accurate)

**Working & verified:** open (in-app path modal + built-in PDF browser, Recently Opened list,
browser starts in the last opened-file directory, native Choose file… when
`native_file_dialogs_enabled`), close current PDF, view + zoom (25–400%) + thumbnails,
prev/next + mouse-wheel page-turn at scroll boundaries, editable page/zoom fields,
fixed (non-scrolling) toolbar, drag-reorder, delete with page-specific confirmation,
rotate, insert, split, optimize (metadata strip + image recompress + prune + stream
compress), print (native print dialog via `window.print()`), highlight (H),
sticky notes (N), freehand ink (D), shapes (S), stamps (T), redaction (X), page
image insert (I), interactive forms (F), in-PDF text blocks (E) and vector stroke
rectangles (G) with Edits modal, PAdES digital signatures (Sign modal +
Signatures panel, Ctrl/Cmd+Shift+U), PDF outline **Bookmarks** sidebar (click to
jump), PDF/Markdown view toggle with sibling `.md`
auto-save and overwrite confirmation, Markdown conversion (PDFium text extraction —
decodes CID/Type0 fonts, with heuristic headings, TOC/table, column-table formatting;
tagged-PDF `/StructTreeRoot` semantics; Tesseract OCR fallback), extractive summarize
+ intelligent extraction (`.summary.md`, Ctrl/Cmd+Shift+E), password protect
(`_protected.pdf` export + encrypted open), save/save-as (working copy), undo/redo
(50-entry cap; binary deltas for files >32 MB).

**Crash notes from v0.1.1 work:** native PDF file dialogs were removed after the
Open PDF dialog path froze on the target Linux/Wayland stack; they are back via
`tauri-plugin-dialog` with Wayland opt-in (`PDF_PANDA_NATIVE_DIALOGS=1`). Thumbnail
clicks while in Markdown view must switch back to PDF mode before rendering the
target page; the UI currently defers that render by animation frames to avoid racing
the WebKitGTK view transition.

**Known gaps / future work:** none tracked in `PLAN.md` vNext.

**Docs distinction:** `docs/SIGNING.md` covers **release artifact** code signing
(macOS/Windows packages), not in-PDF cryptographic signatures (`sign_pdf`).

## Keyboard shortcuts (UI)

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
| H / N / D / S / T / X / E / G / I / F | Toggle highlight / note / draw / shape / stamp / redact / page text / vector / image insert / forms |
| Delete | Delete page (with confirmation) |
| Escape | Exit active tool mode or dismiss modals |

## Conventions

- **Commit attribution:** commits are authored by the human committer **only**.
  NEVER add AI/agent attribution anywhere: no assistant credit lines, co-author
  trailers, assistant names, model names, vendor names, or tool names in messages,
  code, or docs. Grep the staged diff for attribution markers before committing.
- Keep the **Status & Verification** section in `PLAN.md` and this file accurate
  when features change.
- Match existing style; run fmt + clippy + tsc and the test suite before claiming
  work is done. Verify behavior with evidence, not assertions.
