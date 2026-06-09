use lopdf::{Dictionary, Document, Object, ObjectId};

/// Attributes a leaf page can inherit from ancestor /Pages nodes.
pub const INHERITABLE_PAGE_KEYS: [&[u8]; 4] = [b"MediaBox", b"CropBox", b"Resources", b"Rotate"];

pub fn is_page_dict(d: &Dictionary) -> bool {
    d.get(b"Type").ok().and_then(|o| o.as_name().ok()).map(|n| n == b"Page").unwrap_or(false)
}

pub fn inherited_page_attr(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Object> {
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

pub fn get_pages_kids(doc: &Document) -> Result<(Vec<Object>, ObjectId), String> {
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

pub fn set_pages_kids(doc: &mut Document, pages_ref: ObjectId, kids: Vec<Object>) -> Result<(), String> {
    let count = kids.len() as i64;
    let dict = doc.get_dictionary_mut(pages_ref).map_err(|e| e.to_string())?;
    dict.set(b"Kids", Object::Array(kids));
    dict.set(b"Count", Object::Integer(count));
    Ok(())
}

/// Collapse a (possibly nested) page tree so every leaf page is a direct child of
/// the root /Pages node. Returns the root /Pages id.
pub fn flatten_pages(doc: &mut Document) -> Result<ObjectId, String> {
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

/// Delete inclusive 0-based kid indices from the flat page tree. At least one page must remain.
pub fn delete_kids_in_range(doc: &mut Document, start_page: u32, end_page: u32) -> Result<u32, String> {
    let pages_ref = flatten_pages(doc)?;
    let (mut kids, _) = get_pages_kids(doc)?;
    let total = kids.len() as u32;
    if start_page >= total || end_page >= total || start_page > end_page {
        return Err(format!("Invalid page range: {start_page}-{end_page}"));
    }
    let delete_count = end_page - start_page + 1;
    if delete_count >= total {
        return Err("Cannot delete every page in the document".to_string());
    }
    kids.drain(start_page as usize..=end_page as usize);
    set_pages_kids(doc, pages_ref, kids)?;
    Ok(delete_count)
}
