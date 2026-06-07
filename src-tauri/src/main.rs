#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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

fn plain_text_to_markdown(text: &str) -> String {
    let normalized = text.lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n");
    if normalized.is_empty() {
        "_(no extractable text on this page)_\n\n".to_string()
    } else {
        format!("{normalized}\n\n")
    }
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
        let text = page.text().map_err(|e| e.to_string())?;
        let lines = lines_from_pdfium_text(&text);
        if lines.is_empty() {
            markdown.push_str(&plain_text_to_markdown(text.all().trim()));
        } else {
            markdown.push_str(&format_markdown_lines(&lines));
        }
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

fn write_markdown_file(markdown_path: &Path, markdown: &str, overwrite: bool) -> Result<MarkdownSaveResult, String> {
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
fn save_pdf_markdown(
    path: String,
    overwrite: bool,
    output_path: Option<String>,
) -> Result<MarkdownSaveResult, String> {
    let pdf_path = PathBuf::from(path);
    let markdown = pdf_to_markdown(&pdf_path)?;
    let markdown_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(|| pdf_path.with_extension("md"));
    write_markdown_file(&markdown_path, &markdown, overwrite)
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
    for (offset, page_id) in new_page_ids.into_iter().enumerate() {
        source_kids.insert(at + offset, Object::Reference(page_id));
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

/// Copy the working copy to a fresh temp snapshot, used to build the undo/redo
/// history. Returns the snapshot path (restored later via `save_working_copy`).
#[tauri::command]
fn snapshot_pdf(source: String) -> Result<String, String> {
    let seq = SNAPSHOT_SEQ.fetch_add(1, Ordering::Relaxed);
    let snapshot = std::env::temp_dir().join(format!("pdf_panda_hist_{}_{}.pdf", std::process::id(), seq));
    fs::copy(PathBuf::from(&source), &snapshot).map_err(|e| e.to_string())?;
    Ok(snapshot.to_string_lossy().into_owned())
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
            get_annotations,
            open_working_copy,
            save_working_copy,
            discard_working_copy,
            snapshot_pdf
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
    fn insert_pdf_rejects_invalid_source_range() {
        let dest = save(&mut build_pdf(2), "insert_dest_range");
        let src = save(&mut build_pdf(2), "insert_src_range");
        let err = insert_pdf(dest.clone(), src.clone(), 1, 1, 0).unwrap_err();
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
    fn move_page_rejects_invalid_index() {
        let path = save(&mut build_pdf(2), "move_invalid");
        let err = move_page(path.clone(), 0, 9).unwrap_err();
        assert!(err.contains("Index out of bounds"));
        let _ = std::fs::remove_file(&path);
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
