use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RenameOp {
    pub id: String,
    pub original_path: String,
    pub new_path: String,
    pub timestamp: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct RenameHistory {
    pub undo_stack: Vec<RenameOp>,
    pub redo_stack: Vec<RenameOp>,
}

pub fn rename_history_path() -> PathBuf {
    std::env::temp_dir().join("Zenith").join("rename_history.json")
}

pub fn load_rename_history() -> RenameHistory {
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

pub fn save_rename_history(h: &RenameHistory) -> Result<(), String> {
    let path = rename_history_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn apply_rename(old_path: String, new_stem: String) -> Result<String, String> {
    let p = PathBuf::from(&old_path);
    if !p.exists() {
        return Err(format!("File not found: {}", old_path));
    }

    let original_ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let safe_stem = new_stem
        .trim()
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    if safe_stem.is_empty() {
        return Err("New filename stem cannot be empty".to_string());
    }
    let new_name = format!("{}{}", safe_stem, original_ext);
    let new_path = p
        .parent()
        .map(|par| par.join(&new_name))
        .ok_or("Cannot determine parent directory")?;

    if new_path == p {
        return Ok(
            serde_json::json!({"renamed": false, "reason": "Same name"}).to_string(),
        );
    }
    if new_path.exists() {
        return Err(format!("Target already exists: {}", new_path.display()));
    }

    fs::rename(&p, &new_path).map_err(|e| format!("Rename failed: {}", e))?;

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
    })
    .to_string())
}

#[tauri::command]
pub fn undo_last_rename() -> Result<String, String> {
    let mut history = load_rename_history();
    let op = history.undo_stack.pop().ok_or("Nothing to undo")?;

    let new_pb = PathBuf::from(&op.new_path);
    let old_pb = PathBuf::from(&op.original_path);

    if !new_pb.exists() {
        return Err(format!("File no longer exists: {}", op.new_path));
    }
    if old_pb.exists() {
        return Err(format!(
            "Original path already occupied: {}",
            op.original_path
        ));
    }

    fs::rename(&new_pb, &old_pb).map_err(|e| format!("Undo rename failed: {}", e))?;

    history.redo_stack.push(op.clone());
    save_rename_history(&history)?;

    Ok(serde_json::json!({
        "undone": true,
        "restored_path": op.original_path,
        "from_path": op.new_path,
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    })
    .to_string())
}

#[tauri::command]
pub fn redo_last_rename() -> Result<String, String> {
    let mut history = load_rename_history();
    let op = history.redo_stack.pop().ok_or("Nothing to redo")?;

    let old_pb = PathBuf::from(&op.original_path);
    let new_pb = PathBuf::from(&op.new_path);

    if !old_pb.exists() {
        return Err(format!("File no longer exists: {}", op.original_path));
    }
    if new_pb.exists() {
        return Err(format!(
            "Target path already occupied: {}",
            op.new_path
        ));
    }

    fs::rename(&old_pb, &new_pb).map_err(|e| format!("Redo rename failed: {}", e))?;

    history.undo_stack.push(op.clone());
    save_rename_history(&history)?;

    Ok(serde_json::json!({
        "redone": true,
        "new_path": op.new_path,
        "from_path": op.original_path,
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    })
    .to_string())
}

#[tauri::command]
pub fn get_rename_history_counts() -> Result<String, String> {
    let history = load_rename_history();
    Ok(serde_json::json!({
        "undo_count": history.undo_stack.len(),
        "redo_count": history.redo_stack.len()
    })
    .to_string())
}
