# Implementation Plan - PDF Panda (MVP)

This document outlines the phased approach for developing PDF Panda, the high-performance, cross-platform PDF editor.

**Full Tech Stack:**
* **Backend Language:** Rust (Bleeding edge)
* **Application Framework:** Tauri 2.11.2 (Latest)
* **Frontend:** Vite 8.0.16 + TypeScript 6.0.3 + React 19.2.7
* **Build Optimization:** `mold` (Linker), `sccache` (Compilation Caching)
* **PDF Rendering Engine:** `pdfium-render` 0.9.1 (via Google's PDFium)
* **PDF Manipulation Library:** `lopdf` 0.41.0

## Phase 1: Foundation & Environment Setup
*Goal: Establish a robust development environment and project structure.*

- [x] **Project Initialization**
    - [x] Initialize Tauri project (using Vite + TypeScript for frontend).
    - [x] Configure Git repository with `.gitignore`.
    - [x] Set up license files (GPL v3) and `README.md`.
- [x] **Developer Experience (DX) Optimization**
    - [x] Configure `.cargo/config.toml` to use the `mold` linker for fast builds on Linux.
    - [x] Set up `sccache` for dependency caching.
    - [x] Establish linting and formatting rules (`.eslintrc.json`, `rustfmt.toml`).
- [x] **CI/CD & Infrastructure**
    - [x] Configure GitHub Actions (`.github/workflows/ci.yml`) for automated testing on Linux, macOS, and Windows.
    - [x] Set up basic build pipeline for cross-compilation targets.

## Phase 2: Core PDF Engine & Viewing Experience
*Goal: Get a PDF file rendered on screen with smooth navigation.*

- [x] **Backend: PDF Engine Integration**
    - [x] Integrate `pdfium-render` for high-fidelity rendering.
    - [x] Integrate `lopdf` for structural document manipulation and parsing.
    - [x] Implement page extraction logic to feed the frontend.
- [x] **Frontend: High-Performance Viewer**
    - [x] Develop a rendering component (Canvas, WebGL, or SVG) for smooth zooming and scrolling.
    - [x] Implement basic navigation controls (page jump, zoom in/out).
- [x] **Thumbnail Sidebar**
    - [x] Implement asynchronous thumbnail generation to prevent UI freezing.
    - [x] Build the visual sidebar component for page overview.

## Phase 3: Page Manipulation (The "Editor" Core)
*Goal: Implement the primary user requested features for managing pages.*

- [x] **Basic Page Actions**
    - [x] Implement "Delete Page" functionality.
    - [x] Implement "Rotate Page" (90/180/270 degrees).
- [x] **Advanced Manipulation**
    - [x] Implement "Re-order Pages" via drag-and-drop in the thumbnail sidebar.
    - [x] Implement "Split PDF" functionality to create multiple files from one.
- [x] **The "Insert PDF" Feature (Critical)**
    - [x] Build UI for selecting a source PDF and specific page ranges.
    - [x] Implement logic to insert pages at specified positions ("Before" or "After").

## Phase 4: Conversion, Optimization & Export
*Goal: Add value through intelligent file transformations.*

- [x] **Markdown Conversion**
    - [x] Develop the engine to parse PDF text and structure into Markdown (.md).
- [x] **Optimized PDF Export**
    - [x] Implement metadata stripping for file size reduction.
    - [x] Implement image re-compression logic (balancing quality vs. size).
- [x] **System Integration**
    - [x] Implement "Print" functionality via the system's native print dialog.

## Phase 5: Refinement, Polishing & Release
*Goal: Ensure a high-quality user experience across all target platforms.*

- [x] **Annotation Support**
    - [x] Implement text selection and basic highlighting for reading/reviewing.
- [x] **UI/UX Polish**
    - [x] Apply consistent styling and responsive design for Linux, macOS, and Windows.
    - [x] Add error handling and user feedback (e.g., loading states, success notifications).
- [x] **Final Verification**
    - [x] Conduct cross-platform testing on all target OSs.
    - [x] Perform performance profiling to ensure "bleeding edge" speed.
    - [x] Finalize documentation and prepare the first release tag.

## Phase 6: Post-MVP Hardening & Branding (v0.2.0)
*Goal: Make editing non-destructive, fix page-tree correctness bugs, and establish the PDF Panda brand.*

- [x] **Branding**
    - [x] Rename project `pdf-editor` → `pdf-panda` (npm/crate/binary, `com.pdf-panda.dev` identifier, window title, docs).
    - [x] Transparent panda logo asset set: app icons (face ≤32px / full panda at larger sizes), hybrid `.ico`/`.icns`, web favicons.
    - [x] Linux taskbar icon via a `.desktop` entry + hicolor icons (packaged builds generate these automatically).
- [x] **Non-destructive editing**
    - [x] Deferred save via a working copy — the user's original file is untouched until they save.
    - [x] `Save` and `Save As…`, unsaved-changes prompt on close / open-another / quit, dirty indicator (toolbar `•` + window title).
    - [x] `Undo` / `Redo` via working-copy snapshots.
- [x] **Correctness fixes**
    - [x] Nested page-tree support: tree-aware delete, flatten-based move/insert (the old flat-tree assumption corrupted such PDFs).
    - [x] Insert now deep-copies the inserted pages' content/resources (no more dangling references).
    - [x] Markdown: map dingbat-font bullet glyphs (e.g. Wingdings `n` = ▪) to list bullets.
    - [x] Insert dialog: two-column layout; From/To bound to the source PDF's page count.
    - [x] Add window `set-title` / `destroy` ACL permissions (dirty title + quit prompt).

---

## Status & Verification

All MVP features are implemented, wired end-to-end (frontend ⇄ Tauri commands),
and verified:

| Area | Implementation | Verified by |
| --- | --- | --- |
| Open PDF | In-app path modal (Ctrl/Cmd+O) with Recently Opened list, built-in PDF browser, and native Choose file… when `native_file_dialogs_enabled` (Wayland off unless `PDF_PANDA_NATIVE_DIALOGS=1`) | `list_pdf_browser_entries_lists_pdfs_and_directories`, `native_file_dialogs_policy_*`, UI validation |
| Close PDF | Toolbar close or Ctrl/Cmd+W (unsaved prompt); clears document state and object URLs | UI validation |
| View / navigate | pdfium page render, prev/next, thumbnail click, Arrow/Page Up/Down, Home/End keys | Manual + render pipeline |
| Zoom | 25%–400%, CSS-scaled (overlays stay aligned); Ctrl/Cmd +/−/0 shortcuts | Manual |
| Thumbnails | Async generation, drag-and-drop reorder (nested-tree safe) | `move_page_reorders`, `move_page_on_nested_tree_reorders_leaves`, `move_page_rejects_invalid_index`, `move_page_rejects_invalid_from_index`, `move_page_same_index_is_noop`, `move_page_rejects_missing_file` |
| Save / Save As | Working-copy committed on demand; Ctrl/Cmd+S when dirty, Ctrl/Cmd+Shift+S for Save As; dirty prompt on close/open/quit | `open_working_copy_creates_isolated_temp_file`, `working_copy_isolates_edits_until_saved`, `open_working_copy_rejects_missing_file`, `save_working_copy_rejects_missing_working_file`, UI validation |
| Undo / Redo | Working-copy snapshot history (50-entry cap); files &gt; 32 MB use compact binary deltas; dirty state tracks vs. saved point; Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl/Cmd+Shift+Z redo | `snapshot_pdf_creates_unique_history_files`, `snapshot_undo_restore_reverts_working_copy`, `encode_pdf_delta_roundtrip`, `snapshot_pdf_entry_uses_delta_for_large_files`, `prune_history_entry_rematerializes_orphaned_deltas`, `snapshot_pdf_rejects_missing_source`, `file_byte_size_returns_length`, UI validation |
| Delete page | Delete key or toolbar → confirmation modal → tree-aware `delete_page` (rejects last-page delete, nested trees) | `delete_page_reduces_pages_and_fixes_count`, `delete_page_on_nested_tree_removes_only_one_leaf`, `delete_page_rejects_invalid_index`, `delete_page_rejects_only_page`, `delete_page_rejects_missing_file` |
| Rotate page | Toolbar button or Ctrl/Cmd+R → `rotate_page` (90° steps, leaf-id based) | `rotate_page_accumulates_in_90_steps`, `rotate_page_rejects_invalid_index`, `rotate_page_rejects_missing_file` |
| Insert PDF | Ctrl/Cmd+Shift+I two-column modal (source + range + position); flattens target, deep-copies inserted pages' objects | `insert_pdf_adds_pages_at_index`, `insert_pdf_imports_pages_into_nested_tree`, `insert_pdf_rejects_invalid_source_range`, `insert_pdf_rejects_source_range_out_of_bounds`, `insert_pdf_rejects_out_of_bounds_index`, `insert_pdf_rejects_missing_source_file`, `insert_pdf_rejects_missing_dest_file` |
| Split PDF | Ctrl/Cmd+Shift+K ranges → separate files, orphans pruned; rejects empty/invalid ranges | `split_pdf_creates_separate_files`, `split_pdf_rejects_invalid_range`, `split_pdf_rejects_empty_ranges`, `split_pdf_rejects_missing_file` |
| Markdown | PDF/Markdown toggle (Ctrl/Cmd+Shift+M), tagged-PDF `/StructTreeRoot` semantics (headings, lists, tables) with PDFium heuristic + OCR fallback per page; sibling `.md` auto-save (or Save Markdown As… path) with overwrite conflict detection; on save, no-text pages export rendered PNGs and embedded XObject images land in `<name>_assets/` | `tagged_markdown_*`, `write_markdown_file_*`, `symbol_font_bullets_become_markdown_bullets`, `file_byte_size_returns_length`, ignored `render_real_pdf_smoke` |
| Optimize | Metadata strip + image recompress + prune + stream compress; Ctrl/Cmd+Shift+O | `optimize_pdf_writes_output_file`, `optimize_pdf_rejects_missing_file` |
| Password protect | Export encrypted `<name>_protected.pdf`; open encrypted files with password prompt | `protect_pdf_*`, `pdf_is_encrypted`, `verify_pdf_password`, `open_working_copy_with_password` |
| Summarize | Extractive overview, key points, headings, emails/URLs/dates; save sibling `.summary.md` (Ctrl/Cmd+Shift+E) | `summarize_pdf`, `save_pdf_summary`, `build_pdf_summary_*`, UI validation |
| Page text / vector | In-PDF Helvetica text blocks and stroke rectangles via content-stream markers (`%PP-TXT` / `%PP-VEC`); place (**E**), drag rect (**G**), manage via Edits modal | `add_page_text`, `list_page_text_edits`, `update_page_text`, `remove_page_text`, `add_page_vector_rect`, `list_page_vectors`, `remove_page_vector`, `page_text_edit_roundtrip`, `page_vector_rect_roundtrip` |
| Digital signatures | PAdES signing with PKCS#12 (.p12/.pfx); list + verify integrity/chain (Ctrl/Cmd+Shift+U); Signatures sidebar panel | `sign_pdf`, `list_pdf_signatures`, `verify_pdf_signatures`, `pdf_signature_roundtrip_with_openssl`, UI validation |
| Bookmarks | PDF outline tree in sidebar; click to jump (nested depth); Refresh reloads | `get_pdf_bookmarks`, `get_pdf_bookmarks_reads_outline_tree`, UI validation |
| Print | Renders all pages → native print dialog (`window.print()`); Ctrl/Cmd+P | Manual |
| Highlight / Notes / Draw / Shapes / Stamps / Redact | Highlights (H), notes (N), ink (D), shapes (S), stamps (T), redaction boxes (X); click-to-remove in active mode; Escape exits annotation mode or dismisses modals | `highlight_*`, `text_note_*`, `ink_stroke_*`, `square_*`, `circle_*`, `line_*`, `*_stamp_*`, `add_redaction`, `remove_redaction` |
| Branding | PDF Panda transparent icon set, favicons, taskbar/window icon | Visual inspection, transparency audit |

**Quality gates (all green):**
- `cargo test` — 137 unit tests (+ 3 ignored: `render_real_pdf_smoke`, `export_e2e_sample_pdf`, `ocr_rendered_page_smoke`) covering
  every lopdf-based command, working-copy/snapshot flows, page-edit validation,
  highlight CRUD, and Markdown file-write conflict handling.
- `cargo clippy --all-targets` with `-D warnings` — clean.
- `cargo fmt --check` — clean.
- `tsc --noEmit` — clean.
- `npx tauri build --no-bundle` — optimized release binary (LTO, `codegen-units=1`, stripped).
- CI matrix runs all of the above on Linux, macOS, and Windows; Linux also runs
  the WebdriverIO smoke suite (`scripts/e2e-test.sh`).

**Known limitations (documented, not defects):**
- Markdown extraction uses PDFium's text layer (handles CID/Type0 fonts), defaults
  to saving beside the open PDF as `<pdf-name>.md` (custom path via Save Markdown As…),
  and reconstructs headings/tables from text geometry heuristics. On save it also
  exports page renders (no-text pages) and embedded XObject images (JPEG, PNG,
  DeviceGray, DeviceCMYK, Indexed, JPXDecode) to `<pdf-name>_assets/`. Scanned pages
  without a text layer use Tesseract OCR when installed (`PDF_PANDA_OCR_LANG`,
  `TESSERACT_CMD`). Tagged PDFs prefer `/StructTreeRoot` structure types over
  geometry heuristics; untagged pages still use PDFium layout reconstruction.
- On bleeding-edge Linux GPU stacks, WebKitGTK's DMABUF renderer is disabled at
  startup to avoid a Wayland crash; GPU compositing is retained (see `main.rs`).
- Undo/Redo uses whole-file snapshots for files ≤ 32 MB and compact binary deltas
  for larger files (50-entry cap). If a single delta exceeds 32 MB it falls back
  to a full snapshot.

## Plan Completion

**PLAN.md is complete for v0.2.x.** Phases 1–6 and every actionable backlog item
below are implemented or explicitly moved to the vNext roadmap. Nothing in this
file blocks tagging or shipping `v0.2.0`.

### v0.2.x backlog (all done)

- [x] Markdown page renders for no-text pages (`<name>_assets/page-N.png` on save)
- [x] Markdown embedded XObject image extraction (JPEG + raw RGB → PNG on save)
- [x] Sticky text notes (`add_text_note` / `remove_text_note`, **N** shortcut)
- [x] Large-file undo guard (skip snapshots &gt; 32 MB; `file_byte_size` command)
- [x] Packaging/signing docs (`docs/SIGNING.md`)
- [x] Release QA checklist (`docs/MANUAL_E2E.md`)
- [x] Local smoke script (`scripts/smoke-test.sh` — unit tests + typecheck)
- [x] Freehand drawing (`add_ink_stroke` / `remove_ink_stroke`, **D** shortcut)
- [x] Shape outlines (`add_square` / `add_circle` / `add_line`, **S** shortcut)
- [x] Text and image stamps (`add_text_stamp` / `add_image_stamp`, **T** shortcut)
- [x] Password protection (`protect_pdf`, encrypted open with password prompt)
- [x] Redaction (`add_redaction` / `remove_redaction`, **X** shortcut)
- [x] Markdown exotic image filters (DeviceGray, DeviceCMYK, Indexed, JPXDecode on save)
- [x] Page image insertion (`add_page_image` / `get_image_dimensions`, **I** shortcut)
- [x] Interactive form support (`get_pdf_form_fields` / `set_pdf_form_field` / `add_text_form_field`, **F** shortcut)
- [x] Insert edge cases — AcroForm merge on insert, cross-insert font dedup, conflicting field rename
- [x] Form depth — checkbox, choice list, and radio group field creation (`add_checkbox_form_field` / `add_choice_form_field` / `add_radio_form_field`)
- [x] Large-file undo deltas — binary delta snapshots for files &gt; 32 MB (`snapshot_pdf_entry` / `restore_history_entry` / `prune_history_entry`)
- [x] Automated UI/e2e — WebdriverIO + embedded WebDriver smoke suite (`scripts/e2e-test.sh`, `e2e/specs/smoke.spec.ts`)
- [x] Signing automation — tag-triggered release workflow with optional macOS/Windows signing and SHA256 checksums (`.github/workflows/release.yml`, `docs/SIGNING.md`)
- [x] OCR integration — Tesseract OCR for scanned pages in Markdown export (`ocr_pdf_page`, `ocr_available`; env `TESSERACT_CMD`, `PDF_PANDA_OCR_LANG`)
- [x] Markdown depth — tagged-PDF semantics (`/StructTreeRoot` → headings, lists, tables; PDFium/OCR fallback per page)
- [x] File dialogs — native open/save via `tauri-plugin-dialog` (`native_file_dialogs_enabled`; macOS/Windows + Linux X11 by default, Wayland opt-in with `PDF_PANDA_NATIVE_DIALOGS=1`)
- [x] AI-powered tools — extractive document summarization and intelligent extraction (`summarize_pdf`, `save_pdf_summary`; emails, URLs, dates, headings)
- [x] Advanced editing — in-PDF text blocks and vector stroke rectangles (`add_page_text` / `update_page_text` / `remove_page_text`, `add_page_vector_rect` / `remove_page_vector`; **E** / **G** shortcuts, Edits modal)
- [x] Digital signatures — PAdES PKCS#12 signing and verification (`sign_pdf`, `list_pdf_signatures`, `verify_pdf_signatures`; **Ctrl/Cmd+Shift+U**, Signatures panel)

### vNext roadmap

- [x] **Bookmark navigation** — PDF outline sidebar with page jump (`get_pdf_bookmarks`, Bookmarks panel)
