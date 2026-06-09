use pdfium_render::prelude::*;
use std::path::Path;

/// Render one PDF page to encoded image bytes at the given dimensions.
pub fn render_page_bytes(
    pdfium: &Pdfium,
    path: &Path,
    page_index: u32,
    width: i32,
    height: i32,
    format: image::ImageFormat,
) -> Result<Vec<u8>, String> {
    let document = pdfium.load_pdf_from_file(path, None).map_err(|e| e.to_string())?;
    let page = document.pages().get(page_index as PdfPageIndex).map_err(|e| e.to_string())?;
    let bitmap = page.render(width as Pixels, height as Pixels, None).map_err(|e| e.to_string())?;
    let image = bitmap.as_image().map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    image.write_to(&mut std::io::Cursor::new(&mut buffer), format).map_err(|e| e.to_string())?;
    Ok(buffer)
}
