use zbus::blocking::Connection;

pub fn system_idle_seconds() -> Result<u64, String> {
    let connection = Connection::session().map_err(|error| error.to_string())?;

    // GNOME exposes milliseconds through Mutter on both X11 and Wayland.
    if let Ok(reply) = connection.call_method(
        Some("org.gnome.Mutter.IdleMonitor"),
        "/org/gnome/Mutter/IdleMonitor/Core",
        Some("org.gnome.Mutter.IdleMonitor"),
        "GetIdletime",
        &(),
    ) {
        if let Ok((milliseconds,)) = reply.body().deserialize::<(u64,)>() {
            return Ok(milliseconds / 1_000);
        }
    }

    // KDE and other desktops commonly implement the freedesktop screensaver API.
    let reply = connection
        .call_method(
            Some("org.freedesktop.ScreenSaver"),
            "/org/freedesktop/ScreenSaver",
            Some("org.freedesktop.ScreenSaver"),
            "GetSessionIdleTime",
            &(),
        )
        .map_err(|error| format!("desktop idle service unavailable: {error}"))?;
    let (seconds,) = reply
        .body()
        .deserialize::<(u32,)>()
        .map_err(|error| error.to_string())?;
    Ok(u64::from(seconds))
}

pub fn monotonic_millis() -> Result<u64, String> {
    let mut timestamp = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `timestamp` is a valid, writable timespec for clock_gettime.
    let result = unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut timestamp) };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(timestamp.tv_sec as u64 * 1_000 + timestamp.tv_nsec as u64 / 1_000_000)
}
