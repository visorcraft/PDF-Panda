#[tauri::command]
fn protect_pdf(path: String, user_password: String, owner_password: Option<String>) -> Result<String, String> {
    pdf::security::protect_pdf(path, user_password, owner_password)
}
#[tauri::command]
fn list_pdf_signatures(path: String) -> Result<Vec<PdfSignatureInfo>, String> {
    pdf::security::list_pdf_signatures(path)
}
#[tauri::command]
fn verify_pdf_signatures(
    path: String,
    trust_pem_path: Option<String>,
) -> Result<PdfSignatureVerificationSummary, String> {
    pdf::security::verify_pdf_signatures(path, trust_pem_path)
}
#[tauri::command]
fn sign_pdf(
    path: String,
    cert_path: String,
    cert_password: String,
    reason: Option<String>,
    location: Option<String>,
    field_name: Option<String>,
    output_path: Option<String>,
) -> Result<String, String> {
    pdf::security::sign_pdf(path, cert_path, cert_password, reason, location, field_name, output_path)
}
#[tauri::command]
fn open_working_copy(original: String) -> Result<String, String> {
    pdf::history::open_working_copy(original)
}
#[tauri::command]
fn save_working_copy(working: String, target: String) -> Result<(), String> {
    pdf::history::save_working_copy(working, target)
}
#[tauri::command]
fn discard_working_copy(working: String) -> Result<(), String> {
    pdf::history::discard_working_copy(working)
}
#[tauri::command]
fn snapshot_pdf(source: String) -> Result<String, String> {
    pdf::history::snapshot_pdf(source)
}
#[tauri::command]
fn snapshot_pdf_entry(history: Vec<HistorySnapshot>, source: String) -> Result<HistorySnapshot, String> {
    pdf::history::snapshot_pdf_entry(history, source)
}
#[tauri::command]
fn restore_history_entry(history: Vec<HistorySnapshot>, index: usize, target: String) -> Result<(), String> {
    pdf::history::restore_history_entry(history, index, target)
}
#[tauri::command]
fn discard_history_entry(entry: HistorySnapshot) -> Result<(), String> {
    pdf::history::discard_history_entry(entry)
}
#[tauri::command]
fn prune_history_entry(history: Vec<HistorySnapshot>, drop_index: usize) -> Result<Vec<HistorySnapshot>, String> {
    pdf::history::prune_history_entry(history, drop_index)
}
#[tauri::command]
fn add_highlight(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotations::add_highlight(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}
/// Remove the `index`-th highlight annotation (0-based, in document order) from a
/// page. The index matches the order highlights are returned by
/// `get_annotations` after filtering to the `Highlight` subtype.
#[tauri::command]
fn remove_highlight(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotations::remove_highlight(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn add_text_note(path: String, page_index: u32, x: f64, y: f64, content: String) -> Result<(), String> {
    pdf::annotations::add_text_note(&PathBuf::from(path), page_index, x, y, content)
}
/// Remove the `index`-th text-note annotation (0-based among `Text` subtypes).
#[tauri::command]
fn remove_text_note(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotations::remove_text_note(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn add_ink_stroke(path: String, page_index: u32, points: Vec<f64>) -> Result<(), String> {
    pdf::annotation_markup::add_ink_stroke(&PathBuf::from(path), page_index, points)
}
#[tauri::command]
fn remove_ink_stroke(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_ink_stroke(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn add_square(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_square(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}
#[tauri::command]
fn add_circle(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_circle(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}
#[tauri::command]
fn add_line(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_line(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}
#[tauri::command]
fn remove_square(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_square(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn remove_circle(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_circle(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn remove_line(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_line(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn list_stamp_presets() -> Vec<pdf::annotation_markup::StampPresetInfo> {
    pdf::annotation_markup::list_stamp_presets()
}
#[tauri::command]
fn add_text_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    pdf::annotation_markup::add_text_stamp(&PathBuf::from(path), page_index, x, y, preset)
}
#[tauri::command]
fn add_image_stamp(path: String, page_index: u32, x: f64, y: f64, preset: String) -> Result<(), String> {
    pdf::annotation_markup::add_image_stamp(&PathBuf::from(path), page_index, x, y, preset)
}
#[tauri::command]
fn remove_text_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_text_stamp(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn remove_image_stamp(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_image_stamp(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn add_redaction(path: String, page_index: u32, x1: f64, y1: f64, x2: f64, y2: f64) -> Result<(), String> {
    pdf::annotation_markup::add_redaction(&PathBuf::from(path), page_index, x1, y1, x2, y2)
}
#[tauri::command]
fn remove_redaction(path: String, page_index: u32, index: u32) -> Result<(), String> {
    pdf::annotation_markup::remove_redaction(&PathBuf::from(path), page_index, index)
}
#[tauri::command]
fn get_annotations(path: String, page_index: u32) -> Result<Vec<pdf::annotations::AnnotationData>, String> {
    pdf::annotations::get_annotations(&PathBuf::from(path), page_index)
}
