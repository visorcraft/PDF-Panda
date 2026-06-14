use std::path::Path;

use crate::pdf::coords::obj_to_f64;
use crate::pdf::page_tree::set_pages_kids;
use crate::{PrintDocumentResult, PrintMargins, PrintOptions, PrinterInfo};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

pub fn list_printers() -> Vec<PrinterInfo> {
    use printers::{get_default_printer, get_printers};

    let default_name = get_default_printer().map(|p| p.system_name.clone()).unwrap_or_default();

    get_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            system_name: p.system_name.clone(),
            display_name: if p.name.is_empty() { p.system_name.clone() } else { p.name.clone() },
            is_default: p.system_name == default_name,
            driver_name: p.driver_name,
        })
        .collect()
}

pub fn print_document(source_path: &Path, opts: &PrintOptions, temp_dir: &Path) -> Result<PrintDocumentResult, String> {
    let printer_name = opts.printer_name.as_ref().ok_or("Printer name is required")?;
    let copies = opts.copies.ok_or("Copies is required")?;
    let duplex = opts.duplex.as_deref().ok_or("Duplex is required")?;

    let doc = Document::load(source_path).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len() as u32;
    let selected = parse_page_range(opts.page_range.as_deref(), page_count)?;

    let temp_name = format!(
        "print_{}_{}.pdf",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()
    );
    let temp_path = temp_dir.join(temp_name);
    #[cfg(target_os = "windows")]
    let mut guard = TempFileGuard::new(&temp_path);
    #[cfg(not(target_os = "windows"))]
    let guard = TempFileGuard::new(&temp_path);
    build_print_pdf(source_path, opts, &selected, &temp_path)?;

    #[cfg(target_os = "windows")]
    {
        open_pdf_for_manual_print(&temp_path)?;
        guard.disarm();
        Ok(PrintDocumentResult::WindowsFallback { temp_path: temp_path.to_string_lossy().into_owned() })
    }

    #[cfg(not(target_os = "windows"))]
    {
        use printers::common::base::job::PrinterJobOptions;
        use printers::common::converters::Converter;
        use printers::get_printer_by_name;

        let printer =
            get_printer_by_name(printer_name).ok_or_else(|| format!("Printer not found: {}", printer_name))?;

        let copies_str = copies.to_string();
        let mut props: Vec<(&str, &str)> = vec![("copies", &copies_str), ("media", &opts.paper_size)];
        let sides = match duplex {
            "simplex" => "one-sided",
            "longEdge" => "two-sided-long-edge",
            "shortEdge" => "two-sided-short-edge",
            _ => "one-sided",
        };
        props.push(("sides", sides));

        let job_id = printer
            .print_file(
                temp_path.to_str().ok_or("Temp path is not valid UTF-8")?,
                PrinterJobOptions {
                    name: Some("PDF Panda print job"),
                    raw_properties: &props,
                    converter: Converter::None,
                },
            )
            .map_err(|e| format!("Print failed: {:?}", e))?;

        Ok(PrintDocumentResult::DirectJob { job_id })
    }
}

struct TempFileGuard<'a> {
    path: &'a Path,
    disarmed: bool,
}

impl<'a> TempFileGuard<'a> {
    fn new(path: &'a Path) -> Self {
        Self { path, disarmed: false }
    }

    fn disarm(&mut self) {
        self.disarmed = true;
    }
}

impl<'a> Drop for TempFileGuard<'a> {
    fn drop(&mut self) {
        if !self.disarmed {
            let _ = std::fs::remove_file(self.path);
        }
    }
}

#[cfg(target_os = "windows")]
fn open_pdf_for_manual_print(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::ShellExecuteExW;
    use windows::Win32::UI::Shell::SEE_MASK_NOCLOSEPROCESS;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let operation: Vec<u16> = "print\0".encode_utf16().collect();
    let mut info = windows::Win32::UI::Shell::SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<windows::Win32::UI::Shell::SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: windows::core::PCWSTR(operation.as_ptr()),
        lpFile: windows::core::PCWSTR(wide.as_ptr()),
        nShow: SW_SHOWNORMAL.0 as i32,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn print_to_pdf(source_path: &Path, opts: &PrintOptions, output_path: &Path) -> Result<(), String> {
    let doc = Document::load(source_path).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len() as u32;
    let selected = parse_page_range(opts.page_range.as_deref(), page_count)?;
    build_print_pdf(source_path, opts, &selected, output_path)?;
    Ok(())
}

pub fn render_print_preview(
    source_path: &Path,
    page_index: u32,
    opts: &PrintOptions,
    width: i32,
    height: i32,
    temp_dir: &Path,
) -> Result<Vec<u8>, String> {
    // TODO: Task 9
    let _ = (source_path, page_index, opts, width, height, temp_dir);
    Err("not implemented".into())
}

/// Build a transformed print PDF from the source, laying out the selected pages
/// onto the requested paper size with scaling, margins, and orientation applied.
pub fn build_print_pdf(
    source_path: &Path,
    opts: &PrintOptions,
    selected_pages: &[u32],
    output_path: &Path,
) -> Result<(), String> {
    let mut doc = Document::load(source_path).map_err(|e| e.to_string())?;

    apply_redactions_for_print(&mut doc)?;
    flatten_annotations_for_print(&mut doc)?;

    let target_size = paper_size_in_points(&opts.paper_size, &opts.orientation)?;

    let new_page_ids: Vec<ObjectId> = selected_pages
        .iter()
        .map(|&idx| {
            let page_id = *doc.get_pages().get(&(idx + 1)).ok_or_else(|| format!("Page index out of bounds: {idx}"))?;
            transform_page_for_print(&mut doc, page_id, target_size, opts)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let pages_ref = {
        let catalog = doc.catalog().map_err(|e| e.to_string())?;
        catalog
            .get(b"Pages")
            .map_err(|_| "No Pages entry in catalog".to_string())?
            .as_reference()
            .map_err(|_| "Pages entry is not a reference".to_string())?
    };

    for &page_id in &new_page_ids {
        if let Ok(dict) = doc.get_dictionary_mut(page_id) {
            dict.set(b"Parent", Object::Reference(pages_ref));
        }
    }

    let new_kids: Vec<Object> = new_page_ids.iter().map(|id| Object::Reference(*id)).collect();
    set_pages_kids(&mut doc, pages_ref, new_kids)?;

    if let Ok(catalog) = doc.catalog_mut() {
        catalog.remove(b"AcroForm");
    }

    doc.save(output_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// v1 stub: no-op placeholder for redaction application during print.
pub fn apply_redactions_for_print(_doc: &mut Document) -> Result<(), String> {
    Ok(())
}

/// v1 stub: no-op placeholder for annotation flattening during print.
pub fn flatten_annotations_for_print(_doc: &mut Document) -> Result<(), String> {
    Ok(())
}

/// Return the page dimensions in PDF points for the requested paper size.
/// Orientation may be "portrait" or "landscape" (case-insensitive).
pub fn paper_size_in_points(paper_size: &str, orientation: &str) -> Result<(f64, f64), String> {
    let (w, h) = match paper_size.to_lowercase().as_str() {
        "a4" => (595.0, 842.0),
        "letter" => (612.0, 792.0),
        "legal" => (612.0, 1008.0),
        _ => return Err(format!("Unsupported paper size: {paper_size}")),
    };
    if orientation.eq_ignore_ascii_case("landscape") {
        Ok((h, w))
    } else {
        Ok((w, h))
    }
}

fn margins_to_array(margins: &PrintMargins) -> [f64; 4] {
    match margins {
        PrintMargins::None => [0.0, 0.0, 0.0, 0.0],
        PrintMargins::Default => [36.0, 36.0, 36.0, 36.0],
        PrintMargins::Custom { top, right, bottom, left } => [*top, *right, *bottom, *left],
    }
}

fn compute_scale(page_w: f64, page_h: f64, available_w: f64, available_h: f64, scaling: &str) -> f64 {
    match scaling.to_lowercase().as_str() {
        "fit" | "shrinktofit" | "fittopage" => {
            if page_w <= 0.0 || page_h <= 0.0 {
                return 1.0;
            }
            let sx = available_w / page_w;
            let sy = available_h / page_h;
            sx.min(sy)
        }
        "fill" => {
            if page_w <= 0.0 || page_h <= 0.0 {
                return 1.0;
            }
            let sx = available_w / page_w;
            let sy = available_h / page_h;
            sx.max(sy)
        }
        _ => 1.0,
    }
}

/// Clone the source page, apply scaling/translation so its content fits the
/// target paper size, and return the new page object id.
fn transform_page_for_print(
    doc: &mut Document,
    page_id: ObjectId,
    target_size: (f64, f64),
    opts: &PrintOptions,
) -> Result<ObjectId, String> {
    let mut page_dict = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.clone();

    let media = page_dict
        .get(b"MediaBox")
        .map_err(|_| "Page MediaBox missing".to_string())?
        .as_array()
        .map_err(|_| "Bad MediaBox".to_string())?
        .clone();
    if media.len() < 4 {
        return Err("MediaBox has fewer than 4 values".to_string());
    }
    let media_rect = [obj_to_f64(&media[0]), obj_to_f64(&media[1]), obj_to_f64(&media[2]), obj_to_f64(&media[3])];
    let page_w = media_rect[2] - media_rect[0];
    let page_h = media_rect[3] - media_rect[1];

    let margins = margins_to_array(&opts.margins);
    let (target_w, target_h) = target_size;
    let available_w = (target_w - margins[1] - margins[3]).max(0.0);
    let available_h = (target_h - margins[0] - margins[2]).max(0.0);

    let scale = compute_scale(page_w, page_h, available_w, available_h, &opts.scaling);
    let scaled_w = page_w * scale;
    let scaled_h = page_h * scale;
    let tx = margins[3] + (available_w - scaled_w) / 2.0;
    let ty = margins[2] + (available_h - scaled_h) / 2.0;

    let mut new_content = Vec::new();
    new_content.extend_from_slice(b"q\n");

    if opts.color_mode.eq_ignore_ascii_case("grayscale") {
        new_content.extend_from_slice(b"/DeviceGray CS /DeviceGray cs\n");
    }

    new_content.extend_from_slice(format!("{scale:.6} 0 0 {scale:.6} {tx:.6} {ty:.6} cm\n").as_bytes());

    let existing = collect_page_content_bytes(doc, page_id)?;
    new_content.extend_from_slice(&existing);
    new_content.extend_from_slice(b"\nQ");

    let content_stream = Stream::new(Dictionary::new(), new_content);
    let content_id = doc.add_object(Object::Stream(content_stream));

    page_dict.set(b"Contents", Object::Reference(content_id));
    page_dict.set(
        b"MediaBox",
        Object::Array(vec![
            Object::Real(0.0),
            Object::Real(0.0),
            Object::Real(target_w as f32),
            Object::Real(target_h as f32),
        ]),
    );
    page_dict.remove(b"Annots");
    page_dict.remove(b"Parent");

    let new_page_id = doc.add_object(Object::Dictionary(page_dict));
    Ok(new_page_id)
}

fn stream_decompressed_bytes(stream: &Stream) -> Vec<u8> {
    let mut s = stream.clone();
    match s.decompress() {
        Ok(()) => s.content,
        Err(_) => stream.content.clone(),
    }
}

fn collect_page_content_bytes(doc: &Document, page_id: ObjectId) -> Result<Vec<u8>, String> {
    let contents = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.get(b"Contents").ok().cloned();

    let mut out = Vec::new();
    match contents {
        Some(Object::Reference(id)) => {
            let obj = doc.get_object(id).map_err(|e| e.to_string())?;
            if let Object::Stream(stream) = obj {
                out.extend_from_slice(&stream_decompressed_bytes(stream));
            }
        }
        Some(Object::Array(arr)) => {
            for item in arr {
                let id = item.as_reference().map_err(|_| "Bad content reference".to_string())?;
                let obj = doc.get_object(id).map_err(|e| e.to_string())?;
                if let Object::Stream(stream) = obj {
                    out.extend_from_slice(&stream_decompressed_bytes(stream));
                }
            }
        }
        _ => {}
    }
    Ok(out)
}

fn parse_page_range(range: Option<&str>, page_count: u32) -> Result<Vec<u32>, String> {
    let indices: Vec<u32> = (0..page_count).collect();
    let Some(spec) = range else {
        return Ok(indices);
    };
    let spec = spec.trim();
    if spec.is_empty() || spec.eq_ignore_ascii_case("all") {
        return Ok(indices);
    }

    let mut out = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start, end)) = part.split_once('-') {
            let start: u32 = start.trim().parse().map_err(|_| format!("Invalid range: {}", part))?;
            let end: u32 = end.trim().parse().map_err(|_| format!("Invalid range: {}", part))?;
            if start == 0 || end < start || end > page_count {
                return Err(format!("Range out of bounds: {}", part));
            }
            out.extend((start - 1)..end);
        } else {
            let idx: u32 = part.parse().map_err(|_| format!("Invalid page: {}", part))?;
            if idx == 0 || idx > page_count {
                return Err(format!("Page out of bounds: {}", part));
            }
            out.push(idx - 1);
        }
    }
    if out.is_empty() {
        return Err("No pages selected".into());
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn minimal_blank_pdf(path: &Path) {
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        doc.objects.insert(content_id, Object::Stream(Stream::new(Dictionary::new(), b"BT ET".to_vec())));
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
        page.set("Contents", Object::Reference(content_id));
        doc.objects.insert(page_id, Object::Dictionary(page));
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc.save(path).unwrap();
    }

    #[test]
    fn parse_page_range_all() {
        assert_eq!(parse_page_range(Some("all"), 5).unwrap(), vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn parse_page_range_comma_and_dash() {
        assert_eq!(parse_page_range(Some("1-3,5"), 5).unwrap(), vec![0, 1, 2, 4]);
    }

    #[test]
    fn build_print_pdf_a4_landscape() {
        let dir = std::env::temp_dir().join("pdf_panda_print_test");
        let _ = fs::create_dir_all(&dir);
        let source = dir.join("source.pdf");
        let output = dir.join("output.pdf");

        minimal_blank_pdf(&source);

        let opts = PrintOptions {
            page_range: None,
            orientation: "landscape".to_string(),
            paper_size: "a4".to_string(),
            scaling: "fit".to_string(),
            margins: PrintMargins::None,
            color_mode: "color".to_string(),
            printer_name: None,
            copies: None,
            duplex: None,
        };

        build_print_pdf(&source, &opts, &[0], &output).unwrap();

        let doc = Document::load(&output).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let media = doc.get_dictionary(page_id).unwrap().get(b"MediaBox").unwrap().as_array().unwrap();
        let w = obj_to_f64(&media[2]) - obj_to_f64(&media[0]);
        let h = obj_to_f64(&media[3]) - obj_to_f64(&media[1]);
        assert!((w - 842.0).abs() < 0.1, "expected width ~842, got {w}");
        assert!((h - 595.0).abs() < 0.1, "expected height ~595, got {h}");

        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn print_to_pdf_creates_file() {
        let dir = std::env::temp_dir().join("pdf_panda_print_test");
        let _ = fs::create_dir_all(&dir);
        let source = dir.join("source.pdf");
        let output = dir.join("print_output.pdf");

        minimal_blank_pdf(&source);

        let opts = PrintOptions {
            page_range: None,
            orientation: "portrait".to_string(),
            paper_size: "Letter".to_string(),
            scaling: "fitToPage".to_string(),
            margins: PrintMargins::Default,
            color_mode: "color".to_string(),
            printer_name: None,
            copies: None,
            duplex: None,
        };

        print_to_pdf(&source, &opts, &output).unwrap();
        assert!(output.exists());

        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(&output);
    }
}
