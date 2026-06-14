use std::path::Path;

use crate::{PrintDocumentResult, PrintMargins, PrintOptions, PrinterInfo};

pub fn list_printers() -> Vec<PrinterInfo> {
    // TODO: Task 4
    vec![]
}

pub fn print_document(
    source_path: &Path,
    opts: &PrintOptions,
    temp_dir: &Path,
) -> Result<PrintDocumentResult, String> {
    // TODO: Task 7
    Err("not implemented".into())
}

pub fn print_to_pdf(
    source_path: &Path,
    opts: &PrintOptions,
    output_path: &Path,
) -> Result<(), String> {
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
