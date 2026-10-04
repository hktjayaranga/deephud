use std::ffi::{OsStr, OsString};

fn preferred_backend(
    display: Option<&OsStr>,
    override_backend: Option<&OsStr>,
) -> Option<OsString> {
    if let Some(backend) = override_backend.filter(|value| !value.is_empty()) {
        return Some(backend.to_owned());
    }
    // GTK's native Wayland backend cannot request always-on-top on GNOME.
    // Prefer XWayland, including when the desktop exports GDK_BACKEND=wayland,
    // but let GTK fall back if it cannot connect to the X display.
    display
        .filter(|value| !value.is_empty())
        .map(|_| OsString::from("x11,wayland"))
}

pub fn configure() {
    if let Some(backend) = preferred_backend(
        std::env::var_os("DISPLAY").as_deref(),
        std::env::var_os("DEEPHUD_GDK_BACKEND").as_deref(),
    ) {
        // Called only from main, before GTK initialization and thread creation.
        std::env::set_var("GDK_BACKEND", backend);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    // Exercise the real startup environment in separate processes so these
    // checks cannot race other tests by changing their environment variables.
    #[test]
    fn configures_inherited_desktop_environment() {
        for (display, inherited, override_backend, expected) in [
            (Some(":0"), "wayland", None, "x11,wayland"),
            (Some(":0"), "wayland", Some(""), "x11,wayland"),
            (Some(":0"), "x11", Some("wayland"), "wayland"),
            (None, "wayland", None, "wayland"),
        ] {
            let mut child = Command::new(std::env::current_exe().unwrap());
            child
                .args(["--exact", "linux_backend::tests::startup_environment_child"])
                .env("DEEPHUD_TEST_EXPECTED_BACKEND", expected)
                .env("GDK_BACKEND", inherited)
                .env_remove("DISPLAY")
                .env_remove("DEEPHUD_GDK_BACKEND");
            if let Some(display) = display {
                child.env("DISPLAY", display);
            }
            if let Some(backend) = override_backend {
                child.env("DEEPHUD_GDK_BACKEND", backend);
            }
            let output = child.output().unwrap();
            assert!(
                output.status.success(),
                "startup backend failed: {}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[test]
    fn startup_environment_child() {
        let Some(expected) = std::env::var_os("DEEPHUD_TEST_EXPECTED_BACKEND") else {
            return;
        };
        configure();
        assert_eq!(std::env::var_os("GDK_BACKEND"), Some(expected));
    }

    #[test]
    fn prefers_xwayland_when_an_x_display_is_available() {
        assert_eq!(
            preferred_backend(Some(OsStr::new(":0")), None),
            Some(OsString::from("x11,wayland"))
        );
    }

    #[test]
    fn leaves_native_wayland_only_sessions_unchanged() {
        assert_eq!(preferred_backend(None, None), None);
        assert_eq!(preferred_backend(Some(OsStr::new("")), None), None);
    }

    #[test]
    fn honors_an_app_specific_override() {
        for display in [None, Some(OsStr::new(":0"))] {
            assert_eq!(
                preferred_backend(display, Some(OsStr::new("wayland"))),
                Some(OsString::from("wayland"))
            );
        }
        assert_eq!(
            preferred_backend(Some(OsStr::new(":0")), Some(OsStr::new(""))),
            Some(OsString::from("x11,wayland"))
        );
    }
}
