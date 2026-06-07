# Implementation Plan - PDF-Panda (MVP)

This document outlines the phased approach for developing PDF-Panda, the high-performance, cross-platform PDF editor.

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
*Goal: Make editing non-destructive, fix page-tree correctness bugs, and establish the PDF-Panda brand.*

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
| Open PDF | In-app path modal with Recently Opened list and built-in PDF browser starting from the last opened-file directory (avoids unstable native dialog path on affected Wayland/WebKitGTK setups) | Real-PDF smoke test with `Disability_Brochure.pdf`, UI validation |
| Close PDF | Toolbar close action clears current document state and generated object URLs | UI validation |
| View / navigate | pdfium page render, prev/next, thumbnail click | Manual + render pipeline |
| Zoom | 25%–400%, CSS-scaled (overlays stay aligned) | Manual |
| Thumbnails | Async generation, drag-and-drop reorder (nested-tree safe) | `move_page_reorders`, `move_page_on_nested_tree_reorders_leaves` |
| Save / Save As | Working-copy committed on demand; Ctrl/Cmd+S when dirty, Ctrl/Cmd+Shift+S for Save As; dirty prompt on close/open/quit | `working_copy_isolates_edits_until_saved`, UI validation |
| Undo / Redo | Working-copy snapshot history (50-entry cap); dirty state tracks vs. saved point; Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl/Cmd+Shift+Z redo | `snapshot_undo_restore_reverts_working_copy`, UI validation |
| Delete page | Confirmation modal → tree-aware `delete_page` (lopdf `delete_pages`, handles nested trees) | `delete_page_reduces_pages_and_fixes_count`, `delete_page_on_nested_tree_removes_only_one_leaf` |
| Rotate page | Toolbar button → `rotate_page` (90° steps, leaf-id based) | `rotate_page_accumulates_in_90_steps` |
| Insert PDF | Two-column modal (source + range + position); flattens target, deep-copies inserted pages' objects | `insert_pdf_adds_pages_at_index`, `insert_pdf_imports_pages_into_nested_tree` |
| Split PDF | Ranges → separate files, orphans pruned | `split_pdf_creates_separate_files` |
| Markdown | PDF/Markdown toggle, PDFium text extraction with heuristic headings/TOC/tables + dingbat-bullet mapping; sibling `.md` auto-save (or Save Markdown As… path) with overwrite conflict detection | `write_markdown_file_*`, `symbol_font_bullets_become_markdown_bullets`, ignored `render_real_pdf_smoke` |
| Optimize | Metadata strip + image recompress + prune + stream compress | `optimize_pdf_writes_output_file` |
| Print | Renders all pages → native print dialog (`window.print()`) | Manual |
| Highlight | Click-to-draw highlights, persisted + read back; Escape cancels draw and exits highlight mode | `highlight_add_and_read_back` |
| Branding | PDF-Panda transparent icon set, favicons, taskbar/window icon | Visual inspection, transparency audit |

**Quality gates (all green):**
- `cargo test` — unit tests covering every lopdf-based command and Markdown file-write conflict handling.
- `cargo clippy --all-targets` with `-D warnings` — clean.
- `cargo fmt --check` — clean.
- `tsc --noEmit` — clean.
- `npx tauri build --no-bundle` — optimized release binary (LTO, `codegen-units=1`, stripped).
- CI matrix runs all of the above on Linux, macOS, and Windows.

**Known limitations (documented, not defects):**
- Markdown extraction uses PDFium's text layer (handles CID/Type0 fonts), defaults
  to saving beside the open PDF as `<pdf-name>.md` (custom path via Save Markdown As…),
  and reconstructs headings/tables from
  text geometry heuristics. It does not extract images, OCR scanned pages, or use
  tagged-PDF semantics; pages with no text layer are marked
  `_(no extractable text on this page)_`.
- On bleeding-edge Linux GPU stacks, WebKitGTK's DMABUF renderer is disabled at
  startup to avoid a Wayland crash; GPU compositing is retained (see `main.rs`).
- Undo/Redo and deferred save use whole-file working-copy snapshots — fine for
  typical PDFs; very large files are copied on each edit.

## Remaining / Future Work

- **Markdown depth:** no image extraction, OCR for scanned/no-text pages, or
  tagged-PDF semantics.
- **Insert edge cases:** AcroForm / form-field merging is not handled; fonts
  shared across inserted pages aren't deduped beyond a single insert operation.
- **Undo/Redo:** snapshot-based with a 50-entry cap; delta snapshots would still
  help for very large files.
- **File dialogs:** native open/save dialogs are intentionally avoided on the
  Wayland/WebKitGTK target (in-app path + browser used); revisit when the desktop
  portal path is stable.
- **Annotations:** rectangle highlights only — no notes, freehand, or other types.
- **Packaging / distribution:** Linux via `scripts/build-linux-packages.sh` (deb/rpm)
  and `scripts/build-appimage.sh` (needs `appimagetool`); unsigned macOS/Windows via
  `scripts/build-macos.sh` / `scripts/build-windows.sh`; signing/notarization not set up yet.
- **Testing:** save, undo/redo snapshot restore, insert/split validation, and
  Markdown file-write flows have Rust unit tests; no automated UI/e2e coverage yet.

## Future Roadmap (Post-MVP)

Aligned with `FEATURES.md`. Overlaps with **Remaining / Future Work** above are
called out rather than duplicated.

- **Advanced editing:** In-PDF text editing, vector object manipulation, and
  image insertion (beyond current page-level operations).
- **OCR integration:** Optical character recognition for scanned documents and
  pages with no text layer (see also Markdown depth above).
- **Enhanced annotations:** Sticky notes, stamps, shapes, and freehand drawing
  (see also annotations bullet above — highlights only today).
- **Security features:** Password protection, digital signatures, and redaction
  tools.
- **Form support:** Creation and filling of interactive PDF forms (broader than
  insert-time AcroForm merging noted above).
- **AI-powered tools:** Document summarization and intelligent content extraction.
