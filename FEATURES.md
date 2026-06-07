# PDF-Panda Features

Current release: **v0.2.0** (MVP complete). This file is the product feature
catalog referenced by `PLAN.md`.

## MVP (shipped)

### Open & navigate
- In-app path entry with Recently Opened list and built-in PDF browser (avoids
  unstable native file dialogs on affected Wayland/WebKitGTK stacks)
- Page view with prev/next, thumbnail sidebar, mouse-wheel page-turn at scroll
  boundaries, editable page/zoom fields
- Zoom 25%–400% with aligned highlight overlays
- Keyboard shortcuts for navigation, zoom, open/close, print, and modals

### Page editing
- Delete page (with confirmation; rejects deleting the only page)
- Rotate page (90° steps)
- Drag-and-drop page reorder (nested page-tree safe)
- Insert PDF pages from another file (range + position)
- Split PDF into multiple files by page ranges

### Save & history
- Non-destructive editing via working copy (original untouched until save)
- Save / Save As with unsaved-changes prompts
- Undo / Redo (50-entry snapshot cap)

### Conversion & export
- PDF → Markdown (PDFium text extraction with heuristic headings, TOC, tables)
- Save Markdown beside PDF or via Save Markdown As… with overwrite detection;
  no-text pages export rendered PNGs to `<name>_assets/` on save
- Optimize PDF (metadata strip, image recompress, prune, stream compress)
- Print via native print dialog

### Annotations
- Rectangle highlights (H — click-to-draw, persisted, click-to-remove)
- Sticky text notes (N — click to place, modal for text, click-to-remove in note mode)

### Platform
- Linux, macOS, Windows builds via Tauri 2
- Packaging scripts: `build-no-bundle.sh`, `build-linux-packages.sh`,
  `build-appimage.sh`, `build-macos.sh`, `build-windows.sh`

## Known limitations (MVP)

- Markdown: no embedded XObject image extraction, OCR, or tagged-PDF semantics
  (no-text pages get a rendered page PNG on Markdown save)
- No freehand, stamps, or shapes (highlights + sticky notes only)
- Native file dialogs intentionally avoided on the current Linux/Wayland target
- Undo/redo uses whole-file snapshots (fine for typical PDFs; large files copy
  on each edit)
- Insert does not merge AcroForm fields or dedupe fonts across repeated inserts
- Release packages are unsigned (`docs/SIGNING.md` documents signing when certs exist)

## Future roadmap (post-MVP)

- **Advanced editing:** in-PDF text editing, vector manipulation, image insertion
- **OCR:** scanned documents and pages without a text layer
- **Enhanced annotations:** stamps, shapes, freehand drawing
- **Security:** password protection, digital signatures, redaction
- **Forms:** interactive PDF form creation and filling
- **AI tools:** summarization and intelligent content extraction
- **Testing:** automated Tauri WebView UI / e2e suite (`docs/MANUAL_E2E.md` today)
- **Distribution:** automated signing pipeline (see `docs/SIGNING.md`)
