# AGENTS.md — PDF Panda

## Agent Working Style

- Be concise. Don't restate the plan unless it changed.
- Never scan `node_modules`, `.venv`, `dist`, `build`, log/archive dirs, or generated files.
- Cap search/read output (`head`/`tail`/`grep | head`, `find … | head -n 200`).

Context for AI agents. **Read before making changes.**

## Project

Cross-platform desktop PDF editor (MVP). Tauri 2 + Rust backend, React/TS frontend
(single UI file: `src/App.tsx`). GPL v3. Remote: `visorcraft/PDF-Panda`. Tag: `v0.2.0`.

**Stack:** Rust 2021, Tauri 2, Vite 8, React 19, TS 6 · `pdfium-render` (render) ·
`lopdf` (structure) · `mold` + `sccache` (Linux; `.cargo/config.toml`).

## PDFium (critical)

Rendering needs a **standard PDFium** build (C `FPDF_*` API). Never use system
`libdeepin-pdfium` (incompatible C++ API).

- Fetch: `scripts/fetch-pdfium.sh` → `src-tauri/vendor/pdfium/` (gitignored).
- Load order (`bind_pdfium` in `main.rs`): `PDFIUM_LIB_PATH` → next to exe → Tauri
  resource dir → vendor → system. Missing lib returns errors (no panic).
- Packaged: `bundle.resources` in `tauri.conf.json` → `<resource_dir>/vendor/pdfium/`.
- PDFium is behind a process-wide `Mutex`; keep PDFium commands serialized.

## Build & run

**Use Tauri CLI only** (not plain `cargo` for release assets):

- Dev: `npm run tauri dev`
- Binary: `npx tauri build --no-bundle` → `src-tauri/target/release/pdf-panda`
- Packages: `npx tauri build` (AppImage needs `appimagetool`)

Plain `cargo build --release` is dev-mode (expects Vite on `:5173`). CI uses
`npx tauri build --no-bundle`.

## Linux / Wayland

`main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux unless already set —
avoids WebKitGTK DMABUF crash on some multi-GPU Wayland stacks.

## Quality gates

From `src-tauri/` unless noted:

- `cargo test` — 115 unit tests (+ 3 ignored: `render_real_pdf_smoke`, `export_e2e_sample_pdf`, `ocr_rendered_page_smoke`)
- `PDF_PANDA_TEST_PDF=/path/to.pdf cargo test render_real_pdf_smoke -- --ignored --nocapture`
- `cargo clippy --all-targets` (CI: `RUSTFLAGS=-Dwarnings`)
- `cargo fmt --check` (single `rustfmt.toml` at repo root)
- `npx tsc --noEmit`
- E2E (Linux): `scripts/e2e-test.sh` (needs `xvfb-run`; `wdio` feature)
- Local parity: `scripts/smoke-test.sh`

CI does not install PDFium; default tests compile without it.

## Architecture

- `src-tauri/src/main.rs` — all commands, PDFium binding, tests. Custom commands
  need no ACL entries; plugins do (`capabilities/default.json`).
- Flat page tree only (`/Kids` are leaf pages; `/Count` synced in `set_pages_kids`).
- Annotation coords: natural image pixels; zoom is CSS transform on the viewer.

Command surface (grouped): browser/listing · render/thumbnails · page ops
(delete/move/rotate/split/insert) · markdown convert/save · optimize · encrypt/
protect/open-with-password · annotations (highlight, note, ink, shapes, stamps,
redact) · page image · forms (get/set/add text/checkbox/choice/radio) · working
copy + undo history (`snapshot_pdf_entry`, `restore_history_entry`,
`prune_history_entry`, delta snapshots >32 MB) · OCR (`ocr_available`,
`ocr_pdf_page`; Tesseract on PATH) · `file_byte_size`.

## Status

**Shipped (v0.2.0):** open/close/save (working copy), view/zoom/thumbnails/nav,
page edit (delete/rotate/reorder/insert/split), optimize, print, annotations
(H/N/D/S/T/X), page image (I), forms (F), PDF↔Markdown toggle + assets export,
undo/redo (50-entry cap; deltas for files >32 MB), in-app file browser (no native
dialogs on Linux/Wayland — portal path hangs).

**Ops:** tag `v*` → release workflow (`.github/workflows/release.yml`); optional
signing — `docs/SIGNING.md`. Manual QA: `docs/MANUAL_E2E.md`.

**Gaps:** see `PLAN.md` vNext roadmap (tagged-PDF, native dialogs, etc.). OCR needs
system Tesseract (`tesseract-ocr` package).

**Gotchas:** Markdown-view thumbnail clicks defer PDF render (WebKitGTK race);
AppImage needs `appimagetool`.

## Conventions

- Commits are human-authored **only** — no AI/agent attribution in messages, code,
  or docs (no co-author trailers, tool names, "Generated with…"). Grep staged diff
  before committing.
- Keep `PLAN.md` Status & Verification and this file accurate when features change.
- Match existing style; run fmt + clippy + tsc + tests before claiming done.
