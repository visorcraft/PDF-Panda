# AGENTS.md — PDF-Panda

**Read before changing code.** Cross-platform desktop PDF editor (MVP). Tauri 2 + Rust
backend, React/TS frontend (`src/App.tsx` only). GPL v3 · `visorcraft/PDF-Panda` · tag
`v0.2.0`. Feature matrix: `PLAN.md`.

## Working style

- Be concise; cap searches/reads (`head`/`tail`/`grep | head`, no `node_modules`/`.venv`/`dist`/`build`/generated dirs).
- Use **Tauri CLI** for builds (not plain `cargo` for release assets).
- Run fmt + clippy + tsc + `cargo test` before claiming done; verify with evidence.
- Commits are human-authored **only** — never add AI/agent attribution (grep staged diff).
- Keep `PLAN.md` Status & Verification and this file accurate when features change.

## Stack

Rust 2021 · Tauri 2 · Vite 8 · React 19 · TS 6 · `pdfium-render` · `lopdf` · `underskrift`
(PAdES) + `tokio` · `tauri-plugin-dialog` · Linux: `mold` + `sccache` (`.cargo/config.toml`).

## PDFium (critical)

Rendering needs standard PDFium (C `FPDF_*` API). **Never** use `libdeepin-pdfium`
(incompatible C++ API).

1. `scripts/fetch-pdfium.sh` → `src-tauri/vendor/pdfium/` (gitignored)
2. Load order (`bind_pdfium`): `PDFIUM_LIB_PATH` → exe dir → Tauri resource dir → vendor → system
3. Packaged: `tauri.conf.json` `bundle.resources` → `<resource_dir>/vendor/pdfium/`
4. Process-wide `Mutex` — keep PDFium commands serialized

Missing lib returns errors (no panic).

## Build & run

| Goal | Command |
| --- | --- |
| Dev | `npm run tauri dev` |
| Release binary | `npx tauri build --no-bundle` → `src-tauri/target/release/pdf-panda` |
| Packages | `npx tauri build` (AppImage needs `appimagetool`) |

Plain `cargo build --release` = dev-mode binary (expects Vite `:5173`). CI uses `npx tauri build --no-bundle`.

## Linux / Wayland

`main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` unless already set (WebKitGTK DMABUF crash on some multi-GPU Wayland stacks).

## Quality gates

From `src-tauri/` unless noted:

- `cargo test` — **139** passed (+ 3 ignored: `render_real_pdf_smoke`, `export_e2e_sample_pdf`, `ocr_rendered_page_smoke`; no PDFium needed for default suite)
- `PDF_PANDA_TEST_PDF=/path/to.pdf cargo test render_real_pdf_smoke -- --ignored --nocapture`
- `RUSTFLAGS=-Dwarnings cargo clippy --all-targets`
- `cargo fmt --check` (single `rustfmt.toml` at repo root)
- `npx tsc --noEmit`
- `scripts/smoke-test.sh` (local CI parity)
- Linux E2E: `scripts/e2e-test.sh` / `npm run test:e2e` (`wdio` feature, `xvfb-run`)

Signature roundtrip test needs `openssl` on PATH.

## Architecture

| Path | Role |
| --- | --- |
| `src-tauri/src/main.rs` | All commands, PDFium binding, tests |
| `src/App.tsx` | Entire UI |
| `src-tauri/capabilities/default.json` | ACL; plugins need entries (`dialog:default`); custom commands do not |

**Conventions:** flat page tree (`/Kids` = leaves; `/Count` synced in `set_pages_kids`; nested trees handled on delete/move/insert). Annotation coords = natural image pixels; zoom is CSS transform on viewer.

**Commands** (grep `main.rs` for full list): browser/listing · render/thumbnails · page ops (delete/move/rotate/split/insert) · markdown (`convert_pdf_to_markdown`, `save_pdf_markdown`) · summarize (`summarize_pdf`, `save_pdf_summary`) · page content edits (`add_page_text`, `update_page_text`, `remove_page_text`, `add_page_vector_rect`, `list_page_vectors`, `remove_page_vector`) · signatures (`sign_pdf`, `list_pdf_signatures`, `verify_pdf_signatures`) · bookmarks (`get_pdf_bookmarks`) · metadata (`get_pdf_metadata`, `set_pdf_metadata`) · optimize · encrypt (`protect_pdf`, `pdf_is_encrypted`, `verify_pdf_password`, `open_working_copy_with_password`) · annotations (highlight, note, ink, shapes, stamps, redact) · page image · forms (get/set/add text/checkbox/choice/radio) · working copy + undo (`open_working_copy`, `save_working_copy`, `snapshot_pdf_entry`, `restore_history_entry`, `prune_history_entry`; deltas >32 MB) · OCR (`ocr_available`, `ocr_pdf_page`) · `native_file_dialogs_enabled` · `file_byte_size`.

## Status

**Shipped:** open/close/save (working copy, 50-step undo; deltas >32 MB), view/zoom/nav/thumbnails, page edit (delete/rotate/reorder/insert/split), annotations (H/N/D/S/T/X), page image (I), forms (F), in-PDF text/vector (E/G), bookmarks panel, metadata editor, PAdES sign/verify (Ctrl/Cmd+Shift+U), PDF↔Markdown + `.md`/`_assets/` export, summarize + `.summary.md`, optimize, protect, print, native dialogs when `native_file_dialogs_enabled`.

**vNext:** complete (see `PLAN.md`).

**Gotchas:** Linux Wayland native dialogs off unless `PDF_PANDA_NATIVE_DIALOGS=1` (or `PDF_PANDA_DISABLE_NATIVE_DIALOGS=1` to force off). Markdown-view thumbnail clicks defer PDF render (WebKitGTK race). `docs/SIGNING.md` = release package signing, not `sign_pdf`.

**Shortcuts:** Ctrl/Cmd+O/S/Shift+S/W/Z/Y/R/P; Shift+M/O/E/U/I/K; H/N/D/S/T/X/E/G/I/F; Delete; Escape — details in `README.md`.

## Env (optional)

`PDFIUM_LIB_PATH` · `PDF_PANDA_TEST_PDF` · `PDF_PANDA_OCR_LANG` / `TESSERACT_CMD` · `PDF_PANDA_NATIVE_DIALOGS=1` · `PDF_PANDA_DISABLE_NATIVE_DIALOGS=1`
