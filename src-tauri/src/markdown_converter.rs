use lopdf::Document;
use std::path::PathBuf;

/// Decode a PDF string object's bytes to text.
///
/// PDF text strings are rarely valid UTF-8: they may be UTF-16BE (with a BOM) or
/// single-byte encodings (PDFDocEncoding / WinAnsi, which overlap ASCII). The
/// previous implementation only accepted UTF-8 and silently dropped everything
/// else. We try UTF-8, then UTF-16BE, then fall back to a Latin-1 decode so
/// ASCII/WinAnsi text is preserved rather than discarded.
fn decode_pdf_string(data: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(data) {
        return s.to_string();
    }
    if data.len() >= 2 && data[0] == 0xFE && data[1] == 0xFF {
        let units: Vec<u16> = data[2..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&units);
    }
    // Latin-1: every byte maps directly to a Unicode scalar value.
    data.iter().map(|&b| b as char).collect()
}

/// Append text, collapsing it onto the current line.
fn push_text(out: &mut String, text: &str) {
    out.push_str(text);
}

/// Best-effort extraction of a PDF's text content into Markdown.
///
/// This walks each page's content stream and interprets the text-showing
/// operators, mapping line-positioning operators to line breaks and large
/// negative `TJ` kerning adjustments to spaces so the output reads as text
/// rather than a single run-on blob. Pages become `## Page N` sections.
///
/// Note: documents that use CID/Type0 fonts encode glyph indices rather than
/// characters in their content streams, so naive extraction can't recover their
/// text — that needs a full text layer (pdfium). This covers the common case of
/// simple/WinAnsi-encoded documents.
pub fn convert_pdf_to_markdown(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let doc = Document::load(&path).map_err(|e| e.to_string())?;
    let mut markdown = String::from("# PDF to Markdown Conversion\n\n");

    for (page_num, page_id) in doc.get_pages() {
        markdown.push_str(&format!("## Page {page_num}\n\n"));
        let mut page_text = String::new();

        for content_id in doc.get_page_contents(page_id) {
            let Ok(object) = doc.get_object(content_id) else {
                continue;
            };
            let Ok(stream) = object.as_stream() else {
                continue;
            };
            let Ok(content) = stream.decode_content() else {
                continue;
            };

            for operation in content.operations {
                match operation.operator.as_str() {
                    // Line-positioning operators start a new text line.
                    "Td" | "TD" | "T*" => {
                        if !page_text.ends_with('\n') {
                            page_text.push('\n');
                        }
                    }
                    // Show text.
                    "Tj" => {
                        for operand in &operation.operands {
                            if let lopdf::Object::String(data, _) = operand {
                                push_text(&mut page_text, &decode_pdf_string(data));
                            }
                        }
                    }
                    // Move to next line, then show text.
                    "'" | "\"" => {
                        if !page_text.ends_with('\n') {
                            page_text.push('\n');
                        }
                        for operand in &operation.operands {
                            if let lopdf::Object::String(data, _) = operand {
                                push_text(&mut page_text, &decode_pdf_string(data));
                            }
                        }
                    }
                    // Show text with individual glyph positioning. Strings are
                    // concatenated; large negative numeric adjustments represent
                    // inter-word spacing.
                    "TJ" => {
                        if let Some(lopdf::Object::Array(items)) = operation.operands.first() {
                            for item in items {
                                match item {
                                    lopdf::Object::String(data, _) => {
                                        push_text(&mut page_text, &decode_pdf_string(data));
                                    }
                                    lopdf::Object::Real(n) if *n < -100.0 => page_text.push(' '),
                                    lopdf::Object::Integer(n) if *n < -100 => page_text.push(' '),
                                    _ => {}
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }

        let trimmed = page_text.trim();
        if !trimmed.is_empty() {
            markdown.push_str(trimmed);
        } else {
            markdown.push_str("_(no extractable text on this page)_");
        }
        markdown.push_str("\n\n");
    }

    Ok(markdown)
}
