#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lopdf::{Dictionary, Document, EncryptionState, EncryptionVersion, Object, ObjectId, Permissions, Stream};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use underskrift::inspect::signatures::inspect_signatures;
use underskrift::trust::{TrustStore, TrustStoreSet};
use underskrift::verify::report::SignatureStatus;
use underskrift::verify::SignatureVerifier;
use underskrift::{PdfSigner, SigningOptions, SoftwareSigner, SubFilter};

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

#[derive(Debug, Clone, Serialize)]
struct PdfBookmarkEntry {
    title: String,
    depth: u32,
    page_index: Option<u32>,
}

fn page_index_for_object(doc: &Document, object_id: ObjectId) -> Option<u32> {
    doc.get_pages().iter().find(|(_, id)| **id == object_id).map(|(num, _)| num - 1)
}

fn outline_title(dict: &Dictionary) -> String {
    dict.get(b"Title")
        .ok()
        .and_then(|value| value.as_str().ok())
        .map(|value| String::from_utf8_lossy(value).into_owned())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn resolve_dest_object(doc: &Document, dest: &Object) -> Option<u32> {
    match dest {
        Object::Array(items) if !items.is_empty() => {
            items[0].as_reference().ok().and_then(|id| page_index_for_object(doc, id))
        }
        Object::String(name, _) | Object::Name(name) => resolve_named_dest(doc, name.as_slice()),
        Object::Reference(id) => page_index_for_object(doc, *id),
        _ => None,
    }
}

fn resolve_named_dest(doc: &Document, name: &[u8]) -> Option<u32> {
    let catalog = doc.catalog().ok()?;
    let dests_id = catalog.get(b"Dests").ok()?.as_reference().ok()?;
    let dests = doc.get_dictionary(dests_id).ok()?;
    let names = dests.get(b"Names").ok()?.as_array().ok()?;
    let mut index = 0usize;
    while index + 1 < names.len() {
        let matches = names[index].as_str().ok().is_some_and(|value| value == name);
        if matches {
            return resolve_dest_object(doc, &names[index + 1]);
        }
        index += 2;
    }
    None
}

fn resolve_outline_destination(doc: &Document, dict: &Dictionary) -> Option<u32> {
    if let Ok(dest) = dict.get(b"Dest") {
        if let Some(page_index) = resolve_dest_object(doc, dest) {
            return Some(page_index);
        }
    }
    let action = dict.get(b"A").ok()?.as_dict().ok()?;
    let subtype = action.get(b"S").ok().and_then(|value| value.as_name().ok());
    if subtype != Some(b"GoTo".as_slice()) {
        return None;
    }
    resolve_dest_object(doc, action.get(b"D").ok()?)
}

fn collect_outline_items(doc: &Document, item_id: ObjectId, depth: u32, entries: &mut Vec<PdfBookmarkEntry>) {
    let mut current = Some(item_id);
    while let Some(id) = current {
        let dict = match doc.get_dictionary(id) {
            Ok(dict) => dict,
            Err(_) => break,
        };
        entries.push(PdfBookmarkEntry {
            title: outline_title(dict),
            depth,
            page_index: resolve_outline_destination(doc, dict),
        });
        if let Ok(first) = dict.get(b"First") {
            if let Ok(child_id) = first.as_reference() {
                collect_outline_items(doc, child_id, depth + 1, entries);
            }
        }
        current = dict.get(b"Next").ok().and_then(|value| value.as_reference().ok());
    }
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

fn read_info_string(doc: &Document, key: &[u8]) -> Option<String> {
    let object = doc.trailer.get(b"Info").ok()?;
    let dict = match object {
        Object::Reference(id) => doc.get_dictionary(*id).ok()?,
        Object::Dictionary(dict) => dict,
        _ => return None,
    };
    dict.get(key).ok().and_then(|value| value.as_str().ok()).map(|bytes| String::from_utf8_lossy(bytes).into_owned())
}

fn ensure_info_dict_id(doc: &mut Document) -> Result<ObjectId, String> {
    match doc.trailer.get(b"Info") {
        Ok(Object::Reference(id)) => Ok(*id),
        Ok(Object::Dictionary(dict)) => {
            let id = doc.add_object(Object::Dictionary(dict.clone()));
            doc.trailer.set(b"Info", Object::Reference(id));
            Ok(id)
        }
        _ => {
            let id = doc.add_object(Object::Dictionary(Dictionary::new()));
            doc.trailer.set(b"Info", Object::Reference(id));
            Ok(id)
        }
    }
}

fn unix_seconds_to_utc_parts(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let time = secs.rem_euclid(86_400);
    let hour = (time / 3_600) as u32;
    let minute = ((time % 3_600) / 60) as u32;
    let second = (time % 60) as u32;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i32) + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month = (5 * doy + 2) / 153;
    let day = (doy - (153 * month + 2) / 5 + 1) as u32;
    let month = ((month + 2) % 12 + 1) as u32;
    let year = y + i32::from(month <= 2);

    (year, month, day, hour, minute, second)
}

fn current_pdf_mod_date() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = unix_seconds_to_utc_parts(secs);
    format!("D:{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}Z")
}

fn write_info_text_field(dict: &mut Dictionary, key: &[u8], value: Option<String>) {
    let Some(text) = value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) else {
        dict.remove(key);
        return;
    };
    dict.set(key, Object::String(text.into_bytes(), lopdf::StringFormat::Literal));
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

fn render_page_png(path: &Path, page_index: u32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let page = document.pages().get(page_index as PdfPageIndex).map_err(|e| e.to_string())?;
    let bitmap = page.render(width as Pixels, height as Pixels, None).map_err(|e| e.to_string())?;
    let image = bitmap.as_image().map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(buffer)
}

const OCR_RENDER_W: i32 = 1200;
const OCR_RENDER_H: i32 = 1697;

fn ocr_language() -> String {
    std::env::var("PDF_PANDA_OCR_LANG").unwrap_or_else(|_| "eng".into())
}

fn resolve_tesseract() -> Option<PathBuf> {
    if let Ok(cmd) = std::env::var("TESSERACT_CMD") {
        let path = PathBuf::from(cmd);
        if path.is_file() {
            return Some(path);
        }
    }
    let name = if cfg!(windows) { "tesseract.exe" } else { "tesseract" };
    std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|dir| dir.join(name)).find(|candidate| candidate.is_file()))
}

/// Run Tesseract on a PNG buffer. `Ok(None)` when Tesseract is not installed.
fn ocr_png_bytes(png: &[u8]) -> Result<Option<String>, String> {
    let tesseract = match resolve_tesseract() {
        Some(path) => path,
        None => return Ok(None),
    };

    let tmp_dir = std::env::temp_dir().join(format!(
        "pdf_panda_ocr_{}_{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
    ));
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let image_path = tmp_dir.join("page.png");
    fs::write(&image_path, png).map_err(|e| e.to_string())?;

    let output = Command::new(&tesseract)
        .arg(&image_path)
        .arg("stdout")
        .arg("-l")
        .arg(ocr_language())
        .output()
        .map_err(|e| format!("failed to run {}: {e}", tesseract.display()))?;

    let _ = fs::remove_dir_all(&tmp_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tesseract failed: {stderr}"));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

#[tauri::command]
fn ocr_available() -> bool {
    resolve_tesseract().is_some()
}

/// OCR a single rendered PDF page (for scanned documents without a text layer).
#[tauri::command]
fn ocr_pdf_page(path: String, page: u32) -> Result<String, String> {
    let path = PathBuf::from(path);
    let png = render_page_png(&path, page, OCR_RENDER_W, OCR_RENDER_H)?;
    match ocr_png_bytes(&png)? {
        Some(text) => Ok(text),
        None => Err("Tesseract OCR is not installed (set TESSERACT_CMD or add tesseract to PATH)".into()),
    }
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

/// Attributes a leaf page can inherit from ancestor /Pages nodes.
const INHERITABLE_PAGE_KEYS: [&[u8]; 4] = [b"MediaBox", b"CropBox", b"Resources", b"Rotate"];

fn is_page_dict(d: &Dictionary) -> bool {
    d.get(b"Type").ok().and_then(|o| o.as_name().ok()).map(|n| n == b"Page").unwrap_or(false)
}

/// Resolve an inheritable page attribute by walking the page's /Parent chain.
fn inherited_page_attr(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Object> {
    let mut dict = doc.get_dictionary(page).ok()?;
    loop {
        let parent_ref = dict.get(b"Parent").ok()?.as_reference().ok()?;
        let parent = doc.get_dictionary(parent_ref).ok()?;
        if let Ok(val) = parent.get(key) {
            return Some(val.clone());
        }
        dict = parent;
    }
}

/// Collapse a (possibly nested) page tree so every leaf page is a direct child of
/// the root /Pages node. Inheritable attributes are pushed onto each leaf first
/// so reparenting can't drop a page's MediaBox/Resources/etc. Afterwards /Kids is
/// a flat, ordered leaf list (index == page order) and /Count is correct, which
/// is what `move_page`/`insert_pdf` assume. Returns the root /Pages id.
fn flatten_pages(doc: &mut Document) -> Result<ObjectId, String> {
    let (_, pages_ref) = get_pages_kids(doc)?;
    let leaves: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for &leaf in &leaves {
        for key in INHERITABLE_PAGE_KEYS {
            let present = doc.get_dictionary(leaf).map(|d| d.get(key).is_ok()).unwrap_or(false);
            if present {
                continue;
            }
            if let Some(val) = inherited_page_attr(doc, leaf, key) {
                if let Ok(d) = doc.get_dictionary_mut(leaf) {
                    d.set(key.to_vec(), val);
                }
            }
        }
    }
    for &leaf in &leaves {
        if let Ok(d) = doc.get_dictionary_mut(leaf) {
            d.set("Parent", Object::Reference(pages_ref));
        }
    }
    let kids: Vec<Object> = leaves.iter().map(|id| Object::Reference(*id)).collect();
    set_pages_kids(doc, pages_ref, kids)?;
    Ok(pages_ref)
}

/// Deep-copy object `id` (and everything it transitively references) from `src`
/// into `dst` with a fresh id, remapping references. `remap` dedupes shared
/// resources and terminates reference cycles. Page dicts encountered anywhere are
/// detached from the source tree (see `import_page_dict`) so we never drag the
/// whole page tree across.
fn import_object(
    dst: &mut Document,
    src: &Document,
    id: ObjectId,
    dst_root: ObjectId,
    remap: &mut BTreeMap<ObjectId, ObjectId>,
) -> ObjectId {
    if let Some(&new) = remap.get(&id) {
        return new;
    }
    let new_id = dst.new_object_id();
    remap.insert(id, new_id);
    let cloned = match src.get_object(id) {
        Ok(Object::Dictionary(d)) if is_page_dict(d) => {
            Object::Dictionary(import_page_dict(dst, src, id, d, dst_root, remap))
        }
        Ok(obj) => import_value(dst, src, obj, dst_root, remap),
        Err(_) => Object::Null,
    };
    dst.objects.insert(new_id, cloned);
    new_id
}

fn import_value(
    dst: &mut Document,
    src: &Document,
    value: &Object,
    dst_root: ObjectId,
    remap: &mut BTreeMap<ObjectId, ObjectId>,
) -> Object {
    match value {
        Object::Reference(rid) => Object::Reference(import_object(dst, src, *rid, dst_root, remap)),
        Object::Array(items) => {
            Object::Array(items.iter().map(|v| import_value(dst, src, v, dst_root, remap)).collect())
        }
        Object::Dictionary(d) => Object::Dictionary(import_dict(dst, src, d, dst_root, remap)),
        Object::Stream(s) => {
            Object::Stream(Stream::new(import_dict(dst, src, &s.dict, dst_root, remap), s.content.clone()))
        }
        other => other.clone(),
    }
}

fn import_dict(
    dst: &mut Document,
    src: &Document,
    dict: &Dictionary,
    dst_root: ObjectId,
    remap: &mut BTreeMap<ObjectId, ObjectId>,
) -> Dictionary {
    let mut out = Dictionary::new();
    for (key, val) in dict.iter() {
        out.set(key.clone(), import_value(dst, src, val, dst_root, remap));
    }
    out
}

/// Import a page detached from its source tree: resolve inherited attributes,
/// drop the upward /Parent link, deep-copy the remaining entries (Contents,
/// Resources, …), then point /Parent at the destination root.
fn import_page_dict(
    dst: &mut Document,
    src: &Document,
    src_page: ObjectId,
    dict: &Dictionary,
    dst_root: ObjectId,
    remap: &mut BTreeMap<ObjectId, ObjectId>,
) -> Dictionary {
    let mut page = dict.clone();
    page.remove(b"Parent");
    for key in INHERITABLE_PAGE_KEYS {
        if page.get(key).is_err() {
            if let Some(val) = inherited_page_attr(src, src_page, key) {
                page.set(key.to_vec(), val);
            }
        }
    }
    let mut out = import_dict(dst, src, &page, dst_root, remap);
    out.set("Parent", Object::Reference(dst_root));
    out
}

fn form_field_root_id(doc: &Document, mut id: ObjectId) -> Option<ObjectId> {
    for _ in 0..32 {
        let dict = resolve_field_dict(doc, id)?;
        if let Ok(Object::Reference(parent)) = dict.get(b"Parent") {
            id = *parent;
            continue;
        }
        return Some(id);
    }
    None
}

fn form_roots_on_pages(doc: &Document, page_ids: &[ObjectId]) -> Vec<ObjectId> {
    let mut roots = BTreeMap::new();
    for &page_id in page_ids {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
        for annot in annots {
            let Object::Reference(id) = annot else { continue };
            let Some(dict) = resolve_field_dict(doc, *id) else { continue };
            let is_widget = dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(b"Widget");
            if dict.get(b"FT").is_ok() || (is_widget && dict.get(b"Parent").is_ok()) {
                if let Some(root) = form_field_root_id(doc, *id) {
                    roots.insert(root, ());
                }
            }
        }
    }
    roots.keys().copied().collect()
}

fn acroform_tree_contains(doc: &Document, field: &Object, target: ObjectId) -> bool {
    match field {
        Object::Reference(id) => {
            if *id == target {
                return true;
            }
            if let Some(dict) = resolve_field_dict(doc, *id) {
                if let Some(arr) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
                    return arr.iter().any(|kid| acroform_tree_contains(doc, kid, target));
                }
            }
            false
        }
        _ => false,
    }
}

fn acroform_already_has_field(doc: &Document, field_id: ObjectId) -> bool {
    let Ok(catalog) = doc.catalog() else { return false };
    let Ok(Object::Reference(af_id)) = catalog.get(b"AcroForm") else { return false };
    let Ok(af) = doc.get_dictionary(*af_id) else { return false };
    let Ok(Object::Array(fields)) = af.get(b"Fields") else { return false };
    fields.iter().any(|entry| acroform_tree_contains(doc, entry, field_id))
}

fn rename_form_field_title(doc: &mut Document, field_id: ObjectId, new_name: &str) -> Result<(), String> {
    doc.get_dictionary_mut(field_id)
        .map_err(|e| e.to_string())?
        .set(b"T", Object::String(new_name.as_bytes().to_vec(), lopdf::StringFormat::Literal));
    Ok(())
}

fn resolve_imported_form_name_conflict(doc: &mut Document, field_id: ObjectId) -> Result<(), String> {
    let Some(root) = form_field_root_id(doc, field_id) else {
        return Ok(());
    };
    let Some(name) = resolve_field_dict(doc, root).and_then(field_partial_name) else {
        return Ok(());
    };
    let mut clash = false;
    for &page_id in doc.get_pages().values() {
        let Ok(page) = doc.get_dictionary(page_id) else { continue };
        let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
        for annot in annots {
            let Object::Reference(id) = annot else { continue };
            let Some(other_root) = form_field_root_id(doc, *id) else { continue };
            if other_root == root {
                continue;
            }
            if resolve_field_dict(doc, other_root).and_then(field_partial_name).as_deref() == Some(name.as_str()) {
                clash = true;
                break;
            }
        }
        if clash {
            break;
        }
    }
    if !clash {
        return Ok(());
    }
    let mut candidate = format!("imported_{name}");
    let mut suffix = 1u32;
    loop {
        let mut available = true;
        for &page_id in doc.get_pages().values() {
            let Ok(page) = doc.get_dictionary(page_id) else { continue };
            let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
            for annot in annots {
                let Object::Reference(id) = annot else { continue };
                let Some(other_root) = form_field_root_id(doc, *id) else { continue };
                if other_root == root {
                    continue;
                }
                if resolve_field_dict(doc, other_root).and_then(field_partial_name).as_deref()
                    == Some(candidate.as_str())
                {
                    available = false;
                    break;
                }
            }
            if !available {
                break;
            }
        }
        if available {
            break;
        }
        candidate = format!("imported_{name}_{suffix}");
        suffix += 1;
    }
    rename_form_field_title(doc, root, &candidate)
}

fn register_acroform_field(doc: &mut Document, field_id: ObjectId) -> Result<(), String> {
    if acroform_already_has_field(doc, field_id) {
        return Ok(());
    }
    resolve_imported_form_name_conflict(doc, field_id)?;
    push_acroform_field(doc, field_id)
}

fn merge_acroform_after_insert(
    doc: &mut Document,
    insert_doc: &Document,
    inserted_page_ids: &[ObjectId],
    remap: &BTreeMap<ObjectId, ObjectId>,
) -> Result<(), String> {
    let mut roots = BTreeMap::<ObjectId, ()>::new();
    for root in form_roots_on_pages(doc, inserted_page_ids) {
        roots.insert(root, ());
    }
    if let Ok(catalog) = insert_doc.catalog() {
        if let Ok(Object::Reference(af_id)) = catalog.get(b"AcroForm") {
            if let Ok(af) = insert_doc.get_dictionary(*af_id) {
                if let Ok(Object::Array(fields)) = af.get(b"Fields") {
                    for field in fields {
                        let Object::Reference(src_id) = field else { continue };
                        if let Some(&dst_id) = remap.get(src_id) {
                            roots.insert(dst_id, ());
                        }
                    }
                }
            }
        }
    }
    for root in roots.keys().copied() {
        register_acroform_field(doc, root)?;
    }
    if !roots.is_empty() {
        mark_acroform_need_appearances(doc)?;
    }
    Ok(())
}

fn page_font_entries(doc: &Document, page_id: ObjectId) -> Vec<(Vec<u8>, ObjectId)> {
    let mut out = Vec::new();
    let Ok(page) = doc.get_dictionary(page_id) else { return out };
    let Ok(resources) = page.get(b"Resources").and_then(|o| o.as_dict()) else { return out };
    let Ok(fonts) = resources.get(b"Font").and_then(|o| o.as_dict()) else { return out };
    for (name, obj) in fonts.iter() {
        let id = match obj {
            Object::Reference(id) => *id,
            _ => continue,
        };
        out.push((name.clone(), id));
    }
    out
}

fn font_signature(doc: &Document, font_id: ObjectId) -> Option<String> {
    let dict = doc.get_dictionary(font_id).ok()?;
    let base = dict.get(b"BaseFont").ok()?.as_name().ok()?;
    let subtype = dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()).unwrap_or(b"");
    let mut sig = format!("{}:{}", String::from_utf8_lossy(subtype), String::from_utf8_lossy(base));
    if let Ok(Object::Reference(desc_id)) = dict.get(b"FontDescriptor") {
        if let Ok(Object::Dictionary(desc)) = doc.get_object(*desc_id) {
            if let Some(len) = desc.get(b"Length").ok().and_then(|o| o.as_i64().ok()) {
                sig.push_str(&format!(":len={len}"));
            }
            if let Some(name) = desc.get(b"FontName").ok().and_then(|o| o.as_name().ok()) {
                sig.push_str(&format!(":fn={}", String::from_utf8_lossy(name)));
            }
        }
    }
    Some(sig)
}

fn dedup_fonts_after_insert(doc: &mut Document, inserted_page_ids: &[ObjectId]) -> Result<u32, String> {
    let inserted: BTreeMap<ObjectId, ()> = inserted_page_ids.iter().copied().map(|id| (id, ())).collect();
    let mut known: BTreeMap<String, ObjectId> = BTreeMap::new();

    for &page_id in doc.get_pages().values() {
        if inserted.contains_key(&page_id) {
            continue;
        }
        for (_name, font_id) in page_font_entries(doc, page_id) {
            if let Some(sig) = font_signature(doc, font_id) {
                known.entry(sig).or_insert(font_id);
            }
        }
    }

    let mut deduped = 0u32;
    for &page_id in inserted_page_ids {
        let entries = page_font_entries(doc, page_id);
        for (res_name, font_id) in entries {
            let Some(sig) = font_signature(doc, font_id) else { continue };
            if let Some(&existing_id) = known.get(&sig) {
                if existing_id != font_id {
                    let page_dict = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
                    let resources = page_dict
                        .get_mut(b"Resources")
                        .map_err(|e| e.to_string())?
                        .as_dict_mut()
                        .map_err(|_| "Bad Resources".to_string())?;
                    let fonts = resources
                        .get_mut(b"Font")
                        .map_err(|e| e.to_string())?
                        .as_dict_mut()
                        .map_err(|_| "Bad Font dict".to_string())?;
                    fonts.set(res_name, Object::Reference(existing_id));
                    deduped += 1;
                }
            } else {
                known.insert(sig, font_id);
            }
        }
    }
    Ok(deduped)
}

#[tauri::command]
fn delete_page(path: String, page_index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    // Use lopdf's tree-aware deletion: it resolves the leaf page through the
    // (possibly nested) page tree, removes only that leaf, and decrements /Count
    // up the parent chain. The old flat `Kids` edit assumed every kid was a leaf
    // page, so on a nested tree it deleted whole sub-trees and wrote a bogus
    // /Count (deleting "page 1" could drop pages 1–5 and hide the rest).
    let total = doc.get_pages().len();
    if total <= 1 {
        return Err("Cannot delete the only page in the document".to_string());
    }
    let idx = page_index as usize;
    if idx >= total {
        return Err("Page index out of bounds".to_string());
    }
    doc.delete_pages(&[page_index + 1]); // lopdf page numbers are 1-based

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn move_page(path: String, from_index: u32, to_index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    // Flatten first so /Kids is a flat leaf list (index == page order) even when
    // the source PDF uses a nested page tree.
    let pages_ref = flatten_pages(&mut doc)?;
    let (mut kids, _) = get_pages_kids(&doc)?;

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

// Viewer render size — must stay aligned with `BASE_W` / `BASE_H` in `App.tsx`.
const VIEWER_PAGE_W: f64 = 800.0;
const VIEWER_PAGE_H: f64 = 1132.0;

fn page_media_box(doc: &Document, page_id: ObjectId) -> Result<[f64; 4], String> {
    let page = doc.get_dictionary(page_id).map_err(|e| e.to_string())?;
    let arr = page.get(b"MediaBox").map_err(|e| e.to_string())?.as_array().map_err(|_| "Bad MediaBox")?;
    let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
    Ok([get(0), get(1), get(2), get(3)])
}

fn viewer_rect_to_pdf(
    doc: &Document,
    page_id: ObjectId,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(f64, f64, f64, f64), String> {
    let media = page_media_box(doc, page_id)?;
    let mw = media[2] - media[0];
    let mh = media[3] - media[1];
    if mw <= 0.0 || mh <= 0.0 || w <= 0.0 || h <= 0.0 {
        return Err("Invalid page or image size".to_string());
    }
    let px = x * mw / VIEWER_PAGE_W;
    let pw = w * mw / VIEWER_PAGE_W;
    let ph = h * mh / VIEWER_PAGE_H;
    let py = mh - (y * mh / VIEWER_PAGE_H) - ph;
    Ok((px, py, pw, ph))
}

fn next_image_xobject_name(xobjects: &Dictionary) -> String {
    for n in 1..=9999 {
        let name = format!("Im{n}");
        if xobjects.get(name.as_bytes()).is_err() {
            return name;
        }
    }
    "Im9999".to_string()
}

fn append_page_content(doc: &mut Document, page_id: ObjectId, ops: &[u8]) -> Result<(), String> {
    let contents = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Contents").ok().cloned();
    match contents {
        Some(Object::Reference(id)) => {
            let obj = doc.get_object_mut(id).map_err(|e| e.to_string())?;
            if let Object::Stream(stream) = obj {
                let mut body = stream.get_plain_content().map_err(|e| e.to_string())?;
                body.extend_from_slice(ops);
                stream.set_plain_content(body);
            } else {
                return Err("Bad page Contents".to_string());
            }
        }
        Some(Object::Array(mut arr)) => {
            let new_id = doc.add_object(Object::Stream(Stream::new(Dictionary::new(), ops.to_vec())));
            arr.push(Object::Reference(new_id));
            doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Contents", Object::Array(arr));
        }
        _ => {
            let stream_id = doc.add_object(Object::Stream(Stream::new(Dictionary::new(), ops.to_vec())));
            doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Contents", Object::Reference(stream_id));
        }
    }
    Ok(())
}

fn embed_jpeg_xobject(doc: &mut Document, jpeg: Vec<u8>, width: u32, height: u32) -> ObjectId {
    doc.add_object(Object::Stream(Stream::new(
        Dictionary::from_iter(vec![
            (b"Type".to_vec(), Object::Name(b"XObject".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Image".to_vec())),
            (b"Width".to_vec(), Object::Integer(width as i64)),
            (b"Height".to_vec(), Object::Integer(height as i64)),
            (b"ColorSpace".to_vec(), Object::Name(b"DeviceRGB".to_vec())),
            (b"BitsPerComponent".to_vec(), Object::Integer(8)),
            (b"Filter".to_vec(), Object::Name(b"DCTDecode".to_vec())),
        ]),
        jpeg,
    )))
}

#[tauri::command]
fn get_image_dimensions(path: String) -> Result<[u32; 2], String> {
    let img = image::open(PathBuf::from(&path)).map_err(|e| e.to_string())?;
    Ok([img.width(), img.height()])
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
    if width < 5.0 || height < 5.0 {
        return Err("Image placement is too small".to_string());
    }

    let image_path = PathBuf::from(&image_path);
    if !image_path.is_file() {
        return Err("Image file not found".to_string());
    }

    let img = image::open(&image_path).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let (img_w, img_h) = rgb.dimensions();
    let mut jpeg = Vec::new();
    image::DynamicImage::ImageRgb8(rgb)
        .write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let (px, py, pw, ph) = viewer_rect_to_pdf(&doc, page_id, x, y, width, height)?;
    let image_id = embed_jpeg_xobject(&mut doc, jpeg, img_w, img_h);

    if !matches!(doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Resources"), Ok(Object::Dictionary(_))) {
        doc.get_dictionary_mut(page_id)
            .map_err(|e| e.to_string())?
            .set(b"Resources", Object::Dictionary(Dictionary::new()));
    }

    let xobject_name = {
        let page_dict = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
        let resources = page_dict
            .get_mut(b"Resources")
            .map_err(|e| e.to_string())?
            .as_dict_mut()
            .map_err(|_| "Bad Resources".to_string())?;
        match resources.get_mut(b"XObject") {
            Ok(Object::Dictionary(dict)) => {
                let name = next_image_xobject_name(dict);
                dict.set(name.as_bytes(), Object::Reference(image_id));
                name
            }
            _ => {
                let mut dict = Dictionary::new();
                dict.set(b"Im1", Object::Reference(image_id));
                resources.set(b"XObject", Object::Dictionary(dict));
                "Im1".to_string()
            }
        }
    };

    let ops = format!("q {pw} 0 0 {ph} {px} {py} cm /{xobject_name} Do Q\n");
    append_page_content(&mut doc, page_id, ops.as_bytes())?;

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageTextEdit {
    index: u32,
    x: f64,
    y: f64,
    font_size: f64,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageVectorEdit {
    index: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    kind: String,
}

fn stream_plain_content(doc: &Document, id: ObjectId) -> Result<Vec<u8>, String> {
    let stream =
        doc.get_object(id).map_err(|e| e.to_string())?.as_stream().map_err(|_| "Bad content stream".to_string())?;
    match stream.get_plain_content() {
        Ok(bytes) => Ok(bytes),
        Err(_) => Ok(stream.content.clone()),
    }
}

fn read_page_content(doc: &Document, page_id: ObjectId) -> Result<Vec<u8>, String> {
    let contents = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Contents").ok().cloned();
    match contents {
        Some(Object::Reference(id)) => stream_plain_content(doc, id),
        Some(Object::Array(items)) => {
            let mut merged = Vec::new();
            for item in items {
                if let Object::Reference(id) = item {
                    merged.extend_from_slice(&stream_plain_content(doc, id)?);
                    merged.push(b'\n');
                }
            }
            Ok(merged)
        }
        _ => Ok(Vec::new()),
    }
}

fn write_page_content(doc: &mut Document, page_id: ObjectId, body: Vec<u8>) -> Result<(), String> {
    let mut stream = Stream::new(Dictionary::new(), body.clone());
    stream.set_plain_content(body);
    let stream_id = doc.add_object(Object::Stream(stream));
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Contents", Object::Reference(stream_id));
    Ok(())
}

fn viewer_point_to_pdf(doc: &Document, page_id: ObjectId, x: f64, y: f64) -> Result<(f64, f64), String> {
    let media = page_media_box(doc, page_id)?;
    let mw = media[2] - media[0];
    let mh = media[3] - media[1];
    if mw <= 0.0 || mh <= 0.0 {
        return Err("Invalid page size".to_string());
    }
    let px = x * mw / VIEWER_PAGE_W;
    let py = mh - y * mh / VIEWER_PAGE_H;
    Ok((px, py))
}

fn escape_pdf_literal_string(text: &str) -> String {
    text.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
}

fn marker_label(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ensure_helvetica_font(doc: &mut Document, page_id: ObjectId) -> Result<String, String> {
    let page_dict = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
    if !matches!(page_dict.get(b"Resources"), Ok(Object::Dictionary(_))) {
        page_dict.set(b"Resources", Object::Dictionary(Dictionary::new()));
    }
    let resources = page_dict
        .get_mut(b"Resources")
        .map_err(|e| e.to_string())?
        .as_dict_mut()
        .map_err(|_| "Bad Resources".to_string())?;
    let font_name = match resources.get_mut(b"Font") {
        Ok(Object::Dictionary(fonts)) => {
            if fonts.get(b"Helv").is_ok() {
                "Helv".to_string()
            } else {
                fonts.set(
                    b"Helv",
                    Object::Dictionary(Dictionary::from_iter(vec![
                        (b"Type".to_vec(), Object::Name(b"Font".to_vec())),
                        (b"Subtype".to_vec(), Object::Name(b"Type1".to_vec())),
                        (b"BaseFont".to_vec(), Object::Name(b"Helvetica".to_vec())),
                    ])),
                );
                "Helv".to_string()
            }
        }
        _ => {
            let mut fonts = Dictionary::new();
            fonts.set(
                b"Helv",
                Object::Dictionary(Dictionary::from_iter(vec![
                    (b"Type".to_vec(), Object::Name(b"Font".to_vec())),
                    (b"Subtype".to_vec(), Object::Name(b"Type1".to_vec())),
                    (b"BaseFont".to_vec(), Object::Name(b"Helvetica".to_vec())),
                ])),
            );
            resources.set(b"Font", Object::Dictionary(fonts));
            "Helv".to_string()
        }
    };
    Ok(font_name)
}

fn next_panda_text_index(content: &str) -> u32 {
    content
        .lines()
        .filter_map(|line| line.strip_prefix("%PP-TXT "))
        .filter_map(|rest| rest.split_whitespace().next()?.parse::<u32>().ok())
        .max()
        .map(|max| max + 1)
        .unwrap_or(0)
}

fn next_panda_vector_index(content: &str) -> u32 {
    content
        .lines()
        .filter_map(|line| line.strip_prefix("%PP-VEC "))
        .filter_map(|rest| rest.split_whitespace().next()?.parse::<u32>().ok())
        .max()
        .map(|max| max + 1)
        .unwrap_or(0)
}

fn parse_page_text_edits(content: &str) -> Vec<PageTextEdit> {
    let mut edits = Vec::new();
    for line in content.lines() {
        let Some(rest) = line.strip_prefix("%PP-TXT ") else { continue };
        let mut parts = rest.split_whitespace();
        let Some(index) = parts.next().and_then(|v| v.parse::<u32>().ok()) else { continue };
        let Some(x) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let Some(y) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let Some(font_size) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let text = parts.collect::<Vec<_>>().join(" ");
        edits.push(PageTextEdit { index, x, y, font_size, text });
    }
    edits.sort_by_key(|edit| edit.index);
    edits
}

fn parse_page_vectors(content: &str) -> Vec<PageVectorEdit> {
    let mut vectors = Vec::new();
    for line in content.lines() {
        let Some(rest) = line.strip_prefix("%PP-VEC ") else { continue };
        let mut parts = rest.split_whitespace();
        let Some(index) = parts.next().and_then(|v| v.parse::<u32>().ok()) else { continue };
        let Some(x) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let Some(y) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let Some(width) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let Some(height) = parts.next().and_then(|v| v.parse::<f64>().ok()) else { continue };
        let kind = parts.next().unwrap_or("stroke").to_string();
        vectors.push(PageVectorEdit { index, x, y, width, height, kind });
    }
    vectors.sort_by_key(|vector| vector.index);
    vectors
}

fn remove_panda_block(content: &str, marker_prefix: &str, index: u32) -> Result<String, String> {
    let needle = format!("{marker_prefix} {index} ");
    let mut lines = content.lines().collect::<Vec<_>>();
    let start = lines
        .iter()
        .position(|line| line.starts_with(&needle))
        .ok_or_else(|| format!("{marker_prefix} block not found"))?;
    let mut end = start + 1;
    while end < lines.len() && !lines[end].starts_with("%PP-") {
        end += 1;
    }
    lines.drain(start..end);
    let mut output = lines.join("\n");
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
    Ok(output)
}

struct PageTextOpsArgs<'a> {
    index: u32,
    x: f64,
    y: f64,
    font_size: f64,
    text: &'a str,
    px: f64,
    py: f64,
    font_name: &'a str,
}

fn build_page_text_ops(args: PageTextOpsArgs<'_>) -> String {
    let escaped = escape_pdf_literal_string(args.text);
    format!(
        "%PP-TXT {index} {x} {y} {font_size} {label}\nBT /{font_name} {font_size} Tf 1 0 0 1 {px} {py} Tm ({escaped}) Tj ET\n",
        index = args.index,
        x = args.x,
        y = args.y,
        font_size = args.font_size,
        font_name = args.font_name,
        px = args.px,
        py = args.py,
        label = marker_label(args.text)
    )
}

#[tauri::command]
fn add_page_text(path: String, page_index: u32, x: f64, y: f64, font_size: f64, text: String) -> Result<u32, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Text cannot be empty".to_string());
    }
    if !(8.0..=72.0).contains(&font_size) {
        return Err("Font size must be between 8 and 72".to_string());
    }
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let font_name = ensure_helvetica_font(&mut doc, page_id)?;
    let (px, py) = viewer_point_to_pdf(&doc, page_id, x, y)?;
    let content = String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned();
    let index = next_panda_text_index(&content);
    let mut ops =
        build_page_text_ops(PageTextOpsArgs { index, x, y, font_size, text: trimmed, px, py, font_name: &font_name });
    if !ops.starts_with('\n') {
        ops.insert(0, '\n');
    }
    append_page_content(&mut doc, page_id, ops.as_bytes())?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(index)
}

#[tauri::command]
fn list_page_text_edits(path: String, page_index: u32) -> Result<Vec<PageTextEdit>, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let bytes = read_page_content(&doc, page_id)?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(parse_page_text_edits(&content))
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
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Text cannot be empty".to_string());
    }
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let font_name = ensure_helvetica_font(&mut doc, page_id)?;
    let content = String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned();
    let existing = parse_page_text_edits(&content)
        .into_iter()
        .find(|edit| edit.index == index)
        .ok_or_else(|| "Text block not found".to_string())?;
    let next_x = x.unwrap_or(existing.x);
    let next_y = y.unwrap_or(existing.y);
    let next_font_size = font_size.unwrap_or(existing.font_size);
    if !(8.0..=72.0).contains(&next_font_size) {
        return Err("Font size must be between 8 and 72".to_string());
    }
    let mut content = remove_panda_block(&content, "%PP-TXT", index)?;
    let (px, py) = viewer_point_to_pdf(&doc, page_id, next_x, next_y)?;
    content.push_str(&build_page_text_ops(PageTextOpsArgs {
        index,
        x: next_x,
        y: next_y,
        font_size: next_font_size,
        text: trimmed,
        px,
        py,
        font_name: &font_name,
    }));
    write_page_content(&mut doc, page_id, content.into_bytes())?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_page_text(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let content = String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned();
    let content = remove_panda_block(&content, "%PP-TXT", index)?;
    write_page_content(&mut doc, page_id, content.into_bytes())?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_page_vector_rect(path: String, page_index: u32, x: f64, y: f64, width: f64, height: f64) -> Result<u32, String> {
    if width < 2.0 || height < 2.0 {
        return Err("Vector shape is too small".to_string());
    }
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let (px, py, pw, ph) = viewer_rect_to_pdf(&doc, page_id, x, y, width, height)?;
    let content = String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned();
    let index = next_panda_vector_index(&content);
    let ops = format!("\n%PP-VEC {index} {x} {y} {width} {height} stroke\nq 1 w {px} {py} {pw} {ph} re S Q\n");
    append_page_content(&mut doc, page_id, ops.as_bytes())?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(index)
}

#[tauri::command]
fn list_page_vectors(path: String, page_index: u32) -> Result<Vec<PageVectorEdit>, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let bytes = read_page_content(&doc, page_id)?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(parse_page_vectors(&content))
}

#[tauri::command]
fn remove_page_vector(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let content = String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned();
    let content = remove_panda_block(&content, "%PP-VEC", index)?;
    write_page_content(&mut doc, page_id, content.into_bytes())?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn pdf_object_string(obj: &Object) -> Option<String> {
    match obj {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
        Object::Name(name) => Some(String::from_utf8_lossy(name).to_string()),
        _ => None,
    }
}

fn pdf_rect_to_viewer(doc: &Document, page_id: ObjectId, rect: [f64; 4]) -> Result<[f64; 4], String> {
    let media = page_media_box(doc, page_id)?;
    let mw = media[2] - media[0];
    let mh = media[3] - media[1];
    if mw <= 0.0 || mh <= 0.0 {
        return Err("Invalid page size".to_string());
    }
    let x1 = (rect[0] - media[0]) * VIEWER_PAGE_W / mw;
    let x2 = (rect[2] - media[0]) * VIEWER_PAGE_W / mw;
    let y1 = (media[3] - rect[3]) * VIEWER_PAGE_H / mh;
    let y2 = (media[3] - rect[1]) * VIEWER_PAGE_H / mh;
    Ok([x1, y1, x2, y2])
}

fn pdf_rect_array(dict: &Dictionary) -> Option<[f64; 4]> {
    let arr = dict.get(b"Rect").ok()?.as_array().ok()?;
    let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
    Some([get(0), get(1), get(2), get(3)])
}

fn btn_field_kind(dict: &Dictionary) -> &'static str {
    let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
    if ff & (1 << 16) != 0 {
        return "radio";
    }
    if ff & (1 << 17) != 0 {
        return "button";
    }
    "checkbox"
}

fn field_type_label(dict: &Dictionary) -> String {
    match dict.get(b"FT").ok().and_then(|o| o.as_name().ok()) {
        Some(b"Tx") => "text".to_string(),
        Some(b"Btn") => btn_field_kind(dict).to_string(),
        Some(b"Ch") => "choice".to_string(),
        Some(b"Sig") => "signature".to_string(),
        _ => "unknown".to_string(),
    }
}

fn field_type_label_for(doc: &Document, id: ObjectId) -> String {
    let Some(dict) = resolve_field_dict(doc, id) else {
        return "unknown".to_string();
    };
    if let Ok(Object::Reference(parent_id)) = dict.get(b"Parent") {
        if let Some(parent) = resolve_field_dict(doc, *parent_id) {
            let ff = parent.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
            if ff & (1 << 16) != 0 {
                return "radio".to_string();
            }
        }
    }
    field_type_label(dict)
}

fn field_value_string(dict: &Dictionary) -> String {
    dict.get(b"V").ok().and_then(pdf_object_string).unwrap_or_default()
}

fn field_is_checked(dict: &Dictionary) -> bool {
    match dict.get(b"V").ok() {
        Some(Object::Name(name)) => name != b"Off",
        Some(other) => pdf_object_string(other).is_some_and(|v| !v.is_empty() && !v.eq_ignore_ascii_case("off")),
        None => dict.get(b"AS").ok().and_then(|o| o.as_name().ok()).is_some_and(|n| n != b"Off"),
    }
}

fn field_choice_options(dict: &Dictionary) -> Vec<String> {
    let Some(Object::Array(opts)) = dict.get(b"Opt").ok() else {
        return Vec::new();
    };
    opts.iter()
        .filter_map(|entry| match entry {
            Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
            Object::Array(pair) if pair.len() >= 2 => pair.get(1).and_then(pdf_object_string),
            _ => None,
        })
        .collect()
}

fn page_index_for_annotation(doc: &Document, annot_id: ObjectId) -> Option<u32> {
    for (page_num, page_id) in doc.get_pages() {
        let page = doc.get_dictionary(page_id).ok()?;
        let annots = page.get(b"Annots").ok()?.as_array().ok()?;
        if annots.iter().any(|entry| matches!(entry, Object::Reference(id) if *id == annot_id)) {
            return Some(page_num.saturating_sub(1));
        }
    }
    None
}

fn resolve_field_dict(doc: &Document, id: ObjectId) -> Option<&Dictionary> {
    doc.get_object(id).ok()?.as_dict().ok()
}

fn field_partial_name(dict: &Dictionary) -> Option<String> {
    dict.get(b"T").ok().and_then(pdf_object_string)
}

fn full_field_name(doc: &Document, mut id: ObjectId) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for _ in 0..16 {
        let dict = resolve_field_dict(doc, id)?;
        if let Some(name) = field_partial_name(dict) {
            parts.push(name);
        }
        match dict.get(b"Parent") {
            Ok(Object::Reference(parent_id)) => id = *parent_id,
            _ => break,
        }
    }
    parts.reverse();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("."))
    }
}

fn collect_field_rect(doc: &Document, id: ObjectId) -> Option<[f64; 4]> {
    let dict = resolve_field_dict(doc, id)?;
    if let Some(rect) = pdf_rect_array(dict) {
        return Some(rect);
    }
    let kids = dict.get(b"Kids").ok()?.as_array().ok()?;
    for kid in kids {
        let kid_id = match kid {
            Object::Reference(kid_id) => *kid_id,
            _ => continue,
        };
        if let Some(rect) = collect_field_rect(doc, kid_id) {
            return Some(rect);
        }
    }
    None
}

fn collect_field_widget_id(doc: &Document, id: ObjectId) -> Option<ObjectId> {
    let dict = resolve_field_dict(doc, id)?;
    if dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(b"Widget") {
        return Some(id);
    }
    let kids = dict.get(b"Kids").ok()?.as_array().ok()?;
    for kid in kids {
        let kid_id = match kid {
            Object::Reference(kid_id) => *kid_id,
            _ => continue,
        };
        if let Some(widget_id) = collect_field_widget_id(doc, kid_id) {
            return Some(widget_id);
        }
    }
    None
}

fn walk_form_nodes(doc: &Document, obj: &Object, out: &mut Vec<ObjectId>) {
    let id = match obj {
        Object::Reference(id) => *id,
        _ => return,
    };
    let Some(dict) = resolve_field_dict(doc, id) else {
        return;
    };
    let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
    let is_radio_parent = ff & (1 << 16) != 0 && dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()).is_some();
    if dict.get(b"FT").is_ok() && !is_radio_parent {
        out.push(id);
    }
    if let Some(arr) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        for kid in arr {
            walk_form_nodes(doc, kid, out);
        }
    }
}

fn mark_acroform_need_appearances(doc: &mut Document) -> Result<(), String> {
    let catalog_id =
        doc.trailer.get(b"Root").ok().and_then(|o| o.as_reference().ok()).ok_or("No catalog".to_string())?;
    let catalog = doc.get_dictionary(catalog_id).map_err(|e| e.to_string())?;
    let acroform_id = match catalog.get(b"AcroForm") {
        Ok(Object::Reference(id)) => *id,
        _ => return Ok(()),
    };
    let acroform = doc.get_dictionary_mut(acroform_id).map_err(|e| e.to_string())?;
    acroform.set(b"NeedAppearances", Object::Boolean(true));
    Ok(())
}

fn ensure_acroform(doc: &mut Document) -> Result<ObjectId, String> {
    let catalog_id =
        doc.trailer.get(b"Root").ok().and_then(|o| o.as_reference().ok()).ok_or("No catalog".to_string())?;
    if let Ok(catalog) = doc.get_dictionary(catalog_id) {
        if let Ok(Object::Reference(id)) = catalog.get(b"AcroForm") {
            return Ok(*id);
        }
    }
    let acroform_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
        (b"Fields".to_vec(), Object::Array(vec![])),
        (b"NeedAppearances".to_vec(), Object::Boolean(true)),
    ])));
    doc.get_dictionary_mut(catalog_id).map_err(|e| e.to_string())?.set(b"AcroForm", Object::Reference(acroform_id));
    Ok(acroform_id)
}

fn push_acroform_field(doc: &mut Document, field_id: ObjectId) -> Result<(), String> {
    let acroform_id = ensure_acroform(doc)?;
    let acroform = doc.get_dictionary_mut(acroform_id).map_err(|e| e.to_string())?;
    match acroform.get_mut(b"Fields") {
        Ok(Object::Array(fields)) => fields.push(Object::Reference(field_id)),
        _ => {
            acroform.set(b"Fields", Object::Array(vec![Object::Reference(field_id)]));
        }
    }
    Ok(())
}

fn append_page_annotation(doc: &mut Document, page_id: ObjectId, annot_id: ObjectId) -> Result<(), String> {
    let page_dict = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
    match page_dict.get_mut(b"Annots") {
        Ok(Object::Array(arr)) => arr.push(Object::Reference(annot_id)),
        _ => page_dict.set(b"Annots", Object::Array(vec![Object::Reference(annot_id)])),
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
struct FormFieldData {
    name: String,
    field_type: String,
    value: String,
    page_index: Option<u32>,
    rect: Option<[f64; 4]>,
    options: Vec<String>,
    checked: bool,
}

fn form_field_from_id(doc: &Document, id: ObjectId) -> Option<FormFieldData> {
    let dict = resolve_field_dict(doc, id)?;
    let name = full_field_name(doc, id).or_else(|| field_partial_name(dict))?;
    let field_type = field_type_label_for(doc, id);
    let value = field_value_string(dict);
    let checked = field_is_checked(dict);
    let options = field_choice_options(dict);
    let widget_id = collect_field_widget_id(doc, id).unwrap_or(id);
    let page_index = page_index_for_annotation(doc, widget_id);
    let rect = collect_field_rect(doc, id).and_then(|pdf_rect| {
        page_index
            .and_then(|idx| doc.get_pages().get(&(idx + 1)).copied())
            .and_then(|page_id| pdf_rect_to_viewer(doc, page_id, pdf_rect).ok())
    });
    Some(FormFieldData { name, field_type, value, page_index, rect, options, checked })
}

fn collect_form_fields(doc: &Document) -> Vec<FormFieldData> {
    let mut ids = Vec::new();
    if let Ok(catalog) = doc.catalog() {
        if let Ok(Object::Reference(acroform_id)) = catalog.get(b"AcroForm") {
            if let Ok(acroform) = doc.get_dictionary(*acroform_id) {
                if let Ok(Object::Array(fields)) = acroform.get(b"Fields") {
                    for field in fields {
                        walk_form_nodes(doc, field, &mut ids);
                    }
                }
            }
        }
    }
    if ids.is_empty() {
        for page_id in doc.get_pages().values() {
            let Ok(page) = doc.get_dictionary(*page_id) else { continue };
            let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
            for annot in annots {
                let Object::Reference(id) = annot else { continue };
                let Some(dict) = resolve_field_dict(doc, *id) else { continue };
                if dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(b"Widget")
                    && dict.get(b"FT").is_ok()
                {
                    ids.push(*id);
                }
            }
        }
    }
    let mut seen = BTreeMap::new();
    for id in ids {
        if let Some(field) = form_field_from_id(doc, id) {
            seen.entry(field.name.clone()).or_insert(field);
        }
    }
    seen.into_values().collect()
}

fn find_form_field_id_by_name(doc: &Document, target: &str) -> Result<ObjectId, String> {
    let mut ids = Vec::new();
    if let Ok(catalog) = doc.catalog() {
        if let Ok(Object::Reference(acroform_id)) = catalog.get(b"AcroForm") {
            if let Ok(acroform) = doc.get_dictionary(*acroform_id) {
                if let Ok(Object::Array(fields)) = acroform.get(b"Fields") {
                    for field in fields {
                        walk_form_nodes(doc, field, &mut ids);
                    }
                }
            }
        }
    }
    if ids.is_empty() {
        for page_id in doc.get_pages().values() {
            let Ok(page) = doc.get_dictionary(*page_id) else { continue };
            let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
            for annot in annots {
                if let Object::Reference(id) = annot {
                    ids.push(*id);
                }
            }
        }
    }
    for id in ids {
        if full_field_name(doc, id).or_else(|| resolve_field_dict(doc, id).and_then(field_partial_name))
            == Some(target.to_string())
        {
            return Ok(id);
        }
    }
    Err(format!("Form field not found: {target}"))
}

#[tauri::command]
fn get_pdf_form_fields(path: String) -> Result<Vec<FormFieldData>, String> {
    let doc = Document::load(PathBuf::from(&path)).map_err(|e| e.to_string())?;
    Ok(collect_form_fields(&doc))
}

#[tauri::command]
fn set_pdf_form_field(path: String, name: String, value: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let field_id = find_form_field_id_by_name(&doc, &name)?;
    let field_type = field_type_label_for(&doc, field_id);

    match field_type.as_str() {
        "checkbox" => {
            let on = matches!(value.as_str(), "1" | "true" | "yes" | "on" | "checked");
            set_btn_widget_checked(&mut doc, field_id, on)?;
        }
        "radio" => {
            let on = matches!(value.as_str(), "1" | "true" | "yes" | "on" | "checked");
            if on {
                set_radio_group_checked(&mut doc, field_id)?;
            } else {
                set_btn_widget_checked(&mut doc, field_id, false)?;
            }
        }
        "choice" => {
            let dict = doc.get_dictionary_mut(field_id).map_err(|e| e.to_string())?;
            dict.set(b"V", Object::String(value.as_bytes().to_vec(), lopdf::StringFormat::Literal));
        }
        "button" => return Err("Push buttons cannot be filled".to_string()),
        "signature" => return Err("Signature fields cannot be filled".to_string()),
        _ => {
            let dict = doc.get_dictionary_mut(field_id).map_err(|e| e.to_string())?;
            dict.set(b"V", Object::String(value.as_bytes().to_vec(), lopdf::StringFormat::Literal));
        }
    }
    mark_acroform_need_appearances(&mut doc)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn btn_on_state_name(dict: &Dictionary) -> Vec<u8> {
    dict.get(b"AP")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|ap| ap.get(b"N").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|n| n.iter().find(|(k, _)| *k != b"Off").map(|(k, _)| k.clone()))
        .unwrap_or_else(|| b"Yes".to_vec())
}

fn set_btn_widget_checked(doc: &mut Document, widget_id: ObjectId, on: bool) -> Result<(), String> {
    let on_name = doc.get_dictionary(widget_id).map_err(|e| e.to_string()).map(btn_on_state_name)?;
    let dict = doc.get_dictionary_mut(widget_id).map_err(|e| e.to_string())?;
    if on {
        dict.set(b"V", Object::Name(on_name.clone()));
        dict.set(b"AS", Object::Name(on_name));
    } else {
        dict.set(b"V", Object::Name(b"Off".to_vec()));
        dict.set(b"AS", Object::Name(b"Off".to_vec()));
    }
    Ok(())
}

fn radio_group_widget_ids(doc: &Document, group_id: ObjectId) -> Vec<ObjectId> {
    let Some(dict) = resolve_field_dict(doc, group_id) else {
        return vec![group_id];
    };
    if let Some(kids) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        return kids
            .iter()
            .filter_map(|kid| match kid {
                Object::Reference(id) => Some(*id),
                _ => None,
            })
            .collect();
    }
    vec![group_id]
}

fn set_radio_group_checked(doc: &mut Document, selected_id: ObjectId) -> Result<(), String> {
    let group_id = doc
        .get_dictionary(selected_id)
        .ok()
        .and_then(|dict| dict.get(b"Parent").ok())
        .and_then(|o| o.as_reference().ok())
        .unwrap_or(selected_id);
    for widget_id in radio_group_widget_ids(doc, group_id) {
        set_btn_widget_checked(doc, widget_id, widget_id == selected_id)?;
    }
    Ok(())
}

fn find_radio_group_by_name(doc: &Document, group_name: &str) -> Option<ObjectId> {
    let catalog = doc.catalog().ok()?;
    let af_id = catalog.get(b"AcroForm").ok()?.as_reference().ok()?;
    let af = doc.get_dictionary(af_id).ok()?;
    let fields = af.get(b"Fields").ok()?.as_array().ok()?;
    for field in fields {
        let Object::Reference(id) = field else { continue };
        let dict = resolve_field_dict(doc, *id)?;
        if field_partial_name(dict).as_deref() != Some(group_name) {
            continue;
        }
        let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
        if ff & (1 << 16) != 0 {
            return Some(*id);
        }
    }
    None
}

fn append_field_kid(doc: &mut Document, parent_id: ObjectId, kid_id: ObjectId) -> Result<(), String> {
    let parent = doc.get_dictionary_mut(parent_id).map_err(|e| e.to_string())?;
    match parent.get_mut(b"Kids") {
        Ok(Object::Array(kids)) => kids.push(Object::Reference(kid_id)),
        _ => parent.set(b"Kids", Object::Array(vec![Object::Reference(kid_id)])),
    }
    Ok(())
}

fn viewer_widget_rect(doc: &Document, page_id: ObjectId, x: f64, y: f64, w: f64, h: f64) -> Result<Object, String> {
    let (px, py, pw, ph) = viewer_rect_to_pdf(doc, page_id, x, y, w, h)?;
    Ok(Object::Array(vec![
        Object::Real(px as f32),
        Object::Real(py as f32),
        Object::Real((px + pw) as f32),
        Object::Real((py + ph) as f32),
    ]))
}

fn choice_options_object(options: &[String]) -> Object {
    Object::Array(
        options.iter().map(|option| Object::String(option.as_bytes().to_vec(), lopdf::StringFormat::Literal)).collect(),
    )
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
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Field name is required".to_string());
    }
    if width < 20.0 || height < 10.0 {
        return Err("Form field is too small".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let (px, py, pw, ph) = viewer_rect_to_pdf(&doc, page_id, x, y, width, height)?;
    let field_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Widget".to_vec())),
        (b"FT".to_vec(), Object::Name(b"Tx".to_vec())),
        (b"T".to_vec(), Object::String(name.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (b"V".to_vec(), Object::String(vec![], lopdf::StringFormat::Literal)),
        (
            b"Rect".to_vec(),
            Object::Array(vec![
                Object::Real(px as f32),
                Object::Real(py as f32),
                Object::Real((px + pw) as f32),
                Object::Real((py + ph) as f32),
            ]),
        ),
        (b"F".to_vec(), Object::Integer(4)),
        (b"DA".to_vec(), Object::String(b"/Helv 12 Tf 0 g".to_vec(), lopdf::StringFormat::Literal)),
    ])));

    append_page_annotation(&mut doc, page_id, field_id)?;
    push_acroform_field(&mut doc, field_id)?;
    mark_acroform_need_appearances(&mut doc)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
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
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Field name is required".to_string());
    }
    if width < 12.0 || height < 12.0 {
        return Err("Checkbox is too small".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let rect = viewer_widget_rect(&doc, page_id, x, y, width, height)?;

    let field_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Widget".to_vec())),
        (b"FT".to_vec(), Object::Name(b"Btn".to_vec())),
        (b"Ff".to_vec(), Object::Integer(0)),
        (b"T".to_vec(), Object::String(name.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (b"Rect".to_vec(), rect),
        (b"F".to_vec(), Object::Integer(4)),
        (b"V".to_vec(), Object::Name(if checked { b"Yes".to_vec() } else { b"Off".to_vec() })),
        (b"AS".to_vec(), Object::Name(if checked { b"Yes".to_vec() } else { b"Off".to_vec() })),
    ])));

    append_page_annotation(&mut doc, page_id, field_id)?;
    push_acroform_field(&mut doc, field_id)?;
    mark_acroform_need_appearances(&mut doc)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
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
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Field name is required".to_string());
    }
    if width < 40.0 || height < 14.0 {
        return Err("Choice field is too small".to_string());
    }
    let cleaned: Vec<String> = options.into_iter().map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).collect();
    if cleaned.is_empty() {
        return Err("At least one option is required".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let rect = viewer_widget_rect(&doc, page_id, x, y, width, height)?;
    let default_value = cleaned[0].clone();

    let mut entries = vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Widget".to_vec())),
        (b"FT".to_vec(), Object::Name(b"Ch".to_vec())),
        (b"T".to_vec(), Object::String(name.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (b"Rect".to_vec(), rect),
        (b"F".to_vec(), Object::Integer(4)),
        (b"Opt".to_vec(), choice_options_object(&cleaned)),
        (b"V".to_vec(), Object::String(default_value.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (b"DA".to_vec(), Object::String(b"/Helv 12 Tf 0 g".to_vec(), lopdf::StringFormat::Literal)),
    ];
    if combo {
        entries.push((b"Ff".to_vec(), Object::Integer(1 << 17)));
    }
    let field_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(entries)));

    append_page_annotation(&mut doc, page_id, field_id)?;
    push_acroform_field(&mut doc, field_id)?;
    mark_acroform_need_appearances(&mut doc)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
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
    let group_name = group_name.trim().to_string();
    let option_name = option_name.trim().to_string();
    if group_name.is_empty() || option_name.is_empty() {
        return Err("Group and option names are required".to_string());
    }
    if width < 12.0 || height < 12.0 {
        return Err("Radio button is too small".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    let rect = viewer_widget_rect(&doc, page_id, x, y, width, height)?;

    let group_id = if let Some(existing) = find_radio_group_by_name(&doc, &group_name) {
        existing
    } else {
        let parent_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
            (b"FT".to_vec(), Object::Name(b"Btn".to_vec())),
            (b"Ff".to_vec(), Object::Integer(1 << 16)),
            (b"T".to_vec(), Object::String(group_name.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
            (b"Kids".to_vec(), Object::Array(vec![])),
        ])));
        push_acroform_field(&mut doc, parent_id)?;
        parent_id
    };

    let widget_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Widget".to_vec())),
        (b"Parent".to_vec(), Object::Reference(group_id)),
        (b"FT".to_vec(), Object::Name(b"Btn".to_vec())),
        (b"T".to_vec(), Object::String(option_name.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (b"Rect".to_vec(), rect),
        (b"F".to_vec(), Object::Integer(4)),
        (b"V".to_vec(), Object::Name(b"Off".to_vec())),
        (b"AS".to_vec(), Object::Name(b"Off".to_vec())),
    ])));

    append_page_annotation(&mut doc, page_id, widget_id)?;
    append_field_kid(&mut doc, group_id, widget_id)?;
    mark_acroform_need_appearances(&mut doc)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Debug)]
struct MarkdownTextCell {
    text: String,
}

#[derive(Clone, Debug)]
struct MarkdownTextLine {
    cells: Vec<MarkdownTextCell>,
    text: String,
    left: f32,
    right: f32,
    bottom: f32,
    top: f32,
    height: f32,
}

#[derive(Clone, Debug)]
struct MarkdownGlyph {
    ch: char,
    left: f32,
    right: f32,
    bottom: f32,
    top: f32,
    height: f32,
}

impl MarkdownGlyph {
    fn center_y(&self) -> f32 {
        (self.top + self.bottom) / 2.0
    }

    fn width(&self) -> f32 {
        (self.right - self.left).max(0.1)
    }
}

#[derive(Clone, Debug)]
struct MarkdownGlyphLine {
    glyphs: Vec<MarkdownGlyph>,
    left: f32,
    right: f32,
    bottom: f32,
    top: f32,
    height: f32,
}

impl MarkdownGlyphLine {
    fn new(glyph: MarkdownGlyph) -> Self {
        Self {
            left: glyph.left,
            right: glyph.right,
            bottom: glyph.bottom,
            top: glyph.top,
            height: glyph.height,
            glyphs: vec![glyph],
        }
    }

    fn center_y(&self) -> f32 {
        (self.top + self.bottom) / 2.0
    }

    fn push(&mut self, glyph: MarkdownGlyph) {
        self.left = self.left.min(glyph.left);
        self.right = self.right.max(glyph.right);
        self.bottom = self.bottom.min(glyph.bottom);
        self.top = self.top.max(glyph.top);
        self.height = self.height.max(glyph.height);
        self.glyphs.push(glyph);
    }
}

fn normalize_inline_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn median_glyph_width(glyphs: &[MarkdownGlyph]) -> f32 {
    let mut widths = glyphs.iter().map(MarkdownGlyph::width).filter(|width| *width > 0.0).collect::<Vec<_>>();
    if widths.is_empty() {
        return 4.0;
    }
    widths.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    widths[widths.len() / 2].max(1.0)
}

fn text_line_from_glyph_line(mut line: MarkdownGlyphLine) -> Option<MarkdownTextLine> {
    line.glyphs.sort_by(|a, b| a.left.partial_cmp(&b.left).unwrap_or(std::cmp::Ordering::Equal));
    let average_width = median_glyph_width(&line.glyphs);
    let word_gap = (average_width * 1.15).max(2.0);
    let cell_gap = (line.height * 2.6).max(average_width * 4.0).max(18.0);
    let mut cells: Vec<MarkdownTextCell> = Vec::new();
    let mut current_text = String::new();
    let mut previous_right: Option<f32> = None;

    for glyph in line.glyphs {
        let gap = previous_right.map(|right| glyph.left - right).unwrap_or(0.0);
        if gap > cell_gap && !current_text.trim().is_empty() {
            cells.push(MarkdownTextCell { text: normalize_inline_text(&current_text) });
            current_text.clear();
        }

        if glyph.ch.is_whitespace() {
            if !current_text.is_empty() && !current_text.ends_with(' ') {
                current_text.push(' ');
            }
            previous_right = Some(glyph.right);
            continue;
        }

        if gap > word_gap && !current_text.is_empty() && !current_text.ends_with(' ') {
            current_text.push(' ');
        }
        current_text.push(glyph.ch);
        previous_right = Some(glyph.right);
    }

    if !current_text.trim().is_empty() {
        cells.push(MarkdownTextCell { text: normalize_inline_text(&current_text) });
    }

    if cells.is_empty() {
        return None;
    }

    let text = cells.iter().map(|cell| cell.text.as_str()).collect::<Vec<_>>().join(" ");
    Some(MarkdownTextLine {
        cells,
        text,
        left: line.left,
        right: line.right,
        bottom: line.bottom,
        top: line.top,
        height: line.height,
    })
}

/// Glyphs whose raw character code *might* be a decorative bullet from a symbol
/// font. Cheap pre-check so we only pay the per-glyph `font_name()` FFI cost for
/// plausible candidates instead of for every character on the page.
fn is_symbol_glyph_candidate(ch: char) -> bool {
    let code = ch as u32;
    // Some PDFs map symbol-font glyphs into the Private Use Area (0xF000 + code).
    let base = if (0xF000..=0xF0FF).contains(&code) { code - 0xF000 } else { code };
    (0x6C..=0x77).contains(&base) || base == 0xA7 || base == 0xB7
}

/// Office documents routinely draw list bullets with a Wingdings/Webdings glyph
/// (e.g. Wingdings `n` = ▪). PDF text extraction surfaces the raw glyph code, so
/// the bullet otherwise leaks into the Markdown as a stray letter. When the glyph
/// comes from a known dingbat font, translate the common shape glyphs to `•` so
/// the bullet detector and list formatter treat the line as a list item. Gated on
/// the font name, so ordinary text (e.g. the letter `n` in Arial) is untouched.
fn map_symbol_glyph(font_name: &str, ch: char) -> char {
    let font = font_name.to_ascii_lowercase();
    let is_dingbat = font.contains("wingding") || font.contains("webding") || font.contains("dingbat");
    let is_symbol = font.contains("symbol");
    if !is_dingbat && !is_symbol {
        return ch;
    }
    let code = ch as u32;
    let base = if (0xF000..=0xF0FF).contains(&code) { code - 0xF000 } else { code };
    // Geometric shapes (squares/circles/diamonds in 0x6C–0x77) are dingbat list
    // bullets; 0xA7/0xB7 are the small-square / middle-dot bullets the Symbol
    // font shares. Symbol-font letters are Greek glyphs, so never rewrite those.
    if is_dingbat && ((0x6C..=0x77).contains(&base) || base == 0xA7 || base == 0xB7) {
        return '•';
    }
    if is_symbol && (base == 0xA7 || base == 0xB7) {
        return '•';
    }
    ch
}

fn lines_from_pdfium_text(text: &PdfPageText<'_>) -> Vec<MarkdownTextLine> {
    let mut glyphs = Vec::new();

    for text_char in text.chars().iter() {
        let Some(mut ch) = text_char.unicode_char() else {
            continue;
        };
        if ch.is_control() {
            continue;
        }
        // Translate dingbat-font bullet glyphs (e.g. Wingdings `n` = ▪) to `•`.
        if is_symbol_glyph_candidate(ch) {
            ch = map_symbol_glyph(&text_char.font_name(), ch);
        }

        let bounds = text_char.loose_bounds().or_else(|_| text_char.tight_bounds());
        let Ok(bounds) = bounds else {
            continue;
        };

        let left = bounds.left().value;
        let right = bounds.right().value;
        let bottom = bounds.bottom().value;
        let top = bounds.top().value;
        let right = if right <= left && ch.is_whitespace() { left + 0.1 } else { right };
        let height = bounds.height().value.max(1.0);
        if !left.is_finite() || !right.is_finite() || !bottom.is_finite() || !top.is_finite() || right <= left {
            continue;
        }

        glyphs.push(MarkdownGlyph { ch, left, right, bottom, top, height });
    }

    glyphs.sort_by(|a, b| {
        b.center_y()
            .partial_cmp(&a.center_y())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.left.partial_cmp(&b.left).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut glyph_lines: Vec<MarkdownGlyphLine> = Vec::new();
    for glyph in glyphs {
        let maybe_line = glyph_lines.last_mut().filter(|line| {
            let tolerance = (line.height.max(glyph.height) * 0.65).max(2.0);
            (line.center_y() - glyph.center_y()).abs() <= tolerance
        });

        if let Some(line) = maybe_line {
            line.push(glyph);
        } else {
            glyph_lines.push(MarkdownGlyphLine::new(glyph));
        }
    }

    glyph_lines.into_iter().filter_map(text_line_from_glyph_line).collect()
}

fn median_line_height(lines: &[MarkdownTextLine]) -> f32 {
    let mut heights: Vec<f32> = lines.iter().map(|line| line.height).filter(|height| *height > 0.0).collect();
    if heights.is_empty() {
        return 12.0;
    }
    heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    heights[heights.len() / 2].max(1.0)
}

fn line_gap_after(lines: &[MarkdownTextLine], index: usize) -> f32 {
    lines.get(index + 1).map(|next| (lines[index].bottom - next.top).max(0.0)).unwrap_or(0.0)
}

fn line_gap_before(lines: &[MarkdownTextLine], index: usize) -> f32 {
    if index == 0 {
        return 0.0;
    }
    (lines[index - 1].bottom - lines[index].top).max(0.0)
}

fn page_width(lines: &[MarkdownTextLine]) -> f32 {
    let left = lines.iter().map(|line| line.left).fold(f32::INFINITY, f32::min);
    let right = lines.iter().map(|line| line.right).fold(f32::NEG_INFINITY, f32::max);
    if left.is_finite() && right.is_finite() {
        (right - left).max(1.0)
    } else {
        1.0
    }
}

fn is_page_marker(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 8
        && trimmed.chars().any(|ch| ch.is_ascii_digit())
        && trimmed.chars().all(|ch| ch.is_ascii_digit() || ch == '-' || ch.is_whitespace())
}

fn is_bullet_line(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with("• ")
        || trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.chars().next().is_some_and(|ch| ch.is_ascii_digit() && trimmed.contains(". "))
}

fn is_toc_title(text: &str) -> bool {
    text.trim().eq_ignore_ascii_case("table of contents") || text.trim().eq_ignore_ascii_case("contents")
}

fn trim_toc_leader(title: &str) -> String {
    let mut title = title.trim();
    loop {
        let trimmed = title.trim_end_matches('.').trim_end();
        if trimmed.len() == title.len() {
            break;
        }
        title = trimmed;
    }
    title.to_string()
}

fn parse_toc_entry(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim();
    if trimmed.len() < 4 {
        return None;
    }

    if let Some(index) = trimmed.rfind("Page ") {
        let title = trim_toc_leader(&trimmed[..index]);
        let page = trimmed[index + 5..].trim();
        if !title.is_empty() && !page.is_empty() && page.chars().all(|ch| ch.is_ascii_digit()) {
            return Some((title, page.to_string()));
        }
    }

    let mut parts = trimmed.rsplitn(2, char::is_whitespace);
    let page = parts.next()?.trim();
    let title = parts.next()?.trim();
    if page.chars().all(|ch| ch.is_ascii_digit()) && title.contains("...") {
        let title = trim_toc_leader(title);
        if !title.is_empty() {
            return Some((title, page.to_string()));
        }
    }

    None
}

fn escape_table_cell(text: &str) -> String {
    normalize_inline_text(text).replace('\\', "\\\\").replace('|', "\\|")
}

fn markdown_table(headers: &[String], rows: &[Vec<String>]) -> String {
    let header = headers.iter().map(|cell| escape_table_cell(cell)).collect::<Vec<_>>().join(" | ");
    let separator = headers.iter().map(|_| "---").collect::<Vec<_>>().join(" | ");
    let mut output = format!("| {} |\n| {} |\n", header, separator);

    for row in rows {
        let cells = (0..headers.len())
            .map(|index| escape_table_cell(row.get(index).map(String::as_str).unwrap_or("")))
            .collect::<Vec<_>>()
            .join(" | ");
        output.push_str(&format!("| {} |\n", cells));
    }

    output
}

fn toc_table(rows: &[(String, String)]) -> String {
    let rows = rows.iter().map(|(title, page)| vec![title.clone(), page.clone()]).collect::<Vec<_>>();
    markdown_table(&["Section".to_string(), "Page".to_string()], &rows)
}

fn column_table_block(lines: &[MarkdownTextLine], start: usize) -> Option<(usize, String)> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut index = start;
    let mut expected_columns = 0;

    while let Some(line) = lines.get(index) {
        if line.cells.len() < 2 || line.cells.len() > 8 || is_page_marker(&line.text) {
            break;
        }
        if expected_columns == 0 {
            expected_columns = line.cells.len();
        }
        if line.cells.len().abs_diff(expected_columns) > 1 {
            break;
        }
        rows.push(line.cells.iter().map(|cell| cell.text.clone()).collect());
        index += 1;
    }

    if rows.len() < 2 {
        return None;
    }

    let column_count = rows.iter().map(Vec::len).max().unwrap_or(0);
    if column_count < 2 {
        return None;
    }

    let headers = rows.remove(0);
    let headers = (0..column_count)
        .map(|index| headers.get(index).cloned().unwrap_or_else(|| format!("Column {}", index + 1)))
        .collect::<Vec<_>>();

    Some((index - start, markdown_table(&headers, &rows)))
}

fn probable_heading_level(
    line: &MarkdownTextLine,
    body_height: f32,
    width: f32,
    gap_before: f32,
    gap_after: f32,
) -> Option<usize> {
    let text = line.text.trim();
    if text.is_empty()
        || is_page_marker(text)
        || is_bullet_line(text)
        || parse_toc_entry(text).is_some()
        || text.len() > 90
        || !text.chars().any(char::is_alphabetic)
    {
        return None;
    }

    let words = text.split_whitespace().count();
    if words > 12 {
        return None;
    }

    let relative_height = line.height / body_height.max(1.0);
    let has_heading_spacing = gap_before > body_height * 0.75 || gap_after > body_height * 0.75;
    let first_line = gap_before <= f32::EPSILON;
    let starts_like_title = text.chars().next().is_some_and(|ch| ch.is_uppercase());
    let sentence_like = text.ends_with('.') && words > 4;
    let narrow = (line.right - line.left) < width * 0.75;
    let strong_heading = relative_height >= 1.45 || (!sentence_like && starts_like_title && first_line && words <= 10);

    if strong_heading {
        Some(3)
    } else if !sentence_like && (relative_height >= 1.2 || (starts_like_title && has_heading_spacing && narrow)) {
        Some(4)
    } else {
        None
    }
}

fn flush_paragraph(output: &mut String, paragraph: &mut Vec<String>) {
    if paragraph.is_empty() {
        return;
    }
    output.push_str(&paragraph.join(" "));
    output.push_str("\n\n");
    paragraph.clear();
}

fn format_markdown_lines(lines: &[MarkdownTextLine]) -> String {
    if lines.is_empty() {
        return "_(no extractable text on this page)_\n\n".to_string();
    }

    let body_height = median_line_height(lines);
    let width = page_width(lines);
    let mut output = String::new();
    let mut paragraph: Vec<String> = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let line = &lines[index];
        let text = line.text.trim();
        if text.is_empty() || is_page_marker(text) {
            index += 1;
            continue;
        }

        if is_toc_title(text) {
            flush_paragraph(&mut output, &mut paragraph);
            output.push_str("### Table of Contents\n\n");
            index += 1;

            let mut toc_rows = Vec::new();
            while let Some(line) = lines.get(index) {
                if let Some(row) = parse_toc_entry(&line.text) {
                    toc_rows.push(row);
                    index += 1;
                } else {
                    break;
                }
            }
            if !toc_rows.is_empty() {
                output.push_str(&toc_table(&toc_rows));
                output.push('\n');
            }
            continue;
        }

        if let Some((consumed, table)) = column_table_block(lines, index) {
            flush_paragraph(&mut output, &mut paragraph);
            output.push_str(&table);
            output.push('\n');
            index += consumed;
            continue;
        }

        if let Some((title, page)) = parse_toc_entry(text) {
            flush_paragraph(&mut output, &mut paragraph);
            output.push_str(&toc_table(&[(title, page)]));
            output.push('\n');
            index += 1;
            continue;
        }

        let gap_before = line_gap_before(lines, index);
        let gap_after = line_gap_after(lines, index);
        if let Some(level) = probable_heading_level(line, body_height, width, gap_before, gap_after) {
            flush_paragraph(&mut output, &mut paragraph);
            output.push_str(&format!("{} {}\n\n", "#".repeat(level), text));
            index += 1;
            continue;
        }

        if is_bullet_line(text) {
            flush_paragraph(&mut output, &mut paragraph);
            let bullet = text.trim_start_matches(['•', '*']).trim_start();
            output.push_str(&format!("- {}\n", bullet.trim_start_matches("- ").trim()));
            if gap_after > body_height * 0.8 {
                output.push('\n');
            }
            index += 1;
            continue;
        }

        paragraph.push(text.to_string());
        if text.ends_with('.')
            || text.ends_with('!')
            || text.ends_with('?')
            || text.ends_with(':')
            || gap_after > body_height * 0.9
        {
            flush_paragraph(&mut output, &mut paragraph);
        }
        index += 1;
    }

    flush_paragraph(&mut output, &mut paragraph);
    if output.trim().is_empty() {
        "_(no extractable text on this page)_\n\n".to_string()
    } else {
        output
    }
}

#[derive(Debug, Clone)]
struct TaggedBlock {
    kind: String,
    text: String,
    children: Vec<TaggedBlock>,
}

fn decode_pdf_string(obj: &Object) -> Option<String> {
    match obj {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).into_owned()),
        Object::Name(name) => Some(String::from_utf8_lossy(name).into_owned()),
        _ => None,
    }
}

fn struct_tree_root_id(doc: &Document) -> Result<ObjectId, String> {
    let catalog = doc.catalog().map_err(|e| e.to_string())?;
    catalog
        .get(b"StructTreeRoot")
        .map_err(|_| "missing StructTreeRoot".to_string())?
        .as_reference()
        .map_err(|_| "bad StructTreeRoot".to_string())
}

fn page_index_for_struct(doc: &Document, dict: &Dictionary) -> Option<u32> {
    let page_ref = dict.get(b"Pg").ok()?.as_reference().ok()?;
    doc.get_pages().iter().find_map(|(num, id)| (*id == page_ref).then_some(num.saturating_sub(1)))
}

fn struct_element_text(dict: &Dictionary) -> String {
    for key in [b"T".as_slice(), b"ActualText", b"Alt", b"E"] {
        if let Ok(obj) = dict.get(key) {
            if let Some(raw) = decode_pdf_string(obj) {
                let text = normalize_inline_text(&raw);
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    String::new()
}

fn struct_k_ids(k: &Object) -> Vec<ObjectId> {
    match k {
        Object::Reference(id) => vec![*id],
        Object::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Object::Reference(id) => Some(*id),
                Object::Dictionary(dict) => dict.get(b"Obj").ok().and_then(|obj| obj.as_reference().ok()),
                _ => None,
            })
            .collect(),
        Object::Dictionary(dict) => {
            dict.get(b"Obj").ok().and_then(|obj| obj.as_reference().ok()).map(|id| vec![id]).unwrap_or_default()
        }
        _ => Vec::new(),
    }
}

fn parse_struct_element(
    doc: &Document,
    id: ObjectId,
    inherited_page: Option<u32>,
) -> Result<(Option<u32>, TaggedBlock), String> {
    let dict = doc.get_dictionary(id).map_err(|e| e.to_string())?;
    let page = page_index_for_struct(doc, dict).or(inherited_page);
    let kind = dict
        .get(b"S")
        .ok()
        .and_then(|obj| obj.as_name().ok())
        .map(|name| String::from_utf8_lossy(name).into_owned())
        .unwrap_or_else(|| "Span".to_string());
    let text = struct_element_text(dict);
    let mut children = Vec::new();
    if let Ok(k) = dict.get(b"K") {
        for child_id in struct_k_ids(k) {
            let (_, child) = parse_struct_element(doc, child_id, page)?;
            children.push(child);
        }
    }
    Ok((page, TaggedBlock { kind, text, children }))
}

fn is_struct_container(kind: &str) -> bool {
    matches!(kind, "Document" | "Part" | "Art" | "Sect" | "Div" | "NonStruct" | "Private" | "Span" | "Form")
}

fn infer_page_from_block(block: &TaggedBlock) -> Option<u32> {
    for child in &block.children {
        if let Some(page) = infer_page_from_block(child) {
            return Some(page);
        }
    }
    None
}

fn block_has_content(block: &TaggedBlock) -> bool {
    !block.text.is_empty() || block.children.iter().any(block_has_content)
}

fn distribute_tagged_block(block: TaggedBlock, page: Option<u32>, out: &mut BTreeMap<u32, Vec<TaggedBlock>>) {
    let block_page = page.or_else(|| infer_page_from_block(&block));
    if is_struct_container(&block.kind) && block.text.is_empty() {
        if let Some(p) = block_page {
            for child in block.children {
                distribute_tagged_block(child, Some(p), out);
            }
        } else {
            for child in block.children {
                distribute_tagged_block(child, None, out);
            }
        }
        return;
    }
    if let Some(p) = block_page {
        out.entry(p).or_default().push(block);
    } else {
        for child in block.children {
            distribute_tagged_block(child, None, out);
        }
    }
}

fn tagged_heading_level(kind: &str) -> Option<usize> {
    match kind {
        "H" | "H1" | "Title" => Some(1),
        "H2" => Some(2),
        "H3" => Some(3),
        "H4" => Some(4),
        "H5" => Some(5),
        "H6" => Some(6),
        _ => None,
    }
}

fn tagged_block_text(block: &TaggedBlock) -> String {
    let mut parts = Vec::new();
    if !block.text.is_empty() {
        parts.push(block.text.clone());
    }
    for child in &block.children {
        if matches!(child.kind.as_str(), "Span" | "Em" | "Strong" | "Lbl" | "LBBody" | "LBody") {
            let child_text = tagged_block_text(child);
            if !child_text.is_empty() {
                parts.push(child_text);
            }
        }
    }
    parts.join(" ")
}

fn tagged_list_item_text(block: &TaggedBlock) -> String {
    if !block.text.is_empty() {
        return block.text.clone();
    }
    for child in &block.children {
        if matches!(child.kind.as_str(), "LBody" | "LBBody" | "Lbl") {
            let text = tagged_block_text(child);
            if !text.is_empty() {
                return text;
            }
        }
    }
    tagged_block_text(block)
}

fn format_tagged_table(children: &[TaggedBlock]) -> String {
    let mut rows = Vec::new();
    for child in children {
        if matches!(child.kind.as_str(), "TR" | "TableRow") {
            let cells: Vec<String> = child
                .children
                .iter()
                .filter(|cell| matches!(cell.kind.as_str(), "TD" | "TH" | "TableDataCell" | "TableHeaderCell"))
                .map(tagged_block_text)
                .filter(|cell| !cell.is_empty())
                .collect();
            if !cells.is_empty() {
                rows.push(cells);
            }
        }
    }
    if rows.len() >= 2 {
        let headers = rows.remove(0);
        markdown_table(&headers, &rows)
    } else if rows.len() == 1 {
        let headers: Vec<String> = (0..rows[0].len()).map(|index| format!("Column {}", index + 1)).collect();
        markdown_table(&headers, &rows)
    } else {
        String::new()
    }
}

fn format_tagged_block(block: &TaggedBlock, list_depth: usize, out: &mut String) {
    let kind = block.kind.as_str();
    if let Some(level) = tagged_heading_level(kind) {
        let text = tagged_block_text(block);
        if !text.is_empty() {
            out.push_str(&format!("{} {}\n\n", "#".repeat(level), text));
        }
        return;
    }

    match kind {
        "P" | "Paragraph" => {
            let text = tagged_block_text(block);
            if !text.is_empty() {
                out.push_str(&format!("{text}\n\n"));
            }
        }
        "L" | "List" => {
            for child in &block.children {
                format_tagged_block(child, list_depth, out);
            }
        }
        "LI" | "ListItem" => {
            let text = tagged_list_item_text(block);
            if !text.is_empty() {
                let indent = "  ".repeat(list_depth);
                out.push_str(&format!("{indent}- {text}\n"));
            }
            for child in &block.children {
                if !matches!(child.kind.as_str(), "LBody" | "LBBody" | "Lbl") {
                    format_tagged_block(child, list_depth + 1, out);
                }
            }
            if list_depth == 0 {
                out.push('\n');
            }
        }
        "Table" => {
            let table = format_tagged_table(&block.children);
            if !table.is_empty() {
                out.push_str(&table);
                out.push('\n');
            }
        }
        "BlockQuote" | "Quote" => {
            let text = tagged_block_text(block);
            if !text.is_empty() {
                for line in text.lines() {
                    out.push_str(&format!("> {line}\n"));
                }
                out.push('\n');
            }
        }
        "Figure" | "Image" => {
            let alt = tagged_block_text(block);
            if !alt.is_empty() {
                out.push_str(&format!("![{alt}]({alt})\n\n"));
            }
        }
        _ if is_struct_container(kind) => {
            for child in &block.children {
                format_tagged_block(child, list_depth, out);
            }
        }
        _ => {
            let text = tagged_block_text(block);
            if !text.is_empty() {
                out.push_str(&format!("{text}\n\n"));
            } else {
                for child in &block.children {
                    format_tagged_block(child, list_depth, out);
                }
            }
        }
    }
}

fn format_tagged_blocks(blocks: &[TaggedBlock]) -> String {
    let mut output = String::new();
    for block in blocks {
        format_tagged_block(block, 0, &mut output);
    }
    if output.trim().is_empty() {
        "_(no extractable text on this page)_\n\n".to_string()
    } else {
        output
    }
}

fn tagged_page_has_content(md: &str) -> bool {
    let trimmed = md.trim();
    !trimmed.is_empty() && trimmed != "_(no extractable text on this page)_"
}

/// When the PDF catalog carries `/StructTreeRoot`, map 0-based page indices to
/// Markdown derived from structure types (`/H1`, `/P`, `/L`, `/Table`, …).
fn tagged_markdown_by_page(doc: &Document) -> Option<BTreeMap<u32, String>> {
    let root_id = struct_tree_root_id(doc).ok()?;
    let root = doc.get_dictionary(root_id).ok()?;
    let k = root.get(b"K").ok()?;
    let mut page_blocks: BTreeMap<u32, Vec<TaggedBlock>> = BTreeMap::new();
    for child_id in struct_k_ids(k) {
        let (page, block) = parse_struct_element(doc, child_id, None).ok()?;
        distribute_tagged_block(block, page, &mut page_blocks);
    }
    if !page_blocks.values().any(|blocks| blocks.iter().any(block_has_content)) {
        return None;
    }
    Some(page_blocks.into_iter().map(|(page, blocks)| (page, format_tagged_blocks(&blocks))).collect())
}

fn plain_text_to_markdown(text: &str) -> String {
    let normalized = text.lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n");
    if normalized.is_empty() {
        "_(no extractable text on this page)_\n\n".to_string()
    } else {
        format!("{normalized}\n\n")
    }
}

struct MarkdownImageSink<'a> {
    assets_dir: &'a Path,
    rel_prefix: &'a str,
}

fn append_scanned_page_markdown(
    markdown: &mut String,
    path: &Path,
    page_index: u32,
    image_sink: Option<&MarkdownImageSink<'_>>,
) -> Result<(), String> {
    let png = render_page_png(path, page_index, OCR_RENDER_W, OCR_RENDER_H)?;
    let ocr_text = ocr_png_bytes(&png)?;

    if let Some(sink) = image_sink {
        fs::create_dir_all(sink.assets_dir).map_err(|e| e.to_string())?;
        let file_name = format!("page-{}.png", page_index + 1);
        fs::write(sink.assets_dir.join(&file_name), &png).map_err(|e| e.to_string())?;
        markdown.push_str(&format!("![Page {}]({}/{})\n\n", page_index + 1, sink.rel_prefix, file_name));
    }

    if let Some(text) = ocr_text {
        markdown.push_str(&plain_text_to_markdown(&text));
    } else if image_sink.is_none() {
        markdown.push_str("_(Scanned page — install Tesseract OCR for text extraction.)_\n\n");
    }
    Ok(())
}

fn pdf_filter_has_name(filter: &Object, target: &[u8]) -> bool {
    match filter {
        Object::Name(name) => name == target,
        Object::Array(items) => items.iter().any(|item| matches!(item, Object::Name(name) if name == target)),
        _ => false,
    }
}

fn pdf_filter_is_dctdecode(filter: &Object) -> bool {
    pdf_filter_has_name(filter, b"DCTDecode")
}

fn pdf_numeric_i64(obj: &Object) -> Option<i64> {
    match obj {
        Object::Integer(v) => Some(*v),
        Object::Real(v) => Some(*v as i64),
        _ => None,
    }
}

fn pdf_colorspace_name(colorspace: &Object) -> Option<Vec<u8>> {
    match colorspace {
        Object::Name(name) => Some(name.to_vec()),
        Object::Array(items) => items.first().and_then(|o| o.as_name().ok()).map(|n| n.to_vec()),
        _ => None,
    }
}

fn pdf_colorspace_is(colorspace: &Object, target: &[u8]) -> bool {
    pdf_colorspace_name(colorspace).as_deref() == Some(target)
}

fn cmyk_pixel_to_rgb(c: u8, m: u8, y: u8, k: u8) -> [u8; 3] {
    let c = c as f32 / 255.0;
    let m = m as f32 / 255.0;
    let y = y as f32 / 255.0;
    let k = k as f32 / 255.0;
    [
        (255.0 * (1.0 - c) * (1.0 - k)).round() as u8,
        (255.0 * (1.0 - m) * (1.0 - k)).round() as u8,
        (255.0 * (1.0 - y) * (1.0 - k)).round() as u8,
    ]
}

fn indexed_palette_rgb(colorspace: &Object) -> Option<Vec<u8>> {
    let items = colorspace.as_array().ok()?;
    if !pdf_colorspace_is(colorspace, b"Indexed") {
        return None;
    }
    let lookup = items.get(3)?;
    let Object::String(bytes, _) = lookup else {
        return None;
    };
    Some(bytes.clone())
}

fn raw_image_to_png(width: u32, height: u32, rgb: Vec<u8>) -> Option<Vec<u8>> {
    use image::{ImageBuffer, Rgb};
    let img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::from_raw(width, height, rgb)?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(png)
}

fn gray_samples_to_png(width: u32, height: u32, bytes: &[u8]) -> Option<Vec<u8>> {
    let expected = (width as u64 * height as u64) as usize;
    if bytes.len() < expected {
        return None;
    }
    let mut rgb = Vec::with_capacity(expected * 3);
    for sample in &bytes[..expected] {
        rgb.extend_from_slice(&[*sample, *sample, *sample]);
    }
    raw_image_to_png(width, height, rgb)
}

fn rgb_samples_to_png(width: u32, height: u32, bytes: &[u8], components: usize) -> Option<Vec<u8>> {
    let expected = (width as u64 * height as u64 * components as u64) as usize;
    if bytes.len() < expected {
        return None;
    }
    if components == 3 {
        return raw_image_to_png(width, height, bytes[..expected].to_vec());
    }
    None
}

fn cmyk_samples_to_png(width: u32, height: u32, bytes: &[u8]) -> Option<Vec<u8>> {
    let expected = (width as u64 * height as u64 * 4) as usize;
    if bytes.len() < expected {
        return None;
    }
    let mut rgb = Vec::with_capacity((width as usize * height as usize) * 3);
    for chunk in bytes[..expected].chunks_exact(4) {
        rgb.extend_from_slice(&cmyk_pixel_to_rgb(chunk[0], chunk[1], chunk[2], chunk[3]));
    }
    raw_image_to_png(width, height, rgb)
}

fn indexed_samples_to_png(width: u32, height: u32, bytes: &[u8], palette: &[u8]) -> Option<Vec<u8>> {
    let expected = (width as u64 * height as u64) as usize;
    if bytes.len() < expected || palette.len() < 3 {
        return None;
    }
    let max_index = (palette.len() / 3).saturating_sub(1);
    let mut rgb = Vec::with_capacity(expected * 3);
    for &sample in &bytes[..expected] {
        let idx = (sample as usize).min(max_index) * 3;
        rgb.extend_from_slice(&palette[idx..idx + 3]);
    }
    raw_image_to_png(width, height, rgb)
}

fn pdf_image_stream_bytes(stream: &Stream) -> Option<(Vec<u8>, &'static str)> {
    let filter = stream.dict.get(b"Filter").ok();
    let bytes = stream.decompressed_content().ok()?;
    if filter.is_some_and(pdf_filter_is_dctdecode) {
        return Some((bytes, "jpg"));
    }
    if filter.is_some_and(|f| pdf_filter_has_name(f, b"JPXDecode")) {
        if let Ok(img) = image::load_from_memory(&bytes) {
            let mut png = Vec::new();
            if img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).is_ok() {
                return Some((png, "png"));
            }
        }
    }

    let width = pdf_numeric_i64(stream.dict.get(b"Width").ok()?)? as u32;
    let height = pdf_numeric_i64(stream.dict.get(b"Height").ok()?)? as u32;
    if width == 0 || height == 0 {
        return None;
    }
    let bits = stream.dict.get(b"BitsPerComponent").ok().and_then(pdf_numeric_i64).unwrap_or(8) as u32;
    if bits != 8 {
        return None;
    }

    let colorspace = stream.dict.get(b"ColorSpace").ok()?;
    let png = if pdf_colorspace_is(colorspace, b"Indexed") {
        let palette = indexed_palette_rgb(colorspace)?;
        indexed_samples_to_png(width, height, &bytes, &palette)?
    } else if pdf_colorspace_is(colorspace, b"DeviceRGB") {
        rgb_samples_to_png(width, height, &bytes, 3)?
    } else if pdf_colorspace_is(colorspace, b"DeviceGray") {
        gray_samples_to_png(width, height, &bytes)?
    } else if pdf_colorspace_is(colorspace, b"DeviceCMYK") {
        cmyk_samples_to_png(width, height, &bytes)?
    } else {
        rgb_samples_to_png(width, height, &bytes, 3).or_else(|| gray_samples_to_png(width, height, &bytes))?
    };
    Some((png, "png"))
}

fn append_page_embedded_images(
    doc: &Document,
    page_number: u32,
    sink: &MarkdownImageSink<'_>,
    image_seq: &mut u32,
) -> Result<String, String> {
    let page_id = match doc.get_pages().get(&page_number) {
        Some(id) => *id,
        None => return Ok(String::new()),
    };
    let resources = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|page| page.get(b"Resources").ok())
        .and_then(|obj| obj.as_dict().ok());
    let Some(resources) = resources else {
        return Ok(String::new());
    };
    let xobjects = resources.get(b"XObject").ok().and_then(|obj| obj.as_dict().ok());
    let Some(xobjects) = xobjects else {
        return Ok(String::new());
    };

    let mut block = String::new();
    for (_name, obj) in xobjects.iter() {
        let id = match obj {
            Object::Reference(id) => id,
            _ => continue,
        };
        let stream = match doc.get_object(*id).ok().and_then(|o| o.as_stream().ok()) {
            Some(stream) => stream,
            None => continue,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok());
        if subtype != Some(b"Image") {
            continue;
        }
        let Some((bytes, ext)) = pdf_image_stream_bytes(stream) else {
            continue;
        };
        *image_seq += 1;
        let file_name = format!("page-{page_number}-img-{image_seq}.{ext}");
        fs::write(sink.assets_dir.join(&file_name), bytes).map_err(|e| e.to_string())?;
        block.push_str(&format!("![Page {page_number} embedded image]({}/{file_name})\n\n", sink.rel_prefix));
    }
    Ok(block)
}

fn pdf_to_markdown(path: &Path, image_sink: Option<&MarkdownImageSink<'_>>) -> Result<String, String> {
    let lopdf_doc = Document::load(path).map_err(|e| e.to_string())?;
    let tagged_pages = tagged_markdown_by_page(&lopdf_doc);

    // Use PDFium's text layer: it decodes font encodings (including CID/Type0
    // fonts) that a raw content-stream walk cannot, so real-world PDFs actually
    // produce text instead of empty pages.
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;

    let mut markdown = String::from("# PDF to Markdown Conversion\n\n");
    for (index, page) in document.pages().iter().enumerate() {
        markdown.push_str(&format!("## Page {}\n\n", index + 1));

        if let Some(page_md) = tagged_pages
            .as_ref()
            .and_then(|pages| pages.get(&(index as u32)))
            .filter(|page_md| tagged_page_has_content(page_md))
        {
            markdown.push_str(page_md);
        } else {
            let text = page.text().map_err(|e| e.to_string())?;
            let lines = lines_from_pdfium_text(&text);
            if lines.is_empty() {
                let all_text = text.all();
                let trimmed = all_text.trim();
                if trimmed.is_empty() {
                    append_scanned_page_markdown(&mut markdown, path, index as u32, image_sink)?;
                } else {
                    markdown.push_str(&plain_text_to_markdown(trimmed));
                }
            } else {
                markdown.push_str(&format_markdown_lines(&lines));
            }
        }

        if let Some(sink) = image_sink {
            let mut image_seq = 0u32;
            markdown.push_str(&append_page_embedded_images(&lopdf_doc, (index + 1) as u32, sink, &mut image_seq)?);
        }
    }
    Ok(markdown)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfIntelligentExtraction {
    headings: Vec<String>,
    emails: Vec<String>,
    urls: Vec<String>,
    dates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfSummaryResult {
    page_count: u32,
    word_count: u32,
    title_guess: Option<String>,
    overview: String,
    key_points: Vec<String>,
    extraction: PdfIntelligentExtraction,
    scanned_pages: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummarySaveResult {
    summary: PdfSummaryResult,
    summary_path: String,
    written: bool,
    conflict: bool,
}

const SUMMARY_STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "had", "has", "have", "he", "her", "his", "in",
    "is", "it", "its", "of", "on", "or", "that", "the", "their", "they", "this", "to", "was", "were", "will", "with",
];

fn is_summary_stopword(word: &str) -> bool {
    SUMMARY_STOPWORDS.contains(&word)
}

fn strip_markdown_for_summary(markdown: &str) -> String {
    markdown
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && !trimmed.starts_with("## Page ")
                && !trimmed.starts_with("# PDF to Markdown")
                && !trimmed.starts_with('|')
                && !trimmed.starts_with("![")
                && trimmed != "_(no extractable text on this page)_"
        })
        .map(|line| line.trim_start_matches('#').trim())
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?') {
            let trimmed = current.trim();
            if trimmed.len() > 8 && trimmed.chars().any(|c| c.is_alphabetic()) {
                sentences.push(normalize_inline_text(trimmed));
            }
            current.clear();
        }
    }
    let tail = current.trim();
    if tail.len() > 8 && tail.chars().any(|c| c.is_alphabetic()) {
        sentences.push(normalize_inline_text(tail));
    }
    sentences
}

fn count_words(text: &str) -> u32 {
    text.split_whitespace().filter(|word| !word.is_empty()).count() as u32
}

fn collect_term_frequencies(sentences: &[String]) -> HashMap<String, u32> {
    let mut freq = HashMap::new();
    for sentence in sentences {
        for word in sentence
            .split(|c: char| !c.is_alphanumeric())
            .map(str::to_ascii_lowercase)
            .filter(|word| word.len() > 2 && !is_summary_stopword(word))
        {
            *freq.entry(word).or_insert(0) += 1;
        }
    }
    freq
}

fn score_sentence_for_summary(sentence: &str, index: usize, total: usize, term_freq: &HashMap<String, u32>) -> f32 {
    let words: Vec<&str> = sentence.split_whitespace().collect();
    let word_count = words.len();
    if !(4..=60).contains(&word_count) {
        return 0.0;
    }
    let mut score = 0.0f32;
    if index < total / 5 {
        score += 1.5;
    }
    if (12..=40).contains(&word_count) {
        score += 1.0;
    }
    for word in words {
        let key = word.to_ascii_lowercase();
        if let Some(count) = term_freq.get(&key) {
            score += (*count as f32).sqrt();
        }
    }
    if sentence.chars().filter(|c| c.is_uppercase()).count() > 2 {
        score += 0.5;
    }
    score
}

fn extractive_overview(sentences: &[String], term_freq: &HashMap<String, u32>, max_sentences: usize) -> String {
    if sentences.is_empty() {
        return String::new();
    }
    let total = sentences.len();
    let mut ranked: Vec<(usize, f32)> = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| (index, score_sentence_for_summary(sentence, index, total, term_freq)))
        .filter(|(_, score)| *score > 0.0)
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut picked = ranked.into_iter().take(max_sentences).map(|(index, _)| index).collect::<Vec<_>>();
    picked.sort_unstable();
    picked.into_iter().map(|index| sentences[index].clone()).collect::<Vec<_>>().join(" ")
}

fn looks_like_heading_line(line: &str) -> bool {
    let text = line.trim();
    if text.is_empty() || text.len() > 120 {
        return false;
    }
    let words = text.split_whitespace().count();
    if words > 14 {
        return false;
    }
    text.chars().next().is_some_and(|ch| ch.is_uppercase()) && !text.ends_with('.')
}

fn extract_key_points(sentences: &[String], headings: &[String], max_points: usize) -> Vec<String> {
    let mut points = BTreeSet::new();
    for heading in headings.iter().take(max_points) {
        points.insert(heading.clone());
    }
    for sentence in sentences {
        let trimmed = sentence.trim();
        if trimmed.starts_with("- ") || trimmed.starts_with("• ") {
            points.insert(trimmed.trim_start_matches(['-', '•', ' ']).to_string());
        } else if let Some(rest) = trimmed.strip_prefix(|c: char| c.is_ascii_digit()) {
            if rest.starts_with('.') || rest.starts_with(')') {
                points.insert(trimmed.to_string());
            }
        }
        if points.len() >= max_points {
            break;
        }
    }
    if points.len() < max_points {
        let term_freq = collect_term_frequencies(sentences);
        let total = sentences.len();
        let mut ranked: Vec<(usize, f32)> = sentences
            .iter()
            .enumerate()
            .map(|(index, sentence)| (index, score_sentence_for_summary(sentence, index, total, &term_freq)))
            .filter(|(_, score)| *score > 0.0)
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        for (index, _) in ranked {
            let sentence = &sentences[index];
            if sentence.len() <= 160 {
                points.insert(sentence.clone());
            }
            if points.len() >= max_points {
                break;
            }
        }
    }
    points.into_iter().take(max_points).collect()
}

fn trim_token_edges(token: &str) -> String {
    token
        .trim_matches(|c: char| {
            !c.is_alphanumeric() && c != '@' && c != '.' && c != '_' && c != '-' && c != '/' && c != ':'
        })
        .to_string()
}

fn extract_emails(text: &str) -> Vec<String> {
    let mut emails = BTreeSet::new();
    for token in text.split_whitespace() {
        let cleaned = trim_token_edges(token);
        if cleaned.contains('@')
            && cleaned.contains('.')
            && !cleaned.starts_with('@')
            && cleaned.len() >= 5
            && cleaned.chars().all(|c| c.is_alphanumeric() || "@._-+".contains(c))
        {
            emails.insert(cleaned);
        }
    }
    emails.into_iter().collect()
}

fn extract_urls(text: &str) -> Vec<String> {
    let mut urls = BTreeSet::new();
    for token in text.split_whitespace() {
        let cleaned = trim_token_edges(token);
        if cleaned.starts_with("http://") || cleaned.starts_with("https://") || cleaned.starts_with("www.") {
            urls.insert(cleaned);
        }
    }
    urls.into_iter().collect()
}

fn looks_like_date_token(token: &str) -> bool {
    let token = trim_token_edges(token);
    if token.len() < 6 || token.len() > 32 {
        return false;
    }
    let digits = token.chars().filter(|c| c.is_ascii_digit()).count();
    if digits < 4 {
        return false;
    }
    let has_sep = token.contains('/') || token.contains('-') || token.contains('.');
    let month_names = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "jan",
        "feb",
        "mar",
        "apr",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
    ];
    let lower = token.to_ascii_lowercase();
    month_names.iter().any(|month| lower.contains(month)) || has_sep
}

fn extract_dates(text: &str) -> Vec<String> {
    let mut dates = BTreeSet::new();
    for token in text.split_whitespace() {
        if looks_like_date_token(token) {
            dates.insert(trim_token_edges(token));
        }
    }
    dates.into_iter().collect()
}

fn intelligent_extract_from_text(text: &str) -> PdfIntelligentExtraction {
    let mut headings = BTreeSet::new();
    for line in text.lines() {
        if looks_like_heading_line(line) {
            headings.insert(normalize_inline_text(line));
        }
    }
    PdfIntelligentExtraction {
        headings: headings.into_iter().take(24).collect(),
        emails: extract_emails(text),
        urls: extract_urls(text),
        dates: extract_dates(text),
    }
}

fn guess_title(first_page: &str, headings: &[String]) -> Option<String> {
    if let Some(heading) = headings.first() {
        if heading.len() <= 120 {
            return Some(heading.clone());
        }
    }
    first_page
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line.len() <= 120 && looks_like_heading_line(line))
        .map(normalize_inline_text)
}

fn pdf_plain_text_pages(path: &Path) -> Result<(Vec<String>, u32), String> {
    let lopdf_doc = Document::load(path).map_err(|e| e.to_string())?;
    let tagged_pages = tagged_markdown_by_page(&lopdf_doc);
    let pdfium = get_pdfium()?;
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let mut pages = Vec::new();
    let mut scanned_pages = 0u32;
    for (index, page) in document.pages().iter().enumerate() {
        let page_text = if let Some(page_md) = tagged_pages
            .as_ref()
            .and_then(|pages| pages.get(&(index as u32)))
            .filter(|page_md| tagged_page_has_content(page_md))
        {
            strip_markdown_for_summary(page_md)
        } else {
            let text = page.text().map_err(|e| e.to_string())?;
            let lines = lines_from_pdfium_text(&text);
            if lines.is_empty() {
                let all_text = text.all();
                let trimmed = all_text.trim();
                if trimmed.is_empty() {
                    scanned_pages += 1;
                    String::new()
                } else {
                    trimmed.to_string()
                }
            } else {
                lines.iter().map(|line| line.text.as_str()).collect::<Vec<_>>().join("\n")
            }
        };
        pages.push(page_text);
    }
    Ok((pages, scanned_pages))
}

fn build_pdf_summary(pages: &[String], scanned_pages: u32) -> PdfSummaryResult {
    let page_count = pages.len() as u32;
    let full_text = pages.iter().filter(|page| !page.trim().is_empty()).cloned().collect::<Vec<_>>().join("\n\n");
    let word_count = count_words(&full_text);
    let extraction = intelligent_extract_from_text(&full_text);
    let sentences = split_sentences(&full_text);
    let term_freq = collect_term_frequencies(&sentences);
    let overview = if sentences.is_empty() {
        if scanned_pages > 0 {
            format!(
                "No extractable text was found. {scanned_pages} page(s) appear scanned or image-only (use Markdown export with Tesseract OCR for those pages)."
            )
        } else {
            "No extractable text was found in this document.".to_string()
        }
    } else {
        extractive_overview(&sentences, &term_freq, 4)
    };
    let key_points = extract_key_points(&sentences, &extraction.headings, 8);
    let title_guess = guess_title(pages.first().map(String::as_str).unwrap_or_default(), &extraction.headings);
    PdfSummaryResult { page_count, word_count, title_guess, overview, key_points, extraction, scanned_pages }
}

fn summary_markdown_path(pdf_path: &Path) -> PathBuf {
    pdf_path.with_extension("summary.md")
}

fn summary_to_markdown(summary: &PdfSummaryResult) -> String {
    let mut output = String::from("# Document Summary\n\n");
    if let Some(title) = &summary.title_guess {
        output.push_str(&format!("**Title guess:** {title}\n\n"));
    }
    output.push_str(&format!(
        "**Pages:** {} · **Words:** {} · **Scanned/image-only pages:** {}\n\n",
        summary.page_count, summary.word_count, summary.scanned_pages
    ));
    output.push_str("## Overview\n\n");
    output.push_str(&summary.overview);
    output.push_str("\n\n## Key points\n\n");
    if summary.key_points.is_empty() {
        output.push_str("_(none)_\n\n");
    } else {
        for point in &summary.key_points {
            output.push_str(&format!("- {point}\n"));
        }
        output.push('\n');
    }
    output.push_str("## Extracted headings\n\n");
    if summary.extraction.headings.is_empty() {
        output.push_str("_(none)_\n\n");
    } else {
        for heading in &summary.extraction.headings {
            output.push_str(&format!("- {heading}\n"));
        }
        output.push('\n');
    }
    output.push_str("## Emails\n\n");
    if summary.extraction.emails.is_empty() {
        output.push_str("_(none)_\n\n");
    } else {
        for email in &summary.extraction.emails {
            output.push_str(&format!("- {email}\n"));
        }
        output.push('\n');
    }
    output.push_str("## URLs\n\n");
    if summary.extraction.urls.is_empty() {
        output.push_str("_(none)_\n\n");
    } else {
        for url in &summary.extraction.urls {
            output.push_str(&format!("- {url}\n"));
        }
        output.push('\n');
    }
    output.push_str("## Dates\n\n");
    if summary.extraction.dates.is_empty() {
        output.push_str("_(none)_\n");
    } else {
        for date in &summary.extraction.dates {
            output.push_str(&format!("- {date}\n"));
        }
    }
    output
}

fn summarize_pdf_document(path: &Path) -> Result<PdfSummaryResult, String> {
    if !path.is_file() {
        return Err(format!("file not found: {}", path.display()));
    }
    let (pages, scanned_pages) = pdf_plain_text_pages(path)?;
    Ok(build_pdf_summary(&pages, scanned_pages))
}

#[tauri::command]
fn summarize_pdf(path: String) -> Result<PdfSummaryResult, String> {
    summarize_pdf_document(&PathBuf::from(path))
}

#[tauri::command]
fn save_pdf_summary(path: String, overwrite: bool) -> Result<SummarySaveResult, String> {
    let pdf_path = PathBuf::from(&path);
    let summary = summarize_pdf_document(&pdf_path)?;
    let target = summary_markdown_path(&pdf_path);
    if target.exists() && !overwrite {
        return Ok(SummarySaveResult {
            summary,
            summary_path: target.to_string_lossy().into_owned(),
            written: false,
            conflict: true,
        });
    }
    fs::write(&target, summary_to_markdown(&summary)).map_err(|e| e.to_string())?;
    Ok(SummarySaveResult {
        summary,
        summary_path: target.to_string_lossy().into_owned(),
        written: true,
        conflict: false,
    })
}

/// Return on-disk byte length for undo snapshot sizing decisions.
#[tauri::command]
fn file_byte_size(path: String) -> Result<u64, String> {
    Ok(fs::metadata(path).map_err(|e| e.to_string())?.len())
}

fn native_file_dialogs_policy(
    is_macos: bool,
    is_windows: bool,
    is_linux: bool,
    wayland: bool,
    native_dialogs_env: Option<&str>,
    disable_env: Option<&str>,
) -> bool {
    if disable_env.is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true")) {
        return false;
    }
    if is_macos || is_windows {
        return true;
    }
    if is_linux {
        if wayland {
            return native_dialogs_env.is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
        }
        return true;
    }
    false
}

/// Whether the UI should offer native open/save pickers. macOS/Windows and Linux
/// X11 use them by default; Linux Wayland requires `PDF_PANDA_NATIVE_DIALOGS=1`.
#[tauri::command]
fn native_file_dialogs_enabled() -> bool {
    native_file_dialogs_policy(
        cfg!(target_os = "macos"),
        cfg!(target_os = "windows"),
        cfg!(target_os = "linux"),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        std::env::var("PDF_PANDA_NATIVE_DIALOGS").ok().as_deref(),
        std::env::var("PDF_PANDA_DISABLE_NATIVE_DIALOGS").ok().as_deref(),
    )
}

#[tauri::command]
fn convert_pdf_to_markdown(path: String) -> Result<String, String> {
    pdf_to_markdown(&PathBuf::from(path), None)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownSaveResult {
    markdown: String,
    markdown_path: String,
    written: bool,
    conflict: bool,
}

fn write_markdown_file(markdown_path: &Path, markdown: &str, overwrite: bool) -> Result<MarkdownSaveResult, String> {
    if markdown_path.exists() {
        let existing = std::fs::read(markdown_path).map_err(|e| e.to_string())?;
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

    std::fs::write(markdown_path, markdown).map_err(|e| e.to_string())?;
    Ok(MarkdownSaveResult {
        markdown: markdown.to_string(),
        markdown_path: markdown_path.to_string_lossy().to_string(),
        written: true,
        conflict: false,
    })
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
    let markdown = pdf_to_markdown(&pdf_path, Some(&sink))?;
    write_markdown_file(&markdown_path, &markdown, overwrite)
}

#[tauri::command]
fn split_pdf(path: String, page_ranges: Vec<(u32, u32)>) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    if page_ranges.is_empty() {
        return Err("At least one page range is required".to_string());
    }

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

    // Flatten the destination so /Kids is a flat leaf list we can index into.
    let pages_ref = flatten_pages(&mut doc)?;
    let (mut source_kids, _) = get_pages_kids(&doc)?;

    // Resolve source pages through their (possibly nested) tree, in page order.
    let source_pages: Vec<ObjectId> = insert_doc.get_pages().into_values().collect();
    let insert_start = insert_start as usize;
    let insert_end = insert_end as usize;
    if insert_start > insert_end || insert_end >= source_pages.len() {
        return Err("Invalid insert page range".to_string());
    }
    let at = at_index as usize;
    if at > source_kids.len() {
        return Err("Insert index out of bounds".to_string());
    }

    // Deep-copy the selected pages (and their content/resources) into `doc` so
    // the saved file is self-contained — the old code copied bare references that
    // dangled. `remap` is shared so resources common to several pages are copied
    // once.
    let mut remap = BTreeMap::new();
    let new_page_ids: Vec<ObjectId> = source_pages[insert_start..=insert_end]
        .iter()
        .map(|&src_page| import_object(&mut doc, &insert_doc, src_page, pages_ref, &mut remap))
        .collect();
    for (offset, page_id) in new_page_ids.iter().enumerate() {
        source_kids.insert(at + offset, Object::Reference(*page_id));
    }

    set_pages_kids(&mut doc, pages_ref, source_kids)?;
    merge_acroform_after_insert(&mut doc, &insert_doc, &new_page_ids, &remap)?;
    dedup_fonts_after_insert(&mut doc, &new_page_ids)?;
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

/// True when the file has an encryption dictionary (may still require a password to open).
#[tauri::command]
fn pdf_is_encrypted(path: String) -> Result<bool, String> {
    let path = PathBuf::from(&path);
    match Document::load(&path) {
        Ok(doc) => Ok(doc.is_encrypted()),
        Err(lopdf::Error::InvalidPassword) => Ok(true),
        Err(lopdf::Error::Unimplemented(_)) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Verify that `password` unlocks an encrypted PDF.
#[tauri::command]
fn verify_pdf_password(path: String, password: String) -> Result<(), String> {
    Document::load_with_password(PathBuf::from(&path), &password).map_err(|_| "Incorrect password".to_string())?;
    Ok(())
}

/// Copy an encrypted PDF into a decrypted working copy for editing.
#[tauri::command]
fn open_working_copy_with_password(original: String, password: String) -> Result<String, String> {
    let original = PathBuf::from(&original);
    let mut doc = Document::load_with_password(&original, &password).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        doc.decrypt(&password).map_err(|e| e.to_string())?;
    }
    let stem = original.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let working = std::env::temp_dir().join(format!("pdf_panda_work_{}_{}.pdf", std::process::id(), stem));
    doc.save(&working).map_err(|e| e.to_string())?;
    Ok(working.to_string_lossy().into_owned())
}

fn ensure_pdf_file_id(doc: &mut Document) {
    if doc.trailer.get(b"ID").is_ok() {
        return;
    }
    let id = vec![0xA1u8; 16];
    doc.trailer.set(
        b"ID",
        Object::Array(vec![
            Object::String(id.clone(), lopdf::StringFormat::Hexadecimal),
            Object::String(id, lopdf::StringFormat::Hexadecimal),
        ]),
    );
}

/// Write a password-protected sibling `<stem>_protected.pdf` next to `path`.
#[tauri::command]
fn protect_pdf(path: String, user_password: String, owner_password: Option<String>) -> Result<String, String> {
    if user_password.is_empty() {
        return Err("User password is required".to_string());
    }
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        return Err("PDF is already encrypted".to_string());
    }
    ensure_pdf_file_id(&mut doc);

    let owner = owner_password.filter(|value| !value.is_empty()).unwrap_or_else(|| user_password.clone());
    let version = EncryptionVersion::V2 {
        document: &doc,
        owner_password: &owner,
        user_password: &user_password,
        key_length: 128,
        permissions: Permissions::all(),
    };
    let state = EncryptionState::try_from(version).map_err(|e| e.to_string())?;
    doc.encrypt(&state).map_err(|e| e.to_string())?;

    let output_path = path.with_file_name(format!("{}_protected.pdf", path.file_stem().unwrap().to_string_lossy()));
    doc.save(&output_path).map_err(|e| e.to_string())?;

    Ok(format!(
        "Saved encrypted PDF to {}. Open it with the user password you set.",
        output_path.file_name().unwrap().to_string_lossy()
    ))
}

#[derive(Debug, Clone, Serialize)]
struct PdfSignatureInfo {
    field_name: String,
    signer_name: Option<String>,
    reason: Option<String>,
    location: Option<String>,
    signing_time: Option<String>,
    sub_filter: Option<String>,
    signed_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
struct PdfSignatureVerificationEntry {
    field_name: String,
    status: String,
    signer_name: Option<String>,
    signing_time: Option<String>,
    integrity_ok: bool,
    modifications_after_signing: bool,
    summary: String,
}

#[derive(Debug, Clone, Serialize)]
struct PdfSignatureVerificationSummary {
    signature_count: usize,
    valid_count: usize,
    invalid_count: usize,
    document_modified: bool,
    overall_valid: bool,
    summary: String,
    signatures: Vec<PdfSignatureVerificationEntry>,
}

fn pdf_sign_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| tokio::runtime::Runtime::new().expect("tokio runtime for PDF signing"))
}

fn read_pdf_bytes_for_signing(path: &Path) -> Result<Vec<u8>, String> {
    let path_str = path.to_string_lossy().into_owned();
    if pdf_is_encrypted(path_str)? {
        return Err("Cannot sign an encrypted PDF. Save an unencrypted copy first.".to_string());
    }
    fs::read(path).map_err(|e| e.to_string())
}

fn signature_info_from_field(field: &underskrift::inspect::signatures::SignatureFieldInfo) -> PdfSignatureInfo {
    let field_name = field.field_name.clone().unwrap_or_else(|| format!("Signature{}", field.obj_num.unwrap_or(0)));
    PdfSignatureInfo {
        field_name,
        signer_name: field.name.clone(),
        reason: field.reason.clone(),
        location: field.location.clone(),
        signing_time: field.signing_time.clone(),
        sub_filter: field.sub_filter.clone(),
        signed_percent: field.coverage.as_ref().map(|coverage| coverage.percentage),
    }
}

fn next_signature_field_name(inspection: &underskrift::inspect::signatures::PdfSignatureInspection) -> String {
    let mut index = 1u32;
    loop {
        let candidate = format!("Signature{index}");
        let taken = inspection.signatures.iter().any(|field| field.field_name.as_deref() == Some(candidate.as_str()));
        if !taken {
            return candidate;
        }
        index += 1;
    }
}

fn signature_status_label(status: &SignatureStatus) -> &'static str {
    match status {
        SignatureStatus::Valid => "valid",
        SignatureStatus::ValidButUntrusted => "valid_untrusted",
        SignatureStatus::Invalid => "invalid",
        SignatureStatus::Indeterminate => "indeterminate",
    }
}

fn build_trust_store_set(trust_pem_path: Option<&Path>) -> Result<TrustStoreSet, String> {
    let mut trust_set = TrustStoreSet::new();
    if let Some(path) = trust_pem_path {
        let store = TrustStore::from_pem_file(path).map_err(|e| e.to_string())?;
        trust_set = trust_set.with_sig_store(store);
    }
    Ok(trust_set)
}

/// List digital signature fields embedded in a PDF.
#[tauri::command]
fn list_pdf_signatures(path: String) -> Result<Vec<PdfSignatureInfo>, String> {
    let path = PathBuf::from(path);
    let bytes = read_pdf_bytes_for_signing(&path)?;
    let inspection = inspect_signatures(&bytes).map_err(|e| e.to_string())?;
    Ok(inspection.signatures.iter().map(signature_info_from_field).collect())
}

/// Verify cryptographic integrity and certificate chains for all PDF signatures.
#[tauri::command]
fn verify_pdf_signatures(
    path: String,
    trust_pem_path: Option<String>,
) -> Result<PdfSignatureVerificationSummary, String> {
    let path = PathBuf::from(path);
    let bytes = read_pdf_bytes_for_signing(&path)?;
    let inspection = inspect_signatures(&bytes).map_err(|e| e.to_string())?;
    if !inspection.has_signatures {
        return Ok(PdfSignatureVerificationSummary {
            signature_count: 0,
            valid_count: 0,
            invalid_count: 0,
            document_modified: false,
            overall_valid: false,
            summary: "No digital signatures found.".to_string(),
            signatures: vec![],
        });
    }
    let trust_path = trust_pem_path.map(PathBuf::from);
    let trust_set = build_trust_store_set(trust_path.as_deref())?;
    let verifier = SignatureVerifier::new(&trust_set);
    let report = verifier.verify_pdf(&bytes).map_err(|e| e.to_string())?;
    let signatures = report
        .signatures
        .iter()
        .map(|sig| PdfSignatureVerificationEntry {
            field_name: sig.field_name.clone(),
            status: signature_status_label(&sig.status).to_string(),
            signer_name: sig.signer_name.clone(),
            signing_time: sig.signing_time.clone(),
            integrity_ok: sig.integrity_ok,
            modifications_after_signing: sig.modifications_after_signing,
            summary: sig.summary.clone(),
        })
        .collect();
    Ok(PdfSignatureVerificationSummary {
        signature_count: report.signatures.len(),
        valid_count: report.valid_count,
        invalid_count: report.invalid_count,
        document_modified: report.document_modified,
        overall_valid: report.all_valid(),
        summary: report.summary,
        signatures,
    })
}

/// Digitally sign a PDF with a PKCS#12 (.p12/.pfx) identity. Writes back to `path`
/// unless `output_path` is set.
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
    if cert_password.is_empty() {
        return Err("Certificate password is required".to_string());
    }
    let path = PathBuf::from(path);
    let pdf_bytes = read_pdf_bytes_for_signing(&path)?;
    let cert_path = PathBuf::from(cert_path);
    if !cert_path.is_file() {
        return Err("Certificate file not found".to_string());
    }
    let cert_bytes = fs::read(&cert_path).map_err(|e| e.to_string())?;
    let signer = SoftwareSigner::from_pkcs12_data(&cert_bytes, &cert_password).map_err(|e| e.to_string())?;
    let inspection = inspect_signatures(&pdf_bytes).map_err(|e| e.to_string())?;
    let field =
        field_name.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| next_signature_field_name(&inspection));
    let options = SigningOptions {
        sub_filter: SubFilter::Pades,
        field_name: field,
        reason: reason.filter(|value| !value.trim().is_empty()),
        location: location.filter(|value| !value.trim().is_empty()),
        ..Default::default()
    };
    let signed = pdf_sign_runtime()
        .block_on(PdfSigner::new().options(options).sign(&pdf_bytes, &signer))
        .map_err(|e| e.to_string())?;
    let output = output_path.map(PathBuf::from).unwrap_or(path);
    fs::write(&output, signed).map_err(|e| e.to_string())?;
    Ok(format!("Signed PDF saved to {}", output.file_name().unwrap_or_default().to_string_lossy()))
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

const TEXT_NOTE_WIDTH: f64 = 140.0;
const TEXT_NOTE_HEIGHT: f64 = 80.0;

#[tauri::command]
fn add_text_note(path: String, page_index: u32, x: f64, y: f64, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let x2 = x + TEXT_NOTE_WIDTH;
    let y2 = y + TEXT_NOTE_HEIGHT;
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Text".to_vec())),
        (
            b"Rect".to_vec(),
            Object::Array(vec![
                Object::Real(x as f32),
                Object::Real(y as f32),
                Object::Real(x2 as f32),
                Object::Real(y2 as f32),
            ]),
        ),
        (b"Contents".to_vec(), Object::String(content.into_bytes(), lopdf::StringFormat::Literal)),
        (b"Open".to_vec(), Object::Boolean(false)),
        (b"C".to_vec(), Object::Array(vec![Object::Real(1.0), Object::Real(1.0), Object::Real(0.6)])),
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

/// Remove the `index`-th text-note annotation (0-based among `Text` subtypes).
#[tauri::command]
fn remove_text_note(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut note_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let is_text = doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Subtype").ok())
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n) == "Text")
            .unwrap_or(false);
        if is_text {
            if note_count == index {
                target_pos = Some(pos);
                break;
            }
            note_count += 1;
        }
    }

    let pos = target_pos.ok_or("Text note not found".to_string())?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn ink_bbox(points: &[f64]) -> [f64; 4] {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for chunk in points.chunks(2) {
        if chunk.len() == 2 {
            min_x = min_x.min(chunk[0]);
            min_y = min_y.min(chunk[1]);
            max_x = max_x.max(chunk[0]);
            max_y = max_y.max(chunk[1]);
        }
    }
    [min_x, min_y, max_x, max_y]
}

#[tauri::command]
fn add_ink_stroke(path: String, page_index: u32, points: Vec<f64>) -> Result<(), String> {
    if points.len() < 4 || !points.len().is_multiple_of(2) {
        return Err("Ink stroke needs at least two points".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let bbox = ink_bbox(&points);
    let ink_coords: Vec<Object> = points.iter().map(|p| Object::Real(*p as f32)).collect();
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Ink".to_vec())),
        (
            b"Rect".to_vec(),
            Object::Array(vec![
                Object::Real(bbox[0] as f32),
                Object::Real(bbox[1] as f32),
                Object::Real(bbox[2] as f32),
                Object::Real(bbox[3] as f32),
            ]),
        ),
        (b"InkList".to_vec(), Object::Array(vec![Object::Array(ink_coords)])),
        (b"C".to_vec(), Object::Array(vec![Object::Real(0.0), Object::Real(0.0), Object::Real(1.0)])),
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

/// Remove the `index`-th ink annotation (0-based among `Ink` subtypes).
#[tauri::command]
fn remove_ink_stroke(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;

    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut ink_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let is_ink = doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Subtype").ok())
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n) == "Ink")
            .unwrap_or(false);
        if is_ink {
            if ink_count == index {
                target_pos = Some(pos);
                break;
            }
            ink_count += 1;
        }
    }

    let pos = target_pos.ok_or("Ink stroke not found".to_string())?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));

    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn shape_rect_object(x1: f64, y1: f64, x2: f64, y2: f64) -> Object {
    Object::Array(vec![
        Object::Real(x1 as f32),
        Object::Real(y1 as f32),
        Object::Real(x2 as f32),
        Object::Real(y2 as f32),
    ])
}

fn shape_outline_fields(x1: f64, y1: f64, x2: f64, y2: f64) -> Vec<(Vec<u8>, Object)> {
    vec![
        (b"Rect".to_vec(), shape_rect_object(x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2))),
        (b"C".to_vec(), Object::Array(vec![Object::Real(1.0), Object::Real(0.0), Object::Real(0.0)])),
        (b"Border".to_vec(), Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Real(2.0)])),
    ]
}

fn push_page_annotation(doc: &mut Document, page_id: ObjectId, annot: ObjectId) -> Result<(), String> {
    let annots = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.get_mut(b"Annots");
    match annots {
        Ok(Object::Array(ref mut arr)) => arr.push(Object::Reference(annot)),
        _ => {
            doc.get_dictionary_mut(page_id)
                .map_err(|e| e.to_string())?
                .set(b"Annots", Object::Array(vec![Object::Reference(annot)]));
        }
    }
    Ok(())
}

fn remove_annotation_by_subtype(
    doc: &mut Document,
    page_id: ObjectId,
    subtype: &str,
    index: u32,
    not_found_msg: &str,
) -> Result<(), String> {
    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut match_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let matches = doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Subtype").ok())
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n) == subtype)
            .unwrap_or(false);
        if matches {
            if match_count == index {
                target_pos = Some(pos);
                break;
            }
            match_count += 1;
        }
    }

    let pos = target_pos.ok_or_else(|| not_found_msg.to_string())?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));
    Ok(())
}

#[tauri::command]
fn add_square(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let mut fields = vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Square".to_vec())),
    ];
    fields.extend(shape_outline_fields(x1, y1, x2, y2));
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(fields)));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_circle(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let mut fields = vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Circle".to_vec())),
    ];
    fields.extend(shape_outline_fields(x1, y1, x2, y2));
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(fields)));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_line(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    if (x2 - x1).hypot(y2 - y1) < 5.0 {
        return Err("Line is too short".to_string());
    }

    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let mut fields = vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Line".to_vec())),
        (
            b"L".to_vec(),
            Object::Array(vec![
                Object::Real(x1 as f32),
                Object::Real(y1 as f32),
                Object::Real(x2 as f32),
                Object::Real(y2 as f32),
            ]),
        ),
    ];
    fields.extend(shape_outline_fields(x1, y1, x2, y2));
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(fields)));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_square(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_annotation_by_subtype(&mut doc, page_id, "Square", index, "Square shape not found")?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_circle(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_annotation_by_subtype(&mut doc, page_id, "Circle", index, "Circle shape not found")?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_line(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_annotation_by_subtype(&mut doc, page_id, "Line", index, "Line shape not found")?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

const STAMP_PRESETS: &[(&str, &str)] =
    &[("approved", "APPROVED"), ("draft", "DRAFT"), ("confidential", "CONFIDENTIAL"), ("reviewed", "REVIEWED")];

const TEXT_STAMP_WIDTH: f64 = 132.0;
const TEXT_STAMP_HEIGHT: f64 = 32.0;
const IMAGE_STAMP_SIZE: f64 = 72.0;

#[derive(serde::Serialize)]
struct StampPresetInfo {
    id: String,
    label: String,
    color: [u8; 3],
}

fn stamp_preset_label(preset: &str) -> Result<&'static str, String> {
    STAMP_PRESETS
        .iter()
        .find(|(id, _)| *id == preset)
        .map(|(_, label)| *label)
        .ok_or_else(|| format!("Unknown stamp preset: {preset}"))
}

fn stamp_preset_color(preset: &str) -> [u8; 3] {
    match preset {
        "approved" => [34, 139, 34],
        "draft" => [120, 120, 120],
        "confidential" => [178, 34, 34],
        "reviewed" => [30, 90, 160],
        _ => [100, 100, 100],
    }
}

fn stamp_text_default_appearance(preset: &str) -> &'static str {
    match preset {
        "approved" => "/Helvetica-Bold 14 Tf 0.0 0.55 0.0 rg",
        "draft" => "/Helvetica-Bold 14 Tf 0.35 0.35 0.35 rg",
        "confidential" => "/Helvetica-Bold 14 Tf 0.7 0.1 0.1 rg",
        "reviewed" => "/Helvetica-Bold 14 Tf 0.12 0.35 0.63 rg",
        _ => "/Helvetica-Bold 14 Tf 0.0 0.0 0.0 rg",
    }
}

fn annot_panda_stamp(dict: &lopdf::Dictionary) -> Option<String> {
    dict.get(b"PandaStamp").ok().and_then(|o| o.as_name().ok()).map(|b| String::from_utf8_lossy(b).to_string())
}

fn annot_panda_stamp_kind(dict: &lopdf::Dictionary) -> Option<String> {
    dict.get(b"PandaStampKind").ok().and_then(|o| o.as_name().ok()).map(|b| String::from_utf8_lossy(b).to_string())
}

fn remove_panda_stamp(doc: &mut Document, page_id: ObjectId, kind: &str, index: u32) -> Result<(), String> {
    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut match_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let is_match = doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(annot_panda_stamp_kind)
            .map(|k| k == kind)
            .unwrap_or(false);
        if is_match {
            if match_count == index {
                target_pos = Some(pos);
                break;
            }
            match_count += 1;
        }
    }

    let pos = target_pos.ok_or_else(|| format!("{kind} stamp not found"))?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));
    Ok(())
}

#[tauri::command]
fn list_stamp_presets() -> Vec<StampPresetInfo> {
    STAMP_PRESETS
        .iter()
        .map(|(id, label)| StampPresetInfo {
            id: (*id).to_string(),
            label: (*label).to_string(),
            color: stamp_preset_color(id),
        })
        .collect()
}

#[tauri::command]
fn add_text_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    let label = stamp_preset_label(&preset)?;
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let x2 = x + TEXT_STAMP_WIDTH;
    let y2 = y + TEXT_STAMP_HEIGHT;
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"FreeText".to_vec())),
        (b"Rect".to_vec(), shape_rect_object(x, y, x2, y2)),
        (b"Contents".to_vec(), Object::String(label.as_bytes().to_vec(), lopdf::StringFormat::Literal)),
        (
            b"DA".to_vec(),
            Object::String(stamp_text_default_appearance(&preset).as_bytes().to_vec(), lopdf::StringFormat::Literal),
        ),
        (b"F".to_vec(), Object::Integer(4)),
        (b"PandaStamp".to_vec(), Object::Name(preset.as_bytes().to_vec())),
        (b"PandaStampKind".to_vec(), Object::Name(b"text".to_vec())),
    ])));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn embed_stamp_image_xobject(doc: &mut Document, preset: &str) -> Result<ObjectId, String> {
    let (r, g, b) = {
        let c = stamp_preset_color(preset);
        (c[0], c[1], c[2])
    };
    let width = 72u32;
    let height = 72u32;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for py in 0..height {
        for px in 0..width {
            let edge = px < 2 || py < 2 || px >= width - 2 || py >= height - 2;
            let (pr, pg, pb) =
                if edge { (r.saturating_sub(40), g.saturating_sub(40), b.saturating_sub(40)) } else { (r, g, b) };
            rgb.extend_from_slice(&[pr, pg, pb]);
        }
    }
    let img_id = doc.add_object(Object::Stream(Stream::new(
        Dictionary::from_iter(vec![
            (b"Type".to_vec(), Object::Name(b"XObject".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Image".to_vec())),
            (b"Width".to_vec(), Object::Integer(width as i64)),
            (b"Height".to_vec(), Object::Integer(height as i64)),
            (b"ColorSpace".to_vec(), Object::Name(b"DeviceRGB".to_vec())),
            (b"BitsPerComponent".to_vec(), Object::Integer(8)),
        ]),
        rgb,
    )));
    Ok(img_id)
}

#[tauri::command]
fn add_image_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    stamp_preset_label(&preset)?;
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let img_id = embed_stamp_image_xobject(&mut doc, &preset)?;
    let width = IMAGE_STAMP_SIZE;
    let height = IMAGE_STAMP_SIZE;
    let mut xobject_dict = Dictionary::new();
    xobject_dict.set(b"Im1", Object::Reference(img_id));
    let mut resources = Dictionary::new();
    resources.set(b"XObject", Object::Dictionary(xobject_dict));
    let form_id = doc.add_object(Object::Stream(Stream::new(
        Dictionary::from_iter(vec![
            (b"Type".to_vec(), Object::Name(b"XObject".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Form".to_vec())),
            (
                b"BBox".to_vec(),
                Object::Array(vec![
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Real(width as f32),
                    Object::Real(height as f32),
                ]),
            ),
            (b"Resources".to_vec(), Object::Dictionary(resources)),
        ]),
        format!("q {width} 0 0 {height} 0 0 cm /Im1 Do Q\n").into_bytes(),
    )));
    let ap = Dictionary::from_iter(vec![(b"N".to_vec(), Object::Reference(form_id))]);
    let x2 = x + width;
    let y2 = y + height;
    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Stamp".to_vec())),
        (b"Rect".to_vec(), shape_rect_object(x, y, x2, y2)),
        (b"AP".to_vec(), Object::Dictionary(ap)),
        (b"PandaStamp".to_vec(), Object::Name(preset.as_bytes().to_vec())),
        (b"PandaStampKind".to_vec(), Object::Name(b"image".to_vec())),
    ])));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_text_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_panda_stamp(&mut doc, page_id, "text", index)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_image_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_panda_stamp(&mut doc, page_id, "image", index)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

fn annot_is_redaction(dict: &lopdf::Dictionary) -> bool {
    dict.get(b"PandaRedact").ok().and_then(|o| o.as_bool().ok()).unwrap_or(false)
}

fn remove_redaction_at_index(doc: &mut Document, page_id: ObjectId, index: u32) -> Result<(), String> {
    let annots = match doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Annots") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Err("No annotations on this page".to_string()),
    };

    let mut redaction_count = 0u32;
    let mut target_pos: Option<usize> = None;
    for (pos, annot_ref) in annots.iter().enumerate() {
        let Object::Reference(id) = annot_ref else {
            continue;
        };
        let is_redaction =
            doc.get_object(*id).ok().and_then(|o| o.as_dict().ok()).map(annot_is_redaction).unwrap_or(false);
        if is_redaction {
            if redaction_count == index {
                target_pos = Some(pos);
                break;
            }
            redaction_count += 1;
        }
    }

    let pos = target_pos.ok_or("Redaction not found".to_string())?;
    let mut new_annots = annots;
    new_annots.remove(pos);
    doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?.set(b"Annots", Object::Array(new_annots));
    Ok(())
}

#[tauri::command]
fn add_redaction(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;

    let annot = doc.add_object(Object::Dictionary(lopdf::Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"Square".to_vec())),
        (b"Rect".to_vec(), shape_rect_object(x1, y1, x2, y2)),
        (b"C".to_vec(), Object::Array(vec![Object::Real(0.0), Object::Real(0.0), Object::Real(0.0)])),
        (b"IC".to_vec(), Object::Array(vec![Object::Real(0.0), Object::Real(0.0), Object::Real(0.0)])),
        (b"Border".to_vec(), Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Real(0.0)])),
        (b"PandaRedact".to_vec(), Object::Boolean(true)),
    ])));
    push_page_annotation(&mut doc, page_id, annot)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_redaction(path: String, page_index: u32, index: u32) -> Result<(), String> {
    let path = PathBuf::from(&path);
    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let page_id = *pages.get(&(page_index + 1)).ok_or("Page not found".to_string())?;
    remove_redaction_at_index(&mut doc, page_id, index)?;
    doc.save(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct AnnotationData {
    subtype: String,
    rect: [f64; 4],
    color: Option<[f64; 3]>,
    contents: Option<String>,
    ink_points: Option<Vec<f64>>,
    line_endpoints: Option<[f64; 4]>,
    stamp_kind: Option<String>,
    stamp_preset: Option<String>,
    is_redaction: bool,
}

fn annot_contents(dict: &lopdf::Dictionary) -> Option<String> {
    dict.get(b"Contents").ok().and_then(|o| match o {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
        _ => None,
    })
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

                    let contents = annot_contents(annot_dict);
                    let ink_points = if subtype == "Ink" {
                        annot_dict.get(b"InkList").ok().and_then(|o| o.as_array().ok()).and_then(|strokes| {
                            strokes
                                .first()
                                .and_then(|stroke| stroke.as_array().ok())
                                .map(|coords| coords.iter().map(obj_to_f64).collect::<Vec<_>>())
                        })
                    } else {
                        None
                    };
                    let line_endpoints = if subtype == "Line" {
                        annot_dict.get(b"L").ok().and_then(|o| o.as_array().ok()).map(|arr| {
                            let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
                            [get(0), get(1), get(2), get(3)]
                        })
                    } else {
                        None
                    };
                    let stamp_kind = annot_panda_stamp_kind(annot_dict);
                    let stamp_preset = annot_panda_stamp(annot_dict);
                    let is_redaction = annot_is_redaction(annot_dict);
                    result.push(AnnotationData {
                        subtype,
                        rect,
                        color,
                        contents,
                        ink_points,
                        line_endpoints,
                        stamp_kind,
                        stamp_preset,
                        is_redaction,
                    });
                }
            }
        }
    }

    Ok(result)
}

/// Copy `original` to a fresh temp working file so edits never touch the user's
/// file until they explicitly save. Returns the working-copy path.
#[tauri::command]
fn open_working_copy(original: String) -> Result<String, String> {
    let original = PathBuf::from(&original);
    let stem = original.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let working = std::env::temp_dir().join(format!("pdf_panda_work_{}_{}.pdf", std::process::id(), stem));
    fs::copy(&original, &working).map_err(|e| e.to_string())?;
    Ok(working.to_string_lossy().into_owned())
}

/// Commit the working copy to `target` (Save: target = original; Save As: a new
/// path). The working copy stays put so editing can continue afterwards.
#[tauri::command]
fn save_working_copy(working: String, target: String) -> Result<(), String> {
    fs::copy(PathBuf::from(&working), PathBuf::from(&target)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Best-effort removal of a working copy when its document is closed/discarded.
#[tauri::command]
fn discard_working_copy(working: String) -> Result<(), String> {
    let working = PathBuf::from(&working);
    if working.exists() {
        fs::remove_file(&working).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Monotonic counter so each undo/redo history snapshot gets a unique filename.
static SNAPSHOT_SEQ: AtomicU64 = AtomicU64::new(0);

const HISTORY_DELTA_MAGIC: &[u8] = b"PPDFDELTA1\n";

/// Whole-file snapshots are used below this size; larger working copies store
/// binary deltas against the previous history entry.
fn history_large_file_bytes() -> u64 {
    #[cfg(test)]
    {
        100
    }
    #[cfg(not(test))]
    {
        32 * 1024 * 1024
    }
}

/// Fall back to a whole-file snapshot when a delta grows past this size.
fn history_delta_fallback_bytes() -> u64 {
    #[cfg(test)]
    {
        1_000_000
    }
    #[cfg(not(test))]
    {
        32 * 1024 * 1024
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct HistorySnapshot {
    kind: String,
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_index: Option<usize>,
    size: u64,
}

fn temp_hist_path(tag: &str, ext: &str) -> PathBuf {
    let seq = SNAPSHOT_SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("pdf_panda_hist_{}_{}_{}.{}", std::process::id(), tag, seq, ext))
}

fn write_full_snapshot(source: &Path) -> Result<String, String> {
    let snapshot = temp_hist_path("full", "pdf");
    fs::copy(source, &snapshot).map_err(|e| e.to_string())?;
    Ok(snapshot.to_string_lossy().into_owned())
}

fn write_delta_snapshot(bytes: &[u8]) -> Result<String, String> {
    let path = temp_hist_path("delta", "ppdelta");
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn byte_eq_at(base: &[u8], current: &[u8], i: usize) -> bool {
    match (base.get(i), current.get(i)) {
        (Some(a), Some(b)) => a == b,
        (None, None) => true,
        _ => false,
    }
}

fn encode_pdf_delta(base: &[u8], current: &[u8]) -> Result<Vec<u8>, String> {
    let max_len = base.len().max(current.len());
    let mut patches: Vec<(u64, Vec<u8>)> = Vec::new();
    let mut i = 0usize;
    while i < max_len {
        while i < max_len && byte_eq_at(base, current, i) {
            i += 1;
        }
        if i >= max_len {
            break;
        }
        let start = i;
        while i < max_len && !byte_eq_at(base, current, i) {
            i += 1;
        }
        let data: Vec<u8> = (start..i).map(|j| current.get(j).copied().unwrap_or(0)).collect();
        patches.push((start as u64, data));
    }

    let mut out = Vec::new();
    out.extend_from_slice(HISTORY_DELTA_MAGIC);
    out.extend_from_slice(&(base.len() as u64).to_le_bytes());
    out.extend_from_slice(&(current.len() as u64).to_le_bytes());
    out.extend_from_slice(&(patches.len() as u32).to_le_bytes());
    for (offset, data) in patches {
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
    }
    Ok(out)
}

fn read_u64_le(buf: &[u8], pos: &mut usize) -> Result<u64, String> {
    if *pos + 8 > buf.len() {
        return Err("truncated delta".into());
    }
    let v = u64::from_le_bytes(buf[*pos..*pos + 8].try_into().unwrap());
    *pos += 8;
    Ok(v)
}

fn read_u32_le(buf: &[u8], pos: &mut usize) -> Result<u32, String> {
    if *pos + 4 > buf.len() {
        return Err("truncated delta".into());
    }
    let v = u32::from_le_bytes(buf[*pos..*pos + 4].try_into().unwrap());
    *pos += 4;
    Ok(v)
}

fn apply_pdf_delta(base: &[u8], delta: &[u8]) -> Result<Vec<u8>, String> {
    if !delta.starts_with(HISTORY_DELTA_MAGIC) {
        return Err("invalid delta magic".into());
    }
    let mut pos = HISTORY_DELTA_MAGIC.len();
    let base_size = read_u64_le(delta, &mut pos)? as usize;
    let current_size = read_u64_le(delta, &mut pos)? as usize;
    let patch_count = read_u32_le(delta, &mut pos)? as usize;

    let mut out = base.to_vec();
    if out.len() < base_size {
        out.resize(base_size, 0);
    } else if out.len() > base_size {
        out.truncate(base_size);
    }

    for _ in 0..patch_count {
        let offset = read_u64_le(delta, &mut pos)? as usize;
        let len = read_u32_le(delta, &mut pos)? as usize;
        if pos + len > delta.len() {
            return Err("truncated delta patch".into());
        }
        let data = &delta[pos..pos + len];
        pos += len;
        if offset + len > out.len() {
            out.resize(offset + len, 0);
        }
        out[offset..offset + len].copy_from_slice(data);
    }

    if out.len() < current_size {
        out.resize(current_size, 0);
    } else if out.len() > current_size {
        out.truncate(current_size);
    }
    Ok(out)
}

fn materialize_history_index(history: &[HistorySnapshot], index: usize, into: &Path) -> Result<(), String> {
    let entry = history.get(index).ok_or_else(|| "history index out of bounds".to_string())?;
    match entry.kind.as_str() {
        "full" => {
            fs::copy(&entry.path, into).map_err(|e| e.to_string())?;
            Ok(())
        }
        "delta" => {
            let base_index = entry.base_index.ok_or_else(|| "delta snapshot missing base_index".to_string())?;
            let base_temp = temp_hist_path("mat", "pdf");
            materialize_history_index(history, base_index, &base_temp)?;
            let base_bytes = fs::read(&base_temp).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&base_temp);
            let delta_bytes = fs::read(&entry.path).map_err(|e| e.to_string())?;
            let restored = apply_pdf_delta(&base_bytes, &delta_bytes)?;
            fs::write(into, restored).map_err(|e| e.to_string())
        }
        other => Err(format!("unknown snapshot kind: {other}")),
    }
}

/// Copy the working copy to a fresh temp snapshot, used to build the undo/redo
/// history. Returns the snapshot path (restored later via `save_working_copy`).
#[tauri::command]
fn snapshot_pdf(source: String) -> Result<String, String> {
    write_full_snapshot(Path::new(&source))
}

/// Append a history entry for `source`. Small files get a full snapshot; large
/// files store a compact binary delta against the previous history entry.
#[tauri::command]
fn snapshot_pdf_entry(history: Vec<HistorySnapshot>, source: String) -> Result<HistorySnapshot, String> {
    let source_path = PathBuf::from(&source);
    let current = fs::read(&source_path).map_err(|e| e.to_string())?;
    let size = current.len() as u64;
    let threshold = history_large_file_bytes();

    if size <= threshold || history.is_empty() {
        let path = write_full_snapshot(&source_path)?;
        return Ok(HistorySnapshot { kind: "full".into(), path, base_index: None, size });
    }

    let base_index = history.len() - 1;
    let base_temp = temp_hist_path("base", "pdf");
    materialize_history_index(&history, base_index, &base_temp)?;
    let base_bytes = fs::read(&base_temp).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&base_temp);

    let delta_bytes = encode_pdf_delta(&base_bytes, &current)?;
    if delta_bytes.len() as u64 > history_delta_fallback_bytes() {
        let path = write_full_snapshot(&source_path)?;
        return Ok(HistorySnapshot { kind: "full".into(), path, base_index: None, size });
    }

    let path = write_delta_snapshot(&delta_bytes)?;
    Ok(HistorySnapshot { kind: "delta".into(), path, base_index: Some(base_index), size })
}

/// Materialize `history[index]` and write it to `target` (the live working copy).
#[tauri::command]
fn restore_history_entry(history: Vec<HistorySnapshot>, index: usize, target: String) -> Result<(), String> {
    materialize_history_index(&history, index, Path::new(&target))
}

/// Remove a history snapshot file from disk.
#[tauri::command]
fn discard_history_entry(entry: HistorySnapshot) -> Result<(), String> {
    let path = PathBuf::from(&entry.path);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Drop `drop_index` from the undo stack, rematerializing any delta entries that
/// depended on it while the parent snapshot is still available.
#[tauri::command]
fn prune_history_entry(mut history: Vec<HistorySnapshot>, drop_index: usize) -> Result<Vec<HistorySnapshot>, String> {
    if drop_index >= history.len() {
        return Err("history index out of bounds".into());
    }

    let orphans: Vec<usize> = history
        .iter()
        .enumerate()
        .filter(|(idx, entry)| *idx != drop_index && entry.base_index == Some(drop_index))
        .map(|(idx, _)| idx)
        .collect();

    for idx in orphans {
        let entry = history[idx].clone();
        let materialized = temp_hist_path("prune", "pdf");
        materialize_history_index(&history, idx, &materialized)?;
        let _ = fs::remove_file(&entry.path);
        history[idx] = HistorySnapshot {
            kind: "full".into(),
            path: materialized.to_string_lossy().into_owned(),
            base_index: None,
            size: entry.size,
        };
    }

    let dropped = history.remove(drop_index);
    discard_history_entry(dropped)?;

    for entry in &mut history {
        if let Some(base_index) = entry.base_index.as_mut() {
            if *base_index > drop_index {
                *base_index -= 1;
            }
        }
    }

    Ok(history)
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
                let _ = BUNDLED_PDFIUM_DIR.set(resources.join("vendor").join("pdfium"));
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
            get_pdf_thumbnails,
            delete_page,
            move_page,
            rotate_page,
            split_pdf,
            insert_pdf,
            convert_pdf_to_markdown,
            save_pdf_markdown,
            summarize_pdf,
            save_pdf_summary,
            ocr_available,
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
mod tests {
    use super::*;
    use lopdf::{Dictionary, Stream};
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pdf_panda_test_{}_{}.pdf", std::process::id(), name))
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

    /// Build a PDF with a *nested* page tree: the root /Pages holds an
    /// intermediate /Pages node (two leaves) followed by one direct leaf — three
    /// pages total. This mirrors real PDFs that the old flat-tree code mangled.
    fn build_nested_pdf() -> Document {
        let mut doc = Document::with_version("1.5");
        let root_id = doc.new_object_id();
        let mid_id = doc.new_object_id();

        let leaf = |doc: &mut Document, parent: ObjectId, idx: i64| -> ObjectId {
            let mut page = Dictionary::new();
            page.set("Type", Object::Name(b"Page".to_vec()));
            page.set("Parent", Object::Reference(parent));
            page.set("Resources", Object::Dictionary(Dictionary::new()));
            page.set(
                "MediaBox",
                Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(612), Object::Integer(792)]),
            );
            page.set("TestIdx", Object::Integer(idx));
            doc.add_object(Object::Dictionary(page))
        };

        let a1 = leaf(&mut doc, mid_id, 1);
        let a2 = leaf(&mut doc, mid_id, 2);
        let c = leaf(&mut doc, root_id, 3);

        let mut mid = Dictionary::new();
        mid.set("Type", Object::Name(b"Pages".to_vec()));
        mid.set("Parent", Object::Reference(root_id));
        mid.set("Count", Object::Integer(2));
        mid.set("Kids", Object::Array(vec![Object::Reference(a1), Object::Reference(a2)]));
        doc.objects.insert(mid_id, Object::Dictionary(mid));

        let mut root = Dictionary::new();
        root.set("Type", Object::Name(b"Pages".to_vec()));
        root.set("Count", Object::Integer(3));
        root.set("Kids", Object::Array(vec![Object::Reference(mid_id), Object::Reference(c)]));
        doc.objects.insert(root_id, Object::Dictionary(root));

        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(root_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc
    }

    fn save(doc: &mut Document, name: &str) -> String {
        let path = tmp(name);
        doc.save(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    fn attach_struct_tree_root(doc: &mut Document, root_id: ObjectId) {
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let Object::Dictionary(catalog) = doc.objects.get_mut(&catalog_id).unwrap() else {
            panic!("catalog is not a dictionary");
        };
        catalog.set("StructTreeRoot", Object::Reference(root_id));
        let mut mark_info = Dictionary::new();
        mark_info.set("Marked", Object::Boolean(true));
        catalog.set("MarkInfo", Object::Dictionary(mark_info));
    }

    fn add_struct_elem(doc: &mut Document, kind: &[u8], text: &str, page_id: Option<ObjectId>) -> ObjectId {
        let mut elem = Dictionary::new();
        elem.set("Type", Object::Name(b"StructElem".to_vec()));
        elem.set("S", Object::Name(kind.to_vec()));
        if !text.is_empty() {
            elem.set("T", Object::String(text.as_bytes().to_vec(), lopdf::StringFormat::Literal));
        }
        if let Some(page_id) = page_id {
            elem.set("Pg", Object::Reference(page_id));
        }
        doc.add_object(Object::Dictionary(elem))
    }

    /// Tagged PDF with headings, paragraphs, a list, and a table across two pages.
    fn build_tagged_pdf() -> Document {
        let mut doc = build_pdf(2);
        let page1_id = *doc.get_pages().get(&1).unwrap();
        let page2_id = *doc.get_pages().get(&2).unwrap();

        let h1_id = add_struct_elem(&mut doc, b"H1", "Introduction", Some(page1_id));
        let p1_id = add_struct_elem(&mut doc, b"P", "Body paragraph one.", Some(page1_id));

        let lbody_id = add_struct_elem(&mut doc, b"LBody", "First item", None);
        let mut li = Dictionary::new();
        li.set("Type", Object::Name(b"StructElem".to_vec()));
        li.set("S", Object::Name(b"LI".to_vec()));
        li.set("K", Object::Reference(lbody_id));
        let li_id = doc.add_object(Object::Dictionary(li));

        let mut list = Dictionary::new();
        list.set("Type", Object::Name(b"StructElem".to_vec()));
        list.set("S", Object::Name(b"L".to_vec()));
        list.set("Pg", Object::Reference(page2_id));
        list.set("K", Object::Array(vec![Object::Reference(li_id)]));
        let list_id = doc.add_object(Object::Dictionary(list));

        let td1 = add_struct_elem(&mut doc, b"TD", "Name", None);
        let td2 = add_struct_elem(&mut doc, b"TD", "Score", None);
        let mut tr_head = Dictionary::new();
        tr_head.set("Type", Object::Name(b"StructElem".to_vec()));
        tr_head.set("S", Object::Name(b"TR".to_vec()));
        tr_head.set("K", Object::Array(vec![Object::Reference(td1), Object::Reference(td2)]));
        let tr_head_id = doc.add_object(Object::Dictionary(tr_head));

        let td3 = add_struct_elem(&mut doc, b"TD", "Alice", None);
        let td4 = add_struct_elem(&mut doc, b"TD", "98", None);
        let mut tr_row = Dictionary::new();
        tr_row.set("Type", Object::Name(b"StructElem".to_vec()));
        tr_row.set("S", Object::Name(b"TR".to_vec()));
        tr_row.set("K", Object::Array(vec![Object::Reference(td3), Object::Reference(td4)]));
        let tr_row_id = doc.add_object(Object::Dictionary(tr_row));

        let mut table = Dictionary::new();
        table.set("Type", Object::Name(b"StructElem".to_vec()));
        table.set("S", Object::Name(b"Table".to_vec()));
        table.set("Pg", Object::Reference(page2_id));
        table.set("K", Object::Array(vec![Object::Reference(tr_head_id), Object::Reference(tr_row_id)]));
        let table_id = doc.add_object(Object::Dictionary(table));

        let mut root = Dictionary::new();
        root.set("Type", Object::Name(b"StructTreeRoot".to_vec()));
        root.set(
            "K",
            Object::Array(vec![
                Object::Reference(h1_id),
                Object::Reference(p1_id),
                Object::Reference(list_id),
                Object::Reference(table_id),
            ]),
        );
        let root_id = doc.add_object(Object::Dictionary(root));
        attach_struct_tree_root(&mut doc, root_id);
        doc
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
    fn delete_page_on_nested_tree_removes_only_one_leaf() {
        let path = save(&mut build_nested_pdf(), "nested_delete");
        delete_page(path.clone(), 0).unwrap(); // delete page 1 (first leaf in the intermediate node)
        let doc = Document::load(&path).unwrap();
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 2, "exactly one leaf should be removed");
        let idxs: Vec<i64> = pages
            .values()
            .map(|id| doc.get_dictionary(*id).unwrap().get(b"TestIdx").unwrap().as_i64().unwrap())
            .collect();
        assert_eq!(idxs, vec![2, 3], "remaining pages keep their order");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn move_page_on_nested_tree_reorders_leaves() {
        let path = save(&mut build_nested_pdf(), "nested_move");
        move_page(path.clone(), 0, 2).unwrap(); // move page 1 to the end
        let doc = Document::load(&path).unwrap();
        let idxs: Vec<i64> = doc
            .get_pages()
            .values()
            .map(|id| doc.get_dictionary(*id).unwrap().get(b"TestIdx").unwrap().as_i64().unwrap())
            .collect();
        assert_eq!(idxs, vec![2, 3, 1]);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn insert_pdf_imports_pages_into_nested_tree() {
        let dest = save(&mut build_nested_pdf(), "nested_insert_dest"); // 3 pages, nested tree
        let src = save(&mut build_pdf(2), "nested_insert_src"); // 2 pages; page 0 has Contents
        insert_pdf(dest.clone(), src.clone(), 1, 0, 1).unwrap(); // insert both src pages at position 1

        let doc = Document::load(&dest).unwrap();
        let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        assert_eq!(pages.len(), 5, "all source pages inserted");
        for &pid in &pages {
            let d = doc.get_dictionary(pid).unwrap();
            assert!(d.get(b"MediaBox").is_ok(), "every page carries a MediaBox");
            if let Ok(contents) = d.get(b"Contents") {
                let cid = contents.as_reference().unwrap();
                assert!(doc.get_object(cid).is_ok(), "Contents must resolve — no dangling refs");
            }
        }
        let _ = fs::remove_file(&dest);
        let _ = fs::remove_file(&src);
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
    fn split_pdf_rejects_invalid_range() {
        let path = save(&mut build_pdf(3), "split_invalid");
        let err = split_pdf(path.clone(), vec![(2, 1)]).unwrap_err();
        assert!(err.contains("Invalid page range"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn split_pdf_rejects_empty_ranges() {
        let path = save(&mut build_pdf(2), "split_empty");
        match split_pdf(path.clone(), vec![]) {
            Ok(_) => panic!("expected empty ranges to fail"),
            Err(message) => assert!(message.contains("At least one page range")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn split_pdf_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_split_missing_{}.pdf", std::process::id()));
        let err = split_pdf(missing.to_string_lossy().into_owned(), vec![(0, 0)]).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn insert_pdf_rejects_invalid_source_range() {
        let dest = save(&mut build_pdf(2), "insert_dest_range");
        let src = save(&mut build_pdf(2), "insert_src_range");
        let err = insert_pdf(dest.clone(), src.clone(), 1, 1, 0).unwrap_err();
        assert!(err.contains("Invalid insert page range"));
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn insert_pdf_rejects_source_range_out_of_bounds() {
        let dest = save(&mut build_pdf(2), "insert_dest_src_oob");
        let src = save(&mut build_pdf(1), "insert_src_oob");
        let err = insert_pdf(dest.clone(), src.clone(), 0, 0, 5).unwrap_err();
        assert!(err.contains("Invalid insert page range"));
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn insert_pdf_rejects_out_of_bounds_index() {
        let dest = save(&mut build_pdf(2), "insert_dest_bounds");
        let src = save(&mut build_pdf(1), "insert_src_bounds");
        let err = insert_pdf(dest.clone(), src.clone(), 9, 0, 0).unwrap_err();
        assert!(err.contains("Insert index out of bounds"));
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn insert_pdf_rejects_missing_source_file() {
        let dest = save(&mut build_pdf(2), "insert_dest_missing");
        let missing = std::env::temp_dir().join(format!("pp_insert_missing_{}.pdf", std::process::id()));
        let err = insert_pdf(dest.clone(), missing.to_string_lossy().into_owned(), 0, 0, 0).unwrap_err();
        assert!(!err.is_empty());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn insert_pdf_rejects_missing_dest_file() {
        let src = save(&mut build_pdf(1), "insert_src_missing_dest");
        let missing = std::env::temp_dir().join(format!("pp_insert_dest_missing_{}.pdf", std::process::id()));
        let err = insert_pdf(missing.to_string_lossy().into_owned(), src.clone(), 0, 0, 0).unwrap_err();
        assert!(!err.is_empty());
        let _ = std::fs::remove_file(&src);
    }

    fn attach_type1_font(doc: &mut Document, page_id: ObjectId, res_name: &[u8], base_font: &[u8]) -> ObjectId {
        let font_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
            (b"Type".to_vec(), Object::Name(b"Font".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Type1".to_vec())),
            (b"BaseFont".to_vec(), Object::Name(base_font.to_vec())),
        ])));
        let page = doc.get_dictionary_mut(page_id).unwrap();
        let resources = match page.get_mut(b"Resources") {
            Ok(Object::Dictionary(dict)) => dict,
            _ => {
                page.set(b"Resources", Object::Dictionary(Dictionary::new()));
                doc.get_dictionary_mut(page_id).unwrap().get_mut(b"Resources").unwrap().as_dict_mut().unwrap()
            }
        };
        match resources.get_mut(b"Font") {
            Ok(Object::Dictionary(fonts)) => fonts.set(res_name, Object::Reference(font_id)),
            _ => {
                let mut fonts = Dictionary::new();
                fonts.set(res_name, Object::Reference(font_id));
                resources.set(b"Font", Object::Dictionary(fonts));
            }
        }
        font_id
    }

    #[test]
    fn insert_pdf_merges_acroform_catalog() {
        let main = save(&mut build_pdf(1), "insert_main_form");
        let src = save(&mut build_pdf_with_text_field(), "insert_src_form");
        insert_pdf(main.clone(), src.clone(), 1, 0, 0).unwrap();
        let doc = Document::load(&main).unwrap();
        let catalog = doc.catalog().unwrap();
        let af_id = catalog.get(b"AcroForm").unwrap().as_reference().unwrap();
        let af = doc.get_dictionary(af_id).unwrap();
        let fields = af.get(b"Fields").unwrap().as_array().unwrap();
        assert!(!fields.is_empty());
        let names = get_pdf_form_fields(main.clone()).unwrap();
        assert!(names.iter().any(|field| field.name == "FirstName"));
        let _ = std::fs::remove_file(&main);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn insert_pdf_renames_conflicting_form_field() {
        let main_path = save(&mut build_pdf_with_text_field(), "insert_main_form_conflict");
        let src_path = save(&mut build_pdf_with_text_field(), "insert_src_form_conflict");
        insert_pdf(main_path.clone(), src_path.clone(), 1, 0, 0).unwrap();
        let fields = get_pdf_form_fields(main_path.clone()).unwrap();
        let names: Vec<_> = fields.iter().map(|field| field.name.as_str()).collect();
        assert!(names.contains(&"FirstName"));
        assert!(names.iter().any(|name| name.starts_with("imported_FirstName")));
        let _ = std::fs::remove_file(&main_path);
        let _ = std::fs::remove_file(&src_path);
    }

    #[test]
    fn insert_pdf_dedups_identical_fonts() {
        let mut dest = build_pdf(1);
        let dest_page = *dest.get_pages().get(&1).unwrap();
        let dest_font = attach_type1_font(&mut dest, dest_page, b"F1", b"Helvetica");
        let dest_path = save(&mut dest, "insert_font_dest");

        let mut src = build_pdf(1);
        let src_page = *src.get_pages().get(&1).unwrap();
        let _src_font = attach_type1_font(&mut src, src_page, b"F1", b"Helvetica");
        let src_path = save(&mut src, "insert_font_src");

        insert_pdf(dest_path.clone(), src_path.clone(), 1, 0, 0).unwrap();
        let doc = Document::load(&dest_path).unwrap();
        let pages: Vec<_> = doc.get_pages().into_values().collect();
        let dest_entry =
            page_font_entries(&doc, pages[0]).into_iter().find(|(name, _)| name == b"F1").map(|(_, id)| id);
        let inserted_entry =
            page_font_entries(&doc, pages[1]).into_iter().find(|(name, _)| name == b"F1").map(|(_, id)| id);
        assert_eq!(dest_entry, Some(dest_font));
        assert_eq!(inserted_entry, Some(dest_font));
        let _ = std::fs::remove_file(&dest_path);
        let _ = std::fs::remove_file(&src_path);
    }

    #[test]
    fn delete_page_rejects_invalid_index() {
        let path = save(&mut build_pdf(2), "delete_invalid");
        let err = delete_page(path.clone(), 9).unwrap_err();
        assert!(err.contains("Page index out of bounds"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn delete_page_rejects_only_page() {
        let path = save(&mut build_pdf(1), "delete_only");
        let err = delete_page(path.clone(), 0).unwrap_err();
        assert!(err.contains("only page"));
        assert_eq!(page_count(&path), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn delete_page_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_delete_missing_{}.pdf", std::process::id()));
        let err = delete_page(missing.to_string_lossy().into_owned(), 0).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn move_page_rejects_invalid_index() {
        let path = save(&mut build_pdf(2), "move_invalid");
        let err = move_page(path.clone(), 0, 9).unwrap_err();
        assert!(err.contains("Index out of bounds"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn move_page_rejects_invalid_from_index() {
        let path = save(&mut build_pdf(2), "move_invalid_from");
        let err = move_page(path.clone(), 9, 0).unwrap_err();
        assert!(err.contains("Index out of bounds"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn move_page_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_move_missing_{}.pdf", std::process::id()));
        let err = move_page(missing.to_string_lossy().into_owned(), 0, 1).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn move_page_same_index_is_noop() {
        let path = save(&mut build_pdf(3), "move_noop");
        move_page(path.clone(), 1, 1).unwrap();
        assert_eq!(page_count(&path), 3);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rotate_page_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_rotate_missing_{}.pdf", std::process::id()));
        let err = rotate_page(missing.to_string_lossy().into_owned(), 0).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn rotate_page_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "rotate_invalid");
        let err = rotate_page(path.clone(), 9).unwrap_err();
        assert!(err.contains("Page not found"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_markdown_file_creates_sibling_md() {
        let pdf_path = tmp("markdown_write");
        let md_path = pdf_path.with_extension("md");
        let _ = std::fs::remove_file(&md_path);

        let result = write_markdown_file(&md_path, "# Test\n", false).unwrap();

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

        let result = write_markdown_file(&md_path, "# New\n", false).unwrap();

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

        let result = write_markdown_file(&md_path, "# New\n", true).unwrap();

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

        let result = write_markdown_file(&md_path, "# Same\n", false).unwrap();

        assert!(!result.written);
        assert!(!result.conflict);
        assert_eq!(std::fs::read_to_string(&md_path).unwrap(), "# Same\n");
        let _ = std::fs::remove_file(&md_path);
    }

    #[test]
    fn write_markdown_file_writes_custom_path() {
        let custom = std::env::temp_dir().join(format!("pp_md_custom_{}.md", std::process::id()));
        let _ = std::fs::remove_file(&custom);

        let result = write_markdown_file(&custom, "# Custom\n", false).unwrap();

        assert!(result.written);
        assert!(!result.conflict);
        assert_eq!(result.markdown_path, custom.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&custom).unwrap(), "# Custom\n");
        let _ = std::fs::remove_file(&custom);
    }

    fn md_line(text: &str, top: f32, bottom: f32, cells: Vec<(&str, f32, f32)>) -> MarkdownTextLine {
        let height = (top - bottom).max(1.0);
        let (left, right, cells) = if cells.is_empty() {
            (72.0, 420.0, vec![MarkdownTextCell { text: text.to_string() }])
        } else {
            let left = cells.iter().map(|(_, left, _)| *left).fold(f32::INFINITY, f32::min);
            let right = cells.iter().map(|(_, _, right)| *right).fold(f32::NEG_INFINITY, f32::max);
            let cells = cells.into_iter().map(|(text, _, _)| MarkdownTextCell { text: text.to_string() }).collect();
            (left, right, cells)
        };
        MarkdownTextLine { text: text.to_string(), left, right, bottom, top, height, cells }
    }

    #[test]
    fn symbol_font_bullets_become_markdown_bullets() {
        // Wingdings 'n' (0x6E) is the square bullet that leaked as a literal "n".
        assert_eq!(map_symbol_glyph("Wingdings", 'n'), '•');
        assert_eq!(map_symbol_glyph("Wingdings", 'l'), '•');
        // Subset-prefixed font names still match.
        assert_eq!(map_symbol_glyph("ABCDEF+Wingdings", 'n'), '•');
        // Private-Use-Area encoded variant (0xF000 + code).
        assert_eq!(map_symbol_glyph("Wingdings", '\u{F06E}'), '•');
        // Ordinary text fonts are never rewritten.
        assert_eq!(map_symbol_glyph("ArialMT", 'n'), 'n');
        // Symbol-font letters are Greek (nu), not bullets.
        assert_eq!(map_symbol_glyph("Symbol", 'n'), 'n');
        // Pre-check stays in sync with the mapper.
        assert!(is_symbol_glyph_candidate('n'));
        assert!(!is_symbol_glyph_candidate('a'));
    }

    #[test]
    fn get_pdf_page_count_reports_document_length() {
        let path = save(&mut build_pdf(5), "page_count");
        assert_eq!(get_pdf_page_count(path.clone()).unwrap(), 5);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn list_pdf_browser_entries_lists_pdfs_and_directories() {
        let dir = std::env::temp_dir().join(format!("pp_browser_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let standalone = save(&mut build_pdf(1), "browser_src");
        fs::copy(&standalone, dir.join("sample.pdf")).unwrap();
        let _ = fs::remove_file(&standalone);
        fs::write(dir.join("notes.txt"), b"text").unwrap();
        fs::create_dir_all(dir.join("nested")).unwrap();

        let listing = list_pdf_browser_entries(Some(dir.to_string_lossy().into_owned())).unwrap();
        let names: Vec<&str> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(names.contains(&"nested"));
        assert!(names.contains(&"sample.pdf"));
        assert!(!names.contains(&"notes.txt"));
        assert!(listing.entries.iter().find(|e| e.name == "nested").unwrap().is_dir);
        assert!(!listing.entries.iter().find(|e| e.name == "sample.pdf").unwrap().is_dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_pdf_browser_entries_from_file_path_uses_parent_dir() {
        let dir = std::env::temp_dir().join(format!("pp_browser_file_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let standalone = save(&mut build_pdf(1), "browser_file_src");
        let pdf_path = dir.join("target.pdf");
        fs::copy(&standalone, &pdf_path).unwrap();
        let _ = fs::remove_file(&standalone);

        let listing = list_pdf_browser_entries(Some(pdf_path.to_string_lossy().into_owned())).unwrap();
        assert_eq!(listing.current_dir, dir.canonicalize().unwrap().to_string_lossy());
        assert!(listing.entries.iter().any(|entry| entry.name == "target.pdf"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_pdf_browser_entries_rejects_missing_directory() {
        let missing = std::env::temp_dir().join(format!("pp_browser_missing_{}", std::process::id()));
        match list_pdf_browser_entries(Some(missing.to_string_lossy().into_owned())) {
            Ok(_) => panic!("expected missing directory to fail"),
            Err(message) => assert!(!message.is_empty()),
        }
    }

    #[test]
    fn discard_working_copy_missing_path_succeeds() {
        let missing = std::env::temp_dir().join(format!("pp_missing_wc_{}.pdf", std::process::id()));
        discard_working_copy(missing.to_string_lossy().into_owned()).unwrap();
    }

    #[test]
    fn file_byte_size_returns_length() {
        let path = save(&mut build_pdf(1), "byte_size");
        let len = file_byte_size(path.clone()).unwrap();
        assert!(len > 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn native_file_dialogs_policy_enables_macos_and_windows() {
        assert!(native_file_dialogs_policy(true, false, false, false, None, None));
        assert!(native_file_dialogs_policy(false, true, false, false, None, None));
    }

    #[test]
    fn native_file_dialogs_policy_wayland_requires_opt_in() {
        assert!(!native_file_dialogs_policy(false, false, true, true, None, None));
        assert!(native_file_dialogs_policy(false, false, true, true, Some("1"), None));
        assert!(native_file_dialogs_policy(false, false, true, false, None, None));
    }

    #[test]
    fn native_file_dialogs_policy_honors_disable_env() {
        assert!(!native_file_dialogs_policy(true, false, false, false, None, Some("1")));
    }

    #[test]
    fn open_working_copy_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_open_wc_missing_{}.pdf", std::process::id()));
        let err = open_working_copy(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn save_working_copy_rejects_missing_working_file() {
        let missing = std::env::temp_dir().join(format!("pp_save_wc_missing_{}.pdf", std::process::id()));
        let target = std::env::temp_dir().join(format!("pp_save_wc_target_{}.pdf", std::process::id()));
        let err = save_working_copy(missing.to_string_lossy().into_owned(), target.to_string_lossy().into_owned())
            .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn snapshot_pdf_rejects_missing_source() {
        let missing = std::env::temp_dir().join(format!("pp_snapshot_missing_{}.pdf", std::process::id()));
        let err = snapshot_pdf(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn open_working_copy_creates_isolated_temp_file() {
        let path = save(&mut build_pdf(1), "wc_open");
        let working = open_working_copy(path.clone()).unwrap();
        assert_ne!(working, path);
        assert!(PathBuf::from(&working).exists());
        assert_eq!(fs::read(&working).unwrap(), fs::read(&path).unwrap());
        discard_working_copy(working).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn working_copy_isolates_edits_until_saved() {
        let original = std::env::temp_dir().join(format!("pp_wc_orig_{}.pdf", std::process::id()));
        fs::write(&original, b"ORIGINAL").unwrap();
        let orig_str = original.to_string_lossy().into_owned();

        let working = open_working_copy(orig_str.clone()).unwrap();
        fs::write(&working, b"EDITED").unwrap(); // simulate an edit on the working copy
        assert_eq!(fs::read(&original).unwrap(), b"ORIGINAL"); // original untouched

        save_working_copy(working.clone(), orig_str).unwrap();
        assert_eq!(fs::read(&original).unwrap(), b"EDITED"); // save commits to original

        discard_working_copy(working.clone()).unwrap();
        assert!(!std::path::Path::new(&working).exists());
        let _ = fs::remove_file(&original);
    }

    #[test]
    fn snapshot_pdf_creates_unique_history_files() {
        let path = save(&mut build_pdf(1), "snap_unique");
        let first = snapshot_pdf(path.clone()).unwrap();
        let second = snapshot_pdf(path.clone()).unwrap();
        assert_ne!(first, second);
        assert!(PathBuf::from(&first).exists());
        assert!(PathBuf::from(&second).exists());
        discard_working_copy(first).unwrap();
        discard_working_copy(second).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn snapshot_undo_restore_reverts_working_copy() {
        let path = save(&mut build_pdf(2), "undo_snap");
        let working = open_working_copy(path.clone()).unwrap();
        let baseline = snapshot_pdf(working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 2);

        delete_page(working.clone(), 0).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 1);
        let edited = snapshot_pdf(working.clone()).unwrap();

        save_working_copy(baseline.clone(), working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 2);

        save_working_copy(edited.clone(), working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 1);

        discard_working_copy(working).unwrap();
        discard_working_copy(baseline).unwrap();
        discard_working_copy(edited).unwrap();
        let _ = fs::remove_file(&path);
    }

    /// Writes `e2e/fixtures/sample.pdf` for the WebdriverIO smoke suite.
    #[test]
    #[ignore]
    fn export_e2e_sample_pdf() {
        let dest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../e2e/fixtures/sample.pdf");
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let source = save(&mut build_pdf(1), "e2e_sample");
        fs::copy(&source, &dest).unwrap();
        let _ = fs::remove_file(source);
        eprintln!("wrote {}", dest.display());
    }

    #[test]
    fn encode_pdf_delta_roundtrip() {
        let base = b"AAAAABBBBBCCCCCDDDDD".to_vec();
        let mut current = base.clone();
        current[5] = b'x';
        current[12] = b'y';
        current.extend_from_slice(b"EEEEE");
        let delta = encode_pdf_delta(&base, &current).unwrap();
        let restored = apply_pdf_delta(&base, &delta).unwrap();
        assert_eq!(restored, current);
    }

    #[test]
    fn snapshot_pdf_entry_uses_delta_for_large_files() {
        let path = save(&mut build_pdf(20), "delta_snap");
        let working = open_working_copy(path.clone()).unwrap();
        let baseline = snapshot_pdf_entry(vec![], working.clone()).unwrap();
        assert_eq!(baseline.kind, "full");

        delete_page(working.clone(), 0).unwrap();
        let history = vec![baseline.clone()];
        let edited = snapshot_pdf_entry(history.clone(), working.clone()).unwrap();
        assert_eq!(edited.kind, "delta");
        assert_eq!(edited.base_index, Some(0));

        restore_history_entry(history, 0, working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 20);

        restore_history_entry(vec![baseline, edited], 1, working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 19);

        discard_working_copy(working).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn prune_history_entry_rematerializes_orphaned_deltas() {
        let path = save(&mut build_pdf(2), "prune_snap");
        let working = open_working_copy(path.clone()).unwrap();
        let baseline = snapshot_pdf_entry(vec![], working.clone()).unwrap();
        delete_page(working.clone(), 0).unwrap();
        let edited = snapshot_pdf_entry(vec![baseline.clone()], working.clone()).unwrap();
        let history = vec![baseline, edited];

        let pruned = prune_history_entry(history, 0).unwrap();
        assert_eq!(pruned.len(), 1);
        assert_eq!(pruned[0].kind, "full");

        restore_history_entry(pruned.clone(), 0, working.clone()).unwrap();
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 1);

        discard_history_entry(pruned[0].clone()).unwrap();
        discard_working_copy(working).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn tagged_markdown_extracts_headings_and_paragraphs() {
        let doc = build_tagged_pdf();
        let pages = tagged_markdown_by_page(&doc).expect("tagged pages");
        let page1 = pages.get(&0).expect("page 1 markdown");
        assert!(page1.contains("# Introduction"));
        assert!(page1.contains("Body paragraph one."));
    }

    #[test]
    fn tagged_markdown_formats_lists_and_tables() {
        let doc = build_tagged_pdf();
        let pages = tagged_markdown_by_page(&doc).expect("tagged pages");
        let page2 = pages.get(&1).expect("page 2 markdown");
        assert!(page2.contains("- First item"));
        assert!(page2.contains("| Name | Score |"));
        assert!(page2.contains("| Alice | 98 |"));
    }

    #[test]
    fn tagged_markdown_absent_without_struct_tree() {
        let doc = build_pdf(1);
        assert!(tagged_markdown_by_page(&doc).is_none());
    }

    #[test]
    fn split_sentences_splits_on_punctuation() {
        let sentences = split_sentences("Alpha one. Beta two! Gamma three?");
        assert_eq!(sentences.len(), 3);
        assert!(sentences[0].contains("Alpha"));
    }

    #[test]
    fn intelligent_extract_finds_email_url_and_date() {
        let extraction = intelligent_extract_from_text(
            "Contact team@example.com on 03/15/2024. Visit https://example.com/docs today.",
        );
        assert!(extraction.emails.iter().any(|email| email.contains("team@example.com")));
        assert!(extraction.urls.iter().any(|url| url.contains("https://example.com")));
        assert!(!extraction.dates.is_empty());
    }

    #[test]
    fn build_pdf_summary_produces_overview_and_key_points() {
        let pages = vec![
            "Quarterly Report".to_string(),
            "Revenue increased across all regions during the quarter.".to_string(),
            "Operating costs remained stable while product adoption accelerated.".to_string(),
        ];
        let summary = build_pdf_summary(&pages, 0);
        assert_eq!(summary.page_count, 3);
        assert!(summary.word_count > 10);
        assert!(summary.title_guess.as_deref() == Some("Quarterly Report"));
        assert!(!summary.overview.is_empty());
        assert!(!summary.key_points.is_empty());
    }

    #[test]
    fn summarize_pdf_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_summary_missing_{}.pdf", std::process::id()));
        let err = summarize_pdf(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn summary_to_markdown_formats_sections() {
        let summary = build_pdf_summary(
            &["Quarterly Report".to_string(), "Revenue increased across all regions.".to_string()],
            1,
        );
        let md = summary_to_markdown(&summary);
        assert!(md.contains("# Document Summary"));
        assert!(md.contains("## Overview"));
        assert!(md.contains("## Key points"));
        assert!(md.contains("Scanned/image-only pages:** 1"));
    }

    #[test]
    fn ocr_available_reports_tesseract_presence() {
        let available = ocr_available();
        assert_eq!(available, resolve_tesseract().is_some());
    }

    #[test]
    fn ocr_pdf_page_rejects_missing_file() {
        let missing = tmp("ocr_missing");
        let err = ocr_pdf_page(missing.to_string_lossy().into_owned(), 0).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn ocr_png_bytes_without_tesseract_returns_none() {
        let prev_path = std::env::var_os("PATH");
        let prev_cmd = std::env::var_os("TESSERACT_CMD");
        std::env::remove_var("PATH");
        std::env::remove_var("TESSERACT_CMD");
        let result = ocr_png_bytes(&[0x89, 0x50, 0x4e, 0x47]);
        if let Some(path) = prev_path {
            std::env::set_var("PATH", path);
        }
        if let Some(cmd) = prev_cmd {
            std::env::set_var("TESSERACT_CMD", cmd);
        }
        assert_eq!(result.unwrap(), None);
    }

    /// Needs PDFium + Tesseract. Run: `cargo test ocr_rendered_page_smoke -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn ocr_rendered_page_smoke() {
        if resolve_tesseract().is_none() {
            eprintln!("skip: tesseract not installed");
            return;
        }
        let path = save(&mut build_pdf(1), "ocr_smoke");
        let png = render_page_png(Path::new(&path), 0, OCR_RENDER_W, OCR_RENDER_H).unwrap();
        let text = ocr_png_bytes(&png).unwrap().unwrap_or_default();
        assert!(!text.is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn markdown_lines_promote_probable_headings() {
        let lines = vec![
            md_line("Cigna Employee-Paid Voluntary Benefits!", 720.0, 704.0, vec![]),
            md_line(
                "As an eligible employee of Insperity, you have the chance to apply for valuable benefits.",
                680.0,
                668.0,
                vec![],
            ),
            md_line("The group rates mean you pay less than individual coverage.", 654.0, 642.0, vec![]),
        ];

        let markdown = format_markdown_lines(&lines);

        assert!(markdown.contains("### Cigna Employee-Paid Voluntary Benefits!"));
        assert!(markdown.contains("As an eligible employee"));
    }

    #[test]
    fn markdown_lines_turn_toc_leaders_into_table() {
        let lines = vec![
            md_line("Table of Contents", 720.0, 708.0, vec![]),
            md_line("Plan Features................................................ Page 4", 684.0, 672.0, vec![]),
            md_line("Plan Summary................................................. Page 10", 666.0, 654.0, vec![]),
        ];

        let markdown = format_markdown_lines(&lines);

        assert!(markdown.contains("### Table of Contents"));
        assert!(markdown.contains("| Section | Page |"));
        assert!(markdown.contains("| Plan Features | 4 |"));
        assert!(markdown.contains("| Plan Summary | 10 |"));
    }

    #[test]
    fn markdown_lines_turn_column_blocks_into_tables() {
        let lines = vec![
            md_line("Benefit Amount", 720.0, 708.0, vec![("Benefit", 72.0, 140.0), ("Amount", 260.0, 330.0)]),
            md_line("Life $25,000", 704.0, 692.0, vec![("Life", 72.0, 120.0), ("$25,000", 260.0, 330.0)]),
            md_line("Disability $1,000", 688.0, 676.0, vec![("Disability", 72.0, 150.0), ("$1,000", 260.0, 330.0)]),
        ];

        let markdown = format_markdown_lines(&lines);

        assert!(markdown.contains("| Benefit | Amount |"));
        assert!(markdown.contains("| Life | $25,000 |"));
        assert!(markdown.contains("| Disability | $1,000 |"));
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
    fn optimize_pdf_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_optimize_missing_{}.pdf", std::process::id()));
        let err = optimize_pdf(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn protect_pdf_writes_encrypted_output() {
        let path = save(&mut build_pdf(1), "protect");
        let msg = protect_pdf(path.clone(), "user-secret".to_string(), None).unwrap();
        assert!(msg.contains("_protected.pdf"));
        let protected = PathBuf::from(&path)
            .with_file_name(format!("{}_protected.pdf", PathBuf::from(&path).file_stem().unwrap().to_string_lossy()));
        verify_pdf_password(protected.to_string_lossy().into_owned(), "user-secret".to_string()).unwrap();
        assert!(pdf_is_encrypted(protected.to_string_lossy().into_owned()).unwrap());
        assert!(verify_pdf_password(protected.to_string_lossy().into_owned(), "wrong".to_string()).is_err());
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(protected);
    }

    #[test]
    fn protect_pdf_rejects_empty_password() {
        let path = save(&mut build_pdf(1), "protect_empty");
        match protect_pdf(path.clone(), String::new(), None) {
            Ok(_) => panic!("expected empty password to fail"),
            Err(message) => assert!(message.contains("required")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pdf_is_encrypted_detects_protected_file() {
        let path = save(&mut build_pdf(1), "protect_detect");
        protect_pdf(path.clone(), "secret".to_string(), None).unwrap();
        let protected = PathBuf::from(&path)
            .with_file_name(format!("{}_protected.pdf", PathBuf::from(&path).file_stem().unwrap().to_string_lossy()));
        assert!(pdf_is_encrypted(protected.to_string_lossy().into_owned()).unwrap());
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(protected);
    }

    #[test]
    fn verify_pdf_password_accepts_correct_secret() {
        let path = save(&mut build_pdf(1), "protect_verify");
        protect_pdf(path.clone(), "open-me".to_string(), None).unwrap();
        let protected = PathBuf::from(&path)
            .with_file_name(format!("{}_protected.pdf", PathBuf::from(&path).file_stem().unwrap().to_string_lossy()));
        verify_pdf_password(protected.to_string_lossy().into_owned(), "open-me".to_string()).unwrap();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(protected);
    }

    fn generate_test_pkcs12(dir: &Path) -> Option<PathBuf> {
        if Command::new("openssl").arg("version").output().is_err() {
            return None;
        }
        let key = dir.join("sig_key.pem");
        let cert = dir.join("sig_cert.pem");
        let p12 = dir.join("sig_test.p12");
        let status = Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-keyout",
                key.to_str()?,
                "-out",
                cert.to_str()?,
                "-days",
                "1",
                "-nodes",
                "-subj",
                "/CN=PDF Panda Test Signer",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }
        let status = Command::new("openssl")
            .args([
                "pkcs12",
                "-export",
                "-legacy",
                "-out",
                p12.to_str()?,
                "-inkey",
                key.to_str()?,
                "-in",
                cert.to_str()?,
                "-password",
                "pass:pdfpanda-test",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }
        Some(p12)
    }

    fn build_pdf_with_outlines(n: usize) -> Document {
        let mut doc = build_pdf(n);
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let pages = doc.get_pages();
        let page_one = *pages.get(&1).unwrap();
        let page_two = pages.get(&2).copied();

        let outlines_id = doc.new_object_id();
        let mut chapter_one = Dictionary::new();
        chapter_one.set("Title", Object::String(b"Chapter 1".to_vec(), lopdf::StringFormat::Literal));
        chapter_one.set("Dest", Object::Array(vec![Object::Reference(page_one), Object::Name(b"Fit".to_vec())]));
        chapter_one.set("Parent", Object::Reference(outlines_id));
        let chapter_one_id = doc.add_object(Object::Dictionary(chapter_one));

        let chapter_two_id = page_two.map(|page_id| {
            let mut chapter_two = Dictionary::new();
            chapter_two.set("Title", Object::String(b"Chapter 2".to_vec(), lopdf::StringFormat::Literal));
            chapter_two.set("Dest", Object::Array(vec![Object::Reference(page_id), Object::Name(b"Fit".to_vec())]));
            chapter_two.set("Parent", Object::Reference(outlines_id));
            chapter_two.set("Prev", Object::Reference(chapter_one_id));
            let chapter_two_id = doc.add_object(Object::Dictionary(chapter_two));
            if let Ok(Object::Dictionary(chapter_one)) = doc.get_object_mut(chapter_one_id) {
                chapter_one.set("Next", Object::Reference(chapter_two_id));
            }
            chapter_two_id
        });

        if let Ok(Object::Dictionary(chapter_one)) = doc.get_object_mut(chapter_one_id) {
            if let Some(next_id) = chapter_two_id {
                chapter_one.set("Next", Object::Reference(next_id));
            }
        }

        let mut outlines = Dictionary::new();
        outlines.set("Type", Object::Name(b"Outlines".to_vec()));
        outlines.set("First", Object::Reference(chapter_one_id));
        outlines.set("Last", Object::Reference(chapter_two_id.unwrap_or(chapter_one_id)));
        outlines.set("Count", Object::Integer(if chapter_two_id.is_some() { 2 } else { 1 }));
        doc.objects.insert(outlines_id, Object::Dictionary(outlines));
        doc.get_dictionary_mut(catalog_id).expect("catalog").set("Outlines", Object::Reference(outlines_id));
        doc
    }

    #[test]
    fn get_pdf_metadata_empty_without_info_dict() {
        let path = save(&mut build_pdf(1), "metadata_empty");
        let metadata = get_pdf_metadata(path.clone()).unwrap();
        assert!(metadata.title.is_none());
        assert!(metadata.author.is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_pdf_metadata_roundtrip() {
        let path = save(&mut build_pdf(1), "metadata_roundtrip");
        set_pdf_metadata(
            path.clone(),
            Some("Quarterly Report".to_string()),
            Some("Alex Example".to_string()),
            Some("Finance".to_string()),
            Some("Q1, revenue".to_string()),
            Some("PDF Panda".to_string()),
            Some("PDF-Panda".to_string()),
        )
        .unwrap();
        let metadata = get_pdf_metadata(path.clone()).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Quarterly Report"));
        assert_eq!(metadata.author.as_deref(), Some("Alex Example"));
        assert_eq!(metadata.subject.as_deref(), Some("Finance"));
        assert_eq!(metadata.keywords.as_deref(), Some("Q1, revenue"));
        assert_eq!(metadata.creator.as_deref(), Some("PDF Panda"));
        assert_eq!(metadata.producer.as_deref(), Some("PDF-Panda"));
        assert!(metadata.creation_date.is_some());
        assert!(metadata.mod_date.is_some());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_pdf_bookmarks_empty_without_outline() {
        let path = save(&mut build_pdf(1), "bookmark_empty");
        let bookmarks = get_pdf_bookmarks(path.clone()).unwrap();
        assert!(bookmarks.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_pdf_bookmarks_reads_outline_tree() {
        let path = save(&mut build_pdf_with_outlines(2), "bookmark_tree");
        let bookmarks = get_pdf_bookmarks(path.clone()).unwrap();
        assert_eq!(bookmarks.len(), 2);
        assert_eq!(bookmarks[0].title, "Chapter 1");
        assert_eq!(bookmarks[0].depth, 0);
        assert_eq!(bookmarks[0].page_index, Some(0));
        assert_eq!(bookmarks[1].title, "Chapter 2");
        assert_eq!(bookmarks[1].page_index, Some(1));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn list_pdf_signatures_empty_on_unsigned_pdf() {
        let path = save(&mut build_pdf(1), "sig_list_empty");
        let signatures = list_pdf_signatures(path.clone()).unwrap();
        assert!(signatures.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn verify_pdf_signatures_empty_on_unsigned_pdf() {
        let path = save(&mut build_pdf(1), "sig_verify_empty");
        let report = verify_pdf_signatures(path.clone(), None).unwrap();
        assert_eq!(report.signature_count, 0);
        assert!(!report.overall_valid);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn sign_pdf_rejects_empty_password() {
        let path = save(&mut build_pdf(1), "sig_reject_pw");
        let err =
            sign_pdf(path.clone(), "/tmp/missing.p12".to_string(), String::new(), None, None, None, None).unwrap_err();
        assert!(err.contains("password"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn sign_pdf_rejects_encrypted_pdf() {
        let path = save(&mut build_pdf(1), "sig_reject_enc");
        protect_pdf(path.clone(), "secret".to_string(), None).unwrap();
        let protected = PathBuf::from(&path)
            .with_file_name(format!("{}_protected.pdf", PathBuf::from(&path).file_stem().unwrap().to_string_lossy()));
        let err = sign_pdf(
            protected.to_string_lossy().into_owned(),
            "/tmp/missing.p12".to_string(),
            "pw".to_string(),
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(err.contains("encrypted"));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(protected);
    }

    #[test]
    fn pdf_signature_roundtrip_with_openssl() {
        let dir = std::env::temp_dir().join(format!("pdf_panda_sig_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let Some(p12) = generate_test_pkcs12(&dir) else {
            eprintln!("openssl unavailable — skipping pdf_signature_roundtrip_with_openssl");
            return;
        };
        let path = save(&mut build_pdf(1), "sig_roundtrip");
        sign_pdf(
            path.clone(),
            p12.to_string_lossy().into_owned(),
            "pdfpanda-test".to_string(),
            Some("Approved".to_string()),
            Some("Test Lab".to_string()),
            None,
            None,
        )
        .unwrap();
        let listed = list_pdf_signatures(path.clone()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].field_name, "Signature1");
        assert_eq!(listed[0].reason.as_deref(), Some("Approved"));
        let report = verify_pdf_signatures(path.clone(), None).unwrap();
        assert_eq!(report.signature_count, 1);
        assert_eq!(report.signatures[0].status, "valid_untrusted");
        assert!(report.signatures[0].integrity_ok);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn open_working_copy_with_password_decrypts_for_editing() {
        let path = save(&mut build_pdf(2), "protect_open");
        protect_pdf(path.clone(), "edit-me".to_string(), None).unwrap();
        let protected = PathBuf::from(&path)
            .with_file_name(format!("{}_protected.pdf", PathBuf::from(&path).file_stem().unwrap().to_string_lossy()));
        let working =
            open_working_copy_with_password(protected.to_string_lossy().into_owned(), "edit-me".to_string()).unwrap();
        let doc = Document::load(&working).unwrap();
        assert!(!doc.is_encrypted());
        assert_eq!(get_pdf_page_count(working.clone()).unwrap(), 2);
        discard_working_copy(working).unwrap();
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(protected);
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
    fn get_annotations_returns_empty_without_highlights() {
        let path = save(&mut build_pdf(1), "annots_empty");
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert!(annots.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_annotations_rejects_invalid_page() {
        let path = save(&mut build_pdf(1), "annots_invalid_page");
        match get_annotations(path.clone(), 9) {
            Ok(_) => panic!("expected invalid page to fail"),
            Err(message) => assert!(message.contains("Page not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_highlight_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "remove_invalid");
        add_highlight(path.clone(), 0, 1.0, 1.0, 2.0, 2.0).unwrap();
        match remove_highlight(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("Highlight not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_highlight_rejects_invalid_page() {
        let path = save(&mut build_pdf(1), "add_invalid_page");
        match add_highlight(path.clone(), 9, 1.0, 1.0, 2.0, 2.0) {
            Ok(_) => panic!("expected invalid page to fail"),
            Err(message) => assert!(message.contains("Page not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_annotations_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_annots_missing_{}.pdf", std::process::id()));
        match get_annotations(missing.to_string_lossy().into_owned(), 0) {
            Ok(_) => panic!("expected missing file to fail"),
            Err(message) => assert!(!message.is_empty()),
        }
    }

    #[test]
    fn add_highlight_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_add_highlight_missing_{}.pdf", std::process::id()));
        let err = add_highlight(missing.to_string_lossy().into_owned(), 0, 1.0, 1.0, 2.0, 2.0).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn remove_highlight_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_remove_highlight_missing_{}.pdf", std::process::id()));
        let err = remove_highlight(missing.to_string_lossy().into_owned(), 0, 0).unwrap_err();
        assert!(!err.is_empty());
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
    fn text_note_add_and_read_back() {
        let path = save(&mut build_pdf(1), "text_note");
        add_text_note(path.clone(), 0, 12.0, 24.0, "Review this section".to_string()).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Text");
        assert_eq!(annots[0].contents.as_deref(), Some("Review this section"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_text_note_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "text_note_remove");
        add_text_note(path.clone(), 0, 10.0, 10.0, "First".to_string()).unwrap();
        add_text_note(path.clone(), 0, 50.0, 50.0, "Second".to_string()).unwrap();
        remove_text_note(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].contents.as_deref(), Some("Second"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_text_note_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "text_note_invalid");
        add_text_note(path.clone(), 0, 1.0, 1.0, "Note".to_string()).unwrap();
        match remove_text_note(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("Text note not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn ink_stroke_add_and_read_back() {
        let path = save(&mut build_pdf(1), "ink");
        let points = vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0];
        add_ink_stroke(path.clone(), 0, points.clone()).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Ink");
        assert_eq!(annots[0].ink_points.as_deref(), Some(points.as_slice()));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_ink_stroke_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "ink_remove");
        add_ink_stroke(path.clone(), 0, vec![1.0, 1.0, 2.0, 2.0]).unwrap();
        add_ink_stroke(path.clone(), 0, vec![10.0, 10.0, 20.0, 20.0]).unwrap();
        remove_ink_stroke(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].ink_points.as_deref(), Some(&[10.0, 10.0, 20.0, 20.0][..]));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_ink_stroke_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "ink_invalid");
        add_ink_stroke(path.clone(), 0, vec![1.0, 1.0, 2.0, 2.0]).unwrap();
        match remove_ink_stroke(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("Ink stroke not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_ink_stroke_rejects_too_few_points() {
        let path = save(&mut build_pdf(1), "ink_few");
        match add_ink_stroke(path.clone(), 0, vec![1.0, 1.0]) {
            Ok(_) => panic!("expected too few points to fail"),
            Err(message) => assert!(message.contains("at least two points")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_ink_stroke_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_add_ink_missing_{}.pdf", std::process::id()));
        let err = add_ink_stroke(missing.to_string_lossy().into_owned(), 0, vec![1.0, 1.0, 2.0, 2.0]).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn remove_ink_stroke_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_remove_ink_missing_{}.pdf", std::process::id()));
        let err = remove_ink_stroke(missing.to_string_lossy().into_owned(), 0, 0).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn square_shape_add_and_read_back() {
        let path = save(&mut build_pdf(1), "square");
        add_square(path.clone(), 0, 10.0, 20.0, 110.0, 80.0).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Square");
        assert_eq!(annots[0].rect, [10.0, 20.0, 110.0, 80.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn circle_shape_add_and_read_back() {
        let path = save(&mut build_pdf(1), "circle");
        add_circle(path.clone(), 0, 5.0, 5.0, 55.0, 35.0).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Circle");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn line_shape_add_and_read_back() {
        let path = save(&mut build_pdf(1), "line");
        add_line(path.clone(), 0, 10.0, 10.0, 90.0, 70.0).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].subtype, "Line");
        assert_eq!(annots[0].line_endpoints, Some([10.0, 10.0, 90.0, 70.0]));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_square_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "square_remove");
        add_square(path.clone(), 0, 1.0, 1.0, 10.0, 10.0).unwrap();
        add_square(path.clone(), 0, 20.0, 20.0, 30.0, 30.0).unwrap();
        remove_square(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].rect, [20.0, 20.0, 30.0, 30.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_line_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "line_invalid");
        add_line(path.clone(), 0, 1.0, 1.0, 20.0, 20.0).unwrap();
        match remove_line(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("Line shape not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_line_rejects_too_short() {
        let path = save(&mut build_pdf(1), "line_short");
        match add_line(path.clone(), 0, 1.0, 1.0, 1.0, 1.0) {
            Ok(_) => panic!("expected short line to fail"),
            Err(message) => assert!(message.contains("too short")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn redaction_add_and_read_back() {
        let path = save(&mut build_pdf(1), "redact");
        add_redaction(path.clone(), 0, 12.0, 24.0, 112.0, 84.0).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert!(annots[0].is_redaction);
        assert_eq!(annots[0].rect, [12.0, 24.0, 112.0, 84.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_redaction_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "redact_remove");
        add_redaction(path.clone(), 0, 1.0, 1.0, 10.0, 10.0).unwrap();
        add_redaction(path.clone(), 0, 20.0, 20.0, 40.0, 40.0).unwrap();
        remove_redaction(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].rect, [20.0, 20.0, 40.0, 40.0]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_redaction_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "redact_invalid");
        add_redaction(path.clone(), 0, 1.0, 1.0, 10.0, 10.0).unwrap();
        match remove_redaction(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("Redaction not found")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_redaction_rejects_missing_file() {
        let missing = std::env::temp_dir().join(format!("pp_add_redact_missing_{}.pdf", std::process::id()));
        let err = add_redaction(missing.to_string_lossy().into_owned(), 0, 1.0, 1.0, 2.0, 2.0).unwrap_err();
        assert!(!err.is_empty());
    }

    fn test_png(name: &str) -> PathBuf {
        use image::{ImageBuffer, Rgb};
        let path = tmp(name).with_extension("png");
        let img = ImageBuffer::from_fn(8, 6, |_, _| Rgb([200u8, 40, 40]));
        img.save(&path).unwrap();
        path
    }

    #[test]
    fn append_page_content_writes_marker() {
        let path = save(&mut build_pdf(1), "append_content");
        let mut doc = Document::load(&path).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        append_page_content(&mut doc, page_id, b"PP_IMAGE_MARKER\n").unwrap();
        doc.save(&path).unwrap();
        let doc = Document::load(&path).unwrap();
        let marked = doc.objects.iter().any(|(_, obj)| {
            obj.as_stream().map(|s| s.content.windows(16).any(|w| w == b"PP_IMAGE_MARKER\n")).unwrap_or(false)
        });
        assert!(marked, "append_page_content did not persist marker after save");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_page_text_and_vector_markers() {
        let content = "%PP-TXT 0 10 20 14 Hello world\nBT\n%PP-VEC 1 5 6 40 30 stroke\nq\n";
        let texts = parse_page_text_edits(content);
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].text, "Hello world");
        let vectors = parse_page_vectors(content);
        assert_eq!(vectors.len(), 1);
        assert_eq!(vectors[0].width, 40.0);
    }

    #[test]
    fn page_text_edit_roundtrip() {
        let path = save(&mut build_pdf(1), "page_text");
        let index = add_page_text(path.clone(), 0, 120.0, 140.0, 16.0, "Editable line".to_string()).unwrap();
        let edits = list_page_text_edits(path.clone(), 0).unwrap();
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].index, index);
        assert_eq!(edits[0].text, "Editable line");
        update_page_text(path.clone(), 0, index, "Updated line".to_string(), None, None, None).unwrap();
        let edits = list_page_text_edits(path.clone(), 0).unwrap();
        assert_eq!(edits[0].text, "Updated line");
        remove_page_text(path.clone(), 0, index).unwrap();
        assert!(list_page_text_edits(path.clone(), 0).unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn page_vector_rect_roundtrip() {
        let path = save(&mut build_pdf(1), "page_vector");
        let index = add_page_vector_rect(path.clone(), 0, 50.0, 60.0, 120.0, 80.0).unwrap();
        let vectors = list_page_vectors(path.clone(), 0).unwrap();
        assert_eq!(vectors.len(), 1);
        assert_eq!(vectors[0].index, index);
        remove_page_vector(path.clone(), 0, index).unwrap();
        assert!(list_page_vectors(path.clone(), 0).unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_page_text_rejects_empty_string() {
        let path = save(&mut build_pdf(1), "page_text_empty");
        let err = add_page_text(path.clone(), 0, 10.0, 10.0, 12.0, "   ".to_string()).unwrap_err();
        assert!(err.contains("empty"));
        let _ = std::fs::remove_file(&path);
    }

    fn build_pdf_with_text_field() -> Document {
        let mut doc = build_pdf(1);
        let page_id = *doc.get_pages().get(&1).unwrap();
        let field_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
            (b"Type".to_vec(), Object::Name(b"Annot".to_vec())),
            (b"Subtype".to_vec(), Object::Name(b"Widget".to_vec())),
            (b"FT".to_vec(), Object::Name(b"Tx".to_vec())),
            (b"T".to_vec(), Object::String(b"FirstName".to_vec(), lopdf::StringFormat::Literal)),
            (b"V".to_vec(), Object::String(b"Ada".to_vec(), lopdf::StringFormat::Literal)),
            (
                b"Rect".to_vec(),
                Object::Array(vec![
                    Object::Integer(72),
                    Object::Integer(700),
                    Object::Integer(280),
                    Object::Integer(730),
                ]),
            ),
            (b"F".to_vec(), Object::Integer(4)),
        ])));
        doc.get_dictionary_mut(page_id).unwrap().set(b"Annots", Object::Array(vec![Object::Reference(field_id)]));
        let acroform_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
            (b"Fields".to_vec(), Object::Array(vec![Object::Reference(field_id)])),
            (b"NeedAppearances".to_vec(), Object::Boolean(true)),
        ])));
        let catalog_id = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_dictionary_mut(catalog_id).unwrap().set(b"AcroForm", Object::Reference(acroform_id));
        doc
    }

    #[test]
    fn get_pdf_form_fields_reads_text_field() {
        let path = save(&mut build_pdf_with_text_field(), "form_read");
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "FirstName");
        assert_eq!(fields[0].field_type, "text");
        assert_eq!(fields[0].value, "Ada");
        assert_eq!(fields[0].page_index, Some(0));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_pdf_form_field_updates_text_value() {
        let path = save(&mut build_pdf_with_text_field(), "form_set");
        set_pdf_form_field(path.clone(), "FirstName".to_string(), "Grace".to_string()).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields[0].value, "Grace");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_text_form_field_creates_fillable_widget() {
        let path = save(&mut build_pdf(1), "form_add");
        add_text_form_field(path.clone(), 0, "Email".to_string(), 100.0, 120.0, 180.0, 28.0).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "Email");
        assert_eq!(fields[0].field_type, "text");
        assert_eq!(fields[0].page_index, Some(0));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_pdf_form_field_rejects_missing_name() {
        let path = save(&mut build_pdf_with_text_field(), "form_missing");
        let err = set_pdf_form_field(path.clone(), "Missing".to_string(), "x".to_string()).unwrap_err();
        assert!(err.contains("not found"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_checkbox_form_field_creates_toggle() {
        let path = save(&mut build_pdf(1), "form_checkbox");
        add_checkbox_form_field(path.clone(), 0, "Agree".to_string(), 80.0, 80.0, 18.0, 18.0, false).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].field_type, "checkbox");
        assert!(!fields[0].checked);
        set_pdf_form_field(path.clone(), "Agree".to_string(), "true".to_string()).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert!(fields[0].checked);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_choice_form_field_stores_options() {
        let path = save(&mut build_pdf(1), "form_choice");
        add_choice_form_field(
            path.clone(),
            0,
            "Country".to_string(),
            80.0,
            120.0,
            160.0,
            24.0,
            vec!["US".to_string(), "CA".to_string(), "MX".to_string()],
            true,
        )
        .unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].field_type, "choice");
        assert_eq!(fields[0].options, vec!["US", "CA", "MX"]);
        set_pdf_form_field(path.clone(), "Country".to_string(), "CA".to_string()).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields[0].value, "CA");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_radio_form_field_group_excludes_other_options() {
        let path = save(&mut build_pdf(1), "form_radio");
        add_radio_form_field(path.clone(), 0, "Color".to_string(), "Red".to_string(), 60.0, 60.0, 16.0, 16.0).unwrap();
        add_radio_form_field(path.clone(), 0, "Color".to_string(), "Blue".to_string(), 60.0, 90.0, 16.0, 16.0).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        assert_eq!(fields.len(), 2);
        set_pdf_form_field(path.clone(), "Color.Red".to_string(), "true".to_string()).unwrap();
        let fields = get_pdf_form_fields(path.clone()).unwrap();
        let red = fields.iter().find(|field| field.name == "Color.Red").unwrap();
        let blue = fields.iter().find(|field| field.name == "Color.Blue").unwrap();
        assert!(red.checked);
        assert!(!blue.checked);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_image_dimensions_reads_png() {
        let path = test_png("dims");
        let dims = get_image_dimensions(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(dims, [8, 6]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_page_image_embeds_xobject_and_content() {
        let path = save(&mut build_pdf(1), "page_image");
        let img_path = test_png("page_image_src");
        add_page_image(path.clone(), 0, 100.0, 100.0, 80.0, 60.0, img_path.to_string_lossy().into_owned()).unwrap();
        let doc = Document::load(&path).unwrap();
        let any_stream_do = doc.objects.iter().any(|(_, obj)| {
            obj.as_stream().map(|s| String::from_utf8_lossy(&s.content).contains(" Do")).unwrap_or(false)
        });
        assert!(any_stream_do, "no content stream contains image draw operator");
        let pages = doc.get_pages();
        let page_id = *pages.get(&1).unwrap();
        let page = doc.get_dictionary(page_id).unwrap();
        let resources = page.get(b"Resources").unwrap().as_dict().unwrap();
        let xobjects = resources.get(b"XObject").unwrap().as_dict().unwrap();
        assert!(xobjects.iter().any(|(k, _)| k.starts_with(b"Im")));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&img_path);
    }

    #[test]
    fn add_page_image_rejects_missing_pdf() {
        let img_path = test_png("page_image_missing_pdf");
        let missing = std::env::temp_dir().join(format!("pp_page_image_missing_{}.pdf", std::process::id()));
        let err = add_page_image(
            missing.to_string_lossy().into_owned(),
            0,
            10.0,
            10.0,
            50.0,
            50.0,
            img_path.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(!err.is_empty());
        let _ = std::fs::remove_file(&img_path);
    }

    #[test]
    fn add_page_image_rejects_missing_image() {
        let path = save(&mut build_pdf(1), "page_image_no_src");
        let missing = std::env::temp_dir().join(format!("pp_page_image_src_{}.png", std::process::id()));
        let err = add_page_image(path.clone(), 0, 10.0, 10.0, 50.0, 50.0, missing.to_string_lossy().into_owned())
            .unwrap_err();
        assert!(err.contains("not found"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_page_image_rejects_too_small() {
        let path = save(&mut build_pdf(1), "page_image_small");
        let img_path = test_png("page_image_small_src");
        let err =
            add_page_image(path.clone(), 0, 10.0, 10.0, 4.0, 4.0, img_path.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("too small"));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&img_path);
    }

    #[test]
    fn pdf_image_stream_bytes_device_gray_to_png() {
        let stream = Stream::new(
            Dictionary::from_iter(vec![
                (b"Width".to_vec(), Object::Integer(2)),
                (b"Height".to_vec(), Object::Integer(2)),
                (b"BitsPerComponent".to_vec(), Object::Integer(8)),
                (b"ColorSpace".to_vec(), Object::Name(b"DeviceGray".to_vec())),
            ]),
            vec![0, 64, 128, 255],
        );
        let (png, ext) = pdf_image_stream_bytes(&stream).expect("gray image");
        assert_eq!(ext, "png");
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn pdf_image_stream_bytes_device_cmyk_to_png() {
        let stream = Stream::new(
            Dictionary::from_iter(vec![
                (b"Width".to_vec(), Object::Integer(1)),
                (b"Height".to_vec(), Object::Integer(1)),
                (b"BitsPerComponent".to_vec(), Object::Integer(8)),
                (b"ColorSpace".to_vec(), Object::Name(b"DeviceCMYK".to_vec())),
            ]),
            vec![0, 255, 255, 0],
        );
        let (png, ext) = pdf_image_stream_bytes(&stream).expect("cmyk image");
        assert_eq!(ext, "png");
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn pdf_image_stream_bytes_indexed_to_png() {
        let stream = Stream::new(
            Dictionary::from_iter(vec![
                (b"Width".to_vec(), Object::Integer(2)),
                (b"Height".to_vec(), Object::Integer(1)),
                (b"BitsPerComponent".to_vec(), Object::Integer(8)),
                (
                    b"ColorSpace".to_vec(),
                    Object::Array(vec![
                        Object::Name(b"Indexed".to_vec()),
                        Object::Name(b"DeviceRGB".to_vec()),
                        Object::Integer(1),
                        Object::String(vec![255, 0, 0, 0, 0, 255], lopdf::StringFormat::Literal),
                    ]),
                ),
            ]),
            vec![0, 1],
        );
        let (png, ext) = pdf_image_stream_bytes(&stream).expect("indexed image");
        assert_eq!(ext, "png");
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn pdf_image_stream_bytes_device_rgb_to_png() {
        let stream = Stream::new(
            Dictionary::from_iter(vec![
                (b"Width".to_vec(), Object::Integer(1)),
                (b"Height".to_vec(), Object::Integer(1)),
                (b"BitsPerComponent".to_vec(), Object::Integer(8)),
                (b"ColorSpace".to_vec(), Object::Name(b"DeviceRGB".to_vec())),
            ]),
            vec![10, 20, 30],
        );
        let (png, ext) = pdf_image_stream_bytes(&stream).expect("rgb image");
        assert_eq!(ext, "png");
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn list_stamp_presets_returns_known_labels() {
        let presets = list_stamp_presets();
        assert_eq!(presets.len(), 4);
        assert!(presets.iter().any(|p| p.id == "approved" && p.label == "APPROVED"));
    }

    #[test]
    fn text_stamp_add_and_read_back() {
        let path = save(&mut build_pdf(1), "text_stamp");
        add_text_stamp(path.clone(), 0, 20.0, 30.0, "approved".to_string()).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].stamp_kind.as_deref(), Some("text"));
        assert_eq!(annots[0].stamp_preset.as_deref(), Some("approved"));
        assert_eq!(annots[0].contents.as_deref(), Some("APPROVED"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn image_stamp_add_and_read_back() {
        let path = save(&mut build_pdf(1), "image_stamp");
        add_image_stamp(path.clone(), 0, 40.0, 50.0, "draft".to_string()).unwrap();
        let annots = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(annots.len(), 1);
        assert_eq!(annots[0].stamp_kind.as_deref(), Some("image"));
        assert_eq!(annots[0].stamp_preset.as_deref(), Some("draft"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_text_stamp_deletes_the_right_one() {
        let path = save(&mut build_pdf(1), "text_stamp_remove");
        add_text_stamp(path.clone(), 0, 10.0, 10.0, "approved".to_string()).unwrap();
        add_text_stamp(path.clone(), 0, 50.0, 50.0, "draft".to_string()).unwrap();
        remove_text_stamp(path.clone(), 0, 0).unwrap();
        let remaining = get_annotations(path.clone(), 0).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].stamp_preset.as_deref(), Some("draft"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn add_text_stamp_rejects_unknown_preset() {
        let path = save(&mut build_pdf(1), "text_stamp_bad");
        match add_text_stamp(path.clone(), 0, 1.0, 1.0, "nope".to_string()) {
            Ok(_) => panic!("expected unknown preset to fail"),
            Err(message) => assert!(message.contains("Unknown stamp preset")),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn remove_image_stamp_rejects_invalid_index() {
        let path = save(&mut build_pdf(1), "image_stamp_invalid");
        add_image_stamp(path.clone(), 0, 1.0, 1.0, "reviewed".to_string()).unwrap();
        match remove_image_stamp(path.clone(), 0, 9) {
            Ok(_) => panic!("expected invalid index to fail"),
            Err(message) => assert!(message.contains("image stamp not found")),
        }
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
    ///   PDF_PANDA_TEST_PDF=/path/to/file.pdf \
    ///     cargo test render_real_pdf_smoke -- --ignored --nocapture
    #[test]
    #[ignore = "requires a PDFium library and PDF_PANDA_TEST_PDF"]
    fn render_real_pdf_smoke() {
        let pdf = std::env::var("PDF_PANDA_TEST_PDF").expect("set PDF_PANDA_TEST_PDF");

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
