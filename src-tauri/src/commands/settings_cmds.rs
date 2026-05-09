use tauri::{AppHandle, Emitter, State};

use crate::settings::{SettingsState, ZenithSettings};

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<ZenithSettings, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    new_settings: ZenithSettings,
) -> Result<(), String> {
    let theme = new_settings.appearance.theme.clone();
    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
    *s = new_settings;
    s.save()?;
    drop(s);
    let _ = app.emit("settings-changed", ());
    let _ = app.emit("theme-changed", theme);
    Ok(())
}

const KEYRING_SERVICE: &str = "zenith-app";

#[tauri::command]
pub fn store_api_key(provider: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("api_key/{}", provider))
        .map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_api_key(provider: String) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("api_key/{}", provider))
        .map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("api_key/{}", provider))
        .map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_secret_key(key_name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("secret/{}", key_name))
        .map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_secret_key(key_name: String) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("secret/{}", key_name))
        .map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}
