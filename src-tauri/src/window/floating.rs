use crate::config::{
    schema::{AppSettings, FloatingCorner, FloatingPosition},
    store,
};
use tauri::Manager;

const FLOATING_MARGIN: i32 = 24;

pub fn register_main_window_position_persistence(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    window.on_window_event(|event| {
        if let tauri::WindowEvent::Moved(position) = event {
            let _ = remember_main_window_position(*position);
        }
    });

    Ok(())
}

pub fn set_mouse_passthrough(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

pub fn apply_main_window_layout(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let _ = window.set_shadow(false);
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(settings.mouse_passthrough)
        .map_err(|error| error.to_string())?;
    let logical_size = settings.floating_size.logical_pixels();
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            logical_size,
            logical_size,
        )))
        .map_err(|error| error.to_string())?;

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "monitor not found".to_string())?;
    let work_area = monitor.work_area();
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let position = settings
        .floating_position
        .map(|position| clamp_position(position.physical(), work_area, size))
        .unwrap_or_else(|| corner_position(settings.floating_corner, work_area, size));

    window
        .set_position(tauri::Position::Physical(position))
        .map_err(|error| error.to_string())
}

fn remember_main_window_position(position: tauri::PhysicalPosition<i32>) -> Result<(), String> {
    let mut settings = store::load();
    settings.floating_position = Some(FloatingPosition::new(position.x, position.y));
    store::save(&settings)
}

fn corner_position(
    corner: FloatingCorner,
    work_area: &tauri::PhysicalRect<i32, u32>,
    size: tauri::PhysicalSize<u32>,
) -> tauri::PhysicalPosition<i32> {
    let left = work_area.position.x + FLOATING_MARGIN;
    let top = work_area.position.y + FLOATING_MARGIN;
    let right =
        work_area.position.x + work_area.size.width as i32 - size.width as i32 - FLOATING_MARGIN;
    let bottom =
        work_area.position.y + work_area.size.height as i32 - size.height as i32 - FLOATING_MARGIN;

    let (x, y) = match corner {
        FloatingCorner::TopLeft => (left, top),
        FloatingCorner::TopRight => (right, top),
        FloatingCorner::BottomLeft => (left, bottom),
        FloatingCorner::BottomRight => (right, bottom),
    };

    tauri::PhysicalPosition::new(x, y)
}

fn clamp_position(
    position: tauri::PhysicalPosition<i32>,
    work_area: &tauri::PhysicalRect<i32, u32>,
    size: tauri::PhysicalSize<u32>,
) -> tauri::PhysicalPosition<i32> {
    let min_x = work_area.position.x;
    let min_y = work_area.position.y;
    let max_x = work_area.position.x + work_area.size.width as i32 - size.width as i32;
    let max_y = work_area.position.y + work_area.size.height as i32 - size.height as i32;

    tauri::PhysicalPosition::new(
        clamp_axis(position.x, min_x, max_x),
        clamp_axis(position.y, min_y, max_y),
    )
}

fn clamp_axis(value: i32, min: i32, max: i32) -> i32 {
    value.clamp(min, max.max(min))
}
