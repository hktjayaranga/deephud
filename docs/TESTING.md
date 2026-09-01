# Testing

Run the automated suite with `npm test`. It covers timer formatting and
monotonic arithmetic, settings migration, productivity statistics, and the
timer-to-session repository path.

Before a release, perform the following checks on each supported platform:

1. Start, pause, resume, reset, skip, and adjust every timer mode.
2. Suspend and resume the laptop during a running timer.
3. Complete work and break intervals with automatic switching both enabled and disabled.
4. Verify notifications, sounds, always-on-top, opacity, snapping, and click-through.
5. Close to tray, restore from tray, and toggle login startup.
6. Add, edit, search, filter, export, delete, back up, and restore session history.
7. Install each generated package on a clean supported environment.

## Release matrix

| Platform | Architecture | Required manual coverage |
| --- | --- | --- |
| Ubuntu | x64 | Wayland and X11; `.deb` and AppImage |
| Windows 10 | x64 | NSIS `.exe` and `.msi` |
| Windows 11 | x64 | NSIS `.exe` and `.msi` |
| macOS | Apple Silicon | Signed/notarized DMG on a clean account |
| macOS | Intel | Signed/notarized DMG on a clean account |

For every row, explicitly test global shortcuts, tray behavior, login startup,
notifications, transparency, always-on-top, click-through, idle pause/resume,
and suspend/resume timer accuracy. Automated CI proves that each native code
path compiles; it does not replace these desktop integration checks.
