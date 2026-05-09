use tauri::{AppHandle, Emitter, Manager, State};

use crate::EditorImageState;

#[tauri::command]
pub async fn open_editor_window(
    app: AppHandle,
    image_path: String,
    editor_state: State<'_, EditorImageState>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("zenith_editor") {
        win.set_focus().map_err(|e| e.to_string())?;
        win.emit("editor-load-image", &image_path)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    {
        let mut pending = editor_state.pending.lock().unwrap();
        *pending = Some(image_path.clone());
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

#[tauri::command]
pub async fn open_editor_window_blank(
    app: AppHandle,
    editor_state: State<'_, EditorImageState>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("zenith_editor") {
        win.set_focus().map_err(|e| e.to_string())?;
        win.emit("editor-load-image", "").map_err(|e| e.to_string())?;
        return Ok(());
    }
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

#[tauri::command]
pub async fn open_music_discovery_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("music_discovery") {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "music_discovery",
        tauri::WebviewUrl::App("/?window=music".into()),
    )
    .title("Zenith Music Discovery")
    .inner_size(800.0, 600.0)
    .min_inner_size(600.0, 400.0)
    .center()
    .decorations(true)
    .transparent(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn take_pending_editor_image(
    editor_state: State<'_, EditorImageState>,
) -> String {
    let mut pending = editor_state.pending.lock().unwrap();
    pending.take().unwrap_or_default()
}
