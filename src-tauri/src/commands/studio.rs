use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn move_files(moves_json: String) -> Result<String, String> {
    let moves: Vec<serde_json::Value> =
        serde_json::from_str(&moves_json).map_err(|e| format!("Invalid JSON: {}", e))?;

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

    let temp = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp).ok();
    let history_path = temp.join("mapping_history.json");
    let history_json =
        serde_json::to_string_pretty(&executed).map_err(|e| e.to_string())?;
    fs::write(&history_path, &history_json).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "moved": executed.len(),
        "undo_path": history_path.to_string_lossy()
    })
    .to_string())
}

#[tauri::command]
pub fn undo_moves() -> Result<String, String> {
    let temp = std::env::temp_dir().join("Zenith");
    let history_path = temp.join("mapping_history.json");
    if !history_path.exists() {
        return Err("No move history found".to_string());
    }

    let content = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    let moves: Vec<serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| format!("Invalid history: {}", e))?;

    let mut reverted = 0;
    for mv in moves.iter().rev() {
        let old_path = mv["old_path"].as_str().unwrap_or("");
        let new_path = mv["new_path"].as_str().unwrap_or("");
        if new_path.is_empty() || old_path.is_empty() {
            continue;
        }
        if PathBuf::from(new_path).exists() {
            if let Some(parent) = PathBuf::from(old_path).parent() {
                fs::create_dir_all(parent).ok();
            }
            if fs::rename(new_path, old_path).is_ok() {
                reverted += 1;
            }
        }
    }

    let mut posters_deleted = 0;
    if let Ok(entries) = fs::read_dir(&temp) {
        let mut tx_files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .starts_with("tx_")
            })
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

    let mut dirs_to_check: Vec<PathBuf> = Vec::new();
    for mv in &moves {
        if let Some(new_path) = mv["new_path"].as_str() {
            let mut p = PathBuf::from(new_path);
            while let Some(parent) = p.parent() {
                if parent == p || parent.to_string_lossy().len() <= 3 {
                    break;
                }
                dirs_to_check.push(parent.to_path_buf());
                p = parent.to_path_buf();
            }
        }
    }
    dirs_to_check.sort_by(|a, b| {
        b.to_string_lossy()
            .len()
            .cmp(&a.to_string_lossy().len())
    });
    dirs_to_check.dedup();
    for dir in &dirs_to_check {
        let _ = fs::remove_dir(dir);
    }

    fs::remove_file(&history_path).ok();
    Ok(serde_json::json!({"reverted": reverted, "posters_deleted": posters_deleted}).to_string())
}

#[tauri::command]
pub fn walk_directory(paths_json: String) -> Result<String, String> {
    let input_paths: Vec<String> =
        serde_json::from_str(&paths_json).map_err(|e| format!("Invalid JSON: {}", e))?;

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
    })
    .to_string())
}

#[tauri::command]
pub fn execute_studio_plan(moves_json: String) -> Result<String, String> {
    let moves: Vec<serde_json::Value> =
        serde_json::from_str(&moves_json).map_err(|e| format!("Invalid JSON: {}", e))?;

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

        if !poster_url.is_empty() {
            if let Some(parent) = new_pb.parent() {
                let poster_ext = if poster_url.contains(".png") {
                    "png"
                } else {
                    "jpg"
                };
                let poster_name = format!("poster.{}", poster_ext);
                let poster_path = parent.join(&poster_name);
                if let Ok(output) = std::process::Command::new("curl")
                    .args([
                        "-sL",
                        "-o",
                        &poster_path.to_string_lossy(),
                        poster_url,
                    ])
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

    let temp = std::env::temp_dir().join("Zenith");
    fs::create_dir_all(&temp).ok();
    let tx_id = uuid::Uuid::new_v4().to_string();
    let tx_path = temp.join(format!("tx_{}.json", tx_id));
    let tx_data = serde_json::json!({
        "moves": executed,
        "posters": poster_files,
    });
    fs::write(
        &tx_path,
        serde_json::to_string_pretty(&tx_data).unwrap_or_default(),
    )
    .ok();

    let history_path = temp.join("mapping_history.json");
    let history_json =
        serde_json::to_string_pretty(&executed).map_err(|e| e.to_string())?;
    fs::write(&history_path, &history_json).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "moved": executed.len(),
        "posters_downloaded": poster_files.len(),
        "transaction_id": tx_id,
    })
    .to_string())
}
