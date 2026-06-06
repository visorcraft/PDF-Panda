# PDF Editor MVP

A high-performance, cross-platform PDF editor built with Rust and Tauri.

## Features (MVP)
* Open PDFs via a native file dialog
* Page Management (Re-order via drag-and-drop, Insert, Delete, Rotate, Split)
* High-Performance Viewer with zoom (25%–300%) and thumbnail navigation
* Highlight annotations (persisted to the document)
* Markdown Conversion (.md)
* Optimized PDF Export (metadata strip, image recompression, stream compression)
* Printing via the system's native print dialog
* Cross-platform support (Linux, macOS, Windows)

## Tech Stack
* **Backend:** Rust
* **Framework:** Tauri
* **Frontend:** Vite + React + TypeScript
* **Optimization:** `mold`, `sccache`

## License
This project is licensed under the GNU General Public License v3.
