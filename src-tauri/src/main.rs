#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod audio;
mod bridge;
mod config;
mod diagnostics;
mod platform;
mod window;

fn main() {
    app::run();
}
