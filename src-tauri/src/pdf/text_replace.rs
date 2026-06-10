use crate::pdf::content::append_page_content;
use crate::pdf::coords::viewer_rect_to_pdf;
use crate::pdf::io::mutate_pdf;
#[cfg(test)]
use crate::pdf::page_text::read_page_content;
use crate::pdf::page_text::{ensure_helvetica_font, escape_pdf_literal_string};
use std::path::Path;

/// White-out a viewer-pixel region and draw replacement text on top (append-only).
#[allow(clippy::too_many_arguments)]
pub fn replace_text_region(
    path: &Path,
    page_index: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    new_text: &str,
    font_size: f64,
) -> Result<(), String> {
    let trimmed = new_text.trim();
    if trimmed.is_empty() {
        return Err("Text cannot be empty".to_string());
    }
    if !(6.0..=72.0).contains(&font_size) {
        return Err("Font size must be between 6 and 72".to_string());
    }
    mutate_pdf(path, |doc| {
        let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or_else(|| "Page not found".to_string())?;
        let (px, py, pw, ph) = viewer_rect_to_pdf(doc, page_id, x, y, w, h)?;
        let whiteout = format!("q 1 1 1 rg {px} {py} {pw} {ph} re f Q\n");
        append_page_content(doc, page_id, whiteout.as_bytes())?;

        let font_name = ensure_helvetica_font(doc, page_id)?;
        let escaped = escape_pdf_literal_string(trimmed);
        let descent = font_size * 0.2;
        let text_ops = format!(
            "BT /{font_name} {font_size} Tf 1 0 0 1 {tx} {ty} Tm ({escaped}) Tj ET\n",
            font_name = font_name,
            font_size = font_size,
            tx = px,
            ty = py + descent,
            escaped = escaped,
        );
        append_page_content(doc, page_id, text_ops.as_bytes())?;
        Ok(())
    })
}

/// Read page content as UTF-8 lossy string (test helper).
#[cfg(test)]
pub fn page_content_string(path: &Path, page_index: u32) -> Result<String, String> {
    let doc = lopdf::Document::load(path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or_else(|| "Page not found".to_string())?;
    Ok(String::from_utf8_lossy(&read_page_content(&doc, page_id)?).into_owned())
}
