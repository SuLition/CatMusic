use tauri::Emitter;

use crate::{audio::features, config::schema::AppSettings};

pub fn emit_bootstrap(app: &tauri::AppHandle) {
    let _ = app.emit("audio://features", features::silent_frame(0));
}

pub fn emit_settings_changed(app: &tauri::AppHandle, settings: &AppSettings) {
    let _ = app.emit("settings://changed", settings);
}
