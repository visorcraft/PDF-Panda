# PDF-Panda

PDF-Panda is a high-performance, cross-platform PDF editor built with Rust and Tauri.

## Features (MVP)
* Open PDFs via in-app path entry, Recently Opened list, and built-in PDF browser
* Page Management (Re-order via drag-and-drop, Insert, Delete, Rotate, Split)
* High-Performance Viewer with zoom (25%–400%) and thumbnail navigation
* Highlight annotations (persisted to the document)
* Markdown Conversion (.md)
* Optimized PDF Export (metadata strip, image recompression, stream compression)
* Printing via the system's native print dialog
* Save / Save As, Undo / Redo (50-entry cap), and non-destructive working-copy editing
* Cross-platform support (Linux, macOS, Windows)

See `FEATURES.md` for the full feature catalog and `PLAN.md` for implementation status.

## Tech Stack
* **Backend:** Rust
* **Framework:** Tauri
* **Frontend:** Vite + React + TypeScript
* **Optimization:** `mold`, `sccache`

## PDFium runtime library
PDF rendering uses [`pdfium-render`](https://crates.io/crates/pdfium-render),
which needs a standard PDFium build at runtime (the C `FPDF_*` API). Fetch the
prebuilt library before running:

```sh
scripts/fetch-pdfium.sh
```

This installs `libpdfium` into `src-tauri/vendor/pdfium/` (gitignored). At
startup the app looks for PDFium via `PDFIUM_LIB_PATH`, then next to the
executable, then `src-tauri/vendor/pdfium/`, then the system library. Note: a
distro's `libdeepin-pdfium` is a *different, incompatible* API and is not used.

## License
This project is licensed under the GNU General Public License v3.
