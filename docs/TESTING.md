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


## Today’s task queue

Automated coverage includes queue validation, ordering, progress, v1/v2 backup
compatibility, recovery, completion choices, and native SQLite migration,
idempotent saves, and transaction rollback. Run `cargo test queue_tests` from
`src-tauri` for the SQLite checks.

Before release, verify in the desktop UI:

1. Add tasks with different projects, modes, durations, and estimates. Edit,
   reorder, complete, reopen, remove, and restart the app to check persistence.
2. Complete a Deep Work task; continue it, mark it done, and switch to the next
   unfinished task. Reaching the estimate must not automatically complete it.
3. Complete Pomodoro work and breaks with both auto-start settings enabled and
   disabled. Queue choices must wait until after the break, preserve the long
   break rhythm across task switches, and never start the next task automatically.
4. End or skip partial work. Keep focused minutes without counting a completed
   block. Skip a break and verify that the task-choice prompt still appears.
5. Restart during work, during a break, and at a saved completion prompt. Check
   queue links and ensure recovery/retry does not count a block twice.
6. Cross local midnight; carry unfinished tasks into today and keep progress.
7. Back up and restore the queue and its linked history. Verify older v1 backup
   compatibility and database reset while no session is open.
8. Check small/full HUD controls, keyboard navigation, modal focus, long task
   names, light/dark themes, and click-through suspension on the Today workspace
   and completion prompt.
