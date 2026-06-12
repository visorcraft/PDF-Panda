use crate::pdf::page_tree::inherited_page_attr;
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::path::Path;

use crate::PdfUaReport;

pub fn inspect_pdfua(path: &Path) -> Result<PdfUaReport, String> {
    let doc = match Document::load(path) {
        Ok(d) => d,
        Err(lopdf::Error::InvalidPassword) | Err(lopdf::Error::Unimplemented(_)) => {
            return Ok(PdfUaReport {
                tagged: false,
                has_title: false,
                language: None,
                figures_total: 0,
                figures_with_alt: 0,
                image_xobjects: 0,
                page_count: 0,
                encrypted: true,
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    if doc.is_encrypted() {
        return Ok(PdfUaReport {
            tagged: false,
            has_title: false,
            language: None,
            figures_total: 0,
            figures_with_alt: 0,
            image_xobjects: 0,
            page_count: 0,
            encrypted: true,
        });
    }

    let catalog = doc.catalog().map_err(|e| e.to_string())?;

    let tagged = {
        let marked = catalog
            .get(b"MarkInfo")
            .ok()
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Marked").ok())
            .and_then(|o| o.as_bool().ok())
            == Some(true);
        let has_struct_tree_root = catalog.get(b"StructTreeRoot").is_ok();
        marked && has_struct_tree_root
    };

    let has_title = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| match o {
            Object::Reference(id) => doc.get_dictionary(*id).ok(),
            Object::Dictionary(d) => Some(d),
            _ => None,
        })
        .and_then(|d| d.get(b"Title").ok())
        .and_then(|o| o.as_str().ok())
        .map(|b| !String::from_utf8_lossy(b).trim().is_empty())
        .unwrap_or(false);

    let language =
        catalog.get(b"Lang").ok().and_then(|o| o.as_str().ok()).map(|b| String::from_utf8_lossy(b).into_owned());

    let mut figures_total = 0u32;
    let mut figures_with_alt = 0u32;
    if let Some(root_id) = catalog.get(b"StructTreeRoot").ok().and_then(|o| o.as_reference().ok()) {
        if let Ok(root_dict) = doc.get_dictionary(root_id) {
            if let Ok(k) = root_dict.get(b"K") {
                count_struct_figures(&doc, k, &mut figures_total, &mut figures_with_alt);
            }
        }
    }

    let image_xobjects = count_image_xobjects(&doc);
    let page_count = doc.get_pages().len() as u32;

    Ok(PdfUaReport {
        tagged,
        has_title,
        language,
        figures_total,
        figures_with_alt,
        image_xobjects,
        page_count,
        encrypted: false,
    })
}

fn count_struct_figures(doc: &Document, obj: &Object, total: &mut u32, with_alt: &mut u32) {
    match obj {
        Object::Reference(id) => {
            if let Ok(dict) = doc.get_dictionary(*id) {
                process_struct_element_for_figures(doc, dict, total, with_alt);
            }
        }
        Object::Array(items) => {
            for item in items {
                count_struct_figures(doc, item, total, with_alt);
            }
        }
        Object::Dictionary(dict) => {
            process_struct_element_for_figures(doc, dict, total, with_alt);
        }
        _ => {}
    }
}

fn process_struct_element_for_figures(doc: &Document, dict: &Dictionary, total: &mut u32, with_alt: &mut u32) {
    let is_figure = dict.get(b"S").ok().and_then(|o| o.as_name().ok()) == Some(b"Figure");
    if is_figure {
        *total += 1;
        let has_alt = dict
            .get(b"Alt")
            .ok()
            .and_then(|o| o.as_str().ok())
            .map(|b| !String::from_utf8_lossy(b).trim().is_empty())
            .unwrap_or(false);
        if has_alt {
            *with_alt += 1;
        }
    }
    if let Ok(k) = dict.get(b"K") {
        count_struct_figures(doc, k, total, with_alt);
    }
}

fn count_image_xobjects(doc: &Document) -> u32 {
    doc.get_pages()
        .iter()
        .filter_map(|(_num, &page_id)| {
            let resources = page_resources_dict(doc, page_id)?;
            let xobjects_obj = resources.get(b"XObject").ok()?;
            let xobject_dict = match xobjects_obj {
                Object::Reference(id) => doc.get_dictionary(*id).ok()?,
                Object::Dictionary(d) => d,
                _ => return Some(0u32),
            };
            Some(
                xobject_dict
                    .iter()
                    .filter(|(_k, v)| {
                        let subtype = match v {
                            Object::Reference(id) => doc
                                .get_object(*id)
                                .ok()
                                .and_then(|o| o.as_dict().ok())
                                .and_then(|d| d.get(b"Subtype").ok()),
                            Object::Dictionary(d) => d.get(b"Subtype").ok(),
                            _ => None,
                        };
                        subtype.and_then(|o| o.as_name().ok()) == Some(b"Image")
                    })
                    .count() as u32,
            )
        })
        .sum()
}

fn page_resources_dict(doc: &Document, page_id: ObjectId) -> Option<Dictionary> {
    let page_dict = doc.get_dictionary(page_id).ok()?;
    let obj = page_dict.get(b"Resources").ok().cloned().or_else(|| inherited_page_attr(doc, page_id, b"Resources"))?;
    match obj {
        Object::Reference(id) => doc.get_dictionary(id).ok().cloned(),
        Object::Dictionary(d) => Some(d),
        _ => None,
    }
}
