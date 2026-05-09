use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    commands::staging::chrono_id,
    ScriptProcessState, ScriptWindowContent, ScriptWindowState,
};

#[tauri::command]
pub async fn open_script_window(
    app: AppHandle,
    state: State<'_, ScriptWindowState>,
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

    let main_win = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let monitor = main_win
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor")?;
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
    .position((x as f64) / scale, (y as f64) / scale)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = script_win.set_focus();
    Ok(())
}

#[tauri::command]
pub fn update_script_window(
    app: AppHandle,
    state: State<'_, ScriptWindowState>,
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
pub fn close_script_window(
    app: AppHandle,
    state: State<'_, ScriptWindowState>,
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
pub fn get_script_window_content(
    state: State<'_, ScriptWindowState>,
) -> Result<Option<ScriptWindowContent>, String> {
    let lock = state.content.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}

#[tauri::command]
pub fn launch_script(
    app: AppHandle,
    proc_state: State<'_, ScriptProcessState>,
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
        let resource = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let cwd_parent = cwd
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| cwd.clone());
        [resource.join(&script_path), cwd.join(&script_path), cwd_parent.join(&script_path)]
            .into_iter()
            .find(|p| p.exists())
            .ok_or_else(|| {
                format!(
                    "Script not found: {} (tried resource_dir, cwd, cwd/..)",
                    script_path
                )
            })?
    };

    let child = std::process::Command::new("python")
        .arg("-u")
        .arg(&full_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to launch script '{}': {}",
                full_path.display(),
                e
            )
        })?;

    procs.insert(script_id, child);
    Ok(())
}

#[tauri::command]
pub fn stop_script(
    proc_state: State<'_, ScriptProcessState>,
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
pub async fn process_file(
    app: AppHandle,
    _proc_state: State<'_, ScriptProcessState>,
    action: String,
    args_json: String,
) -> Result<String, String> {
    let resource = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cwd_parent = cwd
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| cwd.clone());
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

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run process_files.py: {}", e))?;

    {
        use std::io::Write;
        let stdin_pipe = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open stdin pipe".to_string())?;
        let mut writer = std::io::BufWriter::new(stdin_pipe);
        writer
            .write_all(args_json.as_bytes())
            .map_err(|e| format!("Failed to write args to stdin: {}", e))?;
    }

    let pid_key = format!("pf_{}_{}", action, chrono_id());
    let child_id = child.id();
    let _ = app.emit(
        "script-started",
        serde_json::json!({"id": &pid_key, "pid": child_id, "action": &action}),
    );

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to run process_files.py: {}", e))?;

    let _ = app.emit(
        "script-finished",
        serde_json::json!({"id": &pid_key, "action": &action}),
    );

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("Script error: {} {}", stderr, stdout));
    }

    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    Ok(stdout)
}

#[tauri::command]
pub fn cancel_all_scripts(
    proc_state: State<'_, ScriptProcessState>,
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
pub fn is_script_running(
    proc_state: State<'_, ScriptProcessState>,
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
