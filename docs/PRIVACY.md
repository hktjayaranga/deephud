# Privacy

DeepHUD is offline-first and privacy-first.

- No account is required.
- No telemetry, usage analytics, crash reporting, advertising, or tracking is included.
- No session, project, task, goal, or setting is sent over the network.
- Focus history is stored in `~/.config/com.deepworkhud.app/deepwork-hud.db`.
- Settings are stored in the application WebView's local storage.
- Desktop notifications are submitted only to the local notification service.
- The GNOME idle monitor provides only the number of idle seconds; keystrokes and visited applications are never recorded.
- Export and backup write only to a location explicitly chosen by the user.

Deleting the application-data directory removes local DeepHUD data. Make a
backup from the History page first if it should be retained.
