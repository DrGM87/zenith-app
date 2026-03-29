use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager, PhysicalPosition, WebviewWindow,
};

mod api_server;
mod plugins;
mod settings;

use settings::{SettingsState, ZenithSettings};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub extension: String,
    pub is_directory: bool,
    pub thumbnail: Option<String>,
    pub mime_type: String,
    #[serde(default)]
    pub self_destruct_at: Option<u64>,
}

pub struct AppState {
    pub staged_items: Arc<Mutex<HashMap<String, StagedItem>>>,
    pub plugin_manager: Mutex<plugins::PluginManager>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptWindowContent {
    pub title: String,
    #[serde(default)]
    pub components: serde_json::Value,
    pub width: Option<f64>,
    pub height: Option<f64>,
    #[serde(default)]
    pub pinned: bool,
    pub collapse_delay: Option<u64>,
}

pub struct ScriptWindowState {
    pub content: Arc<Mutex<Option<ScriptWindowContent>>>,
    pub events: Arc<Mutex<Vec<serde_json::Value>>>,
}

pub struct ScriptProcessState {
    pub processes: Mutex<HashMap<String, std::process::Child>>,
}

/// Stores the image path that the editor window should load on startup.
/// The editor reads this on mount via `take_pending_editor_image`, which
/// atomically returns and clears the value.
pub struct EditorImageState {
    pub pending: Mutex<Option<String>>,
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, SettingsState>) -> Result<ZenithSettings, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, SettingsState>,
    new_settings: ZenithSettings,
) -> Result<(), String> {
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = new_settings;
    s.save()?;
    drop(s);
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
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

pub fn get_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "zip" => "application/zip",
        "rar" => "application/x-rar-compressed",
        "7z" => "application/x-7z-compressed",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "avi" => "video/x-msvideo",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        "ppt" | "pptx" => "application/vnd.ms-powerpoint",
        "exe" => "application/x-msdownload",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        _ => "application/octet-stream",
    }
}

fn generate_thumbnail(path: &str) -> Option<String> {
    let ext = PathBuf::from(path)
        .extension()?
        .to_str()?
        .to_lowercase();

    let image_exts = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico"];
    if !image_exts.contains(&ext.as_str()) {
        return None;
    }

    let img = image::open(path).ok()?;
    let thumb = img.thumbnail(80, 80);
    let mut buf = Vec::new();
    thumb
        .write_to(
            &mut std::io::Cursor::new(&mut buf),
            image::ImageFormat::Png,
        )
        .ok()?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn set_ignore_cursor(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_window(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No primary monitor")?;

    let screen_size = monitor.size();
    let screen_pos = monitor.position();
    let scale = monitor.scale_factor();

    let (w, h) = if expanded {
        (400.0, 600.0)
    } else {
        (180.0, 50.0)
    };

    let win_width = (w * scale) as i32;
    let win_height = (h * scale) as i32;
    let margin_right = (16.0 * scale) as i32;
    let margin_bottom = (48.0 * scale) as i32;

    let x = screen_pos.x + screen_size.width as i32 - win_width - margin_right;
    let y = screen_pos.y + screen_size.height as i32 - win_height - margin_bottom;

    let _ = window.set_size(tauri::PhysicalSize::new(win_width as u32, win_height as u32));
    let _ = window.set_position(PhysicalPosition::new(x, y));

    Ok(())
}

pub fn create_staged_item_from_path(path: &str) -> Result<StagedItem, String> {
    let pb = PathBuf::from(path);
    if !pb.exists() {
        return Err(format!("File not found: {}", path));
    }

    let metadata = fs::metadata(&pb).map_err(|e| e.to_string())?;
    let name = pb
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let extension = pb
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let id = format!("{}_{}", chrono_id(), name.replace(' ', "_"));
    let thumbnail = generate_thumbnail(path);
    let mime_type = get_mime_type(&extension).to_string();

    Ok(StagedItem {
        id,
        path: path.to_string(),
        name,
        size: metadata.len(),
        extension,
        is_directory: metadata.is_dir(),
        thumbnail,
        mime_type,
        self_destruct_at: None,
    })
}

// ── State persistence (v4 Task 1.1: Crash Recovery) ──

fn state_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local).join("Zenith").join("state.json")
}

pub fn persist_items(items: &HashMap<String, StagedItem>) {
    let path = state_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let vals: Vec<&StagedItem> = items.values().collect();
    if let Ok(json) = serde_json::to_string(&vals) {
        let _ = fs::write(&path, json);
    }
}

fn load_persisted_items() -> HashMap<String, StagedItem> {
    let path = state_path();
    if !path.exists() {
        return HashMap::new();
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            let items: Vec<StagedItem> = serde_json::from_str(&content).unwrap_or_default();
            items.into_iter().map(|i| (i.id.clone(), i)).collect()
        }
        Err(_) => HashMap::new(),
    }
}

#[tauri::command]
fn stage_file(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<StagedItem, String> {
    let item = create_staged_item_from_path(&path)?;
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.insert(item.id.clone(), item.clone());
    persist_items(&items);
    Ok(item)
}

#[tauri::command]
fn remove_staged_item(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.remove(&id);
    persist_items(&items);
    Ok(())
}

#[tauri::command]
fn clear_all_items(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.clear();
    persist_items(&items);
    Ok(())
}

#[tauri::command]
fn get_staged_items(state: tauri::State<'_, AppState>) -> Result<Vec<StagedItem>, String> {
    let items = state
        .staged_items
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(items.values().cloned().collect())
}

#[tauri::command]
fn stage_text(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<StagedItem, String> {
    let preview = if text.len() > 60 {
        format!("{}...", &text[..57])
    } else {
        text.clone()
    };

    let id = format!("{}_clipboard", chrono_id());
    let size = text.len() as u64;

    let item = StagedItem {
        id: id.clone(),
        path: String::new(),
        name: preview,
        size,
        extension: "txt".to_string(),
        is_directory: false,
        thumbnail: None,
        mime_type: "text/plain".to_string(),
        self_destruct_at: None,
    };

    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.insert(id, item.clone());
    persist_items(&items);

    Ok(item)
}

#[tauri::command]
fn start_drag_out(window: WebviewWindow, path: String) -> Result<(), String> {
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
fn list_plugins(state: tauri::State<'_, AppState>) -> Result<Vec<plugins::PluginInfo>, String> {
    let pm = state.plugin_manager.lock().map_err(|e| e.to_string())?;
    pm.list_plugins()
}

#[tauri::command]
fn run_plugin(
    state: tauri::State<'_, AppState>,
    plugin_path: String,
) -> Result<String, String> {
    let items: Vec<StagedItem> = {
        let staged = state.staged_items.lock().map_err(|e| e.to_string())?;
        staged.values().cloned().collect()
    };
    let items_json = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let pm = state.plugin_manager.lock().map_err(|e| e.to_string())?;
    pm.run_plugin(&plugin_path, &items_json)
}

#[tauri::command]
async fn open_script_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScriptWindowState>,
    content: ScriptWindowContent,
) -> Result<(), String> {
    let w = content.width.unwrap_or(380.0);
    let h = content.height.unwrap_or(480.0);
    let title = content.title.clone();

    {
        let mut lock = state.content.lock().map_err(|e| e.to_string())?;
        *lock = Some(content);
    }

    if let Some(win) = app.get_webview_window("script") {
        let _ = win.set_title(&title);
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        let _ = win.set_focus();
        let _ = app.emit("script-window-update", ());
        return Ok(());
    }

    let main_win = app.get_webview_window("main").ok_or("Main window not found")?;
    let monitor = main_win.primary_monitor().map_err(|e| e.to_string())?.ok_or("No monitor")?;
    let screen_size = monitor.size();
    let screen_pos = monitor.position();
    let scale = monitor.scale_factor();

    let margin_right = (16.0 * scale) as i32;
    let margin_bottom = (48.0 * scale) as i32;
    let panel_height = (600.0 * scale) as i32;
    let gap = (8.0 * scale) as i32;

    let win_w = (w * scale) as i32;
    let win_h = (h * scale) as i32;

    let x = screen_pos.x + screen_size.width as i32 - win_w - margin_right;
    let y = screen_pos.y + screen_size.height as i32 - margin_bottom - panel_height - gap - win_h;

    let script_win = tauri::WebviewWindowBuilder::new(
        &app,
        "script",
        tauri::WebviewUrl::App("index.html?window=script".into()),
    )
    .title(&title)
    .inner_size(w, h)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .position(
        (x as f64) / scale,
        (y as f64) / scale,
    )
    .build()
    .map_err(|e| e.to_string())?;

    let _ = script_win.set_focus();
    Ok(())
}

#[tauri::command]
fn update_script_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScriptWindowState>,
    content: ScriptWindowContent,
) -> Result<(), String> {
    let title = content.title.clone();
    {
        let mut lock = state.content.lock().map_err(|e| e.to_string())?;
        *lock = Some(content);
    }
    if let Some(win) = app.get_webview_window("script") {
        let _ = win.set_title(&title);
        let _ = app.emit("script-window-update", ());
    }
    Ok(())
}

#[tauri::command]
fn close_script_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScriptWindowState>,
) -> Result<(), String> {
    {
        let mut lock = state.content.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }
    if let Some(win) = app.get_webview_window("script") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
fn get_script_window_content(
    state: tauri::State<'_, ScriptWindowState>,
) -> Result<Option<ScriptWindowContent>, String> {
    let lock = state.content.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
fn launch_script(
    app: tauri::AppHandle,
    proc_state: tauri::State<'_, ScriptProcessState>,
    script_id: String,
    script_path: String,
) -> Result<(), String> {
    let mut procs = proc_state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = procs.remove(&script_id) {
        let _ = child.kill();
    }

    let sp = PathBuf::from(&script_path);
    let full_path = if sp.is_absolute() && sp.exists() {
        sp
    } else {
        // Try multiple base directories to find the script
        let resource = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let cwd_parent = cwd.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| cwd.clone());
        [
            resource.join(&script_path),
            cwd.join(&script_path),
            cwd_parent.join(&script_path),
        ]
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("Script not found: {} (tried resource_dir, cwd, cwd/..)", script_path))?
    };

    let child = std::process::Command::new("python")
        .arg("-u")
        .arg(&full_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch script '{}': {}", full_path.display(), e))?;

    procs.insert(script_id, child);
    Ok(())
}

#[tauri::command]
fn stop_script(
    proc_state: tauri::State<'_, ScriptProcessState>,
    script_id: String,
) -> Result<(), String> {
    let mut procs = proc_state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = procs.remove(&script_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn set_self_destruct(
    state: tauri::State<'_, AppState>,
    id: String,
    destruct_at: Option<u64>,
) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    if let Some(item) = items.get_mut(&id) {
        item.self_destruct_at = destruct_at;
        persist_items(&items);
        Ok(())
    } else {
        Err("Item not found".to_string())
    }
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
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
async fn open_editor_window(
    app: tauri::AppHandle,
    image_path: String,
    editor_state: tauri::State<'_, EditorImageState>,
) -> Result<(), String> {
    use tauri::Manager;
    // If editor window already exists, just focus it and emit event directly
    if let Some(win) = app.get_webview_window("zenith_editor") {
        win.set_focus().map_err(|e| e.to_string())?;
        win.emit("editor-load-image", &image_path).map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Store path so editor can retrieve it reliably on mount
    {
        let mut pending = editor_state.pending.lock().unwrap();
        *pending = Some(image_path.clone());
    }
    // Open editor window using the same query-param routing as settings/script windows
    let _editor = tauri::WebviewWindowBuilder::new(
        &app,
        "zenith_editor",
        tauri::WebviewUrl::App("/?window=editor".into()),
    )
    .title("Zenith Editor")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .center()
    .decorations(true)
    .transparent(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_editor_window_blank(
    app: tauri::AppHandle,
    editor_state: tauri::State<'_, EditorImageState>,
) -> Result<(), String> {
    use tauri::Manager;
    // If editor window already exists, focus it and emit blank-canvas event
    if let Some(win) = app.get_webview_window("zenith_editor") {
        win.set_focus().map_err(|e| e.to_string())?;
        win.emit("editor-load-image", "").map_err(|e| e.to_string())?;
        return Ok(());
    }
    // Clear any pending path — this is a blank canvas session
    {
        let mut pending = editor_state.pending.lock().unwrap();
        *pending = None;
    }
    let _editor = tauri::WebviewWindowBuilder::new(
        &app,
        "zenith_editor",
        tauri::WebviewUrl::App("/?window=editor".into()),
    )
    .title("Zenith Editor")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .center()
    .decorations(true)
    .transparent(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Called by the editor frontend on mount to retrieve (and clear) the image
/// path that was stored before the window was created.  Returns "" if none.
#[tauri::command]
fn take_pending_editor_image(editor_state: tauri::State<'_, EditorImageState>) -> String {
    let mut pending = editor_state.pending.lock().unwrap();
    pending.take().unwrap_or_default()
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

#[tauri::command]
async fn save_clipboard_image(data_b64: String, ext: String) -> Result<String, String> {
    use std::io::Write;
    let temp_dir = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string().replace('-', "");
    let safe_ext = if ext.starts_with('.') { ext } else { format!(".{}", ext) };
    let filename = format!("clipboard_paste_{}{}", &uuid[..8], safe_ext);
    let out_path = temp_dir.join(&filename);
    let img_bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let mut file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
    file.write_all(&img_bytes).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
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
fn list_directory(path: String) -> Result<Vec<serde_json::Value>, String> {
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
            a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
        })
    });
    Ok(entries)
}

#[tauri::command]
fn email_files(paths: Vec<String>, to: String, subject: String, body: String) -> Result<(), String> {
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
    let attachment_params: String = paths.iter()
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

/* ─── Smart Rename Engine ─── */

fn rename_history_path() -> PathBuf {
    std::env::temp_dir().join("Zenith").join("rename_history.json")
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct RenameOp {
    id: String,
    original_path: String,
    new_path: String,
    timestamp: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct RenameHistory {
    undo_stack: Vec<RenameOp>,
    redo_stack: Vec<RenameOp>,
}

fn load_rename_history() -> RenameHistory {
    let path = rename_history_path();
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    } else {
        RenameHistory::default()
    }
}

fn save_rename_history(h: &RenameHistory) -> Result<(), String> {
    let path = rename_history_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn apply_rename(old_path: String, new_stem: String) -> Result<String, String> {
    let p = PathBuf::from(&old_path);
    if !p.exists() {
        return Err(format!("File not found: {}", old_path));
    }

    // Extension protection: always preserve the original extension
    let original_ext = p.extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let safe_stem = new_stem.trim().replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    if safe_stem.is_empty() {
        return Err("New filename stem cannot be empty".to_string());
    }
    let new_name = format!("{}{}", safe_stem, original_ext);
    let new_path = p.parent()
        .map(|par| par.join(&new_name))
        .ok_or("Cannot determine parent directory")?;

    if new_path == p {
        return Ok(serde_json::json!({"renamed": false, "reason": "Same name"}).to_string());
    }
    if new_path.exists() {
        return Err(format!("Target already exists: {}", new_path.display()));
    }

    fs::rename(&p, &new_path)
        .map_err(|e| format!("Rename failed: {}", e))?;

    // Push to undo stack, clear redo stack
    let mut history = load_rename_history();
    let op = RenameOp {
        id: uuid::Uuid::new_v4().to_string(),
        original_path: old_path.clone(),
        new_path: new_path.to_string_lossy().to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    history.undo_stack.push(op);
    history.redo_stack.clear();
    save_rename_history(&history)?;

    Ok(serde_json::json!({
        "renamed": true,
        "old_path": old_path,
        "new_path": new_path.to_string_lossy(),
        "new_name": new_name,
        "undo_count": history.undo_stack.len(),
        "redo_count": 0
    }).to_string())
}

#[tauri::command]
fn undo_last_rename() -> Result<String, String> {
    let mut history = load_rename_history();
    let op = history.undo_stack.pop()
        .ok_or("Nothing to undo")?;

    let new_pb = PathBuf::from(&op.new_path);
    let old_pb = PathBuf::from(&op.original_path);

    if !new_pb.exists() {
        return Err(format!("File no longer exists: {}", op.new_path));
    }
    if old_pb.exists() {
        return Err(format!("Original path already occupied: {}", op.original_path));
    }

    fs::rename(&new_pb, &old_pb)
        .map_err(|e| format!("Undo rename failed: {}", e))?;

    history.redo_stack.push(op.clone());
    save_rename_history(&history)?;

    Ok(serde_json::json!({
        "undone": true,
        "restored_path": op.original_path,
        "from_path": op.new_path,
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    }).to_string())
}

#[tauri::command]
fn redo_last_rename() -> Result<String, String> {
    let mut history = load_rename_history();
    let op = history.redo_stack.pop()
        .ok_or("Nothing to redo")?;

    let old_pb = PathBuf::from(&op.original_path);
    let new_pb = PathBuf::from(&op.new_path);

    if !old_pb.exists() {
        return Err(format!("File no longer exists: {}", op.original_path));
    }
    if new_pb.exists() {
        return Err(format!("Target path already occupied: {}", op.new_path));
    }

    fs::rename(&old_pb, &new_pb)
        .map_err(|e| format!("Redo rename failed: {}", e))?;

    history.undo_stack.push(op.clone());
    save_rename_history(&history)?;

    Ok(serde_json::json!({
        "redone": true,
        "new_path": op.new_path,
        "from_path": op.original_path,
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    }).to_string())
}

#[tauri::command]
fn get_rename_history_counts() -> Result<String, String> {
    let history = load_rename_history();
    Ok(serde_json::json!({
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    }).to_string())
}

#[tauri::command]
fn move_files(moves_json: String) -> Result<String, String> {
    let moves: Vec<serde_json::Value> = serde_json::from_str(&moves_json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut executed: Vec<serde_json::Value> = Vec::new();
    for mv in &moves {
        let old_path = mv["old_path"].as_str().ok_or("Missing old_path")?;
        let new_path = mv["new_path"].as_str().ok_or("Missing new_path")?;
        let new_pb = PathBuf::from(new_path);
        if let Some(parent) = new_pb.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create dir: {}", e))?;
        }
        fs::rename(old_path, new_path)
            .map_err(|e| format!("Failed to move {} -> {}: {}", old_path, new_path, e))?;
        executed.push(serde_json::json!({"old_path": old_path, "new_path": new_path}));
    }

    // Save undo mapping to temp
    let temp = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp).ok();
    let history_path = temp.join("mapping_history.json");
    let history_json = serde_json::to_string_pretty(&executed)
        .map_err(|e| e.to_string())?;
    fs::write(&history_path, &history_json).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "moved": executed.len(),
        "undo_path": history_path.to_string_lossy()
    }).to_string())
}

#[tauri::command]
fn undo_moves() -> Result<String, String> {
    let temp = std::env::temp_dir().join("Zenith");
    let history_path = temp.join("mapping_history.json");
    if !history_path.exists() {
        return Err("No move history found".to_string());
    }

    let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    let moves: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid history: {}", e))?;

    let mut reverted = 0;
    for mv in moves.iter().rev() {
        let old_path = mv["old_path"].as_str().unwrap_or("");
        let new_path = mv["new_path"].as_str().unwrap_or("");
        if new_path.is_empty() || old_path.is_empty() { continue; }
        if PathBuf::from(new_path).exists() {
            if let Some(parent) = PathBuf::from(old_path).parent() {
                fs::create_dir_all(parent).ok();
            }
            if fs::rename(new_path, old_path).is_ok() {
                reverted += 1;
            }
        }
    }

    // Delete downloaded posters from the latest transaction JSON
    let mut posters_deleted = 0;
    if let Ok(entries) = fs::read_dir(&temp) {
        let mut tx_files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().unwrap_or_default().to_string_lossy().starts_with("tx_"))
            .collect();
        tx_files.sort();
        if let Some(latest_tx) = tx_files.last() {
            if let Ok(tx_content) = fs::read_to_string(latest_tx) {
                if let Ok(tx_data) = serde_json::from_str::<serde_json::Value>(&tx_content) {
                    if let Some(posters) = tx_data["posters"].as_array() {
                        for poster in posters {
                            if let Some(pp) = poster.as_str() {
                                if fs::remove_file(pp).is_ok() {
                                    posters_deleted += 1;
                                }
                            }
                        }
                    }
                }
            }
            fs::remove_file(latest_tx).ok();
        }
    }

    // Clean up empty folders created during organize (walk up parents)
    let mut dirs_to_check: Vec<PathBuf> = Vec::new();
    for mv in &moves {
        if let Some(new_path) = mv["new_path"].as_str() {
            let mut p = PathBuf::from(new_path);
            while let Some(parent) = p.parent() {
                if parent == p || parent.to_string_lossy().len() <= 3 { break; }
                dirs_to_check.push(parent.to_path_buf());
                p = parent.to_path_buf();
            }
        }
    }
    // Sort deepest first so we remove children before parents
    dirs_to_check.sort_by(|a, b| b.to_string_lossy().len().cmp(&a.to_string_lossy().len()));
    dirs_to_check.dedup();
    for dir in &dirs_to_check {
        let _ = fs::remove_dir(dir); // Only removes if empty
    }

    fs::remove_file(&history_path).ok();
    Ok(serde_json::json!({"reverted": reverted, "posters_deleted": posters_deleted}).to_string())
}

#[tauri::command]
fn walk_directory(paths_json: String) -> Result<String, String> {
    let input_paths: Vec<String> = serde_json::from_str(&paths_json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut files: Vec<serde_json::Value> = Vec::new();

    for p in &input_paths {
        let path = PathBuf::from(p);
        if path.is_file() {
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            files.push(serde_json::json!({
                "path": p,
                "name": path.file_name().unwrap_or_default().to_string_lossy(),
                "size": size,
                "is_expanded": false,
            }));
        } else if path.is_dir() {
            for entry in walkdir::WalkDir::new(&path)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let ep = entry.path();
                if ep.is_file() {
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let rel = ep.strip_prefix(&path).unwrap_or(ep);
                    files.push(serde_json::json!({
                        "path": ep.to_string_lossy(),
                        "name": ep.file_name().unwrap_or_default().to_string_lossy(),
                        "size": size,
                        "is_expanded": true,
                        "source_folder": p,
                        "relative_path": rel.to_string_lossy(),
                    }));
                }
            }
        }
    }

    Ok(serde_json::json!({
        "files": files,
        "total": files.len(),
    }).to_string())
}

#[tauri::command]
fn execute_studio_plan(moves_json: String) -> Result<String, String> {
    let moves: Vec<serde_json::Value> = serde_json::from_str(&moves_json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut executed: Vec<serde_json::Value> = Vec::new();
    let mut poster_files: Vec<String> = Vec::new();

    for mv in &moves {
        let old_path = mv["old_path"].as_str().ok_or("Missing old_path")?;
        let new_path = mv["new_path"].as_str().ok_or("Missing new_path")?;
        let poster_url = mv["poster_url"].as_str().unwrap_or("");

        let new_pb = PathBuf::from(new_path);
        if let Some(parent) = new_pb.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create dir: {}", e))?;
        }

        // Download poster if URL provided
        if !poster_url.is_empty() {
            if let Some(parent) = new_pb.parent() {
                let poster_ext = if poster_url.contains(".png") { "png" } else { "jpg" };
                let poster_name = format!(
                    "poster.{}",
                    poster_ext
                );
                let poster_path = parent.join(&poster_name);
                // Best-effort download — don't fail the whole plan on poster errors
                if let Ok(output) = std::process::Command::new("curl")
                    .args(["-sL", "-o", &poster_path.to_string_lossy(), poster_url])
                    .output()
                {
                    if output.status.success() && poster_path.exists() {
                        poster_files.push(poster_path.to_string_lossy().to_string());
                    }
                }
            }
        }

        fs::rename(old_path, new_path)
            .map_err(|e| format!("Failed to move {} -> {}: {}", old_path, new_path, e))?;
        executed.push(serde_json::json!({"old_path": old_path, "new_path": new_path}));
    }

    // Save undo mapping (includes poster paths for cleanup)
    let temp = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp).ok();
    let tx_id = uuid::Uuid::new_v4().to_string();
    let tx_path = temp.join(format!("tx_{}.json", tx_id));
    let tx_data = serde_json::json!({
        "moves": executed,
        "posters": poster_files,
    });
    fs::write(&tx_path, serde_json::to_string_pretty(&tx_data).unwrap_or_default()).ok();

    // Also save as latest mapping_history.json for undo_moves compatibility
    let history_path = temp.join("mapping_history.json");
    let history_json = serde_json::to_string_pretty(&executed).map_err(|e| e.to_string())?;
    fs::write(&history_path, &history_json).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "moved": executed.len(),
        "posters_downloaded": poster_files.len(),
        "transaction_id": tx_id,
    }).to_string())
}

#[tauri::command]
async fn process_file(
    app: tauri::AppHandle,
    _proc_state: tauri::State<'_, ScriptProcessState>,
    action: String,
    args_json: String,
) -> Result<String, String> {
    let resource = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cwd_parent = cwd.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| cwd.clone());
    let script = "scripts/process_files.py";
    let full_path = [
        resource.join(script),
        cwd.join(script),
        cwd_parent.join(script),
    ]
    .into_iter()
    .find(|p| p.exists())
    .ok_or_else(|| "process_files.py not found".to_string())?;

    let mut cmd = std::process::Command::new("python");
    cmd.arg("-u")
        .arg(&full_path)
        .arg(&action)
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Suppress CMD window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to run process_files.py: {}", e))?;

    // Write args JSON to stdin (avoids Windows 32K command-line length limit)
    {
        use std::io::Write;
        let stdin_pipe = child.stdin.take()
            .ok_or_else(|| "Failed to open stdin pipe".to_string())?;
        let mut writer = std::io::BufWriter::new(stdin_pipe);
        writer.write_all(args_json.as_bytes())
            .map_err(|e| format!("Failed to write args to stdin: {}", e))?;
        // writer + stdin_pipe dropped here → closes pipe → Python sees EOF
    }

    // Track the process so it can be cancelled
    let pid_key = format!("pf_{}_{}", action, chrono_id());
    {
        // We can't store the child directly since we need to wait on it,
        // but we store the PID for cancellation
    }
    let child_id = child.id();
    // Store a placeholder — for cancellation we just need the PID
    let _ = app.emit("script-started", serde_json::json!({"id": &pid_key, "pid": child_id, "action": &action}));

    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to run process_files.py: {}", e))?;

    let _ = app.emit("script-finished", serde_json::json!({"id": &pid_key, "action": &action}));

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("Script error: {} {}", stderr, stdout));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(stdout)
}

#[tauri::command]
fn cancel_all_scripts(
    proc_state: tauri::State<'_, ScriptProcessState>,
) -> Result<String, String> {
    let mut procs = proc_state.processes.lock().map_err(|e| e.to_string())?;
    let count = procs.len();
    for (_id, child) in procs.iter_mut() {
        let _ = child.kill();
    }
    procs.clear();
    Ok(serde_json::json!({"cancelled": count}).to_string())
}

#[tauri::command]
fn read_file_preview(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    if p.is_dir() {
        return Err("Cannot preview a directory".to_string());
    }
    let limit = max_bytes.unwrap_or(512_000); // 500KB default
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
fn is_script_running(
    proc_state: tauri::State<'_, ScriptProcessState>,
    script_id: String,
) -> Result<bool, String> {
    let mut procs = proc_state.processes.lock().map_err(|e| e.to_string())?;
    if let Some(child) = procs.get_mut(&script_id) {
        match child.try_wait() {
            Ok(Some(_)) => {
                procs.remove(&script_id);
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(_) => {
                procs.remove(&script_id);
                Ok(false)
            }
        }
    } else {
        Ok(false)
    }
}

fn chrono_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}{:03}", d.as_secs(), d.subsec_millis())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            staged_items: Arc::new(Mutex::new(load_persisted_items())),
            plugin_manager: Mutex::new(
                plugins::PluginManager::new().expect("Failed to init plugin manager"),
            ),
        })
        .manage(SettingsState {
            settings: Mutex::new(ZenithSettings::load()),
        })
        .manage(ScriptWindowState {
            content: Arc::new(Mutex::new(None)),
            events: Arc::new(Mutex::new(Vec::new())),
        })
        .manage(ScriptProcessState {
            processes: Mutex::new(HashMap::new()),
        })
        .manage(EditorImageState {
            pending: Mutex::new(None),
        })
        .setup(|app| {
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Zenith", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(Image::from_path("icons/32x32.png").unwrap_or_else(|_| {
                    app.default_window_icon().cloned().unwrap()
                }))
                .menu(&menu)
                .tooltip("Zenith - File Staging Area")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "settings" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_settings(handle).await;
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Background thread: self-destruct expired items every 10s
            let destruct_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    let app_st: tauri::State<'_, AppState> = destruct_handle.state();
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let mut items = match app_st.staged_items.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };
                    let expired: Vec<String> = items
                        .iter()
                        .filter_map(|(id, item)| {
                            item.self_destruct_at
                                .filter(|&t| t > 0 && now >= t)
                                .map(|_| id.clone())
                        })
                        .collect();
                    for id in &expired {
                        items.remove(id);
                    }
                    drop(items);
                    if !expired.is_empty() {
                        let _ = destruct_handle.emit("items-changed", ());
                    }
                }
            });

            let app_state: tauri::State<'_, AppState> = app.state();
            let items_for_api = app_state.staged_items.clone();
            let sw_state: tauri::State<'_, ScriptWindowState> = app.state();
            let script_content_for_api = sw_state.content.clone();
            let script_events_for_api = sw_state.events.clone();
            let api_app_handle = app.handle().clone();
            api_server::ApiServer::start(items_for_api, script_content_for_api, script_events_for_api, api_app_handle);

            // Listen for script-window-open from the API server and create the window
            let open_handle = app.handle().clone();
            app.listen("script-window-open", move |_| {
                let h = open_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let sw: tauri::State<'_, ScriptWindowState> = h.state();
                    let content = {
                        let lock = sw.content.lock().unwrap();
                        lock.clone()
                    };
                    if let Some(c) = content {
                        let _ = open_script_window(h.clone(), h.state(), c).await;
                    }
                });
            });

            // Listen for script-window-close from the API server
            let close_handle = app.handle().clone();
            app.listen("script-window-close", move |_| {
                let h = close_handle.clone();
                let sw: tauri::State<'_, ScriptWindowState> = h.state();
                let _ = close_script_window(h.clone(), sw);
            });

            let window = app.get_webview_window("main").unwrap();

            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = app_handle.emit("window-blur", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_ignore_cursor,
            resize_window,
            stage_file,
            remove_staged_item,
            clear_all_items,
            get_staged_items,
            start_drag_out,
            stage_text,
            list_plugins,
            run_plugin,
            get_settings,
            save_settings,
            open_settings,
            open_script_window,
            update_script_window,
            close_script_window,
            get_script_window_content,
            launch_script,
            stop_script,
            is_script_running,
            process_file,
            set_self_destruct,
            reveal_in_folder,
            open_file,
            list_directory,
            email_files,
            move_files,
            undo_moves,
            execute_studio_plan,
            walk_directory,
            apply_rename,
            undo_last_rename,
            redo_last_rename,
            get_rename_history_counts,
            read_file_preview,
            cancel_all_scripts,
            open_editor_window,
            open_editor_window_blank,
            take_pending_editor_image,
            save_clipboard_image,
            read_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
