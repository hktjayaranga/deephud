#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::{monotonic_millis, system_idle_seconds};
#[cfg(target_os = "macos")]
pub use macos::{monotonic_millis, system_idle_seconds};
#[cfg(target_os = "windows")]
pub use windows::{monotonic_millis, system_idle_seconds};

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
compile_error!("DeepHUD desktop builds support Linux, macOS, and Windows");
