use std::fs;
use std::path::PathBuf;

fn activity_log_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local).join("Zenith").join("activity_log.json")
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ActivityEntry {
    timestamp: u64,
    action: String,
    details: String,
}

#[tauri::command]
pub fn log_activity(action: String, details: String) -> Result<(), String> {
    let path = activity_log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut entries: Vec<ActivityEntry> = if path.exists() {
        let c = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&c).unwrap_or_default()
    } else {
        vec![]
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    entries.push(ActivityEntry {
        timestamp: now,
        action,
        details,
    });
    if entries.len() > 500 {
        entries = entries.split_off(entries.len() - 500);
    }
    let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_activity_log() -> Result<Vec<serde_json::Value>, String> {
    let path = activity_log_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let c = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_activity_log() -> Result<(), String> {
    let path = activity_log_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn tags_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(local).join("Zenith").join("tags.json")
}

#[tauri::command]
pub fn get_tags() -> Result<serde_json::Value, String> {
    let path = tags_path();
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let c = fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_tag(item_id: String, tag_name: String, color: String) -> Result<(), String> {
    let path = tags_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut tags: serde_json::Value = if path.exists() {
        let c = fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
        serde_json::from_str(&c).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    tags[&item_id] = serde_json::json!({"name": tag_name, "color": color});
    let json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag(item_id: String) -> Result<(), String> {
    let path = tags_path();
    if !path.exists() {
        return Ok(());
    }
    let c = fs::read_to_string(&path).unwrap_or_else(|_| "{}".into());
    let mut tags: serde_json::Value =
        serde_json::from_str(&c).map_err(|e| e.to_string())?;
    if let Some(obj) = tags.as_object_mut() {
        obj.remove(&item_id);
    }
    let json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
