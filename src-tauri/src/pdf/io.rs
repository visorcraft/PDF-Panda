use crate::pdf::render;
use lopdf::Document;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Load a PDF, run `f`, save back to the same path, and return `f`'s result.
pub fn mutate_pdf<T, F>(path: &Path, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Document) -> Result<T, String>,
{
    let mut doc = Document::load(path).map_err(|e| e.to_string())?;
    let result = f(&mut doc)?;
    doc.save(path).map_err(|e| e.to_string())?;
    render::invalidate_document_cache(path);
    Ok(result)
}

/// Return the number of pages without mutating the file.
pub fn page_count(path: &Path) -> Result<usize, String> {
    Document::load(path).map_err(|e| e.to_string()).map(|doc| doc.get_pages().len())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedSession {
    pub original_path: String,
    pub page: u32,
    pub zoom: f64,
    pub view_mode: String,
    pub scroll_view_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionState {
    pub version: u32,
    pub active_index: usize,
    #[serde(default = "default_workspace_view")]
    pub workspace_view: String,
    pub sessions: Vec<PersistedSession>,
}

fn default_workspace_view() -> String {
    "tabs".to_string()
}

impl SessionState {
    const CURRENT_VERSION: u32 = 1;

    #[allow(dead_code)]
    pub fn new(active_index: usize, sessions: Vec<PersistedSession>) -> Self {
        Self { version: Self::CURRENT_VERSION, active_index, workspace_view: default_workspace_view(), sessions }
    }

    pub fn validate(self) -> Result<Self, String> {
        if self.version != Self::CURRENT_VERSION {
            return Err(format!("unsupported session state version {}", self.version));
        }
        Ok(self)
    }
}

fn session_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| format!("failed to get app config dir: {e}"))?;
    std::fs::create_dir_all(&config_dir).map_err(|e| format!("failed to create config dir: {e}"))?;
    Ok(config_dir.join("sessions.json"))
}

fn no_restore_env() -> bool {
    std::env::var("PDF_PANDA_NO_RESTORE").ok().as_deref() == Some("1")
}

pub fn save_session_state(app: &tauri::AppHandle, state: &SessionState) -> Result<(), String> {
    if no_restore_env() {
        return Ok(());
    }
    let path = session_state_path(app)?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("failed to write session state: {e}"))?;
    Ok(())
}

pub fn load_session_state(app: &tauri::AppHandle) -> Result<Option<SessionState>, String> {
    if no_restore_env() {
        return Ok(None);
    }
    let path = session_state_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| format!("failed to read session state: {e}"))?;
    let state: SessionState = serde_json::from_str(&json).map_err(|e| format!("failed to parse session state: {e}"))?;
    match state.validate() {
        Ok(s) => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Dictionary, Object, Stream};
    use std::fs;

    fn minimal_pdf(path: &Path) {
        let mut doc = Document::with_version("1.4");
        let pages_id = doc.new_object_id();
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        doc.objects.insert(content_id, Object::Stream(Stream::new(Dictionary::new(), b"BT ET".to_vec())));
        let mut page = Dictionary::new();
        page.set("Type", Object::Name(b"Page".to_vec()));
        page.set("Parent", Object::Reference(pages_id));
        page.set("MediaBox", Object::Array(vec![0.into(), 0.into(), 612.into(), 792.into()]));
        page.set("Contents", Object::Reference(content_id));
        doc.objects.insert(page_id, Object::Dictionary(page));
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        doc.save(path).unwrap();
    }

    #[test]
    fn page_count_reads_without_mutation() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("count.pdf");
        minimal_pdf(&path);
        assert_eq!(page_count(&path).unwrap(), 1);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mutate_pdf_skips_save_on_closure_error() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("mutate_err.pdf");
        minimal_pdf(&path);
        let before = fs::read(&path).unwrap();
        let err = mutate_pdf::<(), _>(&path, |doc| {
            let page_id = *doc.get_pages().get(&1).unwrap();
            doc.get_dictionary_mut(page_id).unwrap().set("Rotate", Object::Integer(90));
            Err("intentional failure".into())
        })
        .unwrap_err();
        assert_eq!(err, "intentional failure");
        assert_eq!(fs::read(&path).unwrap(), before);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mutate_pdf_persists_changes() {
        let dir = std::env::temp_dir().join("pdf_panda_io_test");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("mutate.pdf");
        minimal_pdf(&path);
        mutate_pdf(&path, |doc| {
            let page_id = *doc.get_pages().get(&1).unwrap();
            doc.get_dictionary_mut(page_id).unwrap().set("Rotate", Object::Integer(90));
            Ok(())
        })
        .unwrap();
        let doc = Document::load(&path).unwrap();
        let page_id = *doc.get_pages().get(&1).unwrap();
        let rot = doc.get_dictionary(page_id).unwrap().get(b"Rotate").unwrap().as_i64().unwrap();
        assert_eq!(rot, 90);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn session_state_round_trip() {
        let state = SessionState::new(
            1,
            vec![
                PersistedSession {
                    original_path: "/tmp/a.pdf".to_string(),
                    page: 3,
                    zoom: 1.5,
                    view_mode: "pdf".to_string(),
                    scroll_view_mode: "continuous".to_string(),
                },
                PersistedSession {
                    original_path: "/tmp/b.pdf".to_string(),
                    page: 0,
                    zoom: 2.0,
                    view_mode: "markdown".to_string(),
                    scroll_view_mode: "single".to_string(),
                },
            ],
        );
        let json = serde_json::to_string_pretty(&state).unwrap();
        let loaded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded, state);
    }

    #[test]
    fn session_state_legacy_defaults_workspace_view() {
        let json = r#"{"version":1,"active_index":0,"sessions":[]}"#;
        let state: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(state.workspace_view, "tabs");
    }

    #[test]
    fn session_state_unknown_version_returns_error() {
        let json = r#"{"version":99,"active_index":0,"sessions":[]}"#;
        let state: SessionState = serde_json::from_str(json).unwrap();
        assert!(state.validate().is_err());
    }
}
