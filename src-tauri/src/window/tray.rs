use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

const MENU_SETTINGS: &str = "settings";
const MENU_DEBUG: &str = "debug";
const MENU_QUIT: &str = "quit";

pub fn init(app: &tauri::AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "\u{8bbe}\u{7f6e}", true, None::<&str>)?;
    let debug = MenuItem::with_id(
        app,
        MENU_DEBUG,
        "\u{8c03}\u{8bd5}\u{9762}\u{677f}",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "\u{9000}\u{51fa}", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &debug, &separator, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("CatMusic")
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SETTINGS => open_settings_window(app),
            MENU_DEBUG => open_debug_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub(crate) fn open_debug_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("debug") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let window = WebviewWindowBuilder::new(
            &app,
            "debug",
            WebviewUrl::App("index.html?view=debug".into()),
        )
        .title("CatMusic \u{8c03}\u{8bd5}\u{9762}\u{677f}")
        .inner_size(320.0, 300.0)
        .resizable(false)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .shadow(true)
        .build();

        if let Ok(window) = window {
            let _ = window.set_focus();
        }
    });
}

pub(crate) fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let window = WebviewWindowBuilder::new(
            &app,
            "settings",
            WebviewUrl::App("index.html?view=settings".into()),
        )
        .title("CatMusic \u{8bbe}\u{7f6e}")
        .inner_size(560.0, 620.0)
        .resizable(false)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .shadow(true)
        .build();

        if let Ok(window) = window {
            let _ = window.set_focus();
        }
    });
}
