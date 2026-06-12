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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinuxPackageRef {
    url: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Default)]
struct LinuxPackages {
    deb: Option<LinuxPackageRef>,
    rpm: Option<LinuxPackageRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LatestVersionInfo {
    version: String,
    notes: Option<String>,
    current: String,
    newer: bool,
    linux_packages: Option<LinuxPackages>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextLineInfo {
    text: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfUaReport {
    pub tagged: bool,
    pub has_title: bool,
    pub language: Option<String>,
    pub figures_total: u32,
    pub figures_with_alt: u32,
    pub image_xobjects: u32,
    pub page_count: u32,
    pub encrypted: bool,
}

const EXPORT_PNG_W: i32 = pdf::export::EXPORT_RENDER_W;
const EXPORT_PNG_H: i32 = pdf::export::EXPORT_RENDER_H;
