use std::path::Path;

use crate::{PrintDocumentResult, PrintMargins, PrintOptions, PrinterInfo};

pub fn list_printers() -> Vec<PrinterInfo> {
    use printers::{get_default_printer, get_printers};

    let default_name = get_default_printer()
        .map(|p| p.system_name.clone())
        .unwrap_or_default();

    get_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            system_name: p.system_name.clone(),
            display_name: if p.name.is_empty() {
                p.system_name.clone()
            } else {
                p.name.clone()
            },
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
