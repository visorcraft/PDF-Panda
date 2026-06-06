# Implementation Plan - PDF Editor (MVP)

This document outlines the phased approach for developing the high-performance, cross-platform PDF editor.

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

---

## Status & Verification

All MVP features are implemented, wired end-to-end (frontend ⇄ Tauri commands),
and verified:

| Area | Implementation | Verified by |
| --- | --- | --- |
| Open PDF | Native file dialog (`@tauri-apps/plugin-dialog`) | Renders in browser/Tauri; dialog plugin + capability wired |
| View / navigate | pdfium page render, prev/next, thumbnail click | Manual + render pipeline |
| Zoom | 25%–300%, CSS-scaled (overlays stay aligned) | Manual |
| Thumbnails | Async generation, drag-and-drop reorder | `move_page_reorders` test |
| Delete page | Toolbar button → `delete_page` (keeps `/Count`) | `delete_page_reduces_pages_and_fixes_count` |
| Rotate page | Toolbar button → `rotate_page` (90° steps) | `rotate_page_accumulates_in_90_steps` |
| Insert PDF | Modal w/ source + range + position | `insert_pdf_adds_pages_at_index` |
| Split PDF | Ranges → separate files, orphans pruned | `split_pdf_creates_separate_files` |
| Markdown | Content-stream text extraction (UTF-8/UTF-16/Latin-1, line breaks) | `markdown_extracts_page_text` |
| Optimize | Metadata strip + image recompress + prune + stream compress | `optimize_pdf_writes_output_file` |
| Print | Renders all pages → native print dialog (`window.print()`) | Manual |
| Highlight | Drag to highlight, persisted + read back | `highlight_add_and_read_back` |

**Quality gates (all green):**
- `cargo test` — 9 unit tests covering every lopdf-based command.
- `cargo clippy --all-targets` with `-D warnings` — clean.
- `cargo fmt --check` — clean.
- `tsc --noEmit` — clean.
- `tauri build` — optimized release (LTO, `codegen-units=1`, stripped).
- CI matrix runs all of the above on Linux, macOS, and Windows.

**Known limitations (documented, not defects):**
- Markdown extraction can't recover text from CID/Type0-font PDFs (needs a full
  text layer); such pages are marked `_(no extractable text on this page)_`.
- Page-tree edits assume a flat page tree (the common case).
- On bleeding-edge Linux GPU stacks, WebKitGTK's DMABUF renderer is disabled at
  startup to avoid a Wayland crash; GPU compositing is retained (see `main.rs`).
