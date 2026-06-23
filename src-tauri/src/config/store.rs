#![allow(dead_code)]

use super::schema::AppSettings;
use std::{fs, path::PathBuf};

pub fn load() -> AppSettings {
    let Some(path) = settings_path() else {
        return AppSettings::default();
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .map(AppSettings::normalized)
        .unwrap_or_default()
}

pub fn save(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| "APPDATA is not available".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "settings path has no parent".to_string())?;

    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn settings_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("CatMusic").join("settings.json"))
}
