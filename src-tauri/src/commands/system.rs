use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, PhysicalPosition, State, WebviewWindow};

use crate::{settings::ZenithSettings, settings::SettingsState, AppState};

#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_focus();
        let _ = win.show();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Zenith Settings")
    .inner_size(720.0, 560.0)
    .resizable(false)
    .decorations(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_ignore_cursor(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_window(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No primary monitor")?;

    let screen_size = monitor.size();
    let screen_pos = monitor.position();
    let scale = monitor.scale_factor();

    let (w, h) = if expanded {
        (480.0, 720.0)
    } else {
        (80.0, 80.0)
    };

    let win_width = (w * scale) as i32;
    let win_height = (h * scale) as i32;
    let margin_right = (16.0 * scale) as i32;
    let margin_bottom = (48.0 * scale) as i32;

    let x = screen_pos.x + screen_size.width as i32 - win_width - margin_right;
    let y = screen_pos.y + screen_size.height as i32 - win_height - margin_bottom;

    let _ = window.set_size(tauri::PhysicalSize::new(
        win_width as u32,
        win_height as u32,
    ));
    let _ = window.set_position(PhysicalPosition::new(x, y));

    Ok(())
}

#[tauri::command]
pub fn start_drag_out(window: WebviewWindow, path: String) -> Result<(), String> {
    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err(format!("File not found: {}", path));
    }

    drag::start_drag(
        &window,
        drag::DragItem::Files(vec![pb]),
        drag::Image::Raw(vec![]),
        |_result, _cursor_pos| {},
        Default::default(),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = if p.is_dir() {
        p
    } else {
        p.parent().unwrap_or(p)
    };
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ping_url(url: String) -> Result<u64, String> {
    use std::time::Instant;

    if !url.starts_with("https://") {
        return Err("Only HTTPS URLs are allowed".to_string());
    }

    let start = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    client
        .head(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(start.elapsed().as_millis() as u64)
}

#[tauri::command]
pub fn read_file_base64(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    use std::io::Read;

    let items = state.staged_items.lock().map_err(|e| e.to_string())?;
    if !items.values().any(|item| item.path == path) {
        return Err("File is not staged".to_string());
    }
    drop(items);

    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("File exceeds 10MB limit".to_string());
    }

    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

#[tauri::command]
pub async fn save_clipboard_image(
    data_b64: String,
    ext: String,
) -> Result<String, String> {
    use std::io::Write;
    let temp_dir = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let uuid_str = uuid::Uuid::new_v4().to_string().replace('-', "");
    let safe_ext = if ext.starts_with('.') {
        ext
    } else {
        format!(".{}", ext)
    };
    let filename = format!("clipboard_paste_{}{}", &uuid_str[..8], safe_ext);
    let out_path = temp_dir.join(&filename);
    let img_bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let mut file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
    file.write_all(&img_bytes).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<serde_json::Value>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }
    let mut entries = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path_str = entry.path().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let ext = if is_dir {
            String::new()
        } else {
            std::path::Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default()
        };
        entries.push(serde_json::json!({
            "name": name,
            "path": path_str,
            "is_directory": is_dir,
            "size": size,
            "extension": ext,
        }));
    }
    entries.sort_by(|a, b| {
        let a_dir = a["is_directory"].as_bool().unwrap_or(false);
        let b_dir = b["is_directory"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
        })
    });
    Ok(entries)
}

#[tauri::command]
pub fn email_files(
    paths: Vec<String>,
    to: String,
    subject: String,
    body: String,
) -> Result<(), String> {
    if !to.contains('@') {
        return Err("Invalid email address".to_string());
    }
    if paths.len() > 10 {
        return Err("Maximum 10 file attachments allowed".to_string());
    }

    fn url_encode(s: &str) -> String {
        let mut out = String::new();
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(b as char);
                }
                b' ' => out.push_str("%20"),
                _ => out.push_str(&format!("%{:02X}", b)),
            }
        }
        out
    }
    let attachment_params: String = paths
        .iter()
        .map(|p| format!("&attachment={}", url_encode(p)))
        .collect();
    let mailto = format!(
        "mailto:{}?subject={}&body={}{}",
        url_encode(&to),
        url_encode(&subject),
        url_encode(&body),
        attachment_params
    );
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &mailto])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&mailto)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&mailto)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_file_preview(
    path: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    if p.is_dir() {
        return Err("Cannot preview a directory".to_string());
    }
    let limit = max_bytes.unwrap_or(512_000);
    let data = fs::read(&p).map_err(|e| format!("Read error: {}", e))?;
    if data.len() > limit {
        let slice = &data[..limit];
        let text = String::from_utf8_lossy(slice);
        Ok(text.into_owned())
    } else {
        let text = String::from_utf8_lossy(&data);
        Ok(text.into_owned())
    }
}

#[tauri::command]
pub fn export_settings(
    state: State<'_, SettingsState>,
) -> Result<String, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&*s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_settings(
    state: State<'_, SettingsState>,
    json: String,
) -> Result<(), String> {
    let new_settings: ZenithSettings =
        serde_json::from_str(&json).map_err(|e| format!("Invalid settings JSON: {}", e))?;
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = new_settings;
    s.save()
}

#[tauri::command]
pub fn launch_snipping_tool() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "snippingtool"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("screencapture")
            .args(["-i", "-c"])
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("gnome-screenshot")
            .args(["-i"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clipboard_history_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local)
        .join("Zenith")
        .join("clipboard_history.json")
}

#[tauri::command]
pub fn save_clipboard_entry(
    text: String,
    image_b64: String,
) -> Result<(), String> {
    let path = clipboard_history_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut entries: Vec<serde_json::Value> = if path.exists() {
        let c = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&c).unwrap_or_default()
    } else {
        vec![]
    };
    let entry = serde_json::json!({
        "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        "text": if text.len() > 200 { format!("{}...", &text[..197]) } else { text },
        "image_b64": if !image_b64.is_empty() { Some(&image_b64[..image_b64.len().min(4096)]) } else { None },
    });
    entries.insert(0, entry);
    if entries.len() > 100 {
        entries.truncate(100);
    }
    let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_clipboard_history() -> Result<Vec<serde_json::Value>, String> {
    let path = clipboard_history_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let c = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_clipboard_history() -> Result<(), String> {
    let path = clipboard_history_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn check_items_exist(
    state: tauri::State<'_, crate::AppState>,
    _paths: Vec<String>,
) -> Result<HashMap<String, bool>, String> {
    let items = state.staged_items.lock().map_err(|e| e.to_string())?;
    let mut result = HashMap::new();
    for (id, item) in items.iter() {
        let exists = std::path::Path::new(&item.path).exists();
        result.insert(id.clone(), exists);
    }
    Ok(result)
}
