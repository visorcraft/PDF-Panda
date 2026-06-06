use lopdf::Document;
use std::path::PathBuf;

pub fn convert_pdf_to_markdown(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let mut markdown_content = String::from("# PDF to Markdown Conversion\n\n");

    for (page_num, page_id) in doc.get_pages() {
        markdown_content.push_str(&format!("## Page {}\n\n", page_num));

        let content_stream_ids = doc.get_page_contents(page_id);
        for content_id in content_stream_ids {
            if let Ok(object) = doc.get_object(content_id) {
                if let Ok(stream) = object.as_stream() {
                    if let Ok(content) = stream.decode_content() {
                        for operation in content.operations {
                            match operation.operator.as_str() {
                                "Tj" => {
                                    for operand in &operation.operands {
                                        if let lopdf::Object::String(data, _) = operand {
                                            if let Ok(text) = std::str::from_utf8(data) {
                                                markdown_content.push_str(text);
                                            }
                                        }
                                    }
                                }
                                "TJ" => {
                                    for operand in &operation.operands {
                                        if let lopdf::Object::Array(items) = operand {
                                            let mut text = String::new();
                                            for item in items {
                                                if let lopdf::Object::String(data, _) = item {
                                                    if let Ok(s) = std::str::from_utf8(data) {
                                                        text.push_str(s);
                                                    }
                                                }
                                            }
                                            markdown_content.push_str(&text);
                                        }
                                    }
                                }
                                "BT" | "ET" | "Td" | "TD" | "T*" | "Tm" | "Tf" | "Ts" | "Tw" | "Tc" | "Tz" | "TL" | "Tr" => {
                                    // Text state operators - handle as needed
                                }
                                "'" | "\"" => {
                                    for operand in &operation.operands {
                                        if let lopdf::Object::String(data, _) = operand {
                                            if let Ok(text) = std::str::from_utf8(data) {
                                                markdown_content.push_str(text);
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
        markdown_content.push_str("\n\n");
    }

    Ok(markdown_content)
}
