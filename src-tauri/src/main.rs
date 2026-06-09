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

#[tauri::command]
fn get_pdf_page_count(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(&path, None).map_err(|e| e.to_string())?;
    Ok(document.pages().len() as u32)
}

/// Return the PDF outline/bookmark tree as a flat, depth-indented list.
#[tauri::command]
fn get_pdf_bookmarks(path: String) -> Result<Vec<PdfBookmarkEntry>, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let catalog = doc.catalog().map_err(|e| e.to_string())?;
    let outlines_id = match catalog.get(b"Outlines") {
        Ok(Object::Reference(id)) => *id,
        _ => return Ok(Vec::new()),
    };
    let outlines = doc.get_dictionary(outlines_id).map_err(|e| e.to_string())?;
    let first_id = match outlines.get(b"First") {
        Ok(Object::Reference(id)) => *id,
        _ => return Ok(Vec::new()),
    };
    let mut entries = Vec::new();
    collect_outline_items(&doc, first_id, 0, &mut entries);
    Ok(entries)
}

#[derive(Debug, Clone, Serialize)]
struct PdfDocumentMetadata {
    title: Option<String>,
    author: Option<String>,
    subject: Option<String>,
    keywords: Option<String>,
    creator: Option<String>,
    producer: Option<String>,
    creation_date: Option<String>,
    mod_date: Option<String>,
}

/// Read document Info dictionary metadata from a PDF.
#[tauri::command]
fn get_pdf_metadata(path: String) -> Result<PdfDocumentMetadata, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    Ok(PdfDocumentMetadata {
        title: read_info_string(&doc, b"Title"),
        author: read_info_string(&doc, b"Author"),
        subject: read_info_string(&doc, b"Subject"),
        keywords: read_info_string(&doc, b"Keywords"),
        creator: read_info_string(&doc, b"Creator"),
        producer: read_info_string(&doc, b"Producer"),
        creation_date: read_info_string(&doc, b"CreationDate"),
        mod_date: read_info_string(&doc, b"ModDate"),
    })
}

/// Update document Info dictionary metadata in the working copy.
#[tauri::command]
fn set_pdf_metadata(
    path: String,
    title: Option<String>,
    author: Option<String>,
    subject: Option<String>,
    keywords: Option<String>,
    creator: Option<String>,
    producer: Option<String>,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        return Err("Cannot edit metadata on an encrypted PDF".to_string());
    }
    let info_id = ensure_info_dict_id(&mut doc)?;
    let needs_creation_date = read_info_string(&doc, b"CreationDate").is_none();
    let mod_date = current_pdf_mod_date();
    let dict = doc.get_dictionary_mut(info_id).map_err(|e| e.to_string())?;
    write_info_text_field(dict, b"Title", title);
    write_info_text_field(dict, b"Author", author);
    write_info_text_field(dict, b"Subject", subject);
    write_info_text_field(dict, b"Keywords", keywords);
    write_info_text_field(dict, b"Creator", creator);
    write_info_text_field(dict, b"Producer", producer);
    if needs_creation_date {
        dict.set(b"CreationDate", Object::String(mod_date.clone().into_bytes(), lopdf::StringFormat::Literal));
    }
    dict.set(b"ModDate", Object::String(mod_date.into_bytes(), lopdf::StringFormat::Literal));
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_pdf_browser_entries(path: Option<String>) -> Result<pdf::browser::PdfBrowserListing, String> {
    let dir = path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(pdf::browser::default_browser_dir);
    let dir = if dir.is_file() {
        dir.parent().map(Path::to_path_buf).unwrap_or_else(pdf::browser::default_browser_dir)
    } else {
        dir
    };
    pdf::browser::list_pdf_entries_for_dir(&dir)
}

#[tauri::command]
fn render_pdf_page(path: String, page_index: u32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    render_page_image(&PathBuf::from(path), page_index, width, height, image::ImageFormat::Png)
}

#[tauri::command]
fn ocr_available() -> bool {
    pdf::ocr::ocr_available()
}

#[tauri::command]
fn tesseract_install_guide() -> TesseractInstallGuide {
    build_tesseract_install_guide()
}

#[tauri::command]
fn ocr_status() -> OcrStatus {
    pdf::ocr::ocr_status()
}

/// OCR a single rendered PDF page (for scanned documents without a text layer).
#[tauri::command]
fn ocr_pdf_page(path: String, page: u32) -> Result<String, String> {
    let path = PathBuf::from(path);
    let png = render_page_image(&path, page, OCR_RENDER_W, OCR_RENDER_H, image::ImageFormat::Png)?;
    pdf::ocr::ocr_pdf_page_from_png(&png)
}

/// Find all occurrences of `query` in the PDF using PDFium's text layer.
#[tauri::command]
fn search_pdf_text(
    path: String,
    query: String,
    match_case: bool,
    match_whole_word: bool,
) -> Result<Vec<PdfTextSearchMatch>, String> {
    let pdfium = get_pdfium()?;
    search_pdf_text_impl(&pdfium, &PathBuf::from(path), &query, match_case, match_whole_word)
}

const EXPORT_PNG_W: i32 = pdf::export::EXPORT_RENDER_W;
const EXPORT_PNG_H: i32 = pdf::export::EXPORT_RENDER_H;

#[tauri::command]
fn get_pdf_thumbnails(path: String, width: i32, height: i32) -> Result<Vec<Vec<u8>>, String> {
    let path = PathBuf::from(path);
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(&path, None).map_err(|e| e.to_string())?;
    let page_count = document.pages().len();
    let mut thumbnails = Vec::with_capacity(page_count as usize);

    for i in 0..page_count {
        let page = document.pages().get(i as PdfPageIndex).map_err(|e| e.to_string())?;
        let bitmap = page.render(width as Pixels, height as Pixels, None).map_err(|e| e.to_string())?;

        let image = bitmap.as_image().map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png).map_err(|e| e.to_string())?;
        thumbnails.push(buffer);
    }

    Ok(thumbnails)
}

/// Deep-copy object `id` (and everything it transitively references) from `src`
/// into `dst` with a fresh id, remapping references. `remap` dedupes shared
/// resources and terminates reference cycles. Page dicts encountered anywhere are
/// detached from the source tree (see `import_page_dict`) so we never drag the
/// whole page tree across.

#[tauri::command]
fn delete_page(path: String, page_index: u32) -> Result<(), String> {
    pdf::page_ops::delete_page(&PathBuf::from(path), page_index)
}

#[tauri::command]
fn move_page(path: String, from_index: u32, to_index: u32) -> Result<(), String> {
    pdf::page_ops::move_page(&PathBuf::from(path), from_index, to_index)
}

/// Deep-copy `page_index` and insert the copy immediately after it.
#[tauri::command]
fn duplicate_page(path: String, page_index: u32) -> Result<u32, String> {
    pdf::page_ops::duplicate_page(&PathBuf::from(&path), page_index)
}

/// Append pages from `merge_path` to the end of `path`.
#[tauri::command]
fn merge_pdf(path: String, merge_path: String, merge_start: u32, merge_end: u32) -> Result<u32, String> {
    pdf::page_ops::merge_pdf(&PathBuf::from(&path), &PathBuf::from(&merge_path), merge_start, merge_end)
}

#[tauri::command]
fn rotate_page(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| {
        rotate_page_at(doc, page_index, 90)?;
        Ok(())
    })
}

/// Rotate every page in the document 90° clockwise.
#[tauri::command]
fn rotate_all_pages(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| rotate_all_pages_by(doc, 90))
}

/// Reverse the document page order.
#[tauri::command]
fn reverse_pages(path: String) -> Result<(), String> {
    pdf::page_ops::reverse_pages(&PathBuf::from(path))
}

/// Insert a blank page before `at_index` (0 = first page).
#[tauri::command]
fn add_blank_page(path: String, at_index: u32) -> Result<u32, String> {
    pdf::page_ops::add_blank_page(&PathBuf::from(path), at_index)
}

/// Delete `start_page`..=`end_page` (inclusive, 0-based). At least one page must remain.
#[tauri::command]
fn delete_page_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_ops::delete_page_range(&PathBuf::from(path), start_page, end_page)
}

/// Append a bookmark pointing at `page_index`.
#[tauri::command]
fn add_pdf_bookmark(path: String, title: String, page_index: u32) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Bookmark title cannot be empty".to_string());
    }
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or_else(|| "Page not found".to_string())?;
    append_outline_item(&mut doc, title, page_id)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Stamp page numbers on the footer of each page in the range (1-based labels).
#[tauri::command]
fn add_page_numbers(path: String, start_page: u32, end_page: u32, prefix: Option<String>) -> Result<u32, String> {
    pdf::page_decor::add_page_numbers(&PathBuf::from(path), start_page, end_page, prefix)
}

/// Add a diagonal text watermark to each page in the range.
#[tauri::command]
fn add_text_watermark(path: String, text: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_decor::add_text_watermark(&PathBuf::from(path), &text, start_page, end_page)
}

/// Remove all annotation dictionaries from pages in the range (flatten markup).
#[tauri::command]
fn flatten_annotations(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_decor::flatten_annotations(&PathBuf::from(path), start_page, end_page)
}

/// Crop `page_index` by viewer-pixel margins (top/right/bottom/left).
#[tauri::command]
fn crop_page(
    path: String,
    page_index: u32,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<(), String> {
    pdf::crop::crop_page(&PathBuf::from(path), page_index, margin_top, margin_right, margin_bottom, margin_left)
}

/// Rotate `page_index` 90° counter-clockwise.
#[tauri::command]
fn rotate_page_ccw(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| {
        rotate_page_at(doc, page_index, 270)?;
        Ok(())
    })
}

/// Clear rotation on `page_index`.
#[tauri::command]
fn reset_page_rotation(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| {
        reset_page_rotation_at(doc, page_index)?;
        Ok(())
    })
}

/// Clear rotation on every page.
#[tauri::command]
fn reset_all_page_rotations(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, pdf::rotation::reset_all_page_rotations)
}

/// Deep-copy `start_page`..=`end_page` and insert the copies immediately after the range.
#[tauri::command]
fn duplicate_page_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_ops::duplicate_page_range(&PathBuf::from(&path), start_page, end_page)
}

/// Remove a bookmark by flat index (same order as `get_pdf_bookmarks`).
#[tauri::command]
fn remove_pdf_bookmark(path: String, bookmark_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let catalog = doc.catalog().map_err(|e| e.to_string())?;
    let outlines_id = catalog
        .get(b"Outlines")
        .map_err(|_| "No bookmarks in this PDF".to_string())?
        .as_reference()
        .map_err(|_| "Bad Outlines".to_string())?;
    let ids = flat_outline_ids(&doc)?;
    let idx = bookmark_index as usize;
    if idx >= ids.len() {
        return Err("Bookmark index out of bounds".to_string());
    }
    remove_outline_item(&mut doc, outlines_id, ids[idx])?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Rename a bookmark by flat index (same order as `get_pdf_bookmarks`).
#[tauri::command]
fn rename_pdf_bookmark(path: String, bookmark_index: u32, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Bookmark title cannot be empty".to_string());
    }
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let ids = flat_outline_ids(&doc)?;
    let idx = bookmark_index as usize;
    if idx >= ids.len() {
        return Err("Bookmark index out of bounds".to_string());
    }
    doc.get_dictionary_mut(ids[idx])
        .map_err(|e| e.to_string())?
        .set("Title", Object::String(title.as_bytes().to_vec(), lopdf::StringFormat::Literal));
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return MediaBox width/height (points) and rotation for every page.
#[tauri::command]
fn get_pdf_page_sizes(path: String) -> Result<Vec<PdfPageSize>, String> {
    pdf::page_sizes::get_pdf_page_sizes(&PathBuf::from(path))
}

/// Remove `/CropBox` from `page_index`.
#[tauri::command]
fn clear_page_crop(path: String, page_index: u32) -> Result<(), String> {
    pdf::crop::clear_page_crop(&PathBuf::from(path), page_index)
}

/// Apply the same viewer-pixel crop margins to every page.
#[tauri::command]
fn crop_all_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::crop::crop_all_pages(&PathBuf::from(path), margin_top, margin_right, margin_bottom, margin_left)
}

/// Rotate `page_index` 180°.
#[tauri::command]
fn rotate_page_180(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| {
        rotate_page_at(doc, page_index, 180)?;
        Ok(())
    })
}

/// Rotate every page 90° counter-clockwise.
#[tauri::command]
fn rotate_all_pages_ccw(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    pdf::io::mutate_pdf(&path, |doc| rotate_all_pages_by(doc, 270))
}

/// Move `page_index` to the first position.
#[tauri::command]
fn move_page_to_first(path: String, page_index: u32) -> Result<(), String> {
    pdf::page_ops::move_page_to_first(&PathBuf::from(path), page_index)
}

/// Move `page_index` to the last position.
#[tauri::command]
fn move_page_to_last(path: String, page_index: u32) -> Result<(), String> {
    pdf::page_ops::move_page_to_last(&PathBuf::from(path), page_index)
}

/// Remove `/CropBox` from every page.
#[tauri::command]
fn clear_all_page_crops(path: String) -> Result<u32, String> {
    pdf::crop::clear_all_page_crops(&PathBuf::from(path))
}

/// Remove every PDF outline/bookmark entry.
#[tauri::command]
fn clear_pdf_bookmarks(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let catalog_id = doc.trailer.get(b"Root").map_err(|e| e.to_string())?.as_reference().map_err(|_| "Bad Root")?;
    let outlines_id = match doc.get_dictionary(catalog_id).map_err(|e| e.to_string())?.get(b"Outlines") {
        Ok(Object::Reference(id)) => *id,
        _ => return Ok(0),
    };
    let ids = flat_outline_ids(&doc)?;
    let count = ids.len() as u32;
    for id in ids {
        doc.objects.remove(&id);
    }
    doc.objects.remove(&outlines_id);
    doc.get_dictionary_mut(catalog_id).map_err(|e| e.to_string())?.remove(b"Outlines");
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(count)
}

/// Stamp header text near the top of each page in the range.
#[tauri::command]
fn add_page_header(path: String, start_page: u32, end_page: u32, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_header(&PathBuf::from(path), start_page, end_page, &text)
}

/// Stamp footer text near the bottom of each page in the range.
#[tauri::command]
fn add_page_footer(path: String, start_page: u32, end_page: u32, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_footer(&PathBuf::from(&path), start_page, end_page, &text)
}

/// Swap two pages by 0-based index.
#[tauri::command]
fn swap_pages(path: String, page_index_a: u32, page_index_b: u32) -> Result<(), String> {
    if page_index_a == page_index_b {
        return Ok(());
    }
    let path_buf = PathBuf::from(&path);
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (mut kids, _) = get_pages_kids(&doc)?;
    let a = page_index_a as usize;
    let b = page_index_b as usize;
    if a >= kids.len() || b >= kids.len() {
        return Err("Page index out of bounds".to_string());
    }
    kids.swap(a, b);
    set_pages_kids(&mut doc, pages_ref, kids)?;
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move `page_index` one position earlier (toward the first page).
#[tauri::command]
fn move_page_up(path: String, page_index: u32) -> Result<(), String> {
    if page_index == 0 {
        return Err("Page is already first".to_string());
    }
    move_page(path, page_index, page_index - 1)
}

/// Move `page_index` one position later (toward the last page).
#[tauri::command]
fn move_page_down(path: String, page_index: u32) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let last = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if last == 0 {
        return Err("Document has no pages".to_string());
    }
    if page_index + 1 >= last {
        return Err("Page is already last".to_string());
    }
    move_page(path, page_index, page_index + 1)
}

/// Replace `page_index` with a deep-copied page from `source_path`.
#[tauri::command]
fn replace_page(path: String, page_index: u32, source_path: String, source_page_index: u32) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let source_path_buf = PathBuf::from(&source_path);
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let source_doc = Document::load(&source_path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (mut kids, _) = get_pages_kids(&doc)?;
    let idx = page_index as usize;
    if idx >= kids.len() {
        return Err("Page index out of bounds".to_string());
    }
    let source_pages: Vec<ObjectId> = source_doc.get_pages().into_values().collect();
    let src_idx = source_page_index as usize;
    if src_idx >= source_pages.len() {
        return Err("Source page index out of bounds".to_string());
    }
    let mut remap = BTreeMap::new();
    let new_page_id = import_object(&mut doc, &source_doc, source_pages[src_idx], pages_ref, &mut remap);
    kids[idx] = Object::Reference(new_page_id);
    set_pages_kids(&mut doc, pages_ref, kids)?;
    merge_acroform_after_insert(&mut doc, &source_doc, &[new_page_id], &remap)?;
    dedup_fonts_after_insert(&mut doc, &[new_page_id])?;
    doc.prune_objects();
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok(())
}

/// Interleave pages from `other_path` after each page of `path` (A0, B0, A1, B1, …).
#[tauri::command]
fn interleave_pdf(path: String, other_path: String, other_start: u32, other_end: u32) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let other_path_buf = PathBuf::from(&other_path);
    if path_buf == other_path_buf {
        return Err("Cannot interleave a PDF with itself".to_string());
    }
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let other_doc = Document::load(&other_path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (dest_kids, _) = get_pages_kids(&doc)?;
    let other_pages: Vec<ObjectId> = other_doc.get_pages().into_values().collect();
    let start = other_start as usize;
    let end = other_end as usize;
    if start > end || end >= other_pages.len() {
        return Err("Invalid interleave page range".to_string());
    }
    let mut remap = BTreeMap::new();
    let other_imported: Vec<ObjectId> = other_pages[start..=end]
        .iter()
        .map(|&src_page| import_object(&mut doc, &other_doc, src_page, pages_ref, &mut remap))
        .collect();
    let dest_len = dest_kids.len();
    let other_len = other_imported.len();
    let max_len = dest_len.max(other_len);
    let mut new_kids = Vec::with_capacity(dest_len + other_len);
    for i in 0..max_len {
        if i < dest_len {
            new_kids.push(dest_kids[i].clone());
        }
        if i < other_len {
            new_kids.push(Object::Reference(other_imported[i]));
        }
    }
    set_pages_kids(&mut doc, pages_ref, new_kids)?;
    merge_acroform_after_insert(&mut doc, &other_doc, &other_imported, &remap)?;
    dedup_fonts_after_insert(&mut doc, &other_imported)?;
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok(other_len as u32)
}

/// Split the document into odd-indexed and even-indexed page files.
#[tauri::command]
fn split_odd_even_pages(path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let (all_kids, pages_ref) = get_pages_kids(&doc)?;
    if all_kids.len() < 2 {
        return Err("Need at least 2 pages to split odd/even".to_string());
    }
    let odd_kids: Vec<Object> =
        all_kids.iter().enumerate().filter(|(i, _)| i % 2 == 0).map(|(_, k)| k.clone()).collect();
    let even_kids: Vec<Object> =
        all_kids.iter().enumerate().filter(|(i, _)| i % 2 == 1).map(|(_, k)| k.clone()).collect();
    let stem = path.file_stem().unwrap().to_string_lossy();
    let mut output_paths = Vec::new();
    for (suffix, kids) in [("_odd", odd_kids), ("_even", even_kids)] {
        let mut part = Document::load(&path).map_err(|e| e.to_string())?;
        set_pages_kids(&mut part, pages_ref, kids)?;
        part.prune_objects();
        let output_path = path.with_file_name(format!("{stem}{suffix}.pdf"));
        part.save(&output_path).map_err(|e| e.to_string())?;
        output_paths.push(output_path.to_string_lossy().into_owned());
    }
    Ok(output_paths)
}

/// Deep-copy every page and append the copies to the end of the document.
#[tauri::command]
fn duplicate_all_pages(path: String) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if total == 0 {
        return Err("Document has no pages".to_string());
    }
    duplicate_page_range(path, 0, total - 1)
}

/// Set `/MediaBox` on each page in the range to a standard paper size (points).
#[tauri::command]
fn set_page_size(path: String, start_page: u32, end_page: u32, preset: String) -> Result<u32, String> {
    pdf::page_margins::set_page_size(&PathBuf::from(&path), start_page, end_page, &preset)
}

/// Write a decrypted sibling `<stem>_decrypted.pdf` next to an encrypted `path`.
#[tauri::command]
fn remove_pdf_password(path: String, password: String) -> Result<String, String> {
    pdf::security::remove_pdf_password(path, password)
}

/// Export each page in the range as a separate single-page PDF in `output_dir`.
#[tauri::command]
fn export_pdf_pages_as_pdf(
    path: String,
    start_page: u32,
    end_page: u32,
    output_dir: String,
) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    if !path.is_file() {
        return Err("File not found".to_string());
    }
    validate_page_range(&path, start_page, end_page)?;
    let output_dir = PathBuf::from(&output_dir);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let mut written = Vec::new();
    for page_index in start_page..=end_page {
        let file_name = format!("page-{:03}.pdf", page_index + 1);
        let output_path = output_dir.join(&file_name);
        let out = extract_pdf_pages(
            path.to_string_lossy().into_owned(),
            output_path.to_string_lossy().into_owned(),
            page_index,
            page_index,
        )?;
        written.push(out);
    }
    Ok(written)
}

/// Rotate every page in `start_page`..=`end_page` 90° clockwise.
#[tauri::command]
fn rotate_page_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let mut rotated = 0u32;
    for page_index in start_page..=end_page {
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current + 90)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Rotate every page in `start_page`..=`end_page` 90° counter-clockwise.
#[tauri::command]
fn rotate_page_range_ccw(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let mut rotated = 0u32;
    for page_index in start_page..=end_page {
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current - 90)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Delete every page outside `start_page`..=`end_page` (at least one page must remain).
#[tauri::command]
fn keep_page_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (kids, _) = get_pages_kids(&doc)?;
    let total = kids.len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let kept: Vec<Object> = kids[start_page as usize..=end_page as usize].to_vec();
    if kept.is_empty() {
        return Err("Cannot delete every page in the document".to_string());
    }
    let deleted = total - kept.len() as u32;
    set_pages_kids(&mut doc, pages_ref, kept)?;
    doc.prune_objects();
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(deleted)
}

/// Move `start_page`..=`end_page` so the first page lands at `to_index`.
#[tauri::command]
fn move_page_range(path: String, start_page: u32, end_page: u32, to_index: u32) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (mut kids, _) = get_pages_kids(&doc)?;
    let start = start_page as usize;
    let end = end_page as usize;
    if start > end || end >= kids.len() {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let to = to_index as usize;
    if to > kids.len() {
        return Err("Target index out of bounds".to_string());
    }
    let segment: Vec<Object> = kids.drain(start..=end).collect();
    let insert_at = to.min(kids.len());
    for (offset, kid) in segment.into_iter().enumerate() {
        kids.insert(insert_at + offset, kid);
    }
    set_pages_kids(&mut doc, pages_ref, kids)?;
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok(())
}

/// Insert pages from `source_path` at the beginning of `path`.
#[tauri::command]
fn prepend_pdf(path: String, source_path: String, source_start: u32, source_end: u32) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let source_path_buf = PathBuf::from(&source_path);
    if path_buf == source_path_buf {
        return Err("Cannot prepend a PDF into itself".to_string());
    }
    let source_count = Document::load(&source_path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if source_count == 0 {
        return Err("Source PDF has no pages".to_string());
    }
    if source_start > source_end || source_end >= source_count {
        return Err("Invalid source page range".to_string());
    }
    insert_pdf(path, source_path, 0, source_start, source_end)?;
    Ok(source_end - source_start + 1)
}

/// Split the document into consecutive files with at most `pages_per_file` pages each.
#[tauri::command]
fn split_every_n_pages(path: String, pages_per_file: u32) -> Result<Vec<String>, String> {
    if pages_per_file == 0 {
        return Err("Pages per file must be at least 1".to_string());
    }
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if total == 0 {
        return Err("Document has no pages".to_string());
    }
    let mut ranges = Vec::new();
    let mut start = 0u32;
    while start < total {
        let end = (start + pages_per_file - 1).min(total - 1);
        ranges.push((start, end));
        start = end + 1;
    }
    split_pdf(path, ranges)
}

/// Draw a rectangular border inset on each page in the range (viewer pixels).
#[tauri::command]
fn add_page_border(path: String, start_page: u32, end_page: u32, inset: f64) -> Result<u32, String> {
    pdf::page_decor::add_page_border(&PathBuf::from(path), start_page, end_page, inset)
}

/// Append a bookmark for every page using `prefix` + page number.
#[tauri::command]
fn bookmark_all_pages(path: String, prefix: Option<String>) -> Result<u32, String> {
    let prefix = prefix.unwrap_or_else(|| "Page ".to_string());
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for (index, page_id) in page_ids.iter().enumerate() {
        let title = format!("{prefix}{}", index + 1);
        append_outline_item(&mut doc, &title, *page_id)?;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(page_ids.len() as u32)
}

/// Deep-copy `page_index` and move the copy to the last position.
#[tauri::command]
fn duplicate_page_to_end(path: String, page_index: u32) -> Result<u32, String> {
    let new_index = duplicate_page(path.clone(), page_index)?;
    move_page_to_last(path.clone(), new_index)?;
    let path_buf = PathBuf::from(&path);
    Ok(Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32 - 1)
}

/// Expand `/MediaBox` outward by viewer-pixel margins on each page in the range.
#[tauri::command]
fn expand_page_margins(
    path: String,
    start_page: u32,
    end_page: u32,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::page_margins::expand_page_margins(
        &PathBuf::from(path),
        start_page,
        end_page,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Clear `/Rotate` on every page in `start_page`..=`end_page`.
#[tauri::command]
fn reset_rotation_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_range::reset_rotation_range(&PathBuf::from(path), start_page, end_page)
}

/// Rotate every page in `start_page`..=`end_page` by 180°.
#[tauri::command]
fn rotate_page_180_range(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_range::rotate_page_180_range(&PathBuf::from(path), start_page, end_page)
}

/// Reverse page order within `start_page`..=`end_page` only.
#[tauri::command]
fn reverse_page_range(path: String, start_page: u32, end_page: u32) -> Result<(), String> {
    pdf::page_range::reverse_page_range(&PathBuf::from(&path), start_page, end_page)
}

/// Deep-copy `start_page`..=`end_page` and append the copies at the end of the document.
#[tauri::command]
fn duplicate_page_range_to_end(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let path_str = path_buf.to_string_lossy().into_owned();
    insert_pdf(path_str.clone(), path_str, total, start_page, end_page)?;
    Ok(end_page - start_page + 1)
}

/// Insert `count` blank pages starting at `at_index`.
#[tauri::command]
fn insert_blank_pages(path: String, at_index: u32, count: u32) -> Result<u32, String> {
    pdf::page_range::insert_blank_pages(&PathBuf::from(path), at_index, count)
}

/// Apply the same viewer-pixel crop margins to `start_page`..=`end_page`.
#[tauri::command]
fn crop_page_range(
    path: String,
    start_page: u32,
    end_page: u32,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::page_range::crop_page_range(
        &PathBuf::from(path),
        start_page,
        end_page,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Remove all annotation dictionaries from every page in the document.
#[tauri::command]
fn flatten_all_annotations(path: String) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if total == 0 {
        return Ok(0);
    }
    flatten_annotations(path, 0, total - 1)
}

/// Remove document Info/XMP metadata from the working copy.
#[tauri::command]
fn clear_pdf_metadata(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        return Err("Cannot clear metadata on an encrypted PDF".to_string());
    }
    if let Ok(catalog) = doc.catalog_mut() {
        catalog.set(b"Metadata", Object::Null);
    }
    if let Ok(info) = doc.trailer.get_mut(b"Info") {
        *info = Object::Null;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reorder pages by MediaBox area (smallest first unless `descending` is true).
#[tauri::command]
fn sort_pages_by_size(path: String, descending: bool) -> Result<(), String> {
    pdf::page_range::sort_pages_by_size(&PathBuf::from(&path), descending)
}

/// Deep-copy `start_page`..=`end_page` and insert the copies immediately before the range.
#[tauri::command]
fn duplicate_page_range_before(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let count = end_page - start_page + 1;
    let path_str = path_buf.to_string_lossy().into_owned();
    insert_pdf(path_str.clone(), path_str, start_page, start_page, end_page)?;
    Ok(count)
}

/// Shrink `/MediaBox` inward by viewer-pixel margins on each page in the range.
#[tauri::command]
fn shrink_page_margins(
    path: String,
    start_page: u32,
    end_page: u32,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::page_margins::shrink_page_margins(
        &PathBuf::from(path),
        start_page,
        end_page,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Rotate pages 1, 3, 5, … by 90° clockwise.
#[tauri::command]
fn rotate_odd_pages(path: String) -> Result<u32, String> {
    pdf::page_range::rotate_odd_pages(&PathBuf::from(path))
}

/// Rotate pages 2, 4, 6, … by 90° clockwise.
#[tauri::command]
fn rotate_even_pages(path: String) -> Result<u32, String> {
    pdf::page_range::rotate_even_pages(&PathBuf::from(path))
}

/// Delete every `nth` page (1-based: pages n, 2n, 3n, …). Keeps at least one page.
#[tauri::command]
fn delete_every_nth_page(path: String, nth: u32) -> Result<u32, String> {
    pdf::page_range::delete_every_nth_page(&PathBuf::from(&path), nth)
}

/// Move `start_page`..=`end_page` to the beginning of the document.
#[tauri::command]
fn move_page_range_to_start(path: String, start_page: u32, end_page: u32) -> Result<(), String> {
    move_page_range(path, start_page, end_page, 0)
}

/// Move `start_page`..=`end_page` to the end of the document.
#[tauri::command]
fn move_page_range_to_end(path: String, start_page: u32, end_page: u32) -> Result<(), String> {
    pdf::page_range::move_page_range_to_end(&PathBuf::from(&path), start_page, end_page)
}

/// Write odd-indexed pages (1, 3, 5, …) to `output_path` without modifying the source.
#[tauri::command]
fn extract_odd_pages(path: String, output_path: String) -> Result<String, String> {
    pdf::parity_helpers::extract_pages_by_parity(&PathBuf::from(&path), &PathBuf::from(&output_path), true)
}

/// Write even-indexed pages (2, 4, 6, …) to `output_path` without modifying the source.
#[tauri::command]
fn extract_even_pages(path: String, output_path: String) -> Result<String, String> {
    pdf::parity_helpers::extract_pages_by_parity(&PathBuf::from(&path), &PathBuf::from(&output_path), false)
}

/// Deep-copy `page_index` and insert the copy immediately before it.
#[tauri::command]
fn duplicate_page_before(path: String, page_index: u32) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let page_count = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len();
    let idx = page_index as usize;
    if idx >= page_count {
        return Err("Page index out of bounds".to_string());
    }
    let path_str = path_buf.to_string_lossy().into_owned();
    insert_pdf(path_str.clone(), path_str, page_index, page_index, page_index)?;
    Ok(page_index)
}

/// Split into `_part1.pdf` (pages before `at_page`) and `_part2.pdf` (from `at_page` onward).
#[tauri::command]
fn split_pdf_at_page(path: String, at_page: u32) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let (all_kids, pages_ref) = get_pages_kids(&doc)?;
    let total = all_kids.len() as u32;
    if total < 2 {
        return Err("Need at least 2 pages to split".to_string());
    }
    if at_page == 0 || at_page >= total {
        return Err(format!("Split page must be between 2 and {total} (1-based start of the second file)"));
    }
    let part1_kids: Vec<Object> = all_kids[..at_page as usize].to_vec();
    let part2_kids: Vec<Object> = all_kids[at_page as usize..].to_vec();
    let stem = path.file_stem().unwrap().to_string_lossy();
    let mut output_paths = Vec::new();
    for (suffix, kids) in [("_part1", part1_kids), ("_part2", part2_kids)] {
        let mut part = Document::load(&path).map_err(|e| e.to_string())?;
        set_pages_kids(&mut part, pages_ref, kids)?;
        part.prune_objects();
        let output_path = path.with_file_name(format!("{stem}{suffix}.pdf"));
        part.save(&output_path).map_err(|e| e.to_string())?;
        output_paths.push(output_path.to_string_lossy().into_owned());
    }
    Ok(output_paths)
}

/// Rotate pages 1, 3, 5, … by 90° counter-clockwise.
#[tauri::command]
fn rotate_odd_pages_ccw(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut rotated = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 0 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current - 90)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Rotate pages 2, 4, 6, … by 90° counter-clockwise.
#[tauri::command]
fn rotate_even_pages_ccw(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut rotated = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 1 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current - 90)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Clear `/Rotate` on pages 1, 3, 5, ….
#[tauri::command]
fn reset_rotation_odd_pages(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut reset = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 0 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        set_page_rotation(&mut doc, page_id, 0)?;
        reset += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(reset)
}

/// Clear `/Rotate` on pages 2, 4, 6, ….
#[tauri::command]
fn reset_rotation_even_pages(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut reset = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 1 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        set_page_rotation(&mut doc, page_id, 0)?;
        reset += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(reset)
}

/// Delete even-indexed pages; keep pages 1, 3, 5, … only.
#[tauri::command]
fn keep_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::keep_pages_by_parity(&PathBuf::from(&path), true)
}

/// Delete odd-indexed pages; keep pages 2, 4, 6, … only.
#[tauri::command]
fn keep_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::keep_pages_by_parity(&PathBuf::from(&path), false)
}

/// Reorder pages by `/Rotate` value (0° first unless `descending` is true).
#[tauri::command]
fn sort_pages_by_rotation(path: String, descending: bool) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (kids, _) = get_pages_kids(&doc)?;
    let mut indexed: Vec<(usize, i64, Object)> = kids
        .into_iter()
        .enumerate()
        .map(|(i, kid)| {
            let rot = kid.as_reference().ok().map(|id| page_rotation(&doc, id).rem_euclid(360)).unwrap_or(0);
            (i, rot, kid)
        })
        .collect();
    indexed.sort_by(|a, b| {
        let ord = a.1.cmp(&b.1);
        if descending {
            ord.reverse()
        } else {
            ord
        }
    });
    let sorted: Vec<Object> = indexed.into_iter().map(|(_, _, kid)| kid).collect();
    set_pages_kids(&mut doc, pages_ref, sorted)?;
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete pages 1, 3, 5, … (odd-indexed in 1-based terms).
#[tauri::command]
fn delete_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::delete_pages_by_parity(&PathBuf::from(&path), true)
}

/// Delete pages 2, 4, 6, … (even-indexed in 1-based terms).
#[tauri::command]
fn delete_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::delete_pages_by_parity(&PathBuf::from(&path), false)
}

/// Rotate pages 1, 3, 5, … by 180°.
#[tauri::command]
fn rotate_180_odd_pages(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut rotated = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 0 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current + 180)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Rotate pages 2, 4, 6, … by 180°.
#[tauri::command]
fn rotate_180_even_pages(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    let mut rotated = 0u32;
    for page_index in 0..total {
        if page_index % 2 != 1 {
            continue;
        }
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current + 180)?;
        rotated += 1;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(rotated)
}

/// Deep-copy odd-indexed pages and append the copies at the end.
#[tauri::command]
fn duplicate_odd_pages(path: String) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    let indices: Vec<u32> = (0..total).filter(|i| i % 2 == 0).collect();
    if indices.is_empty() {
        return Ok(0);
    }
    let path_str = path_buf.to_string_lossy().into_owned();
    let copied = indices.len() as u32;
    for &idx in &indices {
        let at = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
        insert_pdf(path_str.clone(), path_str.clone(), at, idx, idx)?;
    }
    Ok(copied)
}

/// Deep-copy even-indexed pages and append the copies at the end.
#[tauri::command]
fn duplicate_even_pages(path: String) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let total = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
    let indices: Vec<u32> = (0..total).filter(|i| i % 2 == 1).collect();
    if indices.is_empty() {
        return Ok(0);
    }
    let path_str = path_buf.to_string_lossy().into_owned();
    let copied = indices.len() as u32;
    for &idx in &indices {
        let at = Document::load(&path_buf).map_err(|e| e.to_string())?.get_pages().len() as u32;
        insert_pdf(path_str.clone(), path_str.clone(), at, idx, idx)?;
    }
    Ok(copied)
}

/// Insert one blank page between each consecutive pair of pages.
#[tauri::command]
fn insert_blank_between_pages(path: String) -> Result<u32, String> {
    let path_buf = PathBuf::from(&path);
    let mut doc = Document::load(&path_buf).map_err(|e| e.to_string())?;
    let pages_ref = flatten_pages(&mut doc)?;
    let (kids, _) = get_pages_kids(&doc)?;
    let n = kids.len();
    if n < 2 {
        return Err("Need at least 2 pages to insert blanks between".to_string());
    }
    let mut new_kids = Vec::with_capacity(n + n - 1);
    for (i, kid) in kids.into_iter().enumerate() {
        new_kids.push(kid);
        if i + 1 < n {
            let page_id = create_blank_page(&mut doc, pages_ref);
            new_kids.push(Object::Reference(page_id));
        }
    }
    set_pages_kids(&mut doc, pages_ref, new_kids)?;
    doc.save(&path_buf).map_err(|e| e.to_string())?;
    Ok((n - 1) as u32)
}

/// Remove annotations from odd-indexed pages only.
#[tauri::command]
fn flatten_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::flatten_annotations_by_parity(&PathBuf::from(&path), true)
}

/// Remove annotations from even-indexed pages only.
#[tauri::command]
fn flatten_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::flatten_annotations_by_parity(&PathBuf::from(&path), false)
}

/// Rotate every page by 180°.
#[tauri::command]
fn rotate_all_pages_180(path: String) -> Result<u32, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let total = doc.get_pages().len() as u32;
    for page_index in 0..total {
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
        let current = page_rotation(&doc, page_id);
        set_page_rotation(&mut doc, page_id, current + 180)?;
    }
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(total)
}

/// Apply uniform crop margins to odd-indexed pages (1, 3, 5, …).
#[tauri::command]
fn crop_odd_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::crop_pages_by_parity(
        &PathBuf::from(&path),
        true,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Apply uniform crop margins to even-indexed pages (2, 4, 6, …).
#[tauri::command]
fn crop_even_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::crop_pages_by_parity(
        &PathBuf::from(&path),
        false,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Expand MediaBox outward on odd-indexed pages.
#[tauri::command]
fn expand_odd_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::expand_pages_by_parity(
        &PathBuf::from(&path),
        true,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Expand MediaBox outward on even-indexed pages.
#[tauri::command]
fn expand_even_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::expand_pages_by_parity(
        &PathBuf::from(&path),
        false,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Shrink MediaBox inward on odd-indexed pages.
#[tauri::command]
fn shrink_odd_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::shrink_pages_by_parity(
        &PathBuf::from(&path),
        true,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Shrink MediaBox inward on even-indexed pages.
#[tauri::command]
fn shrink_even_pages(
    path: String,
    margin_top: f64,
    margin_right: f64,
    margin_bottom: f64,
    margin_left: f64,
) -> Result<u32, String> {
    pdf::parity_helpers::shrink_pages_by_parity(
        &PathBuf::from(&path),
        false,
        margin_top,
        margin_right,
        margin_bottom,
        margin_left,
    )
}

/// Reverse order among odd-indexed pages only.
#[tauri::command]
fn reverse_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::reverse_pages_by_parity(&PathBuf::from(&path), true)
}

/// Reverse order among even-indexed pages only.
#[tauri::command]
fn reverse_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::reverse_pages_by_parity(&PathBuf::from(&path), false)
}

/// Move odd-indexed pages to the beginning (even pages follow).
#[tauri::command]
fn move_odd_pages_to_start(path: String) -> Result<(), String> {
    pdf::parity_helpers::move_pages_by_parity_to_start(&PathBuf::from(&path), true)
}

/// Move even-indexed pages to the beginning (odd pages follow).
#[tauri::command]
fn move_even_pages_to_start(path: String) -> Result<(), String> {
    pdf::parity_helpers::move_pages_by_parity_to_start(&PathBuf::from(&path), false)
}

/// Move odd-indexed pages to the end (even pages stay at the start).
#[tauri::command]
fn move_odd_pages_to_end(path: String) -> Result<(), String> {
    pdf::parity_helpers::move_pages_by_parity_to_end(&PathBuf::from(&path), true)
}

/// Move even-indexed pages to the end (odd pages stay at the start).
#[tauri::command]
fn move_even_pages_to_end(path: String) -> Result<(), String> {
    pdf::parity_helpers::move_pages_by_parity_to_end(&PathBuf::from(&path), false)
}

/// Remove `/CropBox` from odd-indexed pages only.
#[tauri::command]
fn clear_crop_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::clear_crop_pages_by_parity(&PathBuf::from(&path), true)
}

/// Remove `/CropBox` from even-indexed pages only.
#[tauri::command]
fn clear_crop_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::clear_crop_pages_by_parity(&PathBuf::from(&path), false)
}

/// Deep-copy odd-indexed pages and insert each copy immediately before the original.
#[tauri::command]
fn duplicate_odd_pages_before(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_before(&PathBuf::from(&path), true)
}

/// Deep-copy even-indexed pages and insert each copy immediately before the original.
#[tauri::command]
fn duplicate_even_pages_before(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_before(&PathBuf::from(&path), false)
}

/// Sort odd-indexed pages by `/Rotate` while leaving even pages in place.
#[tauri::command]
fn sort_odd_pages_by_rotation(path: String, descending: bool) -> Result<u32, String> {
    pdf::parity_helpers::sort_pages_by_parity_rotation(&PathBuf::from(&path), true, descending)
}

/// Sort even-indexed pages by `/Rotate` while leaving odd pages in place.
#[tauri::command]
fn sort_even_pages_by_rotation(path: String, descending: bool) -> Result<u32, String> {
    pdf::parity_helpers::sort_pages_by_parity_rotation(&PathBuf::from(&path), false, descending)
}

/// Sort odd-indexed pages by MediaBox area while leaving even pages in place.
#[tauri::command]
fn sort_odd_pages_by_size(path: String, descending: bool) -> Result<u32, String> {
    pdf::parity_helpers::sort_pages_by_parity_size(&PathBuf::from(&path), true, descending)
}

/// Sort even-indexed pages by MediaBox area while leaving odd pages in place.
#[tauri::command]
fn sort_even_pages_by_size(path: String, descending: bool) -> Result<u32, String> {
    pdf::parity_helpers::sort_pages_by_parity_size(&PathBuf::from(&path), false, descending)
}

/// Stamp footer page numbers on odd-indexed pages only (1, 3, 5…).
#[tauri::command]
fn add_page_numbers_odd_pages(path: String, prefix: Option<String>) -> Result<u32, String> {
    pdf::parity_helpers::add_page_numbers_by_parity(&PathBuf::from(&path), true, prefix)
}

/// Stamp footer page numbers on even-indexed pages only (2, 4, 6…).
#[tauri::command]
fn add_page_numbers_even_pages(path: String, prefix: Option<String>) -> Result<u32, String> {
    pdf::parity_helpers::add_page_numbers_by_parity(&PathBuf::from(&path), false, prefix)
}

/// Add a diagonal watermark to odd-indexed pages only.
#[tauri::command]
fn add_text_watermark_odd_pages(path: String, text: String) -> Result<u32, String> {
    pdf::parity_helpers::add_text_watermark_by_parity(&PathBuf::from(&path), true, &text)
}

/// Add a diagonal watermark to even-indexed pages only.
#[tauri::command]
fn add_text_watermark_even_pages(path: String, text: String) -> Result<u32, String> {
    pdf::parity_helpers::add_text_watermark_by_parity(&PathBuf::from(&path), false, &text)
}

/// Stamp header text on odd-indexed pages only.
#[tauri::command]
fn add_page_header_odd_pages(path: String, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_header_by_parity(&PathBuf::from(&path), true, &text)
}

/// Stamp header text on even-indexed pages only.
#[tauri::command]
fn add_page_header_even_pages(path: String, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_header_by_parity(&PathBuf::from(&path), false, &text)
}

/// Stamp footer text on odd-indexed pages only.
#[tauri::command]
fn add_page_footer_odd_pages(path: String, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_footer_by_parity(&PathBuf::from(&path), true, &text)
}

/// Stamp footer text on even-indexed pages only.
#[tauri::command]
fn add_page_footer_even_pages(path: String, text: String) -> Result<u32, String> {
    pdf::page_decor::add_page_footer_by_parity(&PathBuf::from(&path), false, &text)
}

/// Draw a page border on odd-indexed pages only.
#[tauri::command]
fn add_page_border_odd_pages(path: String, inset: f64) -> Result<u32, String> {
    pdf::page_decor::add_page_border_by_parity(&PathBuf::from(&path), true, inset)
}

/// Draw a page border on even-indexed pages only.
#[tauri::command]
fn add_page_border_even_pages(path: String, inset: f64) -> Result<u32, String> {
    pdf::page_decor::add_page_border_by_parity(&PathBuf::from(&path), false, inset)
}

/// Append outline entries for odd-indexed pages only (1, 3, 5…).
#[tauri::command]
fn bookmark_odd_pages(path: String, prefix: Option<String>) -> Result<u32, String> {
    pdf::parity_helpers::bookmark_pages_by_parity(&PathBuf::from(&path), true, prefix)
}

/// Append outline entries for even-indexed pages only (2, 4, 6…).
#[tauri::command]
fn bookmark_even_pages(path: String, prefix: Option<String>) -> Result<u32, String> {
    pdf::parity_helpers::bookmark_pages_by_parity(&PathBuf::from(&path), false, prefix)
}

/// Set MediaBox preset on odd-indexed pages only.
#[tauri::command]
fn set_page_size_odd_pages(path: String, preset: String) -> Result<u32, String> {
    pdf::page_margins::set_page_size_by_parity(&PathBuf::from(&path), true, &preset)
}

/// Set MediaBox preset on even-indexed pages only.
#[tauri::command]
fn set_page_size_even_pages(path: String, preset: String) -> Result<u32, String> {
    pdf::page_margins::set_page_size_by_parity(&PathBuf::from(&path), false, &preset)
}

/// Insert a blank page before each odd-indexed page.
#[tauri::command]
fn insert_blank_before_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::insert_blank_by_parity(&PathBuf::from(&path), true, false)
}

/// Insert a blank page before each even-indexed page.
#[tauri::command]
fn insert_blank_before_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::insert_blank_by_parity(&PathBuf::from(&path), false, false)
}

/// Insert a blank page after each odd-indexed page.
#[tauri::command]
fn insert_blank_after_odd_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::insert_blank_by_parity(&PathBuf::from(&path), true, true)
}

/// Insert a blank page after each even-indexed page.
#[tauri::command]
fn insert_blank_after_even_pages(path: String) -> Result<u32, String> {
    pdf::parity_helpers::insert_blank_by_parity(&PathBuf::from(&path), false, true)
}

/// Deep-copy each odd-indexed page and move the copy to the document end.
#[tauri::command]
fn duplicate_odd_pages_to_end(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_to_end(&PathBuf::from(&path), true)
}

/// Deep-copy each even-indexed page and move the copy to the document end.
#[tauri::command]
fn duplicate_even_pages_to_end(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_to_end(&PathBuf::from(&path), false)
}

/// Deep-copy each odd-indexed page and insert the copies at the document start.
#[tauri::command]
fn duplicate_odd_pages_to_start(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_to_start(&PathBuf::from(&path), true)
}

/// Deep-copy each even-indexed page and insert the copies at the document start.
#[tauri::command]
fn duplicate_even_pages_to_start(path: String) -> Result<u32, String> {
    pdf::parity_helpers::duplicate_pages_by_parity_to_start(&PathBuf::from(&path), false)
}

/// Export each odd-indexed page as a separate single-page PDF in `output_dir`.
#[tauri::command]
fn export_odd_pages_as_pdf(path: String, output_dir: String) -> Result<Vec<String>, String> {
    pdf::parity_helpers::export_pages_by_parity_as_pdf(&PathBuf::from(&path), &PathBuf::from(&output_dir), true)
}

/// Export each even-indexed page as a separate single-page PDF in `output_dir`.
#[tauri::command]
fn export_even_pages_as_pdf(path: String, output_dir: String) -> Result<Vec<String>, String> {
    pdf::parity_helpers::export_pages_by_parity_as_pdf(&PathBuf::from(&path), &PathBuf::from(&output_dir), false)
}

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

/// Deep-copy `start_page`..=`end_page` and insert the copies at the document start.
#[tauri::command]
fn duplicate_page_range_to_start(path: String, start_page: u32, end_page: u32) -> Result<u32, String> {
    pdf::page_range::duplicate_page_range_to_start(&PathBuf::from(path), start_page, end_page)
}

/// Insert a new page at `at_index` containing a centered copy of `image_path`.
#[tauri::command]
fn insert_image_page(path: String, at_index: u32, image_path: String) -> Result<u32, String> {
    pdf::page_images::insert_image_page(&PathBuf::from(path), at_index, &PathBuf::from(image_path))
}

/// Write a single page from the open PDF to `output_path` (does not modify the source).
#[tauri::command]
fn export_page_as_pdf(path: String, page_index: u32, output_path: String) -> Result<String, String> {
    pdf::page_images::export_page_as_pdf(&PathBuf::from(path), page_index, &PathBuf::from(output_path))
}

#[tauri::command]
fn get_image_dimensions(path: String) -> Result<[u32; 2], String> {
    pdf::page_images::get_image_dimensions(&PathBuf::from(path))
}

#[tauri::command]
fn add_page_image(
    path: String,
    page_index: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    image_path: String,
) -> Result<(), String> {
    pdf::page_images::add_page_image(&PathBuf::from(path), page_index, x, y, width, height, &PathBuf::from(image_path))
}

#[tauri::command]
fn add_page_text(path: String, page_index: u32, x: f64, y: f64, font_size: f64, text: String) -> Result<u32, String> {
    pdf::page_text::add_page_text(&PathBuf::from(path), page_index, x, y, font_size, text)
}

#[tauri::command]
fn list_page_text_edits(path: String, page_index: u32) -> Result<Vec<pdf::page_text::PageTextEdit>, String> {
    pdf::page_text::list_page_text_edits(&PathBuf::from(path), page_index)
}

#[tauri::command]
fn update_page_text(
    path: String,
    page_index: u32,
    index: u32,
    text: String,
    x: Option<f64>,
    y: Option<f64>,
    font_size: Option<f64>,
) -> Result<(), String> {
    pdf::page_text::update_page_text(&PathBuf::from(path), page_index, index, text, x, y, font_size)
}

#[tauri::command]
fn remove_page_text(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::page_text::remove_page_text(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn add_page_vector_rect(path: String, page_index: u32, x: f64, y: f64, width: f64, height: f64) -> Result<u32, String> {
    pdf::page_text::add_page_vector_rect(&PathBuf::from(path), page_index, x, y, width, height)
}

#[tauri::command]
fn list_page_vectors(path: String, page_index: u32) -> Result<Vec<pdf::page_text::PageVectorEdit>, String> {
    pdf::page_text::list_page_vectors(&PathBuf::from(path), page_index)
}

#[tauri::command]
fn remove_page_vector(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::page_text::remove_page_vector(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn get_pdf_form_fields(path: String) -> Result<Vec<pdf::forms::FormFieldData>, String> {
    pdf::forms::get_pdf_form_fields(&PathBuf::from(path))
}

#[tauri::command]
fn set_pdf_form_field(path: String, name: String, value: String) -> Result<(), String> {
    pdf::forms::set_pdf_form_field(&PathBuf::from(path), name, value)
}

#[tauri::command]
fn add_text_form_field(
    path: String,
    page_index: u32,
    name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    pdf::forms::add_text_form_field(&PathBuf::from(path), page_index, name, x, y, width, height)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn add_checkbox_form_field(
    path: String,
    page_index: u32,
    name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    checked: bool,
) -> Result<(), String> {
    pdf::forms::add_checkbox_form_field(&PathBuf::from(path), page_index, name, x, y, width, height, checked)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn add_choice_form_field(
    path: String,
    page_index: u32,
    name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    options: Vec<String>,
    combo: bool,
) -> Result<(), String> {
    pdf::forms::add_choice_form_field(&PathBuf::from(path), page_index, name, x, y, width, height, options, combo)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn add_radio_form_field(
    path: String,
    page_index: u32,
    group_name: String,
    option_name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    pdf::forms::add_radio_form_field(&PathBuf::from(path), page_index, group_name, option_name, x, y, width, height)
}

#[tauri::command]
fn summarize_pdf(path: String) -> Result<PdfSummaryResult, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(format!("file not found: {}", path.display()));
    }
    let (pages, scanned) = pdf_plain_text_pages(&path)?;
    Ok(pdf::summary::build_pdf_summary(&pages, scanned))
}

#[tauri::command]
fn save_pdf_summary(path: String, overwrite: bool) -> Result<SummarySaveResult, String> {
    let pdf_path = PathBuf::from(path);
    if !pdf_path.is_file() {
        return Err(format!("file not found: {}", pdf_path.display()));
    }
    let (pages, scanned) = pdf_plain_text_pages(&pdf_path)?;
    let summary = pdf::summary::build_pdf_summary(&pages, scanned);
    pdf::summary::save_summary_file(&pdf_path, &summary, overwrite)
}

/// Return on-disk byte length for undo snapshot sizing decisions.
#[tauri::command]
fn file_byte_size(path: String) -> Result<u64, String> {
    Ok(fs::metadata(path).map_err(|e| e.to_string())?.len())
}

/// Whether the UI should offer native open/save pickers. macOS/Windows and Linux
/// X11 use them by default; Linux Wayland requires `PDF_PANDA_NATIVE_DIALOGS=1`.
#[tauri::command]
fn native_file_dialogs_enabled() -> bool {
    pdf::browser::native_file_dialogs_policy(
        cfg!(target_os = "macos"),
        cfg!(target_os = "windows"),
        cfg!(target_os = "linux"),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        std::env::var("PDF_PANDA_NATIVE_DIALOGS").ok().as_deref(),
        std::env::var("PDF_PANDA_DISABLE_NATIVE_DIALOGS").ok().as_deref(),
    )
}

/// Text/heuristic Markdown preview without assets or OCR (API/tests only).
/// The UI Markdown view uses `save_pdf_markdown`, which runs the full export pipeline.
#[tauri::command]
fn convert_pdf_to_markdown(path: String) -> Result<String, String> {
    pdf_to_markdown(&PathBuf::from(path), None, None)
}

#[tauri::command]
fn save_pdf_markdown(path: String, overwrite: bool, output_path: Option<String>) -> Result<MarkdownSaveResult, String> {
    let pdf_path = PathBuf::from(path);
    let markdown_path = output_path.map(PathBuf::from).unwrap_or_else(|| pdf_path.with_extension("md"));
    let assets_folder = format!("{}_assets", markdown_path.file_stem().and_then(|s| s.to_str()).unwrap_or("document"));
    let assets_dir = markdown_path
        .parent()
        .map(|parent| parent.join(&assets_folder))
        .unwrap_or_else(|| PathBuf::from(&assets_folder));
    let sink = MarkdownImageSink { assets_dir: &assets_dir, rel_prefix: &assets_folder };
    let mut stats = OcrExportStats::default();
    let markdown = pdf_to_markdown(&pdf_path, Some(&sink), Some(&mut stats))?;
    let file_result = pdf::markdown::write_markdown_file(&markdown_path, &markdown, overwrite)?;
    Ok(pdf::markdown::markdown_save_result(
        file_result.markdown,
        &markdown_path,
        file_result.written,
        file_result.conflict,
        &stats,
    ))
}

#[tauri::command]
fn split_pdf(path: String, page_ranges: Vec<(u32, u32)>) -> Result<Vec<String>, String> {
    pdf::merge_split::split_pdf(&PathBuf::from(path), page_ranges)
}

/// Write a new PDF containing only `start_page`..=`end_page` from `path`.
#[tauri::command]
fn extract_pdf_pages(path: String, output_path: String, start_page: u32, end_page: u32) -> Result<String, String> {
    pdf::merge_split::extract_pdf_pages(&PathBuf::from(path), &PathBuf::from(output_path), start_page, end_page)
}

#[tauri::command]
fn insert_pdf(
    path: String,
    insert_path: String,
    at_index: u32,
    insert_start: u32,
    insert_end: u32,
) -> Result<(), String> {
    pdf::merge_split::insert_pdf(&PathBuf::from(path), &PathBuf::from(insert_path), at_index, insert_start, insert_end)
}

#[tauri::command]
fn optimize_pdf(path: String) -> Result<String, String> {
    pdf::optimize::optimize_pdf_file(&PathBuf::from(path))
}

#[tauri::command]
fn pdf_is_encrypted(path: String) -> Result<bool, String> {
    pdf::security::pdf_is_encrypted(path)
}

#[tauri::command]
fn verify_pdf_password(path: String, password: String) -> Result<(), String> {
    pdf::security::verify_pdf_password(path, password)
}

#[tauri::command]
fn open_working_copy_with_password(original: String, password: String) -> Result<String, String> {
    pdf::security::open_working_copy_with_password(original, password)
}

#[tauri::command]
fn protect_pdf(path: String, user_password: String, owner_password: Option<String>) -> Result<String, String> {
    pdf::security::protect_pdf(path, user_password, owner_password)
}

#[tauri::command]
fn list_pdf_signatures(path: String) -> Result<Vec<PdfSignatureInfo>, String> {
    pdf::security::list_pdf_signatures(path)
}

#[tauri::command]
fn verify_pdf_signatures(
    path: String,
    trust_pem_path: Option<String>,
) -> Result<PdfSignatureVerificationSummary, String> {
    pdf::security::verify_pdf_signatures(path, trust_pem_path)
}

#[tauri::command]
fn sign_pdf(
    path: String,
    cert_path: String,
    cert_password: String,
    reason: Option<String>,
    location: Option<String>,
    field_name: Option<String>,
    output_path: Option<String>,
) -> Result<String, String> {
    pdf::security::sign_pdf(path, cert_path, cert_password, reason, location, field_name, output_path)
}

#[tauri::command]
fn open_working_copy(original: String) -> Result<String, String> {
    pdf::history::open_working_copy(original)
}

#[tauri::command]
fn save_working_copy(working: String, target: String) -> Result<(), String> {
    pdf::history::save_working_copy(working, target)
}

#[tauri::command]
fn discard_working_copy(working: String) -> Result<(), String> {
    pdf::history::discard_working_copy(working)
}

#[tauri::command]
fn snapshot_pdf(source: String) -> Result<String, String> {
    pdf::history::snapshot_pdf(source)
}

#[tauri::command]
fn snapshot_pdf_entry(history: Vec<HistorySnapshot>, source: String) -> Result<HistorySnapshot, String> {
    pdf::history::snapshot_pdf_entry(history, source)
}

#[tauri::command]
fn restore_history_entry(history: Vec<HistorySnapshot>, index: usize, target: String) -> Result<(), String> {
    pdf::history::restore_history_entry(history, index, target)
}

#[tauri::command]
fn discard_history_entry(entry: HistorySnapshot) -> Result<(), String> {
    pdf::history::discard_history_entry(entry)
}

#[tauri::command]
fn prune_history_entry(history: Vec<HistorySnapshot>, drop_index: usize) -> Result<Vec<HistorySnapshot>, String> {
    pdf::history::prune_history_entry(history, drop_index)
}

#[tauri::command]
fn add_highlight(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotations::add_highlight(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}

/// Remove the `index`-th highlight annotation (0-based, in document order) from a
/// page. The index matches the order highlights are returned by
/// `get_annotations` after filtering to the `Highlight` subtype.
#[tauri::command]
fn remove_highlight(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotations::remove_highlight(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn add_text_note(path: String, page_index: u32, x: f64, y: f64, content: String) -> Result<(), String> {
    pdf::annotations::add_text_note(&PathBuf::from(path), page_index, x, y, content)
}

/// Remove the `index`-th text-note annotation (0-based among `Text` subtypes).
#[tauri::command]
fn remove_text_note(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotations::remove_text_note(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn add_ink_stroke(path: String, page_index: u32, points: Vec<f64>) -> Result<(), String> {
    pdf::annotation_markup::add_ink_stroke(&PathBuf::from(path), page_index, points)
}

#[tauri::command]
fn remove_ink_stroke(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_ink_stroke(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn add_square(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_square(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}

#[tauri::command]
fn add_circle(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_circle(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}

#[tauri::command]
fn add_line(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_line(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}

#[tauri::command]
fn remove_square(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_square(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn remove_circle(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_circle(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn remove_line(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_line(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn list_stamp_presets() -> Vec<pdf::annotation_markup::StampPresetInfo> {
    pdf::annotation_markup::list_stamp_presets()
}

#[tauri::command]
fn add_text_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    pdf::annotation_markup::add_text_stamp(&PathBuf::from(path), page_index, x, y, preset)
}

#[tauri::command]
fn add_image_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    pdf::annotation_markup::add_image_stamp(&PathBuf::from(path), page_index, x, y, preset)
}

#[tauri::command]
fn remove_text_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_text_stamp(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn remove_image_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_image_stamp(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn add_redaction(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_redaction(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}

#[tauri::command]
fn remove_redaction(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_redaction(&PathBuf::from(path), page_index, index)
}

#[tauri::command]
fn get_annotations(path: String, page_index: u32) -> Result<Vec<pdf::annotations::AnnotationData>, String> {
    pdf::annotations::get_annotations(&PathBuf::from(path), page_index)
}

/// Copy `original` to a fresh temp working file so edits never touch the user's
/// file until they explicitly save. Returns the working-copy path.
#[tauri::command]

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
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

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
        .invoke_handler(tauri::generate_handler![
            list_pdf_browser_entries,
            get_pdf_page_count,
            get_pdf_bookmarks,
            get_pdf_metadata,
            set_pdf_metadata,
            render_pdf_page,
            search_pdf_text,
            export_pdf_page_png,
            export_pdf_pages_png,
            export_pdf_page_jpeg,
            export_pdf_pages_jpeg,
            export_pdf_page_webp,
            export_pdf_pages_webp,
            export_pdf_page_bmp,
            export_pdf_pages_bmp,
            export_pdf_page_tiff,
            export_pdf_pages_tiff,
            export_pdf_page_gif,
            export_pdf_pages_gif,
            export_pdf_page_ppm,
            export_pdf_pages_ppm,
            get_pdf_thumbnails,
            get_pdf_page_sizes,
            delete_page,
            delete_page_range,
            move_page,
            move_page_to_first,
            move_page_to_last,
            duplicate_page,
            duplicate_page_range,
            merge_pdf,
            rotate_page,
            rotate_page_ccw,
            rotate_page_180,
            rotate_all_pages,
            rotate_all_pages_ccw,
            reset_page_rotation,
            reset_all_page_rotations,
            reverse_pages,
            add_blank_page,
            insert_image_page,
            add_pdf_bookmark,
            remove_pdf_bookmark,
            rename_pdf_bookmark,
            clear_pdf_bookmarks,
            add_page_numbers,
            add_page_header,
            add_page_footer,
            swap_pages,
            move_page_up,
            move_page_down,
            replace_page,
            interleave_pdf,
            split_odd_even_pages,
            duplicate_all_pages,
            set_page_size,
            remove_pdf_password,
            export_pdf_pages_as_pdf,
            rotate_page_range,
            rotate_page_range_ccw,
            keep_page_range,
            move_page_range,
            prepend_pdf,
            split_every_n_pages,
            add_page_border,
            bookmark_all_pages,
            duplicate_page_to_end,
            expand_page_margins,
            reset_rotation_range,
            rotate_page_180_range,
            reverse_page_range,
            duplicate_page_range_to_end,
            insert_blank_pages,
            crop_page_range,
            flatten_all_annotations,
            clear_pdf_metadata,
            sort_pages_by_size,
            duplicate_page_range_before,
            shrink_page_margins,
            rotate_odd_pages,
            rotate_even_pages,
            delete_every_nth_page,
            move_page_range_to_start,
            move_page_range_to_end,
            extract_odd_pages,
            extract_even_pages,
            export_pdf_page_tga,
            export_pdf_pages_tga,
            duplicate_page_before,
            split_pdf_at_page,
            rotate_odd_pages_ccw,
            rotate_even_pages_ccw,
            reset_rotation_odd_pages,
            reset_rotation_even_pages,
            keep_odd_pages,
            keep_even_pages,
            sort_pages_by_rotation,
            export_pdf_page_ico,
            export_pdf_pages_ico,
            delete_odd_pages,
            delete_even_pages,
            rotate_180_odd_pages,
            rotate_180_even_pages,
            duplicate_odd_pages,
            duplicate_even_pages,
            insert_blank_between_pages,
            flatten_odd_pages,
            flatten_even_pages,
            rotate_all_pages_180,
            crop_odd_pages,
            crop_even_pages,
            expand_odd_pages,
            expand_even_pages,
            shrink_odd_pages,
            shrink_even_pages,
            reverse_odd_pages,
            reverse_even_pages,
            move_odd_pages_to_start,
            move_even_pages_to_start,
            move_odd_pages_to_end,
            move_even_pages_to_end,
            clear_crop_odd_pages,
            clear_crop_even_pages,
            duplicate_odd_pages_before,
            duplicate_even_pages_before,
            sort_odd_pages_by_rotation,
            sort_even_pages_by_rotation,
            sort_odd_pages_by_size,
            sort_even_pages_by_size,
            add_page_numbers_odd_pages,
            add_page_numbers_even_pages,
            add_text_watermark_odd_pages,
            add_text_watermark_even_pages,
            add_page_header_odd_pages,
            add_page_header_even_pages,
            add_page_footer_odd_pages,
            add_page_footer_even_pages,
            add_page_border_odd_pages,
            add_page_border_even_pages,
            bookmark_odd_pages,
            bookmark_even_pages,
            set_page_size_odd_pages,
            set_page_size_even_pages,
            insert_blank_before_odd_pages,
            insert_blank_before_even_pages,
            insert_blank_after_odd_pages,
            insert_blank_after_even_pages,
            duplicate_odd_pages_to_end,
            duplicate_even_pages_to_end,
            duplicate_odd_pages_to_start,
            duplicate_even_pages_to_start,
            export_odd_pages_as_pdf,
            export_even_pages_as_pdf,
            export_odd_pages_png,
            export_even_pages_png,
            export_odd_pages_jpeg,
            export_even_pages_jpeg,
            export_odd_pages_webp,
            export_even_pages_webp,
            export_odd_pages_bmp,
            export_even_pages_bmp,
            export_odd_pages_tiff,
            export_even_pages_tiff,
            export_odd_pages_gif,
            export_even_pages_gif,
            export_odd_pages_ppm,
            export_even_pages_ppm,
            export_odd_pages_tga,
            export_even_pages_tga,
            // PARITY_DOCMOD_HANDLERS_START
            rotate_mod3_0_pages,
            rotate_mod3_0_pages_ccw,
            rotate_180_mod3_0_pages,
            reset_rotation_mod3_0_pages,
            delete_mod3_0_pages,
            keep_mod3_0_pages,
            duplicate_mod3_0_pages,
            flatten_mod3_0_pages,
            crop_mod3_0_pages,
            expand_mod3_0_pages,
            shrink_mod3_0_pages,
            reverse_mod3_0_pages,
            move_mod3_0_pages_to_start,
            move_mod3_0_pages_to_end,
            clear_crop_mod3_0_pages,
            duplicate_mod3_0_pages_before,
            sort_mod3_0_pages_by_rotation,
            sort_mod3_0_pages_by_size,
            add_page_numbers_mod3_0_pages,
            add_text_watermark_mod3_0_pages,
            add_page_header_mod3_0_pages,
            add_page_footer_mod3_0_pages,
            add_page_border_mod3_0_pages,
            bookmark_mod3_0_pages,
            set_page_size_mod3_0_pages,
            insert_blank_before_mod3_0_pages,
            insert_blank_after_mod3_0_pages,
            duplicate_mod3_0_pages_to_end,
            duplicate_mod3_0_pages_to_start,
            extract_mod3_0_pages,
            export_mod3_0_pages_as_pdf,
            export_mod3_0_pages_png,
            export_mod3_0_pages_jpeg,
            export_mod3_0_pages_webp,
            export_mod3_0_pages_bmp,
            export_mod3_0_pages_tiff,
            export_mod3_0_pages_gif,
            export_mod3_0_pages_ppm,
            export_mod3_0_pages_tga,
            export_mod3_0_pages_ico,
            rotate_mod3_1_pages,
            rotate_mod3_1_pages_ccw,
            rotate_180_mod3_1_pages,
            reset_rotation_mod3_1_pages,
            delete_mod3_1_pages,
            keep_mod3_1_pages,
            duplicate_mod3_1_pages,
            flatten_mod3_1_pages,
            crop_mod3_1_pages,
            expand_mod3_1_pages,
            shrink_mod3_1_pages,
            reverse_mod3_1_pages,
            move_mod3_1_pages_to_start,
            move_mod3_1_pages_to_end,
            clear_crop_mod3_1_pages,
            duplicate_mod3_1_pages_before,
            sort_mod3_1_pages_by_rotation,
            sort_mod3_1_pages_by_size,
            add_page_numbers_mod3_1_pages,
            add_text_watermark_mod3_1_pages,
            add_page_header_mod3_1_pages,
            add_page_footer_mod3_1_pages,
            add_page_border_mod3_1_pages,
            bookmark_mod3_1_pages,
            set_page_size_mod3_1_pages,
            insert_blank_before_mod3_1_pages,
            insert_blank_after_mod3_1_pages,
            duplicate_mod3_1_pages_to_end,
            duplicate_mod3_1_pages_to_start,
            extract_mod3_1_pages,
            export_mod3_1_pages_as_pdf,
            export_mod3_1_pages_png,
            export_mod3_1_pages_jpeg,
            export_mod3_1_pages_webp,
            export_mod3_1_pages_bmp,
            export_mod3_1_pages_tiff,
            export_mod3_1_pages_gif,
            export_mod3_1_pages_ppm,
            export_mod3_1_pages_tga,
            export_mod3_1_pages_ico,
            rotate_mod3_2_pages,
            rotate_mod3_2_pages_ccw,
            rotate_180_mod3_2_pages,
            reset_rotation_mod3_2_pages,
            delete_mod3_2_pages,
            keep_mod3_2_pages,
            duplicate_mod3_2_pages,
            flatten_mod3_2_pages,
            crop_mod3_2_pages,
            expand_mod3_2_pages,
            shrink_mod3_2_pages,
            reverse_mod3_2_pages,
            move_mod3_2_pages_to_start,
            move_mod3_2_pages_to_end,
            clear_crop_mod3_2_pages,
            duplicate_mod3_2_pages_before,
            sort_mod3_2_pages_by_rotation,
            sort_mod3_2_pages_by_size,
            add_page_numbers_mod3_2_pages,
            add_text_watermark_mod3_2_pages,
            add_page_header_mod3_2_pages,
            add_page_footer_mod3_2_pages,
            add_page_border_mod3_2_pages,
            bookmark_mod3_2_pages,
            set_page_size_mod3_2_pages,
            insert_blank_before_mod3_2_pages,
            insert_blank_after_mod3_2_pages,
            duplicate_mod3_2_pages_to_end,
            duplicate_mod3_2_pages_to_start,
            extract_mod3_2_pages,
            export_mod3_2_pages_as_pdf,
            export_mod3_2_pages_png,
            export_mod3_2_pages_jpeg,
            export_mod3_2_pages_webp,
            export_mod3_2_pages_bmp,
            export_mod3_2_pages_tiff,
            export_mod3_2_pages_gif,
            export_mod3_2_pages_ppm,
            export_mod3_2_pages_tga,
            export_mod3_2_pages_ico,
            rotate_mod4_0_pages,
            rotate_mod4_0_pages_ccw,
            rotate_180_mod4_0_pages,
            reset_rotation_mod4_0_pages,
            delete_mod4_0_pages,
            keep_mod4_0_pages,
            duplicate_mod4_0_pages,
            flatten_mod4_0_pages,
            crop_mod4_0_pages,
            expand_mod4_0_pages,
            shrink_mod4_0_pages,
            reverse_mod4_0_pages,
            move_mod4_0_pages_to_start,
            move_mod4_0_pages_to_end,
            clear_crop_mod4_0_pages,
            duplicate_mod4_0_pages_before,
            sort_mod4_0_pages_by_rotation,
            sort_mod4_0_pages_by_size,
            add_page_numbers_mod4_0_pages,
            add_text_watermark_mod4_0_pages,
            add_page_header_mod4_0_pages,
            add_page_footer_mod4_0_pages,
            add_page_border_mod4_0_pages,
            bookmark_mod4_0_pages,
            set_page_size_mod4_0_pages,
            insert_blank_before_mod4_0_pages,
            insert_blank_after_mod4_0_pages,
            duplicate_mod4_0_pages_to_end,
            duplicate_mod4_0_pages_to_start,
            extract_mod4_0_pages,
            export_mod4_0_pages_as_pdf,
            export_mod4_0_pages_png,
            export_mod4_0_pages_jpeg,
            export_mod4_0_pages_webp,
            export_mod4_0_pages_bmp,
            export_mod4_0_pages_tiff,
            export_mod4_0_pages_gif,
            export_mod4_0_pages_ppm,
            export_mod4_0_pages_tga,
            export_mod4_0_pages_ico,
            rotate_mod4_1_pages,
            rotate_mod4_1_pages_ccw,
            rotate_180_mod4_1_pages,
            reset_rotation_mod4_1_pages,
            delete_mod4_1_pages,
            keep_mod4_1_pages,
            duplicate_mod4_1_pages,
            flatten_mod4_1_pages,
            crop_mod4_1_pages,
            expand_mod4_1_pages,
            shrink_mod4_1_pages,
            reverse_mod4_1_pages,
            move_mod4_1_pages_to_start,
            move_mod4_1_pages_to_end,
            clear_crop_mod4_1_pages,
            duplicate_mod4_1_pages_before,
            sort_mod4_1_pages_by_rotation,
            sort_mod4_1_pages_by_size,
            add_page_numbers_mod4_1_pages,
            add_text_watermark_mod4_1_pages,
            add_page_header_mod4_1_pages,
            add_page_footer_mod4_1_pages,
            add_page_border_mod4_1_pages,
            bookmark_mod4_1_pages,
            set_page_size_mod4_1_pages,
            insert_blank_before_mod4_1_pages,
            insert_blank_after_mod4_1_pages,
            duplicate_mod4_1_pages_to_end,
            duplicate_mod4_1_pages_to_start,
            extract_mod4_1_pages,
            export_mod4_1_pages_as_pdf,
            export_mod4_1_pages_png,
            export_mod4_1_pages_jpeg,
            export_mod4_1_pages_webp,
            export_mod4_1_pages_bmp,
            export_mod4_1_pages_tiff,
            export_mod4_1_pages_gif,
            export_mod4_1_pages_ppm,
            export_mod4_1_pages_tga,
            export_mod4_1_pages_ico,
            rotate_mod4_2_pages,
            rotate_mod4_2_pages_ccw,
            rotate_180_mod4_2_pages,
            reset_rotation_mod4_2_pages,
            delete_mod4_2_pages,
            keep_mod4_2_pages,
            duplicate_mod4_2_pages,
            flatten_mod4_2_pages,
            crop_mod4_2_pages,
            expand_mod4_2_pages,
            shrink_mod4_2_pages,
            reverse_mod4_2_pages,
            move_mod4_2_pages_to_start,
            move_mod4_2_pages_to_end,
            clear_crop_mod4_2_pages,
            duplicate_mod4_2_pages_before,
            sort_mod4_2_pages_by_rotation,
            sort_mod4_2_pages_by_size,
            add_page_numbers_mod4_2_pages,
            add_text_watermark_mod4_2_pages,
            add_page_header_mod4_2_pages,
            add_page_footer_mod4_2_pages,
            add_page_border_mod4_2_pages,
            bookmark_mod4_2_pages,
            set_page_size_mod4_2_pages,
            insert_blank_before_mod4_2_pages,
            insert_blank_after_mod4_2_pages,
            duplicate_mod4_2_pages_to_end,
            duplicate_mod4_2_pages_to_start,
            extract_mod4_2_pages,
            export_mod4_2_pages_as_pdf,
            export_mod4_2_pages_png,
            export_mod4_2_pages_jpeg,
            export_mod4_2_pages_webp,
            export_mod4_2_pages_bmp,
            export_mod4_2_pages_tiff,
            export_mod4_2_pages_gif,
            export_mod4_2_pages_ppm,
            export_mod4_2_pages_tga,
            export_mod4_2_pages_ico,
            rotate_mod4_3_pages,
            rotate_mod4_3_pages_ccw,
            rotate_180_mod4_3_pages,
            reset_rotation_mod4_3_pages,
            delete_mod4_3_pages,
            keep_mod4_3_pages,
            duplicate_mod4_3_pages,
            flatten_mod4_3_pages,
            crop_mod4_3_pages,
            expand_mod4_3_pages,
            shrink_mod4_3_pages,
            reverse_mod4_3_pages,
            move_mod4_3_pages_to_start,
            move_mod4_3_pages_to_end,
            clear_crop_mod4_3_pages,
            duplicate_mod4_3_pages_before,
            sort_mod4_3_pages_by_rotation,
            sort_mod4_3_pages_by_size,
            add_page_numbers_mod4_3_pages,
            add_text_watermark_mod4_3_pages,
            add_page_header_mod4_3_pages,
            add_page_footer_mod4_3_pages,
            add_page_border_mod4_3_pages,
            bookmark_mod4_3_pages,
            set_page_size_mod4_3_pages,
            insert_blank_before_mod4_3_pages,
            insert_blank_after_mod4_3_pages,
            duplicate_mod4_3_pages_to_end,
            duplicate_mod4_3_pages_to_start,
            extract_mod4_3_pages,
            export_mod4_3_pages_as_pdf,
            export_mod4_3_pages_png,
            export_mod4_3_pages_jpeg,
            export_mod4_3_pages_webp,
            export_mod4_3_pages_bmp,
            export_mod4_3_pages_tiff,
            export_mod4_3_pages_gif,
            export_mod4_3_pages_ppm,
            export_mod4_3_pages_tga,
            export_mod4_3_pages_ico,
            rotate_mod5_0_pages,
            rotate_mod5_0_pages_ccw,
            rotate_180_mod5_0_pages,
            reset_rotation_mod5_0_pages,
            delete_mod5_0_pages,
            keep_mod5_0_pages,
            duplicate_mod5_0_pages,
            flatten_mod5_0_pages,
            crop_mod5_0_pages,
            expand_mod5_0_pages,
            shrink_mod5_0_pages,
            reverse_mod5_0_pages,
            move_mod5_0_pages_to_start,
            move_mod5_0_pages_to_end,
            clear_crop_mod5_0_pages,
            duplicate_mod5_0_pages_before,
            sort_mod5_0_pages_by_rotation,
            sort_mod5_0_pages_by_size,
            add_page_numbers_mod5_0_pages,
            add_text_watermark_mod5_0_pages,
            add_page_header_mod5_0_pages,
            add_page_footer_mod5_0_pages,
            add_page_border_mod5_0_pages,
            bookmark_mod5_0_pages,
            set_page_size_mod5_0_pages,
            insert_blank_before_mod5_0_pages,
            insert_blank_after_mod5_0_pages,
            duplicate_mod5_0_pages_to_end,
            duplicate_mod5_0_pages_to_start,
            extract_mod5_0_pages,
            export_mod5_0_pages_as_pdf,
            export_mod5_0_pages_png,
            export_mod5_0_pages_jpeg,
            export_mod5_0_pages_webp,
            export_mod5_0_pages_bmp,
            export_mod5_0_pages_tiff,
            export_mod5_0_pages_gif,
            export_mod5_0_pages_ppm,
            export_mod5_0_pages_tga,
            export_mod5_0_pages_ico,
            rotate_mod5_1_pages,
            rotate_mod5_1_pages_ccw,
            rotate_180_mod5_1_pages,
            reset_rotation_mod5_1_pages,
            delete_mod5_1_pages,
            keep_mod5_1_pages,
            duplicate_mod5_1_pages,
            flatten_mod5_1_pages,
            crop_mod5_1_pages,
            expand_mod5_1_pages,
            shrink_mod5_1_pages,
            reverse_mod5_1_pages,
            move_mod5_1_pages_to_start,
            move_mod5_1_pages_to_end,
            clear_crop_mod5_1_pages,
            duplicate_mod5_1_pages_before,
            sort_mod5_1_pages_by_rotation,
            sort_mod5_1_pages_by_size,
            add_page_numbers_mod5_1_pages,
            add_text_watermark_mod5_1_pages,
            add_page_header_mod5_1_pages,
            add_page_footer_mod5_1_pages,
            add_page_border_mod5_1_pages,
            bookmark_mod5_1_pages,
            set_page_size_mod5_1_pages,
            insert_blank_before_mod5_1_pages,
            insert_blank_after_mod5_1_pages,
            duplicate_mod5_1_pages_to_end,
            duplicate_mod5_1_pages_to_start,
            extract_mod5_1_pages,
            export_mod5_1_pages_as_pdf,
            export_mod5_1_pages_png,
            export_mod5_1_pages_jpeg,
            export_mod5_1_pages_webp,
            export_mod5_1_pages_bmp,
            export_mod5_1_pages_tiff,
            export_mod5_1_pages_gif,
            export_mod5_1_pages_ppm,
            export_mod5_1_pages_tga,
            export_mod5_1_pages_ico,
            rotate_mod5_2_pages,
            rotate_mod5_2_pages_ccw,
            rotate_180_mod5_2_pages,
            reset_rotation_mod5_2_pages,
            delete_mod5_2_pages,
            keep_mod5_2_pages,
            duplicate_mod5_2_pages,
            flatten_mod5_2_pages,
            crop_mod5_2_pages,
            expand_mod5_2_pages,
            shrink_mod5_2_pages,
            reverse_mod5_2_pages,
            move_mod5_2_pages_to_start,
            move_mod5_2_pages_to_end,
            clear_crop_mod5_2_pages,
            duplicate_mod5_2_pages_before,
            sort_mod5_2_pages_by_rotation,
            sort_mod5_2_pages_by_size,
            add_page_numbers_mod5_2_pages,
            add_text_watermark_mod5_2_pages,
            add_page_header_mod5_2_pages,
            add_page_footer_mod5_2_pages,
            add_page_border_mod5_2_pages,
            bookmark_mod5_2_pages,
            set_page_size_mod5_2_pages,
            insert_blank_before_mod5_2_pages,
            insert_blank_after_mod5_2_pages,
            duplicate_mod5_2_pages_to_end,
            duplicate_mod5_2_pages_to_start,
            extract_mod5_2_pages,
            export_mod5_2_pages_as_pdf,
            export_mod5_2_pages_png,
            export_mod5_2_pages_jpeg,
            export_mod5_2_pages_webp,
            export_mod5_2_pages_bmp,
            export_mod5_2_pages_tiff,
            export_mod5_2_pages_gif,
            export_mod5_2_pages_ppm,
            export_mod5_2_pages_tga,
            export_mod5_2_pages_ico,
            rotate_mod5_3_pages,
            rotate_mod5_3_pages_ccw,
            rotate_180_mod5_3_pages,
            reset_rotation_mod5_3_pages,
            delete_mod5_3_pages,
            keep_mod5_3_pages,
            duplicate_mod5_3_pages,
            flatten_mod5_3_pages,
            crop_mod5_3_pages,
            expand_mod5_3_pages,
            shrink_mod5_3_pages,
            reverse_mod5_3_pages,
            move_mod5_3_pages_to_start,
            move_mod5_3_pages_to_end,
            clear_crop_mod5_3_pages,
            duplicate_mod5_3_pages_before,
            sort_mod5_3_pages_by_rotation,
            sort_mod5_3_pages_by_size,
            add_page_numbers_mod5_3_pages,
            add_text_watermark_mod5_3_pages,
            add_page_header_mod5_3_pages,
            add_page_footer_mod5_3_pages,
            add_page_border_mod5_3_pages,
            bookmark_mod5_3_pages,
            set_page_size_mod5_3_pages,
            insert_blank_before_mod5_3_pages,
            insert_blank_after_mod5_3_pages,
            duplicate_mod5_3_pages_to_end,
            duplicate_mod5_3_pages_to_start,
            extract_mod5_3_pages,
            export_mod5_3_pages_as_pdf,
            export_mod5_3_pages_png,
            export_mod5_3_pages_jpeg,
            export_mod5_3_pages_webp,
            export_mod5_3_pages_bmp,
            export_mod5_3_pages_tiff,
            export_mod5_3_pages_gif,
            export_mod5_3_pages_ppm,
            export_mod5_3_pages_tga,
            export_mod5_3_pages_ico,
            rotate_mod5_4_pages,
            rotate_mod5_4_pages_ccw,
            rotate_180_mod5_4_pages,
            reset_rotation_mod5_4_pages,
            delete_mod5_4_pages,
            keep_mod5_4_pages,
            duplicate_mod5_4_pages,
            flatten_mod5_4_pages,
            crop_mod5_4_pages,
            expand_mod5_4_pages,
            shrink_mod5_4_pages,
            reverse_mod5_4_pages,
            move_mod5_4_pages_to_start,
            move_mod5_4_pages_to_end,
            clear_crop_mod5_4_pages,
            duplicate_mod5_4_pages_before,
            sort_mod5_4_pages_by_rotation,
            sort_mod5_4_pages_by_size,
            add_page_numbers_mod5_4_pages,
            add_text_watermark_mod5_4_pages,
            add_page_header_mod5_4_pages,
            add_page_footer_mod5_4_pages,
            add_page_border_mod5_4_pages,
            bookmark_mod5_4_pages,
            set_page_size_mod5_4_pages,
            insert_blank_before_mod5_4_pages,
            insert_blank_after_mod5_4_pages,
            duplicate_mod5_4_pages_to_end,
            duplicate_mod5_4_pages_to_start,
            extract_mod5_4_pages,
            export_mod5_4_pages_as_pdf,
            export_mod5_4_pages_png,
            export_mod5_4_pages_jpeg,
            export_mod5_4_pages_webp,
            export_mod5_4_pages_bmp,
            export_mod5_4_pages_tiff,
            export_mod5_4_pages_gif,
            export_mod5_4_pages_ppm,
            export_mod5_4_pages_tga,
            export_mod5_4_pages_ico,
            rotate_mod6_0_pages,
            rotate_mod6_0_pages_ccw,
            rotate_180_mod6_0_pages,
            reset_rotation_mod6_0_pages,
            delete_mod6_0_pages,
            keep_mod6_0_pages,
            duplicate_mod6_0_pages,
            flatten_mod6_0_pages,
            crop_mod6_0_pages,
            expand_mod6_0_pages,
            shrink_mod6_0_pages,
            reverse_mod6_0_pages,
            move_mod6_0_pages_to_start,
            move_mod6_0_pages_to_end,
            clear_crop_mod6_0_pages,
            duplicate_mod6_0_pages_before,
            sort_mod6_0_pages_by_rotation,
            sort_mod6_0_pages_by_size,
            add_page_numbers_mod6_0_pages,
            add_text_watermark_mod6_0_pages,
            add_page_header_mod6_0_pages,
            add_page_footer_mod6_0_pages,
            add_page_border_mod6_0_pages,
            bookmark_mod6_0_pages,
            set_page_size_mod6_0_pages,
            insert_blank_before_mod6_0_pages,
            insert_blank_after_mod6_0_pages,
            duplicate_mod6_0_pages_to_end,
            duplicate_mod6_0_pages_to_start,
            extract_mod6_0_pages,
            export_mod6_0_pages_as_pdf,
            export_mod6_0_pages_png,
            export_mod6_0_pages_jpeg,
            export_mod6_0_pages_webp,
            export_mod6_0_pages_bmp,
            export_mod6_0_pages_tiff,
            export_mod6_0_pages_gif,
            export_mod6_0_pages_ppm,
            export_mod6_0_pages_tga,
            export_mod6_0_pages_ico,
            rotate_mod6_1_pages,
            rotate_mod6_1_pages_ccw,
            rotate_180_mod6_1_pages,
            reset_rotation_mod6_1_pages,
            delete_mod6_1_pages,
            keep_mod6_1_pages,
            duplicate_mod6_1_pages,
            flatten_mod6_1_pages,
            crop_mod6_1_pages,
            expand_mod6_1_pages,
            shrink_mod6_1_pages,
            reverse_mod6_1_pages,
            move_mod6_1_pages_to_start,
            move_mod6_1_pages_to_end,
            clear_crop_mod6_1_pages,
            duplicate_mod6_1_pages_before,
            sort_mod6_1_pages_by_rotation,
            sort_mod6_1_pages_by_size,
            add_page_numbers_mod6_1_pages,
            add_text_watermark_mod6_1_pages,
            add_page_header_mod6_1_pages,
            add_page_footer_mod6_1_pages,
            add_page_border_mod6_1_pages,
            bookmark_mod6_1_pages,
            set_page_size_mod6_1_pages,
            insert_blank_before_mod6_1_pages,
            insert_blank_after_mod6_1_pages,
            duplicate_mod6_1_pages_to_end,
            duplicate_mod6_1_pages_to_start,
            extract_mod6_1_pages,
            export_mod6_1_pages_as_pdf,
            export_mod6_1_pages_png,
            export_mod6_1_pages_jpeg,
            export_mod6_1_pages_webp,
            export_mod6_1_pages_bmp,
            export_mod6_1_pages_tiff,
            export_mod6_1_pages_gif,
            export_mod6_1_pages_ppm,
            export_mod6_1_pages_tga,
            export_mod6_1_pages_ico,
            rotate_mod6_2_pages,
            rotate_mod6_2_pages_ccw,
            rotate_180_mod6_2_pages,
            reset_rotation_mod6_2_pages,
            delete_mod6_2_pages,
            keep_mod6_2_pages,
            duplicate_mod6_2_pages,
            flatten_mod6_2_pages,
            crop_mod6_2_pages,
            expand_mod6_2_pages,
            shrink_mod6_2_pages,
            reverse_mod6_2_pages,
            move_mod6_2_pages_to_start,
            move_mod6_2_pages_to_end,
            clear_crop_mod6_2_pages,
            duplicate_mod6_2_pages_before,
            sort_mod6_2_pages_by_rotation,
            sort_mod6_2_pages_by_size,
            add_page_numbers_mod6_2_pages,
            add_text_watermark_mod6_2_pages,
            add_page_header_mod6_2_pages,
            add_page_footer_mod6_2_pages,
            add_page_border_mod6_2_pages,
            bookmark_mod6_2_pages,
            set_page_size_mod6_2_pages,
            insert_blank_before_mod6_2_pages,
            insert_blank_after_mod6_2_pages,
            duplicate_mod6_2_pages_to_end,
            duplicate_mod6_2_pages_to_start,
            extract_mod6_2_pages,
            export_mod6_2_pages_as_pdf,
            export_mod6_2_pages_png,
            export_mod6_2_pages_jpeg,
            export_mod6_2_pages_webp,
            export_mod6_2_pages_bmp,
            export_mod6_2_pages_tiff,
            export_mod6_2_pages_gif,
            export_mod6_2_pages_ppm,
            export_mod6_2_pages_tga,
            export_mod6_2_pages_ico,
            rotate_mod6_3_pages,
            rotate_mod6_3_pages_ccw,
            rotate_180_mod6_3_pages,
            reset_rotation_mod6_3_pages,
            delete_mod6_3_pages,
            keep_mod6_3_pages,
            duplicate_mod6_3_pages,
            flatten_mod6_3_pages,
            crop_mod6_3_pages,
            expand_mod6_3_pages,
            shrink_mod6_3_pages,
            reverse_mod6_3_pages,
            move_mod6_3_pages_to_start,
            move_mod6_3_pages_to_end,
            clear_crop_mod6_3_pages,
            duplicate_mod6_3_pages_before,
            sort_mod6_3_pages_by_rotation,
            sort_mod6_3_pages_by_size,
            add_page_numbers_mod6_3_pages,
            add_text_watermark_mod6_3_pages,
            add_page_header_mod6_3_pages,
            add_page_footer_mod6_3_pages,
            add_page_border_mod6_3_pages,
            bookmark_mod6_3_pages,
            set_page_size_mod6_3_pages,
            insert_blank_before_mod6_3_pages,
            insert_blank_after_mod6_3_pages,
            duplicate_mod6_3_pages_to_end,
            duplicate_mod6_3_pages_to_start,
            extract_mod6_3_pages,
            export_mod6_3_pages_as_pdf,
            export_mod6_3_pages_png,
            export_mod6_3_pages_jpeg,
            export_mod6_3_pages_webp,
            export_mod6_3_pages_bmp,
            export_mod6_3_pages_tiff,
            export_mod6_3_pages_gif,
            export_mod6_3_pages_ppm,
            export_mod6_3_pages_tga,
            export_mod6_3_pages_ico,
            rotate_mod6_4_pages,
            rotate_mod6_4_pages_ccw,
            rotate_180_mod6_4_pages,
            reset_rotation_mod6_4_pages,
            delete_mod6_4_pages,
            keep_mod6_4_pages,
            duplicate_mod6_4_pages,
            flatten_mod6_4_pages,
            crop_mod6_4_pages,
            expand_mod6_4_pages,
            shrink_mod6_4_pages,
            reverse_mod6_4_pages,
            move_mod6_4_pages_to_start,
            move_mod6_4_pages_to_end,
            clear_crop_mod6_4_pages,
            duplicate_mod6_4_pages_before,
            sort_mod6_4_pages_by_rotation,
            sort_mod6_4_pages_by_size,
            add_page_numbers_mod6_4_pages,
            add_text_watermark_mod6_4_pages,
            add_page_header_mod6_4_pages,
            add_page_footer_mod6_4_pages,
            add_page_border_mod6_4_pages,
            bookmark_mod6_4_pages,
            set_page_size_mod6_4_pages,
            insert_blank_before_mod6_4_pages,
            insert_blank_after_mod6_4_pages,
            duplicate_mod6_4_pages_to_end,
            duplicate_mod6_4_pages_to_start,
            extract_mod6_4_pages,
            export_mod6_4_pages_as_pdf,
            export_mod6_4_pages_png,
            export_mod6_4_pages_jpeg,
            export_mod6_4_pages_webp,
            export_mod6_4_pages_bmp,
            export_mod6_4_pages_tiff,
            export_mod6_4_pages_gif,
            export_mod6_4_pages_ppm,
            export_mod6_4_pages_tga,
            export_mod6_4_pages_ico,
            rotate_mod6_5_pages,
            rotate_mod6_5_pages_ccw,
            rotate_180_mod6_5_pages,
            reset_rotation_mod6_5_pages,
            delete_mod6_5_pages,
            keep_mod6_5_pages,
            duplicate_mod6_5_pages,
            flatten_mod6_5_pages,
            crop_mod6_5_pages,
            expand_mod6_5_pages,
            shrink_mod6_5_pages,
            reverse_mod6_5_pages,
            move_mod6_5_pages_to_start,
            move_mod6_5_pages_to_end,
            clear_crop_mod6_5_pages,
            duplicate_mod6_5_pages_before,
            sort_mod6_5_pages_by_rotation,
            sort_mod6_5_pages_by_size,
            add_page_numbers_mod6_5_pages,
            add_text_watermark_mod6_5_pages,
            add_page_header_mod6_5_pages,
            add_page_footer_mod6_5_pages,
            add_page_border_mod6_5_pages,
            bookmark_mod6_5_pages,
            set_page_size_mod6_5_pages,
            insert_blank_before_mod6_5_pages,
            insert_blank_after_mod6_5_pages,
            duplicate_mod6_5_pages_to_end,
            duplicate_mod6_5_pages_to_start,
            extract_mod6_5_pages,
            export_mod6_5_pages_as_pdf,
            export_mod6_5_pages_png,
            export_mod6_5_pages_jpeg,
            export_mod6_5_pages_webp,
            export_mod6_5_pages_bmp,
            export_mod6_5_pages_tiff,
            export_mod6_5_pages_gif,
            export_mod6_5_pages_ppm,
            export_mod6_5_pages_tga,
            export_mod6_5_pages_ico,
            // PARITY_DOCMOD_HANDLERS_END
            duplicate_page_range_to_start,
            // PARITY_BATCH_HANDLERS_START
            rotate_odd_pages_in_range,
            rotate_even_pages_in_range,
            rotate_odd_pages_in_range_ccw,
            rotate_even_pages_in_range_ccw,
            rotate_180_odd_pages_in_range,
            rotate_180_even_pages_in_range,
            reset_rotation_odd_pages_in_range,
            reset_rotation_even_pages_in_range,
            delete_odd_pages_in_range,
            delete_even_pages_in_range,
            keep_odd_pages_in_range,
            keep_even_pages_in_range,
            duplicate_odd_pages_in_range,
            duplicate_even_pages_in_range,
            duplicate_odd_pages_in_range_before,
            duplicate_even_pages_in_range_before,
            duplicate_odd_pages_in_range_to_start,
            duplicate_even_pages_in_range_to_start,
            duplicate_odd_pages_in_range_to_end,
            duplicate_even_pages_in_range_to_end,
            flatten_odd_pages_in_range,
            flatten_even_pages_in_range,
            reverse_odd_pages_in_range,
            reverse_even_pages_in_range,
            move_odd_pages_in_range_to_start,
            move_even_pages_in_range_to_start,
            move_odd_pages_in_range_to_end,
            move_even_pages_in_range_to_end,
            sort_odd_pages_in_range_by_rotation,
            sort_even_pages_in_range_by_rotation,
            sort_odd_pages_in_range_by_size,
            sort_even_pages_in_range_by_size,
            crop_odd_pages_in_range,
            crop_even_pages_in_range,
            expand_odd_pages_in_range,
            expand_even_pages_in_range,
            shrink_odd_pages_in_range,
            shrink_even_pages_in_range,
            clear_crop_odd_pages_in_range,
            clear_crop_even_pages_in_range,
            insert_blank_before_odd_pages_in_range,
            insert_blank_before_even_pages_in_range,
            insert_blank_after_odd_pages_in_range,
            insert_blank_after_even_pages_in_range,
            bookmark_odd_pages_in_range,
            bookmark_even_pages_in_range,
            set_page_size_odd_pages_in_range,
            set_page_size_even_pages_in_range,
            extract_odd_pages_in_range,
            extract_even_pages_in_range,
            add_page_numbers_odd_pages_in_range,
            add_page_numbers_even_pages_in_range,
            add_text_watermark_odd_pages_in_range,
            add_text_watermark_even_pages_in_range,
            add_page_header_odd_pages_in_range,
            add_page_header_even_pages_in_range,
            add_page_footer_odd_pages_in_range,
            add_page_footer_even_pages_in_range,
            add_page_border_odd_pages_in_range,
            add_page_border_even_pages_in_range,
            export_odd_pages_in_range_as_pdf,
            export_even_pages_in_range_as_pdf,
            export_odd_pages_in_range_png,
            export_even_pages_in_range_png,
            export_odd_pages_in_range_jpeg,
            export_even_pages_in_range_jpeg,
            export_odd_pages_in_range_webp,
            export_even_pages_in_range_webp,
            export_odd_pages_in_range_bmp,
            export_even_pages_in_range_bmp,
            export_odd_pages_in_range_tiff,
            export_even_pages_in_range_tiff,
            export_odd_pages_in_range_gif,
            export_even_pages_in_range_gif,
            export_odd_pages_in_range_ppm,
            export_even_pages_in_range_ppm,
            export_odd_pages_in_range_tga,
            export_even_pages_in_range_tga,
            export_odd_pages_in_range_ico,
            export_even_pages_in_range_ico,
            rotate_range_local_odd_pages,
            rotate_range_local_even_pages,
            rotate_range_local_odd_pages_ccw,
            rotate_range_local_even_pages_ccw,
            rotate_180_range_local_odd_pages,
            rotate_180_range_local_even_pages,
            reset_rotation_range_local_odd_pages,
            reset_rotation_range_local_even_pages,
            delete_range_local_odd_pages,
            delete_range_local_even_pages,
            keep_range_local_odd_pages,
            keep_range_local_even_pages,
            duplicate_range_local_odd_pages,
            duplicate_range_local_even_pages,
            duplicate_range_local_odd_pages_before,
            duplicate_range_local_even_pages_before,
            flatten_range_local_odd_pages,
            flatten_range_local_even_pages,
            export_odd_pages_ico,
            export_even_pages_ico,
            // PARITY_BATCH_HANDLERS_END
            // PARITY_BATCH2_HANDLERS_START
            reverse_range_local_odd_pages,
            reverse_range_local_even_pages,
            move_odd_range_local_pages_to_start,
            move_even_range_local_pages_to_start,
            move_odd_range_local_pages_to_end,
            move_even_range_local_pages_to_end,
            sort_range_local_odd_pages_by_rotation,
            sort_range_local_even_pages_by_rotation,
            sort_range_local_odd_pages_by_size,
            sort_range_local_even_pages_by_size,
            duplicate_range_local_odd_pages_to_start,
            duplicate_range_local_even_pages_to_start,
            duplicate_range_local_odd_pages_to_end,
            duplicate_range_local_even_pages_to_end,
            crop_range_local_odd_pages,
            crop_range_local_even_pages,
            expand_range_local_odd_pages,
            expand_range_local_even_pages,
            shrink_range_local_odd_pages,
            shrink_range_local_even_pages,
            clear_crop_range_local_odd_pages,
            clear_crop_range_local_even_pages,
            insert_blank_before_range_local_odd_pages,
            insert_blank_before_range_local_even_pages,
            insert_blank_after_range_local_odd_pages,
            insert_blank_after_range_local_even_pages,
            bookmark_range_local_odd_pages,
            bookmark_range_local_even_pages,
            set_page_size_range_local_odd_pages,
            set_page_size_range_local_even_pages,
            extract_range_local_odd_pages,
            extract_range_local_even_pages,
            add_page_numbers_range_local_odd_pages,
            add_page_numbers_range_local_even_pages,
            add_text_watermark_range_local_odd_pages,
            add_text_watermark_range_local_even_pages,
            add_page_header_range_local_odd_pages,
            add_page_header_range_local_even_pages,
            add_page_footer_range_local_odd_pages,
            add_page_footer_range_local_even_pages,
            add_page_border_range_local_odd_pages,
            add_page_border_range_local_even_pages,
            export_range_local_odd_pages_as_pdf,
            export_range_local_even_pages_as_pdf,
            export_range_local_odd_pages_png,
            export_range_local_even_pages_png,
            export_range_local_odd_pages_jpeg,
            export_range_local_even_pages_jpeg,
            export_range_local_odd_pages_webp,
            export_range_local_even_pages_webp,
            export_range_local_odd_pages_bmp,
            export_range_local_even_pages_bmp,
            export_range_local_odd_pages_tiff,
            export_range_local_even_pages_tiff,
            export_range_local_odd_pages_gif,
            export_range_local_even_pages_gif,
            export_range_local_odd_pages_ppm,
            export_range_local_even_pages_ppm,
            export_range_local_odd_pages_tga,
            export_range_local_even_pages_tga,
            rotate_mod3_0_pages_in_range_mod3,
            rotate_mod3_1_pages_in_range_mod3,
            rotate_mod3_2_pages_in_range_mod3,
            rotate_mod3_0_pages_in_range_mod3_ccw,
            rotate_mod3_1_pages_in_range_mod3_ccw,
            rotate_mod3_2_pages_in_range_mod3_ccw,
            rotate_180_mod3_0_pages_in_range_mod3,
            rotate_180_mod3_1_pages_in_range_mod3,
            rotate_180_mod3_2_pages_in_range_mod3,
            reset_rotation_mod3_0_pages_in_range_mod3,
            reset_rotation_mod3_1_pages_in_range_mod3,
            reset_rotation_mod3_2_pages_in_range_mod3,
            delete_mod3_0_pages_in_range_mod3,
            delete_mod3_1_pages_in_range_mod3,
            delete_mod3_2_pages_in_range_mod3,
            keep_mod3_0_pages_in_range_mod3,
            keep_mod3_1_pages_in_range_mod3,
            keep_mod3_2_pages_in_range_mod3,
            duplicate_mod3_0_pages_in_range_mod3,
            duplicate_mod3_1_pages_in_range_mod3,
            duplicate_mod3_2_pages_in_range_mod3,
            flatten_mod3_0_pages_in_range_mod3,
            flatten_mod3_1_pages_in_range_mod3,
            flatten_mod3_2_pages_in_range_mod3,
            reverse_mod3_0_pages_in_range_mod3,
            reverse_mod3_1_pages_in_range_mod3,
            reverse_mod3_2_pages_in_range_mod3,
            crop_mod3_0_pages_in_range_mod3,
            crop_mod3_1_pages_in_range_mod3,
            crop_mod3_2_pages_in_range_mod3,
            extract_mod3_0_pages_in_range_mod3,
            extract_mod3_1_pages_in_range_mod3,
            extract_mod3_2_pages_in_range_mod3,
            export_mod3_0_pages_in_range_mod3_as_pdf,
            export_mod3_1_pages_in_range_mod3_as_pdf,
            export_mod3_2_pages_in_range_mod3_as_pdf,
            export_mod3_0_pages_in_range_mod3_png,
            export_mod3_1_pages_in_range_mod3_png,
            export_mod3_2_pages_in_range_mod3_png,
            export_mod3_0_pages_in_range_mod3_jpeg,
            // PARITY_BATCH2_HANDLERS_END
            // PARITY_BATCH3_HANDLERS_START
            duplicate_mod3_0_pages_in_range_before_mod3,
            duplicate_mod3_1_pages_in_range_before_mod3,
            duplicate_mod3_2_pages_in_range_before_mod3,
            duplicate_mod3_0_pages_in_range_to_start_mod3,
            duplicate_mod3_1_pages_in_range_to_start_mod3,
            duplicate_mod3_2_pages_in_range_to_start_mod3,
            duplicate_mod3_0_pages_in_range_to_end_mod3,
            duplicate_mod3_1_pages_in_range_to_end_mod3,
            duplicate_mod3_2_pages_in_range_to_end_mod3,
            expand_mod3_0_pages_in_range_mod3,
            expand_mod3_1_pages_in_range_mod3,
            expand_mod3_2_pages_in_range_mod3,
            shrink_mod3_0_pages_in_range_mod3,
            shrink_mod3_1_pages_in_range_mod3,
            shrink_mod3_2_pages_in_range_mod3,
            clear_crop_mod3_0_pages_in_range_mod3,
            clear_crop_mod3_1_pages_in_range_mod3,
            clear_crop_mod3_2_pages_in_range_mod3,
            insert_blank_before_mod3_0_pages_in_range_mod3,
            insert_blank_before_mod3_1_pages_in_range_mod3,
            insert_blank_before_mod3_2_pages_in_range_mod3,
            insert_blank_after_mod3_0_pages_in_range_mod3,
            insert_blank_after_mod3_1_pages_in_range_mod3,
            insert_blank_after_mod3_2_pages_in_range_mod3,
            bookmark_mod3_0_pages_in_range_mod3,
            bookmark_mod3_1_pages_in_range_mod3,
            bookmark_mod3_2_pages_in_range_mod3,
            set_page_size_mod3_0_pages_in_range_mod3,
            set_page_size_mod3_1_pages_in_range_mod3,
            set_page_size_mod3_2_pages_in_range_mod3,
            add_page_numbers_mod3_0_pages_in_range_mod3,
            add_page_numbers_mod3_1_pages_in_range_mod3,
            add_page_numbers_mod3_2_pages_in_range_mod3,
            add_text_watermark_mod3_0_pages_in_range_mod3,
            add_text_watermark_mod3_1_pages_in_range_mod3,
            add_text_watermark_mod3_2_pages_in_range_mod3,
            add_page_header_mod3_0_pages_in_range_mod3,
            add_page_header_mod3_1_pages_in_range_mod3,
            add_page_header_mod3_2_pages_in_range_mod3,
            add_page_footer_mod3_0_pages_in_range_mod3,
            add_page_footer_mod3_1_pages_in_range_mod3,
            add_page_footer_mod3_2_pages_in_range_mod3,
            add_page_border_mod3_0_pages_in_range_mod3,
            add_page_border_mod3_1_pages_in_range_mod3,
            add_page_border_mod3_2_pages_in_range_mod3,
            export_mod3_0_pages_in_range_mod3_webp,
            export_mod3_1_pages_in_range_mod3_webp,
            export_mod3_2_pages_in_range_mod3_webp,
            export_mod3_0_pages_in_range_mod3_bmp,
            export_mod3_1_pages_in_range_mod3_bmp,
            export_mod3_2_pages_in_range_mod3_bmp,
            export_mod3_0_pages_in_range_mod3_tiff,
            export_mod3_1_pages_in_range_mod3_tiff,
            export_mod3_2_pages_in_range_mod3_tiff,
            export_mod3_0_pages_in_range_mod3_gif,
            export_mod3_1_pages_in_range_mod3_gif,
            export_mod3_2_pages_in_range_mod3_gif,
            export_mod3_0_pages_in_range_mod3_ppm,
            export_mod3_1_pages_in_range_mod3_ppm,
            export_mod3_2_pages_in_range_mod3_ppm,
            export_mod3_0_pages_in_range_mod3_tga,
            export_mod3_1_pages_in_range_mod3_tga,
            export_mod3_2_pages_in_range_mod3_tga,
            export_mod3_0_pages_in_range_mod3_ico,
            export_mod3_1_pages_in_range_mod3_ico,
            export_mod3_2_pages_in_range_mod3_ico,
            export_mod3_1_pages_in_range_mod3_jpeg,
            export_mod3_2_pages_in_range_mod3_jpeg,
            rotate_first_half_pages_in_range,
            rotate_second_half_pages_in_range,
            rotate_first_half_pages_in_range_ccw,
            rotate_second_half_pages_in_range_ccw,
            rotate_180_first_half_pages_in_range,
            rotate_180_second_half_pages_in_range,
            reset_rotation_first_half_pages_in_range,
            reset_rotation_second_half_pages_in_range,
            delete_first_half_pages_in_range,
            delete_second_half_pages_in_range,
            keep_first_half_pages_in_range,
            keep_second_half_pages_in_range,
            duplicate_first_half_pages_in_range,
            duplicate_second_half_pages_in_range,
            flatten_first_half_pages_in_range,
            flatten_second_half_pages_in_range,
            reverse_first_half_pages_in_range,
            reverse_second_half_pages_in_range,
            crop_first_half_pages_in_range,
            crop_second_half_pages_in_range,
            extract_first_half_pages_in_range,
            extract_second_half_pages_in_range,
            export_first_half_pages_in_range_as_pdf,
            export_second_half_pages_in_range_as_pdf,
            export_first_half_pages_in_range_png,
            export_second_half_pages_in_range_png,
            export_first_half_pages_in_range_jpeg,
            export_second_half_pages_in_range_jpeg,
            add_page_numbers_first_half_pages_in_range,
            add_page_numbers_second_half_pages_in_range,
            add_text_watermark_first_half_pages_in_range,
            add_text_watermark_second_half_pages_in_range,
            // PARITY_BATCH3_HANDLERS_END
            // PARITY_BATCH4_HANDLERS_START
            duplicate_first_half_pages_in_range_before,
            duplicate_second_half_pages_in_range_before,
            duplicate_first_half_pages_in_range_to_start,
            duplicate_second_half_pages_in_range_to_start,
            duplicate_first_half_pages_in_range_to_end,
            duplicate_second_half_pages_in_range_to_end,
            expand_first_half_pages_in_range,
            expand_second_half_pages_in_range,
            shrink_first_half_pages_in_range,
            shrink_second_half_pages_in_range,
            clear_crop_first_half_pages_in_range,
            clear_crop_second_half_pages_in_range,
            insert_blank_before_first_half_pages_in_range,
            insert_blank_before_second_half_pages_in_range,
            insert_blank_after_first_half_pages_in_range,
            insert_blank_after_second_half_pages_in_range,
            bookmark_first_half_pages_in_range,
            bookmark_second_half_pages_in_range,
            set_page_size_first_half_pages_in_range,
            set_page_size_second_half_pages_in_range,
            add_page_header_first_half_pages_in_range,
            add_page_header_second_half_pages_in_range,
            add_page_footer_first_half_pages_in_range,
            add_page_footer_second_half_pages_in_range,
            add_page_border_first_half_pages_in_range,
            add_page_border_second_half_pages_in_range,
            export_first_half_pages_in_range_webp,
            export_second_half_pages_in_range_webp,
            export_first_half_pages_in_range_bmp,
            export_second_half_pages_in_range_bmp,
            export_first_half_pages_in_range_tiff,
            export_second_half_pages_in_range_tiff,
            export_first_half_pages_in_range_gif,
            export_second_half_pages_in_range_gif,
            export_first_half_pages_in_range_ppm,
            export_second_half_pages_in_range_ppm,
            export_first_half_pages_in_range_tga,
            export_second_half_pages_in_range_tga,
            export_first_half_pages_in_range_ico,
            export_second_half_pages_in_range_ico,
            sort_first_half_pages_in_range_by_rotation,
            sort_second_half_pages_in_range_by_rotation,
            sort_first_half_pages_in_range_by_size,
            sort_second_half_pages_in_range_by_size,
            rotate_mod4_0_pages_in_range_mod4,
            rotate_mod4_1_pages_in_range_mod4,
            rotate_mod4_2_pages_in_range_mod4,
            rotate_mod4_3_pages_in_range_mod4,
            rotate_mod4_0_pages_in_range_mod4_ccw,
            rotate_mod4_1_pages_in_range_mod4_ccw,
            rotate_mod4_2_pages_in_range_mod4_ccw,
            rotate_mod4_3_pages_in_range_mod4_ccw,
            rotate_180_mod4_0_pages_in_range_mod4,
            rotate_180_mod4_1_pages_in_range_mod4,
            rotate_180_mod4_2_pages_in_range_mod4,
            rotate_180_mod4_3_pages_in_range_mod4,
            reset_rotation_mod4_0_pages_in_range_mod4,
            reset_rotation_mod4_1_pages_in_range_mod4,
            reset_rotation_mod4_2_pages_in_range_mod4,
            reset_rotation_mod4_3_pages_in_range_mod4,
            delete_mod4_0_pages_in_range_mod4,
            delete_mod4_1_pages_in_range_mod4,
            delete_mod4_2_pages_in_range_mod4,
            delete_mod4_3_pages_in_range_mod4,
            keep_mod4_0_pages_in_range_mod4,
            keep_mod4_1_pages_in_range_mod4,
            keep_mod4_2_pages_in_range_mod4,
            keep_mod4_3_pages_in_range_mod4,
            duplicate_mod4_0_pages_in_range_mod4,
            duplicate_mod4_1_pages_in_range_mod4,
            duplicate_mod4_2_pages_in_range_mod4,
            duplicate_mod4_3_pages_in_range_mod4,
            flatten_mod4_0_pages_in_range_mod4,
            flatten_mod4_1_pages_in_range_mod4,
            flatten_mod4_2_pages_in_range_mod4,
            flatten_mod4_3_pages_in_range_mod4,
            reverse_mod4_0_pages_in_range_mod4,
            reverse_mod4_1_pages_in_range_mod4,
            reverse_mod4_2_pages_in_range_mod4,
            reverse_mod4_3_pages_in_range_mod4,
            crop_mod4_0_pages_in_range_mod4,
            crop_mod4_1_pages_in_range_mod4,
            crop_mod4_2_pages_in_range_mod4,
            crop_mod4_3_pages_in_range_mod4,
            extract_mod4_0_pages_in_range_mod4,
            extract_mod4_1_pages_in_range_mod4,
            extract_mod4_2_pages_in_range_mod4,
            extract_mod4_3_pages_in_range_mod4,
            export_mod4_0_pages_in_range_mod4_as_pdf,
            export_mod4_1_pages_in_range_mod4_as_pdf,
            export_mod4_2_pages_in_range_mod4_as_pdf,
            export_mod4_3_pages_in_range_mod4_as_pdf,
            export_mod4_0_pages_in_range_mod4_png,
            export_mod4_1_pages_in_range_mod4_png,
            export_mod4_2_pages_in_range_mod4_png,
            export_mod4_3_pages_in_range_mod4_png,
            export_mod4_0_pages_in_range_mod4_jpeg,
            export_mod4_1_pages_in_range_mod4_jpeg,
            export_mod4_2_pages_in_range_mod4_jpeg,
            export_mod4_3_pages_in_range_mod4_jpeg,
            // PARITY_BATCH4_HANDLERS_END
            // PARITY_BATCH5_HANDLERS_START
            duplicate_mod4_0_pages_in_range_before_mod4,
            duplicate_mod4_1_pages_in_range_before_mod4,
            duplicate_mod4_2_pages_in_range_before_mod4,
            duplicate_mod4_3_pages_in_range_before_mod4,
            duplicate_mod4_0_pages_in_range_to_start_mod4,
            duplicate_mod4_1_pages_in_range_to_start_mod4,
            duplicate_mod4_2_pages_in_range_to_start_mod4,
            duplicate_mod4_3_pages_in_range_to_start_mod4,
            duplicate_mod4_0_pages_in_range_to_end_mod4,
            duplicate_mod4_1_pages_in_range_to_end_mod4,
            duplicate_mod4_2_pages_in_range_to_end_mod4,
            duplicate_mod4_3_pages_in_range_to_end_mod4,
            expand_mod4_0_pages_in_range_mod4,
            expand_mod4_1_pages_in_range_mod4,
            expand_mod4_2_pages_in_range_mod4,
            expand_mod4_3_pages_in_range_mod4,
            shrink_mod4_0_pages_in_range_mod4,
            shrink_mod4_1_pages_in_range_mod4,
            shrink_mod4_2_pages_in_range_mod4,
            shrink_mod4_3_pages_in_range_mod4,
            clear_crop_mod4_0_pages_in_range_mod4,
            clear_crop_mod4_1_pages_in_range_mod4,
            clear_crop_mod4_2_pages_in_range_mod4,
            clear_crop_mod4_3_pages_in_range_mod4,
            insert_blank_before_mod4_0_pages_in_range_mod4,
            insert_blank_before_mod4_1_pages_in_range_mod4,
            insert_blank_before_mod4_2_pages_in_range_mod4,
            insert_blank_before_mod4_3_pages_in_range_mod4,
            insert_blank_after_mod4_0_pages_in_range_mod4,
            insert_blank_after_mod4_1_pages_in_range_mod4,
            insert_blank_after_mod4_2_pages_in_range_mod4,
            insert_blank_after_mod4_3_pages_in_range_mod4,
            bookmark_mod4_0_pages_in_range_mod4,
            bookmark_mod4_1_pages_in_range_mod4,
            bookmark_mod4_2_pages_in_range_mod4,
            bookmark_mod4_3_pages_in_range_mod4,
            set_page_size_mod4_0_pages_in_range_mod4,
            set_page_size_mod4_1_pages_in_range_mod4,
            set_page_size_mod4_2_pages_in_range_mod4,
            set_page_size_mod4_3_pages_in_range_mod4,
            add_page_numbers_mod4_0_pages_in_range_mod4,
            add_page_numbers_mod4_1_pages_in_range_mod4,
            add_page_numbers_mod4_2_pages_in_range_mod4,
            add_page_numbers_mod4_3_pages_in_range_mod4,
            add_text_watermark_mod4_0_pages_in_range_mod4,
            add_text_watermark_mod4_1_pages_in_range_mod4,
            add_text_watermark_mod4_2_pages_in_range_mod4,
            add_text_watermark_mod4_3_pages_in_range_mod4,
            add_page_header_mod4_0_pages_in_range_mod4,
            add_page_header_mod4_1_pages_in_range_mod4,
            add_page_header_mod4_2_pages_in_range_mod4,
            add_page_header_mod4_3_pages_in_range_mod4,
            add_page_footer_mod4_0_pages_in_range_mod4,
            add_page_footer_mod4_1_pages_in_range_mod4,
            add_page_footer_mod4_2_pages_in_range_mod4,
            add_page_footer_mod4_3_pages_in_range_mod4,
            add_page_border_mod4_0_pages_in_range_mod4,
            add_page_border_mod4_1_pages_in_range_mod4,
            add_page_border_mod4_2_pages_in_range_mod4,
            add_page_border_mod4_3_pages_in_range_mod4,
            export_mod4_0_pages_in_range_mod4_webp,
            export_mod4_1_pages_in_range_mod4_webp,
            export_mod4_2_pages_in_range_mod4_webp,
            export_mod4_3_pages_in_range_mod4_webp,
            export_mod4_0_pages_in_range_mod4_bmp,
            export_mod4_1_pages_in_range_mod4_bmp,
            export_mod4_2_pages_in_range_mod4_bmp,
            export_mod4_3_pages_in_range_mod4_bmp,
            export_mod4_0_pages_in_range_mod4_tiff,
            export_mod4_1_pages_in_range_mod4_tiff,
            export_mod4_2_pages_in_range_mod4_tiff,
            export_mod4_3_pages_in_range_mod4_tiff,
            export_mod4_0_pages_in_range_mod4_gif,
            export_mod4_1_pages_in_range_mod4_gif,
            export_mod4_2_pages_in_range_mod4_gif,
            export_mod4_3_pages_in_range_mod4_gif,
            export_mod4_0_pages_in_range_mod4_ppm,
            export_mod4_1_pages_in_range_mod4_ppm,
            export_mod4_2_pages_in_range_mod4_ppm,
            export_mod4_3_pages_in_range_mod4_ppm,
            export_mod4_0_pages_in_range_mod4_tga,
            export_mod4_1_pages_in_range_mod4_tga,
            export_mod4_2_pages_in_range_mod4_tga,
            export_mod4_3_pages_in_range_mod4_tga,
            export_mod4_0_pages_in_range_mod4_ico,
            export_mod4_1_pages_in_range_mod4_ico,
            export_mod4_2_pages_in_range_mod4_ico,
            export_mod4_3_pages_in_range_mod4_ico,
            // PARITY_BATCH5_HANDLERS_END
            // PARITY_BATCH6_HANDLERS_START
            rotate_mod5_0_pages_in_range_mod5,
            rotate_mod5_1_pages_in_range_mod5,
            rotate_mod5_2_pages_in_range_mod5,
            rotate_mod5_3_pages_in_range_mod5,
            rotate_mod5_4_pages_in_range_mod5,
            rotate_mod5_0_pages_in_range_mod5_ccw,
            rotate_mod5_1_pages_in_range_mod5_ccw,
            rotate_mod5_2_pages_in_range_mod5_ccw,
            rotate_mod5_3_pages_in_range_mod5_ccw,
            rotate_mod5_4_pages_in_range_mod5_ccw,
            rotate_180_mod5_0_pages_in_range_mod5,
            rotate_180_mod5_1_pages_in_range_mod5,
            rotate_180_mod5_2_pages_in_range_mod5,
            rotate_180_mod5_3_pages_in_range_mod5,
            rotate_180_mod5_4_pages_in_range_mod5,
            reset_rotation_mod5_0_pages_in_range_mod5,
            reset_rotation_mod5_1_pages_in_range_mod5,
            reset_rotation_mod5_2_pages_in_range_mod5,
            reset_rotation_mod5_3_pages_in_range_mod5,
            reset_rotation_mod5_4_pages_in_range_mod5,
            delete_mod5_0_pages_in_range_mod5,
            delete_mod5_1_pages_in_range_mod5,
            delete_mod5_2_pages_in_range_mod5,
            delete_mod5_3_pages_in_range_mod5,
            delete_mod5_4_pages_in_range_mod5,
            keep_mod5_0_pages_in_range_mod5,
            keep_mod5_1_pages_in_range_mod5,
            keep_mod5_2_pages_in_range_mod5,
            keep_mod5_3_pages_in_range_mod5,
            keep_mod5_4_pages_in_range_mod5,
            duplicate_mod5_0_pages_in_range_mod5,
            duplicate_mod5_1_pages_in_range_mod5,
            duplicate_mod5_2_pages_in_range_mod5,
            duplicate_mod5_3_pages_in_range_mod5,
            duplicate_mod5_4_pages_in_range_mod5,
            flatten_mod5_0_pages_in_range_mod5,
            flatten_mod5_1_pages_in_range_mod5,
            flatten_mod5_2_pages_in_range_mod5,
            flatten_mod5_3_pages_in_range_mod5,
            flatten_mod5_4_pages_in_range_mod5,
            reverse_mod5_0_pages_in_range_mod5,
            reverse_mod5_1_pages_in_range_mod5,
            reverse_mod5_2_pages_in_range_mod5,
            reverse_mod5_3_pages_in_range_mod5,
            reverse_mod5_4_pages_in_range_mod5,
            crop_mod5_0_pages_in_range_mod5,
            crop_mod5_1_pages_in_range_mod5,
            crop_mod5_2_pages_in_range_mod5,
            crop_mod5_3_pages_in_range_mod5,
            crop_mod5_4_pages_in_range_mod5,
            extract_mod5_0_pages_in_range_mod5,
            extract_mod5_1_pages_in_range_mod5,
            extract_mod5_2_pages_in_range_mod5,
            extract_mod5_3_pages_in_range_mod5,
            extract_mod5_4_pages_in_range_mod5,
            export_mod5_0_pages_in_range_mod5_as_pdf,
            export_mod5_1_pages_in_range_mod5_as_pdf,
            export_mod5_2_pages_in_range_mod5_as_pdf,
            export_mod5_3_pages_in_range_mod5_as_pdf,
            export_mod5_4_pages_in_range_mod5_as_pdf,
            export_mod5_0_pages_in_range_mod5_png,
            export_mod5_1_pages_in_range_mod5_png,
            export_mod5_2_pages_in_range_mod5_png,
            export_mod5_3_pages_in_range_mod5_png,
            export_mod5_4_pages_in_range_mod5_png,
            export_mod5_0_pages_in_range_mod5_jpeg,
            export_mod5_1_pages_in_range_mod5_jpeg,
            export_mod5_2_pages_in_range_mod5_jpeg,
            export_mod5_3_pages_in_range_mod5_jpeg,
            export_mod5_4_pages_in_range_mod5_jpeg,
            duplicate_mod5_0_pages_in_range_before_mod5,
            duplicate_mod5_1_pages_in_range_before_mod5,
            duplicate_mod5_2_pages_in_range_before_mod5,
            duplicate_mod5_3_pages_in_range_before_mod5,
            duplicate_mod5_4_pages_in_range_before_mod5,
            duplicate_mod5_0_pages_in_range_to_start_mod5,
            duplicate_mod5_1_pages_in_range_to_start_mod5,
            duplicate_mod5_2_pages_in_range_to_start_mod5,
            duplicate_mod5_3_pages_in_range_to_start_mod5,
            duplicate_mod5_4_pages_in_range_to_start_mod5,
            duplicate_mod5_0_pages_in_range_to_end_mod5,
            duplicate_mod5_1_pages_in_range_to_end_mod5,
            duplicate_mod5_2_pages_in_range_to_end_mod5,
            duplicate_mod5_3_pages_in_range_to_end_mod5,
            duplicate_mod5_4_pages_in_range_to_end_mod5,
            expand_mod5_0_pages_in_range_mod5,
            expand_mod5_1_pages_in_range_mod5,
            expand_mod5_2_pages_in_range_mod5,
            expand_mod5_3_pages_in_range_mod5,
            expand_mod5_4_pages_in_range_mod5,
            shrink_mod5_0_pages_in_range_mod5,
            shrink_mod5_1_pages_in_range_mod5,
            shrink_mod5_2_pages_in_range_mod5,
            shrink_mod5_3_pages_in_range_mod5,
            shrink_mod5_4_pages_in_range_mod5,
            clear_crop_mod5_0_pages_in_range_mod5,
            clear_crop_mod5_1_pages_in_range_mod5,
            clear_crop_mod5_2_pages_in_range_mod5,
            clear_crop_mod5_3_pages_in_range_mod5,
            clear_crop_mod5_4_pages_in_range_mod5,
            insert_blank_before_mod5_0_pages_in_range_mod5,
            insert_blank_before_mod5_1_pages_in_range_mod5,
            insert_blank_before_mod5_2_pages_in_range_mod5,
            insert_blank_before_mod5_3_pages_in_range_mod5,
            insert_blank_before_mod5_4_pages_in_range_mod5,
            insert_blank_after_mod5_0_pages_in_range_mod5,
            insert_blank_after_mod5_1_pages_in_range_mod5,
            insert_blank_after_mod5_2_pages_in_range_mod5,
            insert_blank_after_mod5_3_pages_in_range_mod5,
            insert_blank_after_mod5_4_pages_in_range_mod5,
            bookmark_mod5_0_pages_in_range_mod5,
            bookmark_mod5_1_pages_in_range_mod5,
            bookmark_mod5_2_pages_in_range_mod5,
            bookmark_mod5_3_pages_in_range_mod5,
            bookmark_mod5_4_pages_in_range_mod5,
            set_page_size_mod5_0_pages_in_range_mod5,
            set_page_size_mod5_1_pages_in_range_mod5,
            set_page_size_mod5_2_pages_in_range_mod5,
            set_page_size_mod5_3_pages_in_range_mod5,
            set_page_size_mod5_4_pages_in_range_mod5,
            add_page_numbers_mod5_0_pages_in_range_mod5,
            add_page_numbers_mod5_1_pages_in_range_mod5,
            add_page_numbers_mod5_2_pages_in_range_mod5,
            add_page_numbers_mod5_3_pages_in_range_mod5,
            add_page_numbers_mod5_4_pages_in_range_mod5,
            add_text_watermark_mod5_0_pages_in_range_mod5,
            add_text_watermark_mod5_1_pages_in_range_mod5,
            add_text_watermark_mod5_2_pages_in_range_mod5,
            add_text_watermark_mod5_3_pages_in_range_mod5,
            add_text_watermark_mod5_4_pages_in_range_mod5,
            add_page_header_mod5_0_pages_in_range_mod5,
            add_page_header_mod5_1_pages_in_range_mod5,
            add_page_header_mod5_2_pages_in_range_mod5,
            add_page_header_mod5_3_pages_in_range_mod5,
            add_page_header_mod5_4_pages_in_range_mod5,
            add_page_footer_mod5_0_pages_in_range_mod5,
            add_page_footer_mod5_1_pages_in_range_mod5,
            add_page_footer_mod5_2_pages_in_range_mod5,
            add_page_footer_mod5_3_pages_in_range_mod5,
            add_page_footer_mod5_4_pages_in_range_mod5,
            add_page_border_mod5_0_pages_in_range_mod5,
            add_page_border_mod5_1_pages_in_range_mod5,
            add_page_border_mod5_2_pages_in_range_mod5,
            add_page_border_mod5_3_pages_in_range_mod5,
            add_page_border_mod5_4_pages_in_range_mod5,
            export_mod5_0_pages_in_range_mod5_webp,
            export_mod5_1_pages_in_range_mod5_webp,
            export_mod5_2_pages_in_range_mod5_webp,
            export_mod5_3_pages_in_range_mod5_webp,
            export_mod5_4_pages_in_range_mod5_webp,
            export_mod5_0_pages_in_range_mod5_bmp,
            export_mod5_1_pages_in_range_mod5_bmp,
            export_mod5_2_pages_in_range_mod5_bmp,
            export_mod5_3_pages_in_range_mod5_bmp,
            export_mod5_4_pages_in_range_mod5_bmp,
            export_mod5_0_pages_in_range_mod5_tiff,
            export_mod5_1_pages_in_range_mod5_tiff,
            export_mod5_2_pages_in_range_mod5_tiff,
            export_mod5_3_pages_in_range_mod5_tiff,
            export_mod5_4_pages_in_range_mod5_tiff,
            export_mod5_0_pages_in_range_mod5_gif,
            export_mod5_1_pages_in_range_mod5_gif,
            export_mod5_2_pages_in_range_mod5_gif,
            export_mod5_3_pages_in_range_mod5_gif,
            export_mod5_4_pages_in_range_mod5_gif,
            export_mod5_0_pages_in_range_mod5_ppm,
            export_mod5_1_pages_in_range_mod5_ppm,
            export_mod5_2_pages_in_range_mod5_ppm,
            export_mod5_3_pages_in_range_mod5_ppm,
            export_mod5_4_pages_in_range_mod5_ppm,
            export_mod5_0_pages_in_range_mod5_tga,
            export_mod5_1_pages_in_range_mod5_tga,
            export_mod5_2_pages_in_range_mod5_tga,
            export_mod5_3_pages_in_range_mod5_tga,
            export_mod5_4_pages_in_range_mod5_tga,
            export_mod5_0_pages_in_range_mod5_ico,
            export_mod5_1_pages_in_range_mod5_ico,
            export_mod5_2_pages_in_range_mod5_ico,
            export_mod5_3_pages_in_range_mod5_ico,
            export_mod5_4_pages_in_range_mod5_ico,
            rotate_mod6_0_pages_in_range_mod6,
            rotate_mod6_1_pages_in_range_mod6,
            rotate_mod6_2_pages_in_range_mod6,
            rotate_mod6_3_pages_in_range_mod6,
            rotate_mod6_4_pages_in_range_mod6,
            rotate_mod6_5_pages_in_range_mod6,
            rotate_mod6_0_pages_in_range_mod6_ccw,
            rotate_mod6_1_pages_in_range_mod6_ccw,
            rotate_mod6_2_pages_in_range_mod6_ccw,
            rotate_mod6_3_pages_in_range_mod6_ccw,
            rotate_mod6_4_pages_in_range_mod6_ccw,
            rotate_mod6_5_pages_in_range_mod6_ccw,
            rotate_180_mod6_0_pages_in_range_mod6,
            rotate_180_mod6_1_pages_in_range_mod6,
            rotate_180_mod6_2_pages_in_range_mod6,
            rotate_180_mod6_3_pages_in_range_mod6,
            rotate_180_mod6_4_pages_in_range_mod6,
            rotate_180_mod6_5_pages_in_range_mod6,
            reset_rotation_mod6_0_pages_in_range_mod6,
            reset_rotation_mod6_1_pages_in_range_mod6,
            reset_rotation_mod6_2_pages_in_range_mod6,
            reset_rotation_mod6_3_pages_in_range_mod6,
            reset_rotation_mod6_4_pages_in_range_mod6,
            reset_rotation_mod6_5_pages_in_range_mod6,
            delete_mod6_0_pages_in_range_mod6,
            delete_mod6_1_pages_in_range_mod6,
            delete_mod6_2_pages_in_range_mod6,
            delete_mod6_3_pages_in_range_mod6,
            delete_mod6_4_pages_in_range_mod6,
            delete_mod6_5_pages_in_range_mod6,
            keep_mod6_0_pages_in_range_mod6,
            keep_mod6_1_pages_in_range_mod6,
            keep_mod6_2_pages_in_range_mod6,
            keep_mod6_3_pages_in_range_mod6,
            keep_mod6_4_pages_in_range_mod6,
            keep_mod6_5_pages_in_range_mod6,
            duplicate_mod6_0_pages_in_range_mod6,
            duplicate_mod6_1_pages_in_range_mod6,
            duplicate_mod6_2_pages_in_range_mod6,
            duplicate_mod6_3_pages_in_range_mod6,
            duplicate_mod6_4_pages_in_range_mod6,
            duplicate_mod6_5_pages_in_range_mod6,
            flatten_mod6_0_pages_in_range_mod6,
            flatten_mod6_1_pages_in_range_mod6,
            flatten_mod6_2_pages_in_range_mod6,
            flatten_mod6_3_pages_in_range_mod6,
            flatten_mod6_4_pages_in_range_mod6,
            flatten_mod6_5_pages_in_range_mod6,
            reverse_mod6_0_pages_in_range_mod6,
            reverse_mod6_1_pages_in_range_mod6,
            reverse_mod6_2_pages_in_range_mod6,
            reverse_mod6_3_pages_in_range_mod6,
            reverse_mod6_4_pages_in_range_mod6,
            reverse_mod6_5_pages_in_range_mod6,
            crop_mod6_0_pages_in_range_mod6,
            crop_mod6_1_pages_in_range_mod6,
            crop_mod6_2_pages_in_range_mod6,
            crop_mod6_3_pages_in_range_mod6,
            crop_mod6_4_pages_in_range_mod6,
            crop_mod6_5_pages_in_range_mod6,
            extract_mod6_0_pages_in_range_mod6,
            extract_mod6_1_pages_in_range_mod6,
            extract_mod6_2_pages_in_range_mod6,
            extract_mod6_3_pages_in_range_mod6,
            extract_mod6_4_pages_in_range_mod6,
            extract_mod6_5_pages_in_range_mod6,
            export_mod6_0_pages_in_range_mod6_as_pdf,
            export_mod6_1_pages_in_range_mod6_as_pdf,
            export_mod6_2_pages_in_range_mod6_as_pdf,
            export_mod6_3_pages_in_range_mod6_as_pdf,
            export_mod6_4_pages_in_range_mod6_as_pdf,
            export_mod6_5_pages_in_range_mod6_as_pdf,
            export_mod6_0_pages_in_range_mod6_png,
            export_mod6_1_pages_in_range_mod6_png,
            export_mod6_2_pages_in_range_mod6_png,
            export_mod6_3_pages_in_range_mod6_png,
            export_mod6_4_pages_in_range_mod6_png,
            export_mod6_5_pages_in_range_mod6_png,
            export_mod6_0_pages_in_range_mod6_jpeg,
            export_mod6_1_pages_in_range_mod6_jpeg,
            export_mod6_2_pages_in_range_mod6_jpeg,
            export_mod6_3_pages_in_range_mod6_jpeg,
            export_mod6_4_pages_in_range_mod6_jpeg,
            export_mod6_5_pages_in_range_mod6_jpeg,
            duplicate_mod6_0_pages_in_range_before_mod6,
            duplicate_mod6_1_pages_in_range_before_mod6,
            duplicate_mod6_2_pages_in_range_before_mod6,
            duplicate_mod6_3_pages_in_range_before_mod6,
            duplicate_mod6_4_pages_in_range_before_mod6,
            duplicate_mod6_5_pages_in_range_before_mod6,
            duplicate_mod6_0_pages_in_range_to_start_mod6,
            duplicate_mod6_1_pages_in_range_to_start_mod6,
            duplicate_mod6_2_pages_in_range_to_start_mod6,
            duplicate_mod6_3_pages_in_range_to_start_mod6,
            duplicate_mod6_4_pages_in_range_to_start_mod6,
            duplicate_mod6_5_pages_in_range_to_start_mod6,
            duplicate_mod6_0_pages_in_range_to_end_mod6,
            duplicate_mod6_1_pages_in_range_to_end_mod6,
            duplicate_mod6_2_pages_in_range_to_end_mod6,
            duplicate_mod6_3_pages_in_range_to_end_mod6,
            duplicate_mod6_4_pages_in_range_to_end_mod6,
            duplicate_mod6_5_pages_in_range_to_end_mod6,
            expand_mod6_0_pages_in_range_mod6,
            expand_mod6_1_pages_in_range_mod6,
            expand_mod6_2_pages_in_range_mod6,
            expand_mod6_3_pages_in_range_mod6,
            expand_mod6_4_pages_in_range_mod6,
            expand_mod6_5_pages_in_range_mod6,
            shrink_mod6_0_pages_in_range_mod6,
            shrink_mod6_1_pages_in_range_mod6,
            shrink_mod6_2_pages_in_range_mod6,
            shrink_mod6_3_pages_in_range_mod6,
            shrink_mod6_4_pages_in_range_mod6,
            shrink_mod6_5_pages_in_range_mod6,
            clear_crop_mod6_0_pages_in_range_mod6,
            clear_crop_mod6_1_pages_in_range_mod6,
            clear_crop_mod6_2_pages_in_range_mod6,
            clear_crop_mod6_3_pages_in_range_mod6,
            clear_crop_mod6_4_pages_in_range_mod6,
            clear_crop_mod6_5_pages_in_range_mod6,
            insert_blank_before_mod6_0_pages_in_range_mod6,
            insert_blank_before_mod6_1_pages_in_range_mod6,
            insert_blank_before_mod6_2_pages_in_range_mod6,
            insert_blank_before_mod6_3_pages_in_range_mod6,
            insert_blank_before_mod6_4_pages_in_range_mod6,
            insert_blank_before_mod6_5_pages_in_range_mod6,
            insert_blank_after_mod6_0_pages_in_range_mod6,
            insert_blank_after_mod6_1_pages_in_range_mod6,
            insert_blank_after_mod6_2_pages_in_range_mod6,
            insert_blank_after_mod6_3_pages_in_range_mod6,
            insert_blank_after_mod6_4_pages_in_range_mod6,
            insert_blank_after_mod6_5_pages_in_range_mod6,
            bookmark_mod6_0_pages_in_range_mod6,
            bookmark_mod6_1_pages_in_range_mod6,
            bookmark_mod6_2_pages_in_range_mod6,
            bookmark_mod6_3_pages_in_range_mod6,
            bookmark_mod6_4_pages_in_range_mod6,
            bookmark_mod6_5_pages_in_range_mod6,
            set_page_size_mod6_0_pages_in_range_mod6,
            set_page_size_mod6_1_pages_in_range_mod6,
            set_page_size_mod6_2_pages_in_range_mod6,
            set_page_size_mod6_3_pages_in_range_mod6,
            set_page_size_mod6_4_pages_in_range_mod6,
            set_page_size_mod6_5_pages_in_range_mod6,
            add_page_numbers_mod6_0_pages_in_range_mod6,
            add_page_numbers_mod6_1_pages_in_range_mod6,
            add_page_numbers_mod6_2_pages_in_range_mod6,
            add_page_numbers_mod6_3_pages_in_range_mod6,
            add_page_numbers_mod6_4_pages_in_range_mod6,
            add_page_numbers_mod6_5_pages_in_range_mod6,
            add_text_watermark_mod6_0_pages_in_range_mod6,
            add_text_watermark_mod6_1_pages_in_range_mod6,
            add_text_watermark_mod6_2_pages_in_range_mod6,
            add_text_watermark_mod6_3_pages_in_range_mod6,
            add_text_watermark_mod6_4_pages_in_range_mod6,
            add_text_watermark_mod6_5_pages_in_range_mod6,
            add_page_header_mod6_0_pages_in_range_mod6,
            add_page_header_mod6_1_pages_in_range_mod6,
            add_page_header_mod6_2_pages_in_range_mod6,
            add_page_header_mod6_3_pages_in_range_mod6,
            add_page_header_mod6_4_pages_in_range_mod6,
            add_page_header_mod6_5_pages_in_range_mod6,
            add_page_footer_mod6_0_pages_in_range_mod6,
            add_page_footer_mod6_1_pages_in_range_mod6,
            add_page_footer_mod6_2_pages_in_range_mod6,
            add_page_footer_mod6_3_pages_in_range_mod6,
            add_page_footer_mod6_4_pages_in_range_mod6,
            add_page_footer_mod6_5_pages_in_range_mod6,
            add_page_border_mod6_0_pages_in_range_mod6,
            add_page_border_mod6_1_pages_in_range_mod6,
            add_page_border_mod6_2_pages_in_range_mod6,
            add_page_border_mod6_3_pages_in_range_mod6,
            add_page_border_mod6_4_pages_in_range_mod6,
            add_page_border_mod6_5_pages_in_range_mod6,
            export_mod6_0_pages_in_range_mod6_webp,
            export_mod6_1_pages_in_range_mod6_webp,
            export_mod6_2_pages_in_range_mod6_webp,
            export_mod6_3_pages_in_range_mod6_webp,
            export_mod6_4_pages_in_range_mod6_webp,
            export_mod6_5_pages_in_range_mod6_webp,
            export_mod6_0_pages_in_range_mod6_bmp,
            export_mod6_1_pages_in_range_mod6_bmp,
            export_mod6_2_pages_in_range_mod6_bmp,
            export_mod6_3_pages_in_range_mod6_bmp,
            export_mod6_4_pages_in_range_mod6_bmp,
            export_mod6_5_pages_in_range_mod6_bmp,
            export_mod6_0_pages_in_range_mod6_tiff,
            export_mod6_1_pages_in_range_mod6_tiff,
            export_mod6_2_pages_in_range_mod6_tiff,
            export_mod6_3_pages_in_range_mod6_tiff,
            export_mod6_4_pages_in_range_mod6_tiff,
            export_mod6_5_pages_in_range_mod6_tiff,
            export_mod6_0_pages_in_range_mod6_gif,
            export_mod6_1_pages_in_range_mod6_gif,
            export_mod6_2_pages_in_range_mod6_gif,
            export_mod6_3_pages_in_range_mod6_gif,
            export_mod6_4_pages_in_range_mod6_gif,
            export_mod6_5_pages_in_range_mod6_gif,
            export_mod6_0_pages_in_range_mod6_ppm,
            export_mod6_1_pages_in_range_mod6_ppm,
            export_mod6_2_pages_in_range_mod6_ppm,
            export_mod6_3_pages_in_range_mod6_ppm,
            export_mod6_4_pages_in_range_mod6_ppm,
            export_mod6_5_pages_in_range_mod6_ppm,
            export_mod6_0_pages_in_range_mod6_tga,
            export_mod6_1_pages_in_range_mod6_tga,
            export_mod6_2_pages_in_range_mod6_tga,
            export_mod6_3_pages_in_range_mod6_tga,
            export_mod6_4_pages_in_range_mod6_tga,
            export_mod6_5_pages_in_range_mod6_tga,
            export_mod6_0_pages_in_range_mod6_ico,
            export_mod6_1_pages_in_range_mod6_ico,
            export_mod6_2_pages_in_range_mod6_ico,
            export_mod6_3_pages_in_range_mod6_ico,
            export_mod6_4_pages_in_range_mod6_ico,
            export_mod6_5_pages_in_range_mod6_ico,
            // PARITY_BATCH6_HANDLERS_END
            // PARITY_BATCH7_HANDLERS_START
            rotate_first_third_pages_in_range,
            rotate_second_third_pages_in_range,
            rotate_third_third_pages_in_range,
            rotate_first_third_pages_in_range_ccw,
            rotate_second_third_pages_in_range_ccw,
            rotate_third_third_pages_in_range_ccw,
            rotate_180_first_third_pages_in_range,
            rotate_180_second_third_pages_in_range,
            rotate_180_third_third_pages_in_range,
            reset_rotation_first_third_pages_in_range,
            reset_rotation_second_third_pages_in_range,
            reset_rotation_third_third_pages_in_range,
            delete_first_third_pages_in_range,
            delete_second_third_pages_in_range,
            delete_third_third_pages_in_range,
            keep_first_third_pages_in_range,
            keep_second_third_pages_in_range,
            keep_third_third_pages_in_range,
            duplicate_first_third_pages_in_range,
            duplicate_second_third_pages_in_range,
            duplicate_third_third_pages_in_range,
            flatten_first_third_pages_in_range,
            flatten_second_third_pages_in_range,
            flatten_third_third_pages_in_range,
            reverse_first_third_pages_in_range,
            reverse_second_third_pages_in_range,
            reverse_third_third_pages_in_range,
            crop_first_third_pages_in_range,
            crop_second_third_pages_in_range,
            crop_third_third_pages_in_range,
            extract_first_third_pages_in_range,
            extract_second_third_pages_in_range,
            extract_third_third_pages_in_range,
            export_first_third_pages_in_range_as_pdf,
            export_second_third_pages_in_range_as_pdf,
            export_third_third_pages_in_range_as_pdf,
            export_first_third_pages_in_range_png,
            export_second_third_pages_in_range_png,
            export_third_third_pages_in_range_png,
            export_first_third_pages_in_range_jpeg,
            export_second_third_pages_in_range_jpeg,
            export_third_third_pages_in_range_jpeg,
            add_page_numbers_first_third_pages_in_range,
            add_page_numbers_second_third_pages_in_range,
            add_page_numbers_third_third_pages_in_range,
            add_text_watermark_first_third_pages_in_range,
            add_text_watermark_second_third_pages_in_range,
            add_text_watermark_third_third_pages_in_range,
            duplicate_first_third_pages_in_range_before,
            duplicate_second_third_pages_in_range_before,
            duplicate_third_third_pages_in_range_before,
            duplicate_first_third_pages_in_range_to_start,
            duplicate_second_third_pages_in_range_to_start,
            duplicate_third_third_pages_in_range_to_start,
            duplicate_first_third_pages_in_range_to_end,
            duplicate_second_third_pages_in_range_to_end,
            duplicate_third_third_pages_in_range_to_end,
            expand_first_third_pages_in_range,
            expand_second_third_pages_in_range,
            expand_third_third_pages_in_range,
            shrink_first_third_pages_in_range,
            shrink_second_third_pages_in_range,
            shrink_third_third_pages_in_range,
            clear_crop_first_third_pages_in_range,
            clear_crop_second_third_pages_in_range,
            clear_crop_third_third_pages_in_range,
            insert_blank_before_first_third_pages_in_range,
            insert_blank_before_second_third_pages_in_range,
            insert_blank_before_third_third_pages_in_range,
            insert_blank_after_first_third_pages_in_range,
            insert_blank_after_second_third_pages_in_range,
            insert_blank_after_third_third_pages_in_range,
            bookmark_first_third_pages_in_range,
            bookmark_second_third_pages_in_range,
            bookmark_third_third_pages_in_range,
            set_page_size_first_third_pages_in_range,
            set_page_size_second_third_pages_in_range,
            set_page_size_third_third_pages_in_range,
            add_page_header_first_third_pages_in_range,
            add_page_header_second_third_pages_in_range,
            add_page_header_third_third_pages_in_range,
            add_page_footer_first_third_pages_in_range,
            add_page_footer_second_third_pages_in_range,
            add_page_footer_third_third_pages_in_range,
            add_page_border_first_third_pages_in_range,
            add_page_border_second_third_pages_in_range,
            add_page_border_third_third_pages_in_range,
            export_first_third_pages_in_range_webp,
            export_second_third_pages_in_range_webp,
            export_third_third_pages_in_range_webp,
            export_first_third_pages_in_range_bmp,
            export_second_third_pages_in_range_bmp,
            export_third_third_pages_in_range_bmp,
            export_first_third_pages_in_range_tiff,
            export_second_third_pages_in_range_tiff,
            export_third_third_pages_in_range_tiff,
            export_first_third_pages_in_range_gif,
            export_second_third_pages_in_range_gif,
            export_third_third_pages_in_range_gif,
            export_first_third_pages_in_range_ppm,
            export_second_third_pages_in_range_ppm,
            export_third_third_pages_in_range_ppm,
            export_first_third_pages_in_range_tga,
            export_second_third_pages_in_range_tga,
            export_third_third_pages_in_range_tga,
            export_first_third_pages_in_range_ico,
            export_second_third_pages_in_range_ico,
            export_third_third_pages_in_range_ico,
            sort_first_third_pages_in_range_by_rotation,
            sort_second_third_pages_in_range_by_rotation,
            sort_third_third_pages_in_range_by_rotation,
            sort_first_third_pages_in_range_by_size,
            sort_second_third_pages_in_range_by_size,
            sort_third_third_pages_in_range_by_size,
            // PARITY_BATCH7_HANDLERS_END
            // PARITY_BATCH8_HANDLERS_START
            sort_odd_pages_in_range_by_rotation_desc,
            sort_even_pages_in_range_by_rotation_desc,
            sort_range_local_odd_pages_by_rotation_desc,
            sort_range_local_even_pages_by_rotation_desc,
            sort_first_half_pages_in_range_by_rotation_desc,
            sort_second_half_pages_in_range_by_rotation_desc,
            sort_odd_pages_in_range_by_size_desc,
            sort_even_pages_in_range_by_size_desc,
            sort_range_local_odd_pages_by_size_desc,
            sort_range_local_even_pages_by_size_desc,
            sort_first_half_pages_in_range_by_size_desc,
            sort_second_half_pages_in_range_by_size_desc,
            sort_mod3_0_pages_in_range_mod3_by_rotation_desc,
            sort_mod3_0_pages_in_range_mod3_by_size_desc,
            sort_mod3_1_pages_in_range_mod3_by_rotation_desc,
            sort_mod3_1_pages_in_range_mod3_by_size_desc,
            sort_mod3_2_pages_in_range_mod3_by_rotation_desc,
            sort_mod3_2_pages_in_range_mod3_by_size_desc,
            sort_mod4_0_pages_in_range_mod4_by_rotation_desc,
            sort_mod4_0_pages_in_range_mod4_by_size_desc,
            sort_mod4_1_pages_in_range_mod4_by_rotation_desc,
            sort_mod4_1_pages_in_range_mod4_by_size_desc,
            sort_mod4_2_pages_in_range_mod4_by_rotation_desc,
            sort_mod4_2_pages_in_range_mod4_by_size_desc,
            sort_mod4_3_pages_in_range_mod4_by_rotation_desc,
            sort_mod4_3_pages_in_range_mod4_by_size_desc,
            sort_mod5_0_pages_in_range_mod5_by_rotation_desc,
            sort_mod5_0_pages_in_range_mod5_by_size_desc,
            sort_mod5_1_pages_in_range_mod5_by_rotation_desc,
            sort_mod5_1_pages_in_range_mod5_by_size_desc,
            sort_mod5_2_pages_in_range_mod5_by_rotation_desc,
            sort_mod5_2_pages_in_range_mod5_by_size_desc,
            sort_mod5_3_pages_in_range_mod5_by_rotation_desc,
            sort_mod5_3_pages_in_range_mod5_by_size_desc,
            sort_mod5_4_pages_in_range_mod5_by_rotation_desc,
            sort_mod5_4_pages_in_range_mod5_by_size_desc,
            sort_mod6_0_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_0_pages_in_range_mod6_by_size_desc,
            sort_mod6_1_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_1_pages_in_range_mod6_by_size_desc,
            sort_mod6_2_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_2_pages_in_range_mod6_by_size_desc,
            sort_mod6_3_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_3_pages_in_range_mod6_by_size_desc,
            sort_mod6_4_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_4_pages_in_range_mod6_by_size_desc,
            sort_mod6_5_pages_in_range_mod6_by_rotation_desc,
            sort_mod6_5_pages_in_range_mod6_by_size_desc,
            // PARITY_BATCH8_HANDLERS_END
            add_text_watermark,
            flatten_annotations,
            crop_page,
            crop_all_pages,
            clear_page_crop,
            clear_all_page_crops,
            export_page_as_pdf,
            split_pdf,
            extract_pdf_pages,
            insert_pdf,
            convert_pdf_to_markdown,
            save_pdf_markdown,
            summarize_pdf,
            save_pdf_summary,
            ocr_available,
            tesseract_install_guide,
            licenses::license_documents,
            licenses::credits_catalog,
            licenses::runtime_license_text,
            licenses::open_external_url,
            ocr_status,
            ocr_pdf_page,
            optimize_pdf,
            pdf_is_encrypted,
            verify_pdf_password,
            open_working_copy_with_password,
            protect_pdf,
            list_pdf_signatures,
            verify_pdf_signatures,
            sign_pdf,
            add_highlight,
            remove_highlight,
            add_text_note,
            remove_text_note,
            add_ink_stroke,
            remove_ink_stroke,
            add_square,
            add_circle,
            add_line,
            remove_square,
            remove_circle,
            remove_line,
            list_stamp_presets,
            add_text_stamp,
            add_image_stamp,
            remove_text_stamp,
            remove_image_stamp,
            add_redaction,
            remove_redaction,
            get_image_dimensions,
            add_page_image,
            add_page_text,
            list_page_text_edits,
            update_page_text,
            remove_page_text,
            add_page_vector_rect,
            list_page_vectors,
            remove_page_vector,
            get_pdf_form_fields,
            set_pdf_form_field,
            add_text_form_field,
            add_checkbox_form_field,
            add_choice_form_field,
            add_radio_form_field,
            get_annotations,
            open_working_copy,
            save_working_copy,
            discard_working_copy,
            snapshot_pdf,
            snapshot_pdf_entry,
            restore_history_entry,
            discard_history_entry,
            prune_history_entry,
            file_byte_size,
            native_file_dialogs_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
