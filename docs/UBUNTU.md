# Ubuntu compatibility

## Supported targets

The release pipeline builds on Ubuntu 24.04 and checks source compatibility in
Ubuntu 24.04 and 26.04 containers. Both X11 and Wayland are supported by Tauri,
with desktop-environment limitations noted below.

## Wayland

GTK's native Wayland backend cannot apply DeepHUD's always-on-top request on
GNOME. DeepHUD therefore prefers X11/XWayland when `DISPLAY` is available,
even if the desktop exports `GDK_BACKEND=wayland`. This selection happens before
GTK starts and applies to menu launches and login startup as well. GTK can fall
back to Wayland if it cannot connect to the X display; always-on-top remains
limited in that case. Your desktop session stays on Wayland.

For an older installed build, fully quit DeepHUD from its tray menu and launch:

```bash
GDK_BACKEND=x11 deephud
```

To explicitly select a backend in an updated build, use the app-specific override:

```bash
DEEPHUD_GDK_BACKEND=wayland deephud
```

This override opts back into native Wayland and its always-on-top limitations.

After updating from source, rebuild and install the new package; an already
installed binary does not pick up source changes:

```bash
npm ci
npm run tauri build -- --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/DeepHUD_1.0.0_amd64.deb
```

Quit the old process from the tray before launching the updated app. With
**Always on top** enabled, the HUD should stay above ordinary application
windows. This does not promise visibility above fullscreen applications, the
lock screen, or GNOME's system overlays.

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
