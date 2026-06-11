use std::collections::BTreeMap;

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

static EMBEDDED_FONT_BYTES: &[u8] = include_bytes!("../../vendor/fonts/LiberationSans-Regular.ttf");
static FONT_RESOURCE_NAME: &str = "PPFullFont";
static FONT_BASE_NAME: &str = "LiberationSans";

/// Check whether every character in `text` has a glyph in the bundled font.
pub fn font_has_glyphs_for(text: &str) -> bool {
    let Ok(face) = ttf_parser::Face::parse(EMBEDDED_FONT_BYTES, 0) else {
        return false;
    };
    for ch in text.chars() {
        if face.glyph_index(ch).is_none() {
            return false;
        }
    }
    true
}

/// Ensure the page (and document) has the embedded full font available.
/// Returns the resource name to use in text operators (e.g. "/PPFullFont").
pub fn ensure_full_font(doc: &mut Document, page_id: ObjectId) -> Result<String, String> {
    // Check whether the font is already embedded in this document.
    if let Some(existing_id) = find_embedded_font_id(doc) {
        // Ensure the page's Resources / Font dict references it.
        add_font_to_page_resources(doc, page_id, existing_id)?;
        return Ok(FONT_RESOURCE_NAME.to_string());
    }

    let face =
        ttf_parser::Face::parse(EMBEDDED_FONT_BYTES, 0).map_err(|e| format!("Failed to parse embedded font: {e:?}"))?;

    let bbox = face.global_bounding_box();
    let ascent = face.ascender();
    let descent = face.descender();
    let cap_height = face.capital_height().unwrap_or(ascent);
    let stem_v = ((bbox.x_max - bbox.x_min) as f64 * 0.13).round() as i64;

    // Font stream
    let font_stream = Stream::new(
        Dictionary::from_iter(vec![(b"Length1".to_vec(), Object::Integer(EMBEDDED_FONT_BYTES.len() as i64))]),
        EMBEDDED_FONT_BYTES.to_vec(),
    );
    let font_file_id = doc.add_object(Object::Stream(font_stream));

    // Font descriptor
    let font_descriptor = Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"FontDescriptor".to_vec())),
        (b"FontName".to_vec(), Object::Name(FONT_BASE_NAME.as_bytes().to_vec())),
        (b"Flags".to_vec(), Object::Integer(32)),
        (
            b"FontBBox".to_vec(),
            Object::Array(vec![
                Object::Integer(bbox.x_min as i64),
                Object::Integer(bbox.y_min as i64),
                Object::Integer(bbox.x_max as i64),
                Object::Integer(bbox.y_max as i64),
            ]),
        ),
        (b"ItalicAngle".to_vec(), Object::Integer(0)),
        (b"Ascent".to_vec(), Object::Integer(ascent as i64)),
        (b"Descent".to_vec(), Object::Integer(descent as i64)),
        (b"CapHeight".to_vec(), Object::Integer(cap_height as i64)),
        (b"StemV".to_vec(), Object::Integer(stem_v)),
        (b"FontFile2".to_vec(), Object::Reference(font_file_id)),
    ]);
    let font_descriptor_id = doc.add_object(Object::Dictionary(font_descriptor));

    // Font dictionary
    let font_dict = Dictionary::from_iter(vec![
        (b"Type".to_vec(), Object::Name(b"Font".to_vec())),
        (b"Subtype".to_vec(), Object::Name(b"TrueType".to_vec())),
        (b"BaseFont".to_vec(), Object::Name(FONT_BASE_NAME.as_bytes().to_vec())),
        (b"FontDescriptor".to_vec(), Object::Reference(font_descriptor_id)),
        (b"Encoding".to_vec(), Object::Name(b"WinAnsiEncoding".to_vec())),
    ]);
    let font_id = doc.add_object(Object::Dictionary(font_dict));

    add_font_to_page_resources(doc, page_id, font_id)?;
    Ok(FONT_RESOURCE_NAME.to_string())
}

fn find_embedded_font_id(doc: &Document) -> Option<ObjectId> {
    for (id, obj) in &doc.objects {
        let Ok(dict) = obj.as_dict() else { continue };
        if dict.get(b"Type").ok()?.as_name().ok()? != b"Font" {
            continue;
        }
        if dict.get(b"Subtype").ok()?.as_name().ok()? != b"TrueType" {
            continue;
        }
        if let Ok(base) = dict.get(b"BaseFont").ok()?.as_name() {
            if base == FONT_BASE_NAME.as_bytes() {
                return Some(*id);
            }
        }
    }
    None
}

fn add_font_to_page_resources(doc: &mut Document, page_id: ObjectId, font_id: ObjectId) -> Result<(), String> {
    let page_dict = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
    if !matches!(page_dict.get(b"Resources"), Ok(Object::Dictionary(_))) {
        page_dict.set(b"Resources", Object::Dictionary(Dictionary::new()));
    }
    let resources = page_dict
        .get_mut(b"Resources")
        .map_err(|e| e.to_string())?
        .as_dict_mut()
        .map_err(|_| "Bad Resources".to_string())?;
    if !matches!(resources.get(b"Font"), Ok(Object::Dictionary(_))) {
        resources.set(b"Font", Object::Dictionary(Dictionary::new()));
    }
    let fonts = resources
        .get_mut(b"Font")
        .map_err(|e| e.to_string())?
        .as_dict_mut()
        .map_err(|_| "Bad Font dict".to_string())?;
    fonts.set(FONT_RESOURCE_NAME.as_bytes(), Object::Reference(font_id));
    Ok(())
}

pub fn page_font_entries(doc: &Document, page_id: ObjectId) -> Vec<(Vec<u8>, ObjectId)> {
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

pub fn dedup_fonts_after_insert(doc: &mut Document, inserted_page_ids: &[ObjectId]) -> Result<u32, String> {
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
