use std::collections::BTreeMap;

use lopdf::{Document, Object, ObjectId};

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
