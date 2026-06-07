# Project Features - MVP Plan

## Overview
PDF-Panda is an open-source PDF editor project designed to be native to Linux while cross-compiling for macOS and Windows. The goal of the first release (MVP) is to provide essential page manipulation, conversion, and optimization capabilities in a high-performance, modern desktop application.

**Tech Stack:** Rust + Tauri (latest/bleeding edge versions)
**License:** GNU General Public License v3 (GPL v3)

---

## First Release (MVP) Features

### 1. Page Management
* **Re-order Pages:** Easily rearrange pages within a document using a visual thumbnail view (drag and drop).
* **Insert PDF Pages:** Seamlessly merge another PDF into the current document.
    * Select specific page ranges from the source PDF.
    * Choose insertion position: "Before" or "After" a selected page in the target document.
* **Delete Pages:** Remove a chosen page from the document with confirmation.
* **Rotate Pages:** Rotate individual pages (90, 180, 270 degrees) to correct orientation.
* **Split Document:** Divide a single PDF into multiple smaller PDF files based on user-defined page ranges.

### 2. Viewing & Navigation
* **High-Performance Viewer:** A smooth and responsive PDF rendering engine (leveraging Rust's performance).
* **Thumbnail Sidebar:** A visual overview of the document for rapid navigation and easy manipulation.
* **Basic Annotations:** Support for text selection and highlighting to assist in reading and reviewing documents.

### 3. Conversion & Export
* **Convert to Markdown (.md):** Extract PDF text into a same-folder Markdown file grouped by page, with heuristic headings/table formatting and overwrite confirmation when an existing `.md` differs.
* **Optimized PDF Export:** A specialized export mode designed to reduce file size significantly through:
    * Efficient image re-compression (balancing quality and size).
    * Content optimization (removing redundant metadata/objects).
    * *Goal:* Achieve extreme efficiency without noticeable loss in visual quality.
* **Print Support:** Standard printing capabilities for all open documents.

### 4. Core File Operations
* **Open & Save:** Full support for opening existing PDFs with recent-file access, remembered browser directory, and saving changes to new or existing files.
* **Cross-Platform Compatibility:** Native experience on Linux, macOS, and Windows via Tauri.

---

## Future Roadmap (Post-MVP)
* **Advanced Editing:** Text editing, vector object manipulation, and image insertion.
* **OCR Integration:** Optical Character Recognition for scanned documents.
* **Enhanced Annotations:** Sticky notes, stamps, shapes, and freehand drawing.
* **Security Features:** Password protection, digital signatures, and redaction tools.
* **Form Support:** Creation and filling of interactive PDF forms.
* **AI-Powered Tools:** Document summarization and intelligent content extraction.
