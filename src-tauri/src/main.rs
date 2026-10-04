// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod linux_backend;

fn main() {
    // Select the backend before GTK or any application threads are started.
    #[cfg(target_os = "linux")]
    linux_backend::configure();

    deephud_lib::run();
}
