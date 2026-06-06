#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lopdf::{Document, Object, ObjectId};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

static PDFIUM: OnceLock<Result<Mutex<Pdfium>, String>> = OnceLock::new();
/// Directory holding the bundled PDFium library, populated during Tauri `setup`
/// from the app's resource directory (only meaningful in a packaged build).
static BUNDLED_PDFIUM_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Try to bind a standard PDFium build at `dir`, recording the attempted path on
/// failure.
fn try_pdfium_dir(dir: &std::path::Path, tried: &mut Vec<String>) -> Option<Pdfium> {
    let candidate = Pdfium::pdfium_platform_library_name_at_path(dir);
    match Pdfium::bind_to_library(&candidate) {
        Ok(bindings) => Some(Pdfium::new(bindings)),
        Err(_) => {
            tried.push(candidate.to_string_lossy().into_owned());
            None
        }
    }
}

/// Bind to a standard PDFium library (the C `FPDF_*` API that `pdfium-render`
/// requires). Search order: an explicit `PDFIUM_LIB_PATH`, a `libpdfium` shipped
/// next to the executable, a vendored copy under the crate, then any system
/// library. The system's `libdeepin-pdfium` is a *different*, incompatible C++
/// API and is intentionally never used.
fn bind_pdfium() -> Result<Pdfium, String> {
    let mut tried: Vec<String> = Vec::new();

    // 1. Explicit override.
    if let Some(path) = std::env::var_os("PDFIUM_LIB_PATH") {
        let path = PathBuf::from(path);
        match Pdfium::bind_to_library(&path) {
            Ok(bindings) => return Ok(Pdfium::new(bindings)),
            Err(_) => tried.push(path.to_string_lossy().into_owned()),
        }
    }
    // 2. Next to the executable (bundled distribution).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(pdfium) = try_pdfium_dir(dir, &mut tried) {
                return Ok(pdfium);
            }
        }
    }
    // 2b. Tauri resource directory of a packaged build (set during setup).
    if let Some(dir) = BUNDLED_PDFIUM_DIR.get() {
        if let Some(pdfium) = try_pdfium_dir(dir, &mut tried) {
            return Ok(pdfium);
        }
    }
    // 3. Vendored copy under the crate (developer runs).
    let vendor = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/pdfium");
    if let Some(pdfium) = try_pdfium_dir(&vendor, &mut tried) {
        return Ok(pdfium);
    }
    // 4. Any system-installed PDFium.
    if let Ok(bindings) = Pdfium::bind_to_system_library() {
        return Ok(Pdfium::new(bindings));
    }
    tried.push("system library".to_string());

    Err(format!(
        "Could not load a standard PDFium library. The system's libdeepin-pdfium is a \
         different, incompatible API. Install libpdfium or set PDFIUM_LIB_PATH. Tried: {}",
        tried.join(", ")
    ))
}

/// Returns the process-wide PDFium binding, or a user-facing error string if no
/// compatible library is available (so commands surface a message instead of
/// aborting the app).
fn get_pdfium() -> Result<MutexGuard<'static, Pdfium>, String> {
    PDFIUM
        .get_or_init(|| bind_pdfium().map(Mutex::new))
        .as_ref()
        .map_err(|e| e.clone())?
        .lock()
        .map_err(|_| "PDFium renderer lock poisoned".to_string())
}

#[tauri::command]
fn get_pdf_page_count(path: String) -> Result<u32, String> {
    let path = PathBuf::from(path);
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(&path, None).map_err(|e| e.to_string())?;
    Ok(document.pages().len() as u32)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfBrowserEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfBrowserListing {
    current_dir: String,
    parent_dir: Option<String>,
    entries: Vec<PdfBrowserEntry>,
}

fn default_browser_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .and_then(|home| {
            let documents = home.join("Documents");
            if documents.is_dir() {
                Some(documents)
            } else if home.is_dir() {
                Some(home)
            } else {
                None
            }
        })
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")))
}

fn list_pdf_entries_for_dir(dir: &Path) -> Result<PdfBrowserListing, String> {
    let current_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    if !current_dir.is_dir() {
        return Err(format!("{} is not a directory", current_dir.to_string_lossy()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let is_pdf =
            path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("pdf")).unwrap_or(false);
        if !is_dir && !is_pdf {
            continue;
        }
        entries.push(PdfBrowserEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(PdfBrowserListing {
        parent_dir: current_dir.parent().map(|path| path.to_string_lossy().to_string()),
        current_dir: current_dir.to_string_lossy().to_string(),
        entries,
    })
}

#[tauri::command]
fn list_pdf_browser_entries(path: Option<String>) -> Result<PdfBrowserListing, String> {
    let dir = path.filter(|path| !path.trim().is_empty()).map(PathBuf::from).unwrap_or_else(default_browser_dir);
    let dir = if dir.is_file() { dir.parent().map(Path::to_path_buf).unwrap_or_else(default_browser_dir) } else { dir };
    list_pdf_entries_for_dir(&dir)
}

#[tauri::command]
fn render_pdf_page(path: String, page_index: u32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(&path, None).map_err(|e| e.to_string())?;
    let page = document.pages().get(page_index as PdfPageIndex).map_err(|e| e.to_string())?;

    let bitmap = page.render(width as Pixels, height as Pixels, None).map_err(|e| e.to_string())?;

    let image = bitmap.as_image().map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png).map_err(|e| e.to_string())?;

    Ok(buffer)
}

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

fn get_pages_kids(doc: &Document) -> Result<(Vec<Object>, ObjectId), String> {
    let catalog = doc.catalog().map_err(|e| e.to_string())?;
    let pages_ref = catalog
        .get(b"Pages")
        .map_err(|_| "No Pages entry in catalog".to_string())?
        .as_reference()
        .map_err(|_| "Pages entry is not a reference".to_string())?;
    let kids = doc
        .get_dictionary(pages_ref)
        .map_err(|e| e.to_string())?
        .get(b"Kids")
        .map_err(|_| "No Kids entry in pages dictionary".to_string())?
        .as_array()
        .map_err(|_| "Kids is not an array".to_string())?
        .clone();
    Ok((kids, pages_ref))
}

fn set_pages_kids(doc: &mut Document, pages_ref: ObjectId, kids: Vec<Object>) -> Result<(), String> {
    // Keep /Count in sync with /Kids. These operations assume a flat page tree
    // (every kid is a leaf page), which is what the rest of this module builds
    // and edits, so the leaf count equals the number of kids. A stale /Count
    // produces technically-malformed PDFs that stricter readers reject.
    let count = kids.len() as i64;
    let dict = doc.get_dictionary_mut(pages_ref).map_err(|e| e.to_string())?;
    dict.set(b"Kids", Object::Array(kids));
    dict.set(b"Count", Object::Integer(count));
    Ok(())
}

#[tauri::command]
fn delete_page(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let (mut kids, pages_ref) = get_pages_kids(&doc)?;
    let idx = page_index as usize;
    if idx >= kids.len() {
        return Err("Page index out of bounds".to_string());
    }
    kids.remove(idx);
    set_pages_kids(&mut doc, pages_ref, kids)?;

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn move_page(path: String, from_index: u32, to_index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let (mut kids, pages_ref) = get_pages_kids(&doc)?;

    let from = from_index as usize;
    let to = to_index as usize;
    if from >= kids.len() || to >= kids.len() {
        return Err("Index out of bounds".to_string());
    }
    if from == to {
        return Ok(());
    }

    let moved = kids.remove(from);
    kids.insert(to, moved);
    set_pages_kids(&mut doc, pages_ref, kids)?;

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rotate_page(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let current_rotation = doc
        .get_dictionary(*page_id)
        .ok()
        .and_then(|d| d.get(b"Rotate").ok())
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);

    let next_rotation = (current_rotation + 90) % 360;

    doc.get_dictionary_mut(*page_id).map_err(|e| e.to_string())?.set(b"Rotate", Object::Integer(next_rotation));

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn pdf_to_markdown(path: &Path) -> Result<String, String> {
    // Use PDFium's text layer: it decodes font encodings (including CID/Type0
    // fonts) that a raw content-stream walk cannot, so real-world PDFs actually
    // produce text instead of empty pages.
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;

    let mut markdown = String::from("# PDF to Markdown Conversion\n\n");
    for (index, page) in document.pages().iter().enumerate() {
        markdown.push_str(&format!("## Page {}\n\n", index + 1));
        let text = page.text().map_err(|e| e.to_string())?.all();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            markdown.push_str("_(no extractable text on this page)_");
        } else {
            markdown.push_str(trimmed);
        }
        markdown.push_str("\n\n");
    }
    Ok(markdown)
}

#[tauri::command]
fn convert_pdf_to_markdown(path: String) -> Result<String, String> {
    pdf_to_markdown(&PathBuf::from(path))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownSaveResult {
    markdown: String,
    markdown_path: String,
    written: bool,
    conflict: bool,
}

fn write_markdown_file(pdf_path: &Path, markdown: &str, overwrite: bool) -> Result<MarkdownSaveResult, String> {
    let markdown_path = pdf_path.with_extension("md");

    if markdown_path.exists() {
        let existing = std::fs::read(&markdown_path).map_err(|e| e.to_string())?;
        if existing == markdown.as_bytes() {
            return Ok(MarkdownSaveResult {
                markdown: markdown.to_string(),
                markdown_path: markdown_path.to_string_lossy().to_string(),
                written: false,
                conflict: false,
            });
        }
        if !overwrite {
            return Ok(MarkdownSaveResult {
                markdown: markdown.to_string(),
                markdown_path: markdown_path.to_string_lossy().to_string(),
                written: false,
                conflict: true,
            });
        }
    }

    std::fs::write(&markdown_path, markdown).map_err(|e| e.to_string())?;
    Ok(MarkdownSaveResult {
        markdown: markdown.to_string(),
        markdown_path: markdown_path.to_string_lossy().to_string(),
        written: true,
        conflict: false,
    })
}

#[tauri::command]
fn save_pdf_markdown(path: String, overwrite: bool) -> Result<MarkdownSaveResult, String> {
    let pdf_path = PathBuf::from(path);
    let markdown = pdf_to_markdown(&pdf_path)?;
    write_markdown_file(&pdf_path, &markdown, overwrite)
}

#[tauri::command]
fn split_pdf(path: String, page_ranges: Vec<(u32, u32)>) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let (all_kids, pages_ref) = get_pages_kids(&doc)?;
    let total_pages = all_kids.len() as u32;

    for (start, end) in &page_ranges {
        if *start >= total_pages || *end >= total_pages || *start > *end {
            return Err(format!("Invalid page range: {}-{}", start, end));
        }
    }

    let mut output_paths = Vec::new();

    for (i, (start, end)) in page_ranges.iter().enumerate() {
        let range_kids: Vec<Object> = all_kids[*start as usize..=*end as usize].to_vec();
        set_pages_kids(&mut doc, pages_ref, range_kids)?;

        // Drop the pages (and their now-orphaned content/resources) that aren't
        // part of this range so each split file is actually smaller rather than
        // a full copy with a trimmed page list.
        doc.prune_objects();

        let output_path =
            path.with_file_name(format!("{}_part{}.pdf", path.file_stem().unwrap().to_string_lossy(), i + 1));
        doc.save(&output_path).map_err(|e| e.to_string())?;
        output_paths.push(output_path.to_string_lossy().to_string());

        doc = Document::load(&path).map_err(|e| e.to_string())?;
    }

    Ok(output_paths)
}

#[tauri::command]
fn insert_pdf(
    path: String,
    insert_path: String,
    at_index: u32,
    insert_start: u32,
    insert_end: u32,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let insert_path_buf = PathBuf::from(&insert_path);

    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let insert_doc = Document::load(&insert_path_buf).map_err(|e| e.to_string())?;

    let (mut source_kids, pages_ref) = get_pages_kids(&doc)?;
    let (insert_kids, _) = get_pages_kids(&insert_doc)?;

    let insert_start = insert_start as usize;
    let insert_end = insert_end as usize;
    if insert_start > insert_end || insert_end >= insert_kids.len() {
        return Err("Invalid insert page range".to_string());
    }
    let at = at_index as usize;
    if at > source_kids.len() {
        return Err("Insert index out of bounds".to_string());
    }

    let selected_kids: Vec<Object> = insert_kids[insert_start..=insert_end].to_vec();
    for (offset, kid) in selected_kids.into_iter().enumerate() {
        source_kids.insert(at + offset, kid);
    }

    set_pages_kids(&mut doc, pages_ref, source_kids)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn recompress_images(doc: &mut Document) -> Result<u32, String> {
    let pages = doc.get_pages();
    let mut all_images: Vec<(ObjectId, Vec<u8>, u32, u32)> = Vec::new();

    for page_id in pages.values() {
        let images = doc.get_page_images(*page_id).map_err(|e| e.to_string())?;
        for img in &images {
            all_images.push((img.id, img.content.to_vec(), img.width as u32, img.height as u32));
        }
    }

    let mut count = 0u32;
    for (obj_id, content, width, height) in &all_images {
        let reencoded = reencode_image(content, *width, *height);
        if let Some(data) = reencoded {
            let obj = doc.get_object_mut(*obj_id).map_err(|e| e.to_string())?;
            if let Object::Stream(ref mut s) = obj {
                s.set_plain_content(data);
                s.dict.set(b"Filter", Object::Name(b"DCTDecode".to_vec()));
                count += 1;
            }
        }
    }

    Ok(count)
}

fn reencode_image(raw: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    use image::{DynamicImage, GrayImage, RgbImage};
    let expected_len = (width * height * 3) as usize;

    let img: DynamicImage = if raw.len() >= expected_len && expected_len > 0 {
        let rgb = RgbImage::from_raw(width, height, raw[..expected_len].to_vec())?;
        DynamicImage::ImageRgb8(rgb)
    } else if raw.len() >= (width * height) as usize {
        let gray = GrayImage::from_raw(width, height, raw[..(width * height) as usize].to_vec())?;
        DynamicImage::ImageLuma8(gray)
    } else {
        return None;
    };

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    Some(buf)
}

#[tauri::command]
fn optimize_pdf(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    if let Ok(catalog) = doc.catalog_mut() {
        catalog.set(b"Metadata", Object::Null);
    }

    if let Ok(trailer) = doc.trailer.get_mut(b"Info") {
        *trailer = Object::Null;
    }

    let images_recompressed = recompress_images(&mut doc)?;

    // Remove unreferenced objects and flate-compress remaining uncompressed
    // streams (e.g. content streams) for additional size reduction.
    doc.prune_objects();
    doc.compress();

    let output_path = path.with_file_name(format!("{}_optimized.pdf", path.file_stem().unwrap().to_string_lossy()));
    doc.save(&output_path).map_err(|e| e.to_string())?;

    Ok(format!(
        "Saved to {}. Metadata stripped, objects pruned & streams compressed. {} image(s) recompressed.",
        output_path.file_name().unwrap().to_string_lossy(),
        images_recompressed
    ))
}

#[tauri::command]
fn add_highlight(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Highlight".to_vec())),
        (
            b"Rect".to_vec(),
            Object::Array(vec![
                Object::Real(x1 as f32),
                Object::Real(y1 as f32),
                Object::Real(x2 as f32),
                Object::Real(y2 as f32),
            ]),
        ),
        (
            b"QuadPoints".to_vec(),
            Object::Array(vec![
                Object::Real(x1 as f32),
                Object::Real(y2 as f32),
                Object::Real(x2 as f32),
                Object::Real(y2 as f32),
                Object::Real(x1 as f32),
                Object::Real(y1 as f32),
                Object::Real(x2 as f32),
                Object::Real(y1 as f32),
            ]),
        ),
        (b"C".to_vec(), Object::Array(vec![Object::Real(1.0), Object::Real(1.0), Object::Real(0.0)])),
    ])));

    let annots = doc.get_dictionary_mut(*page_id).map_err(|e| e.to_string())?.get_mut(b"Annots");

    match annots {
        Ok(Object::Array(ref mut arr)) => {
            arr.push(Object::Reference(annot));
        }
        _ => {
            doc.get_dictionary_mut(*page_id)
                .map_err(|e| e.to_string())?
                .set(b"Annots", Object::Array(vec![Object::Reference(annot)]));
        }
    }

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove the `index`-th highlight annotation (0-based, in document order) from a
/// page. The index matches the order highlights are returned by
/// `get_annotations` after filtering to the `Highlight` subtype.
#[tauri::command]
fn remove_highlight(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut highlight_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let is_highlight = doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Subtype").ok())
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n) == "Highlight")
            .unwrap_or(false);
        if is_highlight {
            if highlight_count == index {
                target_pos = Some(pos);
                break;
            }
            highlight_count += 1;
        }
    }

    let pos = target_pos.ok_or("Highlight not found".to_string())?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct AnnotationData {
    subtype: String,
    rect: [f64; 4],
    color: Option<[f64; 3]>,
}

/// Coerce a PDF numeric object to f64. Necessary because a value written as
/// `Real(10.0)` is serialized as `10` and parsed back as `Integer`, so reading
/// it as a float only (`as_f32`) silently yields nothing.
fn obj_to_f64(o: &Object) -> f64 {
    match o {
        Object::Real(r) => *r as f64,
        Object::Integer(i) => *i as f64,
        _ => 0.0,
    }
}

#[tauri::command]
fn get_annotations(path: String, page_index: u32) -> Result<Vec<AnnotationData>, String> {
    let path = PathBuf::from(&path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let page_dict = doc.get_dictionary(*page_id).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    if let Ok(Object::Array(arr)) = page_dict.get(b"Annots") {
        for annot_ref in arr {
            let id = match annot_ref {
                Object::Reference(id) => *id,
                _ => continue,
            };
            if let Ok(annot_obj) = doc.get_object(id) {
                if let Ok(annot_dict) = annot_obj.as_dict() {
                    let subtype = annot_dict
                        .get(b"Subtype")
                        .ok()
                        .and_then(|o| o.as_name().ok())
                        .map(|b| String::from_utf8_lossy(b).to_string())
                        .unwrap_or_default();

                    let rect = if let Ok(Object::Array(rect_arr)) = annot_dict.get(b"Rect") {
                        let get = |i: usize| rect_arr.get(i).map(obj_to_f64).unwrap_or(0.0);
                        [get(0), get(1), get(2), get(3)]
                    } else {
                        [0.0; 4]
                    };

                    let color = annot_dict.get(b"C").ok().and_then(|o| {
                        o.as_array().ok().map(|arr| {
                            let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
                            [get(0), get(1), get(2)]
                        })
                    });

                    result.push(AnnotationData { subtype, rect, color });
                }
            }
        }
    }

    Ok(result)
}

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

    tauri::Builder::default()
        .setup(|app| {
            // In a packaged build, PDFium ships under the app's resource
            // directory; record it so the loader can find it at runtime.
            use tauri::Manager;
            if let Ok(resources) = app.path().resource_dir() {
                let _ = BUNDLED_PDFIUM_DIR.set(resources.join("vendor").join("pdfium"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_pdf_browser_entries,
            get_pdf_page_count,
            render_pdf_page,
            get_pdf_thumbnails,
            delete_page,
            move_page,
            rotate_page,
            split_pdf,
            insert_pdf,
            convert_pdf_to_markdown,
            save_pdf_markdown,
            optimize_pdf,
            add_highlight,
            remove_highlight,
            get_annotations
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Dictionary, Stream};
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pdf_editor_test_{}_{}.pdf", std::process::id(), name))
    }

    /// Build a minimal, valid, flat-tree PDF with `n` pages. Each page carries a
    /// distinct `TestIdx` so reordering can be verified; page 0 gets a text
    /// content stream so markdown extraction has something to find.
    fn build_pdf(n: usize) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();

        let mut kids = Vec::new();
        for i in 0..n {
            let mut page = Dictionary::new();
            page.set("Type", Object::Name(b"Page".to_vec()));
            page.set("Parent", Object::Reference(pages_id));
            page.set("Resources", Object::Dictionary(Dictionary::new()));
            page.set(
                "MediaBox",
                Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]),
            );
            page.set("TestIdx", Object::Integer(i as i64));

            if i == 0 {
                let content = b"BT /F1 12 Tf 72 700 Td (Hello) Tj ET".to_vec();
                let stream_id = doc.add_object(Stream::new(Dictionary::new(), content));
                page.set("Contents", Object::Reference(stream_id));
            }

            let page_id = doc.add_object(Object::Dictionary(page));
            kids.push(Object::Reference(page_id));
        }

        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Count", Object::Integer(n as i64));
        pages.set("Kids", Object::Array(kids));
        doc.objects.insert(pages_id, Object::Dictionary(pages));

        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));

        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc
    }

    fn save(doc: &mut Document, name: &str) -> String {
        let path = tmp(name);
        doc.save(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    fn page_count(path: &str) -> usize {
        Document::load(path).unwrap().get_pages().len()
    }

    fn count_entry(path: &str) -> i64 {
        let doc = Document::load(path).unwrap();
        let (_, pages_ref) = get_pages_kids(&doc).unwrap();
        doc.get_dictionary(pages_ref).unwrap().get(b"Count").unwrap().as_i64().unwrap()
    }

    fn page_order(path: &str) -> Vec<i64> {
        let doc = Document::load(path).unwrap();
        let (kids, _) = get_pages_kids(&doc).unwrap();
        kids.iter()
            .map(|k| {
                let id = k.as_reference().unwrap();
                doc.get_dictionary(id).unwrap().get(b"TestIdx").unwrap().as_i64().unwrap()
            })
            .collect()
    }

    #[test]
    fn delete_page_reduces_pages_and_fixes_count() {
        let path = save(&mut build_pdf(3), "delete");
        delete_page(path.clone(), 1).unwrap();
        assert_eq!(page_count(&path), 2);
        assert_eq!(count_entry(&path), 2, "/Count must track /Kids");
        assert_eq!(page_order(&path), vec![0, 2], "wrong page removed");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn move_page_reorders() {
        let path = save(&mut build_pdf(3), "move");
        move_page(path.clone(), 0, 2).unwrap();
        assert_eq!(page_order(&path), vec![1, 2, 0]);
        assert_eq!(count_entry(&path), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rotate_page_accumulates_in_90_steps() {
        let path = save(&mut build_pdf(1), "rotate");
        rotate_page(path.clone(), 0).unwrap();
        assert_eq!(rotation(&path), 90);
        rotate_page(path.clone(), 0).unwrap();
        assert_eq!(rotation(&path), 180);
        rotate_page(path.clone(), 0).unwrap();
        rotate_page(path.clone(), 0).unwrap();
        assert_eq!(rotation(&path), 0, "should wrap at 360");
        let _ = std::fs::remove_file(&path);
    }

    fn rotation(path: &str) -> i64 {
        let doc = Document::load(path).unwrap();
        let pages = doc.get_pages();
        let pid = *pages.get(&1).unwrap();
        doc.get_dictionary(pid).unwrap().get(b"Rotate").unwrap().as_i64().unwrap()
    }

    #[test]
    fn insert_pdf_adds_pages_at_index() {
        let main_path = save(&mut build_pdf(2), "insert_main");
        let ins_path = save(&mut build_pdf(2), "insert_src");
        // Insert the first page of the source at index 1 of the main doc.
        insert_pdf(main_path.clone(), ins_path.clone(), 1, 0, 0).unwrap();
        assert_eq!(page_count(&main_path), 3);
        assert_eq!(count_entry(&main_path), 3);
        let _ = std::fs::remove_file(&main_path);
        let _ = std::fs::remove_file(&ins_path);
    }

    #[test]
    fn split_pdf_creates_separate_files() {
        let path = save(&mut build_pdf(4), "split");
        let outputs = split_pdf(path.clone(), vec![(0, 1), (2, 3)]).unwrap();
        assert_eq!(outputs.len(), 2);
        for out in &outputs {
            assert_eq!(page_count(out), 2);
            assert_eq!(count_entry(out), 2);
            let _ = std::fs::remove_file(out);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_markdown_file_creates_sibling_md() {
        let pdf_path = tmp("markdown_write");
        let md_path = pdf_path.with_extension("md");
        let _ = std::fs::remove_file(&md_path);

        let result = write_markdown_file(&pdf_path, "# Test\n", false).unwrap();

        assert!(result.written);
        assert!(!result.conflict);
        assert_eq!(result.markdown_path, md_path.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Test\n");
        let _ = std::fs::remove_file(&md_path);
    }

    #[test]
    fn write_markdown_file_detects_conflict_without_overwrite() {
        let pdf_path = tmp("markdown_conflict");
        let md_path = pdf_path.with_extension("md");
        std::fs::write(&md_path, "# Existing\n").unwrap();

        let result = write_markdown_file(&pdf_path, "# New\n", false).unwrap();

        assert!(!result.written);
        assert!(result.conflict);
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Existing\n");
        let _ = std::fs::remove_file(&md_path);
    }

    #[test]
    fn write_markdown_file_overwrites_after_confirmation() {
        let pdf_path = tmp("markdown_overwrite");
        let md_path = pdf_path.with_extension("md");
        std::fs::write(&md_path, "# Existing\n").unwrap();

        let result = write_markdown_file(&pdf_path, "# New\n", true).unwrap();

        assert!(result.written);
        assert!(!result.conflict);
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# New\n");
        let _ = std::fs::remove_file(&md_path);
    }

    #[test]
    fn write_markdown_file_skips_rewrite_when_content_matches() {
        let pdf_path = tmp("markdown_unchanged");
        let md_path = pdf_path.with_extension("md");
        std::fs::write(&md_path, "# Same\n").unwrap();

        let result = write_markdown_file(&pdf_path, "# Same\n", false).unwrap();

        assert!(!result.written);
        assert!(!result.conflict);
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Same\n");
        let _ = std::fs::remove_file(&md_path);
    }

    #[test]
    fn optimize_pdf_writes_output_file() {
        let path = save(&mut build_pdf(2), "optimize");
        let msg = optimize_pdf(path.clone()).unwrap();
        assert!(msg.contains("Metadata stripped"));
        let p = PathBuf::from(&path);
        let out = p.with_file_name(format!("{}_optimized.pdf", p.file_stem().unwrap().to_string_lossy()));
        assert!(out.exists());
        assert!(page_count(&out.to_string_lossy()) == 2);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn highlight_remove_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "remove_hl");
        add_highlight(path.clone(), 0, 10.0, 10.0, 20.0, 20.0).unwrap();
        add_highlight(path.clone(), 0, 30.0, 30.0, 40.0, 40.0).unwrap();
        assert_eq!(get_annotations(path.clone(), 0).unwrap().len(), 2);
        // Removing highlight 0 must leave the second one intact.
        remove_highlight(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].rect, [30.0, 30.0, 40.0, 40.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn highlight_add_and_read_back() {
        let path = save(&mut build_pdf(1), "highlight");
        add_highlight(path.clone(), 0, 10.0, 20.0, 110.0, 40.0).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Highlight");
        assert_eq!(annots[0].rect, [10.0, 20.0, 110.0, 40.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn out_of_bounds_delete_errors() {
        let path = save(&mut build_pdf(2), "oob");
        assert!(delete_page(path.clone(), 9).is_err());
        let _ = std::fs::remove_file(&path);
    }

    /// End-to-end smoke test against a real PDF through the actual pdfium-backed
    /// commands. Ignored by default (needs a working PDFium library and a file);
    /// run with:
    ///   PDF_EDITOR_TEST_PDF=/path/to/file.pdf \
    ///     cargo test render_real_pdf_smoke -- --ignored --nocapture
    #[test]
    #[ignore = "requires a PDFium library and PDF_EDITOR_TEST_PDF"]
    fn render_real_pdf_smoke() {
        let pdf = std::env::var("PDF_EDITOR_TEST_PDF").expect("set PDF_EDITOR_TEST_PDF");

        let pages = get_pdf_page_count(pdf.clone()).expect("page count");
        assert!(pages > 0, "expected at least one page");

        let png = render_pdf_page(pdf.clone(), 0, 800, 1132).expect("render page 0");
        assert!(png.starts_with(b"\x89PNG"), "output should be a PNG");
        assert!(png.len() > 1000, "rendered PNG looks too small");
        std::fs::write("/tmp/render_test_page0.png", &png).unwrap();

        let thumbs = get_pdf_thumbnails(pdf.clone(), 100, 141).expect("thumbnails");
        assert_eq!(thumbs.len() as u32, pages, "one thumbnail per page");

        let md = convert_pdf_to_markdown(pdf.clone()).expect("markdown");
        assert!(md.contains("## Page 1"), "markdown should have page headers");

        if pages > 1 {
            let png_after_markdown = render_pdf_page(pdf, 1, 800, 1132).expect("render page 1 after markdown");
            assert!(png_after_markdown.starts_with(b"\x89PNG"), "post-markdown render output should be a PNG");
            assert!(png_after_markdown.len() > 1000, "post-markdown rendered PNG looks too small");
        }

        eprintln!(
            "render_real_pdf_smoke: pages={pages}, page0={} bytes, thumbnails={}, markdown={} bytes",
            png.len(),
            thumbs.len(),
            md.len()
        );
        eprintln!("markdown preview:\n{}", md.chars().take(400).collect::<String>());
    }
}
