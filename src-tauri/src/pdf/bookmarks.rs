use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PdfBookmarkEntry {
    pub title: String,
    pub depth: u32,
    pub page_index: Option<u32>,
}

pub fn page_index_for_object(doc: &Document, object_id: ObjectId) -> Option<u32> {
    doc.get_pages().iter().find(|(_, id)| **id == object_id).map(|(num, _)| num - 1)
}

pub fn outline_title(dict: &Dictionary) -> String {
    dict.get(b"Title")
        .ok()
        .and_then(|value| value.as_str().ok())
        .map(|value| String::from_utf8_lossy(value).into_owned())
        .unwrap_or_else(|| "Untitled".to_string())
}

pub fn resolve_dest_object(doc: &Document, dest: &Object) -> Option<u32> {
    match dest {
        Object::Array(items) if !items.is_empty() => {
            items[0].as_reference().ok().and_then(|id| page_index_for_object(doc, id))
        }
        Object::String(name, _) | Object::Name(name) => resolve_named_dest(doc, name.as_slice()),
        Object::Reference(id) => page_index_for_object(doc, *id),
        _ => None,
    }
}

pub fn resolve_named_dest(doc: &Document, name: &[u8]) -> Option<u32> {
    let catalog = doc.catalog().ok()?;
    let dests_id = catalog.get(b"Dests").ok()?.as_reference().ok()?;
    let dests = doc.get_dictionary(dests_id).ok()?;
    let names = dests.get(b"Names").ok()?.as_array().ok()?;
    let mut index = 0usize;
    while index + 1 < names.len() {
        let matches = names[index].as_str().ok().is_some_and(|value| value == name);
        if matches {
            return resolve_dest_object(doc, &names[index + 1]);
        }
        index += 2;
    }
    None
}

pub fn resolve_outline_destination(doc: &Document, dict: &Dictionary) -> Option<u32> {
    if let Ok(dest) = dict.get(b"Dest") {
        if let Some(page_index) = resolve_dest_object(doc, dest) {
            return Some(page_index);
        }
    }
    let action = dict.get(b"A").ok()?.as_dict().ok()?;
    let subtype = action.get(b"S").ok().and_then(|value| value.as_name().ok());
    if subtype != Some(b"GoTo".as_slice()) {
        return None;
    }
    resolve_dest_object(doc, action.get(b"D").ok()?)
}

pub fn collect_outline_items(doc: &Document, item_id: ObjectId, depth: u32, entries: &mut Vec<PdfBookmarkEntry>) {
    let mut current = Some(item_id);
    while let Some(id) = current {
        let dict = match doc.get_dictionary(id) {
            Ok(dict) => dict,
            Err(_) => break,
        };
        entries.push(PdfBookmarkEntry {
            title: outline_title(dict),
            depth,
            page_index: resolve_outline_destination(doc, dict),
        });
        if let Ok(first) = dict.get(b"First") {
            if let Ok(child_id) = first.as_reference() {
                collect_outline_items(doc, child_id, depth + 1, entries);
            }
        }
        current = dict.get(b"Next").ok().and_then(|value| value.as_reference().ok());
    }
}

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
