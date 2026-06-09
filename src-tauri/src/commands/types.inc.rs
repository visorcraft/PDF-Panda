#[derive(Debug, Clone, Serialize)]
struct PdfDocumentMetadata {
    title: Option<String>,
    author: Option<String>,
    subject: Option<String>,
    keywords: Option<String>,
    creator: Option<String>,
    producer: Option<String>,
    creation_date: Option<String>,
    mod_date: Option<String>,
}

const EXPORT_PNG_W: i32 = pdf::export::EXPORT_RENDER_W;
const EXPORT_PNG_H: i32 = pdf::export::EXPORT_RENDER_H;
