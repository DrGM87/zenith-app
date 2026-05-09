use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager,
};

mod api_server;
mod commands;
mod plugins;
mod settings;

pub use commands::*;
use settings::{SettingsState, ZenithSettings};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ZenithError {
    FileNotFound { path: String },
    InvalidInput { detail: String },
    Internal { detail: String },
}

impl std::fmt::Display for ZenithError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FileNotFound { path } => write!(f, "File not found: {}", path),
            Self::InvalidInput { detail } => write!(f, "Invalid input: {}", detail),
            Self::Internal { detail } => write!(f, "Internal error: {}", detail),
        }
    }
}

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
    pub last_persist: Arc<Mutex<Instant>>,
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

pub struct EditorImageState {
    pub pending: Mutex<Option<String>>,
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
            last_persist: Arc::new(Mutex::new(Instant::now())),
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
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
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
            api_server::ApiServer::start(
                items_for_api,
                script_content_for_api,
                script_events_for_api,
                api_app_handle,
            );

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
            ping_url,
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
            open_music_discovery_window,
            take_pending_editor_image,
            save_clipboard_image,
            read_file_base64,
            store_api_key,
            get_api_key,
            delete_api_key,
            store_secret_key,
            get_secret_key,
            log_activity,
            get_activity_log,
            clear_activity_log,
            get_tags,
            set_tag,
            remove_tag,
            export_settings,
            import_settings,
            save_clipboard_entry,
            get_clipboard_history,
            clear_clipboard_history,
            launch_snipping_tool,
            record_and_recognize,
            get_music_discovery,
            save_music_track,
            delete_music_track,
            check_items_exist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
