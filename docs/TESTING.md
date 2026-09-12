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


## Distraction capture

Automated checks cover capture validation, duplicate-save handling, failed-save
retry, timer checkpoint preservation, task conversion and rollback, v1/v2/v3
backups, shortcut migration, and capture-aware idle handling. `cargo test` also
checks the SQLite migration and atomic conversion without creating focus records.

Before release, verify on each supported desktop platform:

1. Capture via Ctrl+Alt+N and the icon beside the session name while the timer runs, pauses,
   finishes, and enters a break. Enter saves once; Escape cancels. The capture
   itself must never pause/resume/reset a timer or change its elapsed time.
2. Hide/minimize the HUD, enable click-through, and use the capture shortcut.
   Confirm the input gets keyboard focus; closing it restores click-through.
   Check compact-to-full behavior and that normal full-HUD dimensions stay fixed.
3. Change/clear the shortcut and try an occupied combination. Existing conflict
   feedback should appear, and the icon beside the session name must still work.
4. Simulate storage failure. Keep the typed text, show the error, and retry once
   storage is available. Capture several thoughts and restart to check persistence.
5. During normal breaks and breathing, check the small header review action.
   Review must open Dashboard → Saved for later with the unhandled count badge.
   Confirm that opening that tab manually reaches the same review actions, and
   that the control panel has no capture/review icons. Return to the timer without
   losing breathing progress.
6. Mark handled, reopen, keep for later, delete, and convert a thought using the
   task form. Verify the task's project/estimate, no automatic timer start, and
   no duplicate conversion after retry/restart. Delete a thought without deleting
   its converted task.
7. Enable native idle pause and type in the capture input beyond the idle threshold;
   verify the timer stays running. Confirm ordinary idle handling resumes afterward.
8. Back up and restore v3 captures and links. Test v1/v2 compatibility, failed
   restore rollback, and reset behavior. Check keyboard focus and long input/error
   text in both light and dark themes.


## Monthly insights

Automated coverage includes local month boundaries, leap years, DST transitions,
calendar alignment, partial/legacy completion, shorter-month comparisons, zero
baselines, hourly attribution, totals reconciliation, and filtered History groups.

Before release, verify Dashboard → Overview:

1. Switch Week / Month below the daily summary. Browse across year boundaries,
   return to This month, and verify Next month is disabled on the current month.
2. Compare a current month and a historical month; check the displayed reference
   dates, completed-block explanation, and zero-baseline messaging.
3. Hover/focus calendar days to read numeric totals. Select a day to open History;
   clear the filter and return to Overview without losing the selected month.
4. Check project bars, Unassigned work, all 24 start-hour values, and empty months.
   Edit/delete a history interval and verify the insight totals update.
5. Check light/dark themes, keyboard navigation, long project names, and narrow
   dashboard layouts. Charts should scroll or wrap without resizing the HUD.
6. Leave Overview open across local midnight/month rollover; This month should
   follow the new month while a deliberately selected historical month stays fixed.
