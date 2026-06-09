use lopdf::{Document, Object, ObjectId};

pub fn collect_outline_ids(doc: &Document, item_id: ObjectId, ids: &mut Vec<ObjectId>) {
    let mut current = Some(item_id);
    while let Some(id) = current {
        ids.push(id);
        if let Ok(dict) = doc.get_dictionary(id) {
            if let Ok(first) = dict.get(b"First") {
                if let Ok(child_id) = first.as_reference() {
                    collect_outline_ids(doc, child_id, ids);
                }
            }
            current = dict.get(b"Next").ok().and_then(|value| value.as_reference().ok());
        } else {
            break;
        }
    }
}

pub fn flat_outline_ids(doc: &Document) -> Result<Vec<ObjectId>, String> {
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
    let mut ids = Vec::new();
    collect_outline_ids(doc, first_id, &mut ids);
    Ok(ids)
}

pub fn remove_outline_item(doc: &mut Document, outlines_id: ObjectId, item_id: ObjectId) -> Result<(), String> {
    let dict = doc.get_dictionary(item_id).map_err(|e| e.to_string())?;
    if dict.get(b"First").ok().and_then(|o| o.as_reference().ok()).is_some() {
        return Err("Remove child bookmarks first".to_string());
    }
    let prev_id = dict.get(b"Prev").ok().and_then(|o| o.as_reference().ok());
    let next_id = dict.get(b"Next").ok().and_then(|o| o.as_reference().ok());
    if let Some(prev_id) = prev_id {
        if let Ok(Object::Dictionary(prev)) = doc.get_object_mut(prev_id) {
            if let Some(next_id) = next_id {
                prev.set("Next", Object::Reference(next_id));
            } else {
                prev.remove(b"Next");
            }
        }
    }
    if let Some(next_id) = next_id {
        if let Ok(Object::Dictionary(next)) = doc.get_object_mut(next_id) {
            if let Some(prev_id) = prev_id {
                next.set("Prev", Object::Reference(prev_id));
            } else {
                next.remove(b"Prev");
            }
        }
    }
    let outlines = doc.get_dictionary_mut(outlines_id).map_err(|e| e.to_string())?;
    let first_id = outlines.get(b"First").ok().and_then(|o| o.as_reference().ok());
    let last_id = outlines.get(b"Last").ok().and_then(|o| o.as_reference().ok());
    if first_id == Some(item_id) {
        if let Some(next_id) = next_id {
            outlines.set("First", Object::Reference(next_id));
        } else {
            outlines.remove(b"First");
            outlines.remove(b"Last");
        }
    }
    if last_id == Some(item_id) {
        if let Some(prev_id) = prev_id {
            outlines.set("Last", Object::Reference(prev_id));
        }
    }
    let count = outlines.get(b"Count").ok().and_then(|o| o.as_i64().ok()).unwrap_or(1);
    if count <= 1 {
        outlines.remove(b"Count");
        outlines.remove(b"First");
        outlines.remove(b"Last");
        let catalog_id = doc.trailer.get(b"Root").map_err(|e| e.to_string())?.as_reference().map_err(|_| "Bad Root")?;
        doc.get_dictionary_mut(catalog_id).map_err(|e| e.to_string())?.remove(b"Outlines");
    } else {
        outlines.set("Count", Object::Integer(count - 1));
    }
    doc.objects.remove(&item_id);
    Ok(())
}
