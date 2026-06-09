use std::collections::BTreeMap;

use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;

use crate::pdf::coords::{obj_to_f64, page_media_box, viewer_rect_to_pdf, VIEWER_PAGE_H, VIEWER_PAGE_W};

fn pdf_object_string(obj: &Object) -> Option<String> {
    match obj {
        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
        Object::Name(name) => Some(String::from_utf8_lossy(name).to_string()),
        _ => None,
    }
}

fn pdf_rect_to_viewer(doc: &Document, page_id: ObjectId, rect: [f64; 4]) -> Result<[f64; 4], String> {
    let media = page_media_box(doc, page_id)?;
    let mw = media[2] - media[0];
    let mh = media[3] - media[1];
    if mw <= 0.0 || mh <= 0.0 {
        return Err("Invalid page size".to_string());
    }
    let x1 = (rect[0] - media[0]) * VIEWER_PAGE_W / mw;
    let x2 = (rect[2] - media[0]) * VIEWER_PAGE_W / mw;
    let y1 = (media[3] - rect[3]) * VIEWER_PAGE_H / mh;
    let y2 = (media[3] - rect[1]) * VIEWER_PAGE_H / mh;
    Ok([x1, y1, x2, y2])
}

fn pdf_rect_array(dict: &Dictionary) -> Option<[f64; 4]> {
    let arr = dict.get(b"Rect").ok()?.as_array().ok()?;
    let get = |i: usize| arr.get(i).map(obj_to_f64).unwrap_or(0.0);
    Some([get(0), get(1), get(2), get(3)])
}

fn btn_field_kind(dict: &Dictionary) -> &'static str {
    let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
    if ff & (1 << 16) != 0 {
        return "radio";
    }
    if ff & (1 << 17) != 0 {
        return "button";
    }
    "checkbox"
}

fn field_type_label(dict: &Dictionary) -> String {
    match dict.get(b"FT").ok().and_then(|o| o.as_name().ok()) {
        Some(b"Tx") => "text".to_string(),
        Some(b"Btn") => btn_field_kind(dict).to_string(),
        Some(b"Ch") => "choice".to_string(),
        Some(b"Sig") => "signature".to_string(),
        _ => "unknown".to_string(),
    }
}

pub fn field_type_label_for(doc: &Document, id: ObjectId) -> String {
    let Some(dict) = resolve_field_dict(doc, id) else {
        return "unknown".to_string();
    };
    if let Ok(Object::Reference(parent_id)) = dict.get(b"Parent") {
        if let Some(parent) = resolve_field_dict(doc, *parent_id) {
            let ff = parent.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
            if ff & (1 << 16) != 0 {
                return "radio".to_string();
            }
        }
    }
    field_type_label(dict)
}

fn field_value_string(dict: &Dictionary) -> String {
    dict.get(b"V").ok().and_then(pdf_object_string).unwrap_or_default()
}

fn field_is_checked(dict: &Dictionary) -> bool {
    match dict.get(b"V").ok() {
        Some(Object::Name(name)) => name != b"Off",
        Some(other) => pdf_object_string(other).is_some_and(|v| !v.is_empty() && !v.eq_ignore_ascii_case("off")),
        None => dict.get(b"AS").ok().and_then(|o| o.as_name().ok()).is_some_and(|n| n != b"Off"),
    }
}

fn field_choice_options(dict: &Dictionary) -> Vec<String> {
    let Some(Object::Array(opts)) = dict.get(b"Opt").ok() else {
        return Vec::new();
    };
    opts.iter()
        .filter_map(|entry| match entry {
            Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
            Object::Array(pair) if pair.len() >= 2 => pair.get(1).and_then(pdf_object_string),
            _ => None,
        })
        .collect()
}

fn page_index_for_annotation(doc: &Document, annot_id: ObjectId) -> Option<u32> {
    for (page_num, page_id) in doc.get_pages() {
        let page = doc.get_dictionary(page_id).ok()?;
        let annots = page.get(b"Annots").ok()?.as_array().ok()?;
        if annots.iter().any(|entry| matches!(entry, Object::Reference(id) if *id == annot_id)) {
            return Some(page_num.saturating_sub(1));
        }
    }
    None
}

pub fn resolve_field_dict(doc: &Document, id: ObjectId) -> Option<&Dictionary> {
    doc.get_object(id).ok()?.as_dict().ok()
}

pub fn field_partial_name(dict: &Dictionary) -> Option<String> {
    dict.get(b"T").ok().and_then(pdf_object_string)
}

fn full_field_name(doc: &Document, mut id: ObjectId) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for _ in 0..16 {
        let dict = resolve_field_dict(doc, id)?;
        if let Some(name) = field_partial_name(dict) {
            parts.push(name);
        }
        match dict.get(b"Parent") {
            Ok(Object::Reference(parent_id)) => id = *parent_id,
            _ => break,
        }
    }
    parts.reverse();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("."))
    }
}

fn collect_field_rect(doc: &Document, id: ObjectId) -> Option<[f64; 4]> {
    let dict = resolve_field_dict(doc, id)?;
    if let Some(rect) = pdf_rect_array(dict) {
        return Some(rect);
    }
    let kids = dict.get(b"Kids").ok()?.as_array().ok()?;
    for kid in kids {
        let kid_id = match kid {
            Object::Reference(kid_id) => *kid_id,
            _ => continue,
        };
        if let Some(rect) = collect_field_rect(doc, kid_id) {
            return Some(rect);
        }
    }
    None
}

fn collect_field_widget_id(doc: &Document, id: ObjectId) -> Option<ObjectId> {
    let dict = resolve_field_dict(doc, id)?;
    if dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(b"Widget") {
        return Some(id);
    }
    let kids = dict.get(b"Kids").ok()?.as_array().ok()?;
    for kid in kids {
        let kid_id = match kid {
            Object::Reference(kid_id) => *kid_id,
            _ => continue,
        };
        if let Some(widget_id) = collect_field_widget_id(doc, kid_id) {
            return Some(widget_id);
        }
    }
    None
}

fn walk_form_nodes(doc: &Document, obj: &Object, out: &mut Vec<ObjectId>) {
    let id = match obj {
        Object::Reference(id) => *id,
        _ => return,
    };
    let Some(dict) = resolve_field_dict(doc, id) else {
        return;
    };
    let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
    let is_radio_parent = ff & (1 << 16) != 0 && dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()).is_some();
    if dict.get(b"FT").is_ok() && !is_radio_parent {
        out.push(id);
    }
    if let Some(arr) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        for kid in arr {
            walk_form_nodes(doc, kid, out);
        }
    }
}

pub fn mark_acroform_need_appearances(doc: &mut Document) -> Result<(), String> {
    let catalog_id =
        doc.trailer.get(b"Root").ok().and_then(|o| o.as_reference().ok()).ok_or("No catalog".to_string())?;
    let catalog = doc.get_dictionary(catalog_id).map_err(|e| e.to_string())?;
    let acroform_id = match catalog.get(b"AcroForm") {
        Ok(Object::Reference(id)) => *id,
        _ => return Ok(()),
    };
    let acroform = doc.get_dictionary_mut(acroform_id).map_err(|e| e.to_string())?;
    acroform.set(b"NeedAppearances", Object::Boolean(true));
    Ok(())
}

fn ensure_acroform(doc: &mut Document) -> Result<ObjectId, String> {
    let catalog_id =
        doc.trailer.get(b"Root").ok().and_then(|o| o.as_reference().ok()).ok_or("No catalog".to_string())?;
    if let Ok(catalog) = doc.get_dictionary(catalog_id) {
        if let Ok(Object::Reference(id)) = catalog.get(b"AcroForm") {
            return Ok(*id);
        }
    }
    let acroform_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
        (b"Fields".to_vec(), Object::Array(vec![])),
        (b"NeedAppearances".to_vec(), Object::Boolean(true)),
    ])));
    doc.get_dictionary_mut(catalog_id).map_err(|e| e.to_string())?.set(b"AcroForm", Object::Reference(acroform_id));
    Ok(acroform_id)
}

pub fn push_acroform_field(doc: &mut Document, field_id: ObjectId) -> Result<(), String> {
    let acroform_id = ensure_acroform(doc)?;
    let acroform = doc.get_dictionary_mut(acroform_id).map_err(|e| e.to_string())?;
    match acroform.get_mut(b"Fields") {
        Ok(Object::Array(fields)) => fields.push(Object::Reference(field_id)),
        _ => {
            acroform.set(b"Fields", Object::Array(vec![Object::Reference(field_id)]));
        }
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FormFieldData {
    pub name: String,
    pub field_type: String,
    pub value: String,
    pub page_index: Option<u32>,
    pub rect: Option<[f64; 4]>,
    pub options: Vec<String>,
    pub checked: bool,
}

fn form_field_from_id(doc: &Document, id: ObjectId) -> Option<FormFieldData> {
    let dict = resolve_field_dict(doc, id)?;
    let name = full_field_name(doc, id).or_else(|| field_partial_name(dict))?;
    let field_type = field_type_label_for(doc, id);
    let value = field_value_string(dict);
    let checked = field_is_checked(dict);
    let options = field_choice_options(dict);
    let widget_id = collect_field_widget_id(doc, id).unwrap_or(id);
    let page_index = page_index_for_annotation(doc, widget_id);
    let rect = collect_field_rect(doc, id).and_then(|pdf_rect| {
        page_index
            .and_then(|idx| doc.get_pages().get(&(idx + 1)).copied())
            .and_then(|page_id| pdf_rect_to_viewer(doc, page_id, pdf_rect).ok())
    });
    Some(FormFieldData { name, field_type, value, page_index, rect, options, checked })
}

pub fn collect_form_fields(doc: &Document) -> Vec<FormFieldData> {
    let mut ids = Vec::new();
    if let Ok(catalog) = doc.catalog() {
        if let Ok(Object::Reference(acroform_id)) = catalog.get(b"AcroForm") {
            if let Ok(acroform) = doc.get_dictionary(*acroform_id) {
                if let Ok(Object::Array(fields)) = acroform.get(b"Fields") {
                    for field in fields {
                        walk_form_nodes(doc, field, &mut ids);
                    }
                }
            }
        }
    }
    if ids.is_empty() {
        for page_id in doc.get_pages().values() {
            let Ok(page) = doc.get_dictionary(*page_id) else { continue };
            let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
            for annot in annots {
                let Object::Reference(id) = annot else { continue };
                let Some(dict) = resolve_field_dict(doc, *id) else { continue };
                if dict.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(b"Widget")
                    && dict.get(b"FT").is_ok()
                {
                    ids.push(*id);
                }
            }
        }
    }
    let mut seen = BTreeMap::new();
    for id in ids {
        if let Some(field) = form_field_from_id(doc, id) {
            seen.entry(field.name.clone()).or_insert(field);
        }
    }
    seen.into_values().collect()
}

pub fn find_form_field_id_by_name(doc: &Document, target: &str) -> Result<ObjectId, String> {
    let mut ids = Vec::new();
    if let Ok(catalog) = doc.catalog() {
        if let Ok(Object::Reference(acroform_id)) = catalog.get(b"AcroForm") {
            if let Ok(acroform) = doc.get_dictionary(*acroform_id) {
                if let Ok(Object::Array(fields)) = acroform.get(b"Fields") {
                    for field in fields {
                        walk_form_nodes(doc, field, &mut ids);
                    }
                }
            }
        }
    }
    if ids.is_empty() {
        for page_id in doc.get_pages().values() {
            let Ok(page) = doc.get_dictionary(*page_id) else { continue };
            let Ok(Object::Array(annots)) = page.get(b"Annots") else { continue };
            for annot in annots {
                if let Object::Reference(id) = annot {
                    ids.push(*id);
                }
            }
        }
    }
    for id in ids {
        if full_field_name(doc, id).or_else(|| resolve_field_dict(doc, id).and_then(field_partial_name))
            == Some(target.to_string())
        {
            return Ok(id);
        }
    }
    Err(format!("Form field not found: {target}"))
}

fn btn_on_state_name(dict: &Dictionary) -> Vec<u8> {
    dict.get(b"AP")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|ap| ap.get(b"N").ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|n| n.iter().find(|(k, _)| *k != b"Off").map(|(k, _)| k.clone()))
        .unwrap_or_else(|| b"Yes".to_vec())
}

pub fn set_btn_widget_checked(doc: &mut Document, widget_id: ObjectId, on: bool) -> Result<(), String> {
    let on_name = doc.get_dictionary(widget_id).map_err(|e| e.to_string()).map(btn_on_state_name)?;
    let dict = doc.get_dictionary_mut(widget_id).map_err(|e| e.to_string())?;
    if on {
        dict.set(b"V", Object::Name(on_name.clone()));
        dict.set(b"AS", Object::Name(on_name));
    } else {
        dict.set(b"V", Object::Name(b"Off".to_vec()));
        dict.set(b"AS", Object::Name(b"Off".to_vec()));
    }
    Ok(())
}

fn radio_group_widget_ids(doc: &Document, group_id: ObjectId) -> Vec<ObjectId> {
    let Some(dict) = resolve_field_dict(doc, group_id) else {
        return vec![group_id];
    };
    if let Some(kids) = dict.get(b"Kids").ok().and_then(|o| o.as_array().ok()) {
        return kids
            .iter()
            .filter_map(|kid| match kid {
                Object::Reference(id) => Some(*id),
                _ => None,
            })
            .collect();
    }
    vec![group_id]
}

pub fn set_radio_group_checked(doc: &mut Document, selected_id: ObjectId) -> Result<(), String> {
    let group_id = doc
        .get_dictionary(selected_id)
        .ok()
        .and_then(|dict| dict.get(b"Parent").ok())
        .and_then(|o| o.as_reference().ok())
        .unwrap_or(selected_id);
    for widget_id in radio_group_widget_ids(doc, group_id) {
        set_btn_widget_checked(doc, widget_id, widget_id == selected_id)?;
    }
    Ok(())
}

pub fn find_radio_group_by_name(doc: &Document, group_name: &str) -> Option<ObjectId> {
    let catalog = doc.catalog().ok()?;
    let af_id = catalog.get(b"AcroForm").ok()?.as_reference().ok()?;
    let af = doc.get_dictionary(af_id).ok()?;
    let fields = af.get(b"Fields").ok()?.as_array().ok()?;
    for field in fields {
        let Object::Reference(id) = field else { continue };
        let dict = resolve_field_dict(doc, *id)?;
        if field_partial_name(dict).as_deref() != Some(group_name) {
            continue;
        }
        let ff = dict.get(b"Ff").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
        if ff & (1 << 16) != 0 {
            return Some(*id);
        }
    }
    None
}

pub fn append_field_kid(doc: &mut Document, parent_id: ObjectId, kid_id: ObjectId) -> Result<(), String> {
    let parent = doc.get_dictionary_mut(parent_id).map_err(|e| e.to_string())?;
    match parent.get_mut(b"Kids") {
        Ok(Object::Array(kids)) => kids.push(Object::Reference(kid_id)),
        _ => parent.set(b"Kids", Object::Array(vec![Object::Reference(kid_id)])),
    }
    Ok(())
}

pub fn viewer_widget_rect(doc: &Document, page_id: ObjectId, x: f64, y: f64, w: f64, h: f64) -> Result<Object, String> {
    let (px, py, pw, ph) = viewer_rect_to_pdf(doc, page_id, x, y, w, h)?;
    Ok(Object::Array(vec![
        Object::Real(px as f32),
        Object::Real(py as f32),
        Object::Real((px + pw) as f32),
        Object::Real((py + ph) as f32),
    ]))
}

pub fn choice_options_object(options: &[String]) -> Object {
    Object::Array(
        options.iter().map(|option| Object::String(option.as_bytes().to_vec(), lopdf::StringFormat::Literal)).collect(),
    )
}
