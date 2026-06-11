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
#[tauri::command]
fn list_document_annotations(path: String) -> Result<Vec<pdf::annotations::DocAnnotation>, String> {
    pdf::annotations::list_document_annotations(&PathBuf::from(path))
}
#[tauri::command]
fn updater_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn parse_latest_json(body: &str, current: &str) -> Result<LatestVersionInfo, String> {
    let json: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("Missing version field")?
        .to_string();
    let notes = json
        .get("notes")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let newer = version_newer(&version, current);
    let linux_packages = json.get("linux_packages").map(|lp| {
        let parse_ref = |key: &str| -> Option<LinuxPackageRef> {
            let entry = lp.get(key)?;
            Some(LinuxPackageRef {
                url: entry.get("url")?.as_str()?.to_string(),
                sha256: entry.get("sha256")?.as_str()?.to_string(),
            })
        };
        LinuxPackages {
            deb: parse_ref("deb"),
            rpm: parse_ref("rpm"),
        }
    });
    Ok(LatestVersionInfo {
        version,
        notes,
        current: current.to_string(),
        newer,
        linux_packages,
    })
}

#[tauri::command]
fn fetch_latest_version() -> Result<LatestVersionInfo, String> {
    const URL: &str = "https://github.com/visorcraft/PDF-Panda/releases/latest/download/latest.json";
    let body = if let Ok(path) = std::env::var("PDF_PANDA_LATEST_JSON_PATH") {
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read latest version override: {}", e))?
    } else if let Ok(body) = std::env::var("PDF_PANDA_LATEST_JSON") {
        body
    } else {
        ureq::get(URL)
            .call()
            .map_err(|e| format!("Failed to fetch latest version: {}", e))?
            .into_string()
            .map_err(|e| format!("Failed to read response: {}", e))?
    };
    let current = env!("CARGO_PKG_VERSION").to_string();
    parse_latest_json(&body, &current)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL scheme: only http and https are allowed".into());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    Ok(())
}

pub fn version_newer(a: &str, b: &str) -> bool {
    let a_parts: Vec<u32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let b_parts: Vec<u32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
        match a_part.cmp(b_part) {
            std::cmp::Ordering::Greater => return true,
            std::cmp::Ordering::Less => return false,
            std::cmp::Ordering::Equal => continue,
        }
    }
    a_parts.len() > b_parts.len()
}

/// Pure update-channel classifier so the decision logic is unit-testable.
/// Returns one of: "appimage", "deb", "rpm", "manual", "supported".
pub fn resolve_update_channel(
    forced: Option<&str>,
    is_linux: bool,
    appimage: bool,
    dpkg_owns: bool,
    rpm_owns: bool,
) -> String {
    if let Some(f) = forced {
        if !f.is_empty() {
            return f.to_string();
        }
    }
    if !is_linux {
        return "supported".to_string();
    }
    if appimage {
        return "appimage".to_string();
    }
    if dpkg_owns {
        return "deb".to_string();
    }
    if rpm_owns {
        return "rpm".to_string();
    }
    "manual".to_string()
}

#[cfg(target_os = "linux")]
fn path_owned_by_package(program: &str, query_arg: &str, path: &std::path::Path) -> bool {
    std::process::Command::new(program)
        .arg(query_arg)
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
fn update_channel() -> String {
    let forced = std::env::var("PDF_PANDA_UPDATE_CHANNEL").ok();
    #[cfg(target_os = "linux")]
    {
        let appimage = std::env::var_os("APPIMAGE").is_some();
        let exe = std::env::current_exe().ok();
        let dpkg_owns = exe
            .as_deref()
            .map(|p| path_owned_by_package("dpkg", "-S", p))
            .unwrap_or(false);
        let rpm_owns = exe
            .as_deref()
            .map(|p| path_owned_by_package("rpm", "-qf", p))
            .unwrap_or(false);
        resolve_update_channel(forced.as_deref(), true, appimage, dpkg_owns, rpm_owns)
    }
    #[cfg(not(target_os = "linux"))]
    {
        resolve_update_channel(forced.as_deref(), false, false, false, false)
    }
}

pub fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let got: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    if got.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err(format!(
            "Checksum mismatch: expected {}, got {}",
            expected_hex, got
        ))
    }
}

/// Download a deb/rpm package, verify its SHA-256, then hand it to the
/// desktop's GUI installer (`xdg-open`) which performs the privileged install.
/// Returns the downloaded temp path on success.
#[tauri::command]
fn download_and_open_package(url: String, sha256: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Invalid URL scheme: only https is allowed".into());
    }
    let mut bytes: Vec<u8> = Vec::new();
    use std::io::Read;
    ureq::get(&url)
        .call()
        .map_err(|e| format!("Failed to download package: {}", e))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read package: {}", e))?;
    verify_sha256(&bytes, &sha256)?;
    let file_name = url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("pdf-panda-update");
    let dest = std::env::temp_dir().join(file_name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write package: {}", e))?;
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dest)
            .spawn()
            .map_err(|e| format!("Failed to launch system installer: {}", e))?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn replace_text_region(
    path: String,
    page_index: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    new_text: String,
    font_size: f64,
) -> Result<(), String> {
    pdf::text_replace::replace_text_region(
        &PathBuf::from(path),
        page_index,
        x,
        y,
        w,
        h,
        &new_text,
        font_size,
    )
}

#[tauri::command]
fn get_page_text_lines(path: String, page_index: u32) -> Result<Vec<TextLineInfo>, String> {
    let path = PathBuf::from(path);
    let doc = lopdf::Document::load(&path).map_err(|e| e.to_string())?;
    let page_id = *doc.get_pages().get(&(page_index + 1)).ok_or_else(|| "Page not found".to_string())?;
    let lines = pdf::text_lines::decode_page_text_lines(&doc, page_id)?;
    let media = pdf::coords::page_media_box(&doc, page_id)?;
    let page_w = (media[2] - media[0]).max(1.0) as f32;
    let page_h = (media[3] - media[1]).max(1.0) as f32;

    let mut out = Vec::new();
    for line in lines {
        let [left, bottom, right, top] = line.bbox;
        let viewer = pdf::coords::pdf_rect_to_viewer_px(left, bottom, right, top, page_w, page_h);
        out.push(TextLineInfo {
            text: line.text,
            x: viewer[0],
            y: viewer[1],
            w: (viewer[2] - viewer[0]).max(1.0),
            h: (viewer[3] - viewer[1]).max(1.0),
        });
    }
    Ok(out)
}

#[tauri::command]
fn replace_text_line(
    path: String,
    page_index: u32,
    line_index: usize,
    new_text: String,
) -> Result<(), String> {
    pdf::text_replace::replace_text_line(
        &PathBuf::from(path),
        page_index,
        line_index,
        &new_text,
    )
}
