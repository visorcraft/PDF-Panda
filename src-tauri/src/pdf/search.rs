use pdfium_render::prelude::*;
use serde::Serialize;
use std::path::Path;

pub const SEARCH_RENDER_W: i32 = 800;
pub const SEARCH_RENDER_H: i32 = 1132;

#[derive(Debug, Serialize)]
pub struct PdfTextSearchMatch {
    pub page_index: u32,
    pub match_index: u32,
    pub rect: [f64; 4],
}

pub fn pdf_rect_to_search_pixels(rect: PdfRect, page_w: f32, page_h: f32) -> [f64; 4] {
    let sw = SEARCH_RENDER_W as f64;
    let sh = SEARCH_RENDER_H as f64;
    let pw = f64::from(page_w).max(1.0);
    let ph = f64::from(page_h).max(1.0);
    let left = f64::from(rect.left().value) / pw * sw;
    let right = f64::from(rect.right().value) / pw * sw;
    let top = (ph - f64::from(rect.top().value)) / ph * sh;
    let bottom = (ph - f64::from(rect.bottom().value)) / ph * sh;
    [left, top, right, bottom]
}

pub fn union_search_bounds(segments: &PdfPageTextSegments<'_>) -> Result<PdfRect, String> {
    let mut bounds: Option<(f32, f32, f32, f32)> = None;
    for idx in segments.as_range() {
        let seg = segments.get(idx).map_err(|e| e.to_string())?;
        let b = seg.bounds();
        let l = b.left().value;
        let r = b.right().value;
        let bo = b.bottom().value;
        let t = b.top().value;
        bounds = Some(match bounds {
            None => (l, bo, r, t),
            Some((ul, ubo, ur, ut)) => (ul.min(l), ubo.min(bo), ur.max(r), ut.max(t)),
        });
    }
    let (l, bo, r, t) = bounds.ok_or_else(|| "Empty search result".to_string())?;
    Ok(PdfRect::new(PdfPoints::new(bo), PdfPoints::new(l), PdfPoints::new(t), PdfPoints::new(r)))
}

pub fn search_pdf_text(
    pdfium: &Pdfium,
    path: &Path,
    query: &str,
    match_case: bool,
    match_whole_word: bool,
) -> Result<Vec<PdfTextSearchMatch>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Search query is empty".to_string());
    }
    if !path.is_file() {
        return Err("File not found".to_string());
    }

    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let options = PdfSearchOptions::new().match_case(match_case).match_whole_word(match_whole_word);
    let mut results = Vec::new();
    let mut match_index = 0u32;

    for (page_index, page) in document.pages().iter().enumerate() {
        let text = page.text().map_err(|e| e.to_string())?;
        let search = text.search(query, &options).map_err(|e| e.to_string())?;
        let page_w = page.width().value;
        let page_h = page.height().value;

        for segments in search.iter(PdfSearchDirection::SearchForward) {
            let bounds = union_search_bounds(&segments)?;
            results.push(PdfTextSearchMatch {
                page_index: page_index as u32,
                match_index,
                rect: pdf_rect_to_search_pixels(bounds, page_w, page_h),
            });
            match_index += 1;
        }
    }

    Ok(results)
}
