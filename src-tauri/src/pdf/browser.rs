use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfBrowserEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfBrowserListing {
    pub current_dir: String,
    pub parent_dir: Option<String>,
    pub entries: Vec<PdfBrowserEntry>,
}

pub fn default_browser_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .and_then(|home| {
            let documents = home.join("Documents");
            if documents.is_dir() {
                Some(documents)
            } else if home.is_dir() {
                Some(home)
            } else {
                None
            }
        })
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")))
}

pub fn list_pdf_entries_for_dir(dir: &Path) -> Result<PdfBrowserListing, String> {
    let current_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    if !current_dir.is_dir() {
        return Err(format!("{} is not a directory", current_dir.to_string_lossy()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir = metadata.is_dir();
        let is_pdf =
            path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("pdf")).unwrap_or(false);
        if !is_dir && !is_pdf {
            continue;
        }
        entries.push(PdfBrowserEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(PdfBrowserListing {
        parent_dir: current_dir.parent().map(|path| path.to_string_lossy().to_string()),
        current_dir: current_dir.to_string_lossy().to_string(),
        entries,
    })
}
