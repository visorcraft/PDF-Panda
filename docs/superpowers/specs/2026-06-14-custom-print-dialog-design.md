# Custom print dialog with direct native printing

## Background

PDF Panda currently prints by rendering each page to a PNG and calling the browser's `window.print()`. This relies entirely on the system print dialog and cannot pre-set options like duplex, copies, or orientation. Users have asked for an in-app print dialog with full control.

## Goals

- Replace `window.print()` with a custom in-app print dialog.
- List available printers and let the user pick one.
- Expose options: orientation, paper size, page range, copies, duplex, color/grayscale, scaling/fit-to-page, margins.
- Show a live preview of the document with the selected options applied.
- Print directly to the chosen printer using native OS print APIs on Linux/macOS.
- On Windows, generate a print-ready PDF and open it in the default PDF viewer so the user can print manually.
- Provide a "Save as PDF" fallback that writes a print-ready PDF to disk.
- Work on Linux, macOS, and Windows.

## Non-goals

- Background print-job monitoring (pause/resume/cancel) in v1.
- Advanced finishing options (stapling, hole punching, booklet).
- Network/IPP printer discovery outside the OS print subsystem.

## Design

### Architecture

```
┌─────────────────────────────────────┐
│  Frontend: PrintDialog modal        │
│  - printer list                     │
│  - option controls                  │
│  - live preview                     │
└─────────────┬───────────────────────┘
              │ invoke commands
┌─────────────▼───────────────────────┐
│  Backend: print Tauri commands      │
│  - list_printers                    │
│  - print_document                   │
│  - print_to_pdf                     │
└─────────────┬───────────────────────┘
              │ generate temp PDF
┌─────────────▼───────────────────────┐
│  PDF pipeline (lopdf)               │
│  - page range filter                │
│  - rotate / scale for orientation   │
│  - apply margins                    │
│  - grayscale conversion             │
└─────────────┬───────────────────────┘
              │ submit job
┌─────────────▼───────────────────────┐
│  Native print layer                 │
│  - Linux/macOS: CUPS via printers   │
│  - Windows: open PDF in default     │
│    viewer for manual printing       │
└─────────────────────────────────────┘
```

### Frontend

- Add a new `PrintDialog` component invoked from the File → Print menu. Keep `src/viewer/PrintSurface.tsx` and `src/pdf/usePrintJobs.ts` for the "Use System Print Dialog" legacy fallback.
- The dialog fetches the printer list on open and shows a default printer.
- Controls:
  - **Printer**: dropdown of system printers + default printer marker.
  - **Pages**: all / current / range (e.g. `1-3,5`).
  - **Copies**: number input.
  - **Orientation**: portrait / landscape.
  - **Paper size**: A4, Letter, Legal, etc.
  - **Scaling**: none / fit to page.
  - **Margins**: default / none / custom (top/right/bottom/left).
  - **Color**: color / grayscale.
  - **Duplex**: simplex / long-edge / short-edge.
- **Preview pane**: renders the first page (and optionally a second for duplex/spread) from a generated *preview* PDF that applies the same layout transformations as the final print (margins, scaling, orientation, grayscale). This is returned as image bytes by a new `render_print_preview(source_path, page_index, opts, width, height)` command so the preview matches the printed output.
- **Actions**: Print, Save as PDF, Use System Print Dialog, Cancel.
- Errors are surfaced inline or in a toast.
- "Use System Print Dialog" keeps the existing `window.print()` path via `usePrintJobs`/`PrintSurface` as a legacy fallback.

### Backend

New Rust module `src-tauri/src/pdf/print.rs` and commands in `src-tauri/src/commands/wrappers_*.inc.rs`:

- `list_printers() -> Vec<PrinterInfo>`
  - Wrap the `printers` crate's `get_printers()`.
  - Return `system_name` (stable spooler identifier used for submission), `display_name` (human-readable label), default flag, and driver info.
- `print_document(source_path: String, opts: PrintOptions) -> Result<PrintDocumentResult, String>`
  - Validate that `printer_name`, `copies`, and `duplex` are present.
  - Generate a print-ready temporary PDF from `source_path`.
  - On Linux/macOS: submit it directly to the selected CUPS printer, delete the temp file, and return `PrintDocumentResult::DirectJob { job_id }`.
  - On Windows: open the temp PDF in the default PDF viewer with `ShellExecuteExW` and return `PrintDocumentResult::WindowsFallback { temp_path }`. The user prints manually from the viewer. The temp file is written to a dedicated print temp directory; on app startup, delete any files in that directory older than 24 hours.
- `print_to_pdf(source_path: String, opts: PrintOptions, output_path: String) -> Result<(), String>`
  - Generate the same print-ready PDF from `source_path` and move it to the user-selected path. Job-specific fields in `opts` are ignored.
- `render_print_preview(source_path: String, page_index: u32, opts: PrintOptions, width: i32, height: i32) -> Result<Vec<u8>, String>`
  - Generate a one-page print-ready PDF using the same pipeline as `print_document`, then render it to PNG bytes via PDFium so the preview matches the printed layout. Job-specific fields in `opts` are ignored.

`PrintOptions`:

```rust
struct PrintOptions {
    page_range: Option<String>,
    orientation: Orientation,      // Portrait | Landscape
    paper_size: PaperSize,         // A4 | Letter | Legal | ...
    scaling: Scaling,              // None | FitToPage
    margins: Margins,              // Default | None | Custom { top, right, bottom, left }
    color_mode: ColorMode,         // Color | Grayscale
    // Job-specific fields; None when only generating a PDF or preview.
    printer_name: Option<String>,
    copies: Option<u32>,
    duplex: Option<Duplex>,        // Simplex | LongEdge | ShortEdge
}

#[derive(Serialize)]
#[serde(tag = "kind", content = "data")]
enum PrintDocumentResult {
    DirectJob { job_id: u64 },
    WindowsFallback { temp_path: String },
}
```

### PDF generation

Use `lopdf` to build the print-ready PDF:

1. Load the source document into a working copy.
2. Apply any unapplied redaction annotations first, replacing affected page regions with rasterized redacted images, so covered text cannot leak into the print/saved PDF.
3. Filter pages by range.
4. Flatten remaining annotation and form-widget appearances into each page's content stream so printed output includes highlights, stamps, and filled form values. Preserve the original `/Annots` only when required for interactive output; for print, render them into the content stream.
5. For each selected page:
   - Determine target dimensions from paper size and orientation.
   - Create a new content stream that scales/rotates/translates the original page content to fit the target, respecting scaling and margin options.
   - If grayscale, convert drawing operations to grayscale and rewrite color image XObjects/shadings to grayscale. If a page contains non-convertible color content, rasterize that page at high DPI and embed the grayscale image instead.
6. Write the result to a temporary file.

Existing helpers in `src-tauri/src/pdf/page_ops.rs`, `coords.rs`, and `content.rs` should be reused where possible.

### Native printing

Use the [`printers`](https://crates.io/crates/printers) crate (MIT license, CUPS on Unix, winspool on Windows):

- `printers::get_printers()` for discovery on all platforms.
- **Linux/macOS**: submit the generated PDF with `printer.print_file(path, options)`. CUPS accepts PDF directly and honors options passed as `raw_properties`.
- **Windows**: the `printers` crate writes RAW bytes to winspool, which most Windows drivers cannot interpret as PDF, and it only parses `copies` and `document-format` from `raw_properties` (orientation, duplex, and media are ignored). Therefore on Windows the generated PDF is opened in the default PDF viewer via `ShellExecuteExW` and the user prints manually from there. Layout options are baked into the PDF; printer-specific options are set by the user in the viewer's print dialog.
- Pass paper size as `media` (e.g. `A4`, `Letter`), `copies`, duplex (`sides=one-sided`, `two-sided-long-edge`, `two-sided-short-edge`), and job name through the crate's `PrinterJobOptions::raw_properties`.

If the `printers` crate fails on Linux/macOS, the dialog falls back to "Save as PDF" plus the legacy system print dialog.

### Error handling

- No printers found: show message + Save as PDF.
- Selected printer unavailable: show error, allow retry or pick another.
- PDF generation fails: surface the Rust error in the dialog.
- Print job submission fails: surface error, keep dialog open.
- Save as PDF cancelled: no-op.

### Testing

- Unit tests for page-range parsing and PDF transformation math in `src-tauri/src/main_tests.rs`.
- Manual QA on Linux, macOS, and Windows with a real or PDF printer.
- E2E smoke test that the dialog opens and `list_printers` returns a non-error result.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Windows can't receive raw PDF via `printers` crate | On Windows, generate a layout-correct PDF and open it in the default PDF viewer for manual printing. |
| Grayscale vector conversion is hard | Rasterize preview; for output, prefer vector but fall back to high-DPI raster if needed. |
| Paper sizes vary by locale | Default to A4 or Letter based on system locale; allow override. |
| Large documents slow PDF generation | Show progress indicator; cap preview to first 2 pages. |
| Windows viewer may ignore in-app duplex/copies choices | Layout options are baked into the PDF; printer-specific options are set in the viewer's print dialog. |
| Temp PDFs consumed by external viewer | Keep temp files for 24 hours; clean on app startup. |

## Open questions

- Should the dialog remember the last used printer/options? (Recommended: yes, persist to `localStorage`.)
- Should "current page" be a range option? (Recommended: yes.)
- Should we expose printer-specific options like tray/media type? (Recommended: no in v1.)
