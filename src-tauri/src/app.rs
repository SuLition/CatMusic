use crate::{audio, bridge, config::store, diagnostics, platform, window};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            diagnostics::logging::init();
            window::tray::init(app.handle())?;
            let settings = store::load();
            #[cfg(target_os = "windows")]
            let _ = platform::windows::startup::apply(settings.start_with_windows);
            window::floating::apply_main_window_layout(app.handle(), &settings)
                .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
            window::floating::register_main_window_position_persistence(app.handle())
                .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
            bridge::events::emit_bootstrap(app.handle());
            audio::runtime::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::commands::ping,
            bridge::commands::get_app_settings,
            bridge::commands::list_audio_source_presets,
            bridge::commands::save_app_settings,
            bridge::commands::set_mouse_passthrough,
            bridge::commands::open_settings_window,
            bridge::commands::open_debug_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running CatMusic");
}
