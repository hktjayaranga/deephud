# Ubuntu compatibility

## Supported targets

The release pipeline builds on Ubuntu 24.04 and checks source compatibility in
Ubuntu 24.04 and 26.04 containers. Both X11 and Wayland are supported by Tauri,
with desktop-environment limitations noted below.

## Wayland

GNOME Wayland decides how always-on-top requests and transparent windows are
composited. If an extension or compositor policy prevents the desired overlay
behavior, launch under XWayland:

```bash
GDK_BACKEND=x11 deephud
```

Global shortcuts may be unavailable when the compositor reserves a selected
combination. Choose another combination in Settings.

## System tray

GNOME requires AppIndicator support to display traditional tray icons. Ubuntu's
default desktop includes it. Minimal GNOME installations may need:

```bash
sudo apt install gnome-shell-extension-appindicator
```

## Idle detection

Native idle detection uses `org.gnome.Mutter.IdleMonitor` and therefore works on
GNOME. On another desktop, disable automatic idle handling in Settings.
