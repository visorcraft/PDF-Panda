#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod licenses;
mod pdf;

use pdf::bookmarks::{collect_outline_items, flat_outline_ids, remove_outline_item, PdfBookmarkEntry};
use pdf::content::append_page_content;
use pdf::coords::page_media_box;
use pdf::crop::apply_crop_margins;
use pdf::export::{validate_page_range, write_image_output as write_png_output, ExportImageKind, ParityPageRenderFn};
use pdf::fonts::dedup_fonts_after_insert;
use pdf::form_merge::merge_acroform_after_insert;
use pdf::history::HistorySnapshot;
use pdf::import::import_object;
use pdf::markdown::MarkdownSaveResult;
use pdf::markdown_images::MarkdownImageSink;
use pdf::markdown_pipeline::{pdf_plain_text_pages, pdf_to_markdown};
use pdf::metadata::{current_pdf_mod_date, ensure_info_dict_id, read_info_string, write_info_text_field};
use pdf::ocr::{
    build_tesseract_install_guide, OcrExportStats, OcrStatus, TesseractInstallGuide, OCR_RENDER_H, OCR_RENDER_W,
};
#[cfg(test)]
use pdf::ocr::{ocr_page_segmentation_mode, os_release_value};
use pdf::page_decor::build_page_border_ops;
use pdf::page_decor::{append_outline_item, build_page_number_ops, build_watermark_ops, create_blank_page};
use pdf::page_margins::{apply_expand_margins, apply_shrink_margins, page_size_preset_dims};
use pdf::page_sizes::PdfPageSize;
use pdf::page_text::{ensure_helvetica_font, viewer_point_to_pdf};
use pdf::page_tree::{flatten_pages, get_pages_kids, set_pages_kids};
use pdf::pdfium_bind::{
    get_pdfium, render_page_bmp, render_page_gif, render_page_ico, render_page_image, render_page_jpeg,
    render_page_png, render_page_ppm, render_page_tga, render_page_tiff, render_page_webp, set_bundled_pdfium_dir,
};
use pdf::rotation::{page_rotation, reset_page_rotation_at, rotate_all_pages_by, rotate_page_at, set_page_rotation};
use pdf::search::{search_pdf_text as search_pdf_text_impl, PdfTextSearchMatch};
use pdf::security::{PdfSignatureInfo, PdfSignatureVerificationSummary};
use pdf::summary::{PdfSummaryResult, SummarySaveResult};

use lopdf::{Document, Object, ObjectId};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::process::Command;

include!("commands/types.inc.rs");
include!("commands/wrappers_render.inc.rs");
include!("commands/wrappers_page.inc.rs");

// COMMANDS_EXPORT_INCLUDE
include!("commands_export.inc.rs");
// END_COMMANDS_EXPORT_INCLUDE

// PARITY_DOCMOD_INCLUDE
include!("parity_docmod_generated.inc.rs");
// END_PARITY_DOCMOD_INCLUDE
// PARITY_BATCH_INCLUDE
include!("parity_batch_generated.inc.rs");
// END_PARITY_BATCH_INCLUDE
// PARITY_BATCH2_INCLUDE
include!("parity_batch2_generated.inc.rs");
// END_PARITY_BATCH2_INCLUDE
// PARITY_BATCH3_INCLUDE
include!("parity_batch3_generated.inc.rs");
// END_PARITY_BATCH3_INCLUDE
// PARITY_BATCH4_INCLUDE
include!("parity_batch4_generated.inc.rs");
// END_PARITY_BATCH4_INCLUDE
// PARITY_BATCH5_INCLUDE
include!("parity_batch5_generated.inc.rs");
// END_PARITY_BATCH5_INCLUDE
// PARITY_BATCH6_INCLUDE
include!("parity_batch6_generated.inc.rs");
// END_PARITY_BATCH6_INCLUDE
// PARITY_BATCH7_INCLUDE
include!("parity_batch7_generated.inc.rs");
// END_PARITY_BATCH7_INCLUDE
// PARITY_BATCH8_INCLUDE
include!("parity_batch8_generated.inc.rs");
// END_PARITY_BATCH8_INCLUDE

include!("commands/wrappers_doc.inc.rs");
include!("commands/wrappers_annot.inc.rs");

fn main() {
    // webkit2gtk's DMABUF renderer aborts with `Gdk Error 71 (Protocol error)
    // dispatching to Wayland display` on some Wayland + GPU-driver combinations
    // (notably bleeding-edge multi-GPU NVIDIA + mesa stacks, where the cross-GPU
    // zero-copy buffer handoff to the compositor fails). Disabling it falls back
    // to the SHM presentation path — GPU compositing is still used, so the app
    // stays hardware-accelerated; only the zero-copy presentation is given up.
    // Must run before GTK/WebKit initialise. A value set by the user always
    // wins. Drop when webkit2gtk-4.1 ships a working DMABUF renderer here.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: single-threaded at the very start of main(), before the
        // Tauri/GTK builder or any other thread reads the environment. `unsafe`
        // is a no-op before edition 2024 (hence `allow(unused_unsafe)`) but
        // keeps the call correct after an edition bump.
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    #[cfg(feature = "wdio")]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    #[cfg(not(feature = "wdio"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            // In a packaged build, PDFium ships under the app's resource
            // directory; record it so the loader can find it at runtime.
            use tauri::Manager;
            if let Ok(resources) = app.path().resource_dir() {
                set_bundled_pdfium_dir(resources.join("vendor").join("pdfium"));
            }
            Ok(())
        })
        .invoke_handler(include!("commands/invoke_handler.inc.rs"))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
