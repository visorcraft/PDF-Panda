use std::path::Path;

use crate::{PrintDocumentResult, PrintMargins, PrintOptions, PrinterInfo};

pub fn list_printers() -> Vec<PrinterInfo> {
    use printers::{get_default_printer, get_printers};

    let default_name = get_default_printer().map(|p| p.system_name.clone()).unwrap_or_default();

    get_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            system_name: p.system_name.clone(),
            display_name: if p.name.is_empty() { p.system_name.clone() } else { p.name.clone() },
            is_default: p.system_name == default_name,
            driver_name: p.driver_name,
        })
        .collect()
}

pub fn print_document(source_path: &Path, opts: &PrintOptions, temp_dir: &Path) -> Result<PrintDocumentResult, String> {
    // TODO: Task 7
    Err("not implemented".into())
}

pub fn print_to_pdf(source_path: &Path, opts: &PrintOptions, output_path: &Path) -> Result<(), String> {
    // TODO: Task 8
    Err("not implemented".into())
}

pub fn render_print_preview(
    source_path: &Path,
    page_index: u32,
    opts: &PrintOptions,
    width: i32,
    height: i32,
    temp_dir: &Path,
) -> Result<Vec<u8>, String> {
    // TODO: Task 9
    Err("not implemented".into())
}

fn parse_page_range(range: Option<&str>, page_count: u32) -> Result<Vec<u32>, String> {
    let indices: Vec<u32> = (0..page_count).collect();
    let Some(spec) = range else {
        return Ok(indices);
    };
    let spec = spec.trim();
    if spec.is_empty() || spec.eq_ignore_ascii_case("all") {
        return Ok(indices);
    }

    let mut out = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start, end)) = part.split_once('-') {
            let start: u32 = start.trim().parse().map_err(|_| format!("Invalid range: {}", part))?;
            let end: u32 = end.trim().parse().map_err(|_| format!("Invalid range: {}", part))?;
            if start == 0 || end < start || end > page_count {
                return Err(format!("Range out of bounds: {}", part));
            }
            out.extend((start - 1)..end);
        } else {
            let idx: u32 = part.parse().map_err(|_| format!("Invalid page: {}", part))?;
            if idx == 0 || idx > page_count {
                return Err(format!("Page out of bounds: {}", part));
            }
            out.push(idx - 1);
        }
    }
    if out.is_empty() {
        return Err("No pages selected".into());
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_page_range_all() {
        assert_eq!(parse_page_range(Some("all"), 5).unwrap(), vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn parse_page_range_comma_and_dash() {
        assert_eq!(parse_page_range(Some("1-3,5"), 5).unwrap(), vec![0, 1, 2, 4]);
    }
}
