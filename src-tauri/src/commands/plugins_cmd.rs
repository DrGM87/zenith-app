use tauri::State;

use crate::{plugins, AppState, StagedItem};

#[tauri::command]
pub fn list_plugins(
    state: State<'_, AppState>,
) -> Result<Vec<plugins::PluginInfo>, String> {
    let pm = state.plugin_manager.lock().map_err(|e| e.to_string())?;
    pm.list_plugins()
}

#[tauri::command]
pub fn run_plugin(
    state: State<'_, AppState>,
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
