use lopdf::{Document, Object, ObjectId};

/// Viewer render size — must stay aligned with `BASE_W` / `BASE_H` in `App.tsx`.
pub const VIEWER_PAGE_W: f64 = 800.0;
pub const VIEWER_PAGE_H: f64 = 1132.0;

/// Coerce a PDF numeric object to f64.
pub fn obj_to_f64(o: &Object) -> f64 {
    match o {
        Object::Real(r) => *r as f64,
        Object::Integer(i) => *i as f64,
        _ => 0.0,
    }
}

pub fn page_media_box(doc: &Document, page_id: ObjectId) -> Result<[f64; 4], String> {
    let page = doc.get_dictionary(page_id).map_err(|e| e.to_string())?;
    let arr = page.get(b"MediaBox").map_err(|e| e.to_string())?.as_array().map_err(|_| "Bad MediaBox")?;
    let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
    Ok([get(0), get(1), get(2), get(3)])
}

pub fn viewer_rect_to_pdf(
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
