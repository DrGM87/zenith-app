use base64::Engine;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tauri::State;

use crate::{AppState, StagedItem, ZenithError};

pub fn chrono_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn get_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/vnd.microsoft.icon",
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

pub fn generate_thumbnail(path: &str) -> Option<String> {
    let path = path.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let ext = PathBuf::from(&path)
                .extension()?
                .to_str()?
                .to_lowercase();

            let image_exts = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico"];
            if !image_exts.contains(&ext.as_str()) {
                return None;
            }

            let img = image::open(&path).ok()?;
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
        })();
        let _ = tx.send(result);
    });
    rx.recv().unwrap()
}

pub fn create_staged_item_from_path(path: &str) -> Result<StagedItem, ZenithError> {
    let pb = PathBuf::from(path);
    if !pb.exists() {
        return Err(ZenithError::FileNotFound {
            path: path.to_string(),
        });
    }

    let metadata = fs::metadata(&pb).map_err(|e| ZenithError::Internal {
        detail: e.to_string(),
    })?;
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

pub fn state_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local).join("Zenith").join("state.json")
}

pub fn persist_items(state: &AppState, items: &HashMap<String, StagedItem>) {
    let now = Instant::now();
    let mut last = state.last_persist.lock().unwrap();
    if now.duration_since(*last).as_millis() < 500 {
        return;
    }
    *last = now;
    drop(last);
    force_persist_items(items);
}

pub fn force_persist_items(items: &HashMap<String, StagedItem>) {
    let path = state_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let vals: Vec<&StagedItem> = items.values().collect();
    if let Ok(json) = serde_json::to_string(&vals) {
        let _ = fs::write(&path, json);
    }
}

pub fn load_persisted_items() -> HashMap<String, StagedItem> {
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
pub fn stage_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<StagedItem, String> {
    let item = create_staged_item_from_path(&path).map_err(|e| e.to_string())?;
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.insert(item.id.clone(), item.clone());
    persist_items(&state, &items);
    Ok(item)
}

#[tauri::command]
pub fn remove_staged_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.remove(&id);
    persist_items(&state, &items);
    Ok(())
}

#[tauri::command]
pub fn clear_all_items(state: State<'_, AppState>) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    items.clear();
    force_persist_items(&items);
    Ok(())
}

#[tauri::command]
pub fn get_staged_items(state: State<'_, AppState>) -> Result<Vec<StagedItem>, String> {
    let items = state.staged_items.lock().map_err(|e| e.to_string())?;
    Ok(items.values().cloned().collect())
}

#[tauri::command]
pub fn stage_text(
    state: State<'_, AppState>,
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
    persist_items(&state, &items);

    Ok(item)
}

#[tauri::command]
pub fn set_self_destruct(
    state: State<'_, AppState>,
    id: String,
    destruct_at: Option<u64>,
) -> Result<(), String> {
    let mut items = state.staged_items.lock().map_err(|e| e.to_string())?;
    if let Some(item) = items.get_mut(&id) {
        item.self_destruct_at = destruct_at;
        persist_items(&state, &items);
        Ok(())
    } else {
        Err("Item not found".to_string())
    }
}
