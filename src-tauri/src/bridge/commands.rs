use crate::{
    audio::source::{self, AudioSourcePreset},
    bridge::events,
    config::{schema::AppSettings, store},
    platform, window,
};

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn get_app_settings() -> AppSettings {
    store::load()
}

#[tauri::command]
pub fn list_audio_source_presets() -> Vec<AudioSourcePreset> {
    source::list_source_presets()
}

#[tauri::command]
pub fn save_app_settings(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    #[cfg(target_os = "windows")]
    platform::windows::startup::apply(settings.start_with_windows)?;

    store::save(&settings)?;
    window::floating::apply_main_window_layout(&app, &settings)?;
    events::emit_settings_changed(&app, &settings);
    Ok(settings)
}

#[tauri::command]
pub fn set_mouse_passthrough(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    window::floating::set_mouse_passthrough(&app, enabled)?;
    Ok(enabled)
}

#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) {
    window::tray::open_settings_window(&app);
}

#[tauri::command]
pub fn open_debug_window(app: tauri::AppHandle) {
    window::tray::open_debug_window(&app);
}
