use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

mod database;
mod platform;
mod schedules;

// Never change this string: its checksum was shipped in v0.3.0 databases.
const MIGRATION_1_SQL: &str = concat!(
    "\n",
    "            CREATE TABLE IF NOT EXISTS sessions (\n",
    "                id INTEGER PRIMARY KEY AUTOINCREMENT,\n",
    "                started_at TEXT NOT NULL,\n",
    "                ended_at TEXT NOT NULL,\n",
    "                planned_minutes INTEGER NOT NULL,\n",
    "                focus_seconds INTEGER NOT NULL,\n",
    "                paused_seconds INTEGER NOT NULL DEFAULT 0,\n",
    "                project TEXT NOT NULL DEFAULT '',\n",
    "                task TEXT NOT NULL DEFAULT '',\n",
    "                session_kind TEXT NOT NULL\n",
    "            );\n",
    "            CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);\n",
    "            CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);\n",
    "        ",
);

fn show_hud(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("hud") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "linux")]
fn allow_compact_linux_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use gtk::prelude::WidgetExt;

    // WebKitGTK reports a tall natural minimum size even when the page itself
    // is much shorter. Override that request so Tauri can apply the compact
    // HUD height instead of GTK clamping the window near 200 pixels.
    window.default_vbox()?.set_size_request(1, 1);
    window.with_webview(|webview| webview.inner().set_size_request(1, 1))?;
    Ok(())
}

#[tauri::command]
fn system_idle_seconds() -> Result<u64, String> {
    platform::system_idle_seconds()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Uses each operating system's monotonic clock that includes suspended time,
/// keeping countdowns reliable across sleep and wall-clock changes.
#[tauri::command]
fn monotonic_millis() -> Result<u64, String> {
    platform::monotonic_millis()
}

// Tauri 2.11's monitor conversion reads GTK's work area on the caller thread.
// Its async window command can therefore touch GDK from a Tokio worker on
// Linux. Keep the complete query/conversion on the UI thread.
#[tauri::command]
async fn hud_current_monitor(
    window: tauri::WebviewWindow,
) -> Result<Option<tauri::window::Monitor>, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = target.current_monitor().map_err(|error| error.to_string());
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
}

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_focus_sessions",
            sql: MIGRATION_1_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_project_catalog",
            sql: r#"
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    name TEXT NOT NULL COLLATE NOCASE,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    UNIQUE(project_id, name)
                );
                INSERT OR IGNORE INTO projects(name, created_at)
                    SELECT DISTINCT project, datetime('now') FROM sessions WHERE project != '';
                INSERT OR IGNORE INTO tasks(project_id, name, created_at)
                    SELECT p.id, s.task, datetime('now') FROM sessions s
                    JOIN projects p ON p.name = s.project WHERE s.task != '';
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "group_focus_cycles",
            sql: "ALTER TABLE sessions ADD COLUMN work_session_id TEXT;
                  ALTER TABLE sessions ADD COLUMN work_session_ended_at TEXT;
                  ALTER TABLE sessions ADD COLUMN cycle_completed INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "daily_task_queue",
            sql: "CREATE TABLE daily_queue_items (
                    id TEXT PRIMARY KEY NOT NULL,
                    scheduled_date TEXT NOT NULL,
                    title TEXT NOT NULL,
                    project TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    estimated_sessions INTEGER NOT NULL,
                    focus_minutes INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    completed_at TEXT
                  );
                  CREATE INDEX idx_queue_day ON daily_queue_items(scheduled_date, position);
                  ALTER TABLE sessions ADD COLUMN queue_item_id TEXT;
                  CREATE INDEX idx_sessions_queue ON sessions(queue_item_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "distraction_capture",
            sql: "CREATE TABLE distraction_captures (
                id TEXT PRIMARY KEY NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
                work_session_id TEXT, queue_item_id TEXT, handled_at TEXT, converted_queue_item_id TEXT
            ); CREATE INDEX idx_captures_created ON distraction_captures(created_at);",
            kind: MigrationKind::Up,
        },
        Migration { version: 6, description: "recurring_focus_schedules", sql: schedules::MIGRATION, kind: MigrationKind::Up },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = database_migrations();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            system_idle_seconds,
            quit_app,
            monotonic_millis,
            hud_current_monitor,
            database::initialize_database,
            database::save_session,
            database::update_session,
            database::get_sessions,
            database::delete_session,
            database::reset_database,
            database::delete_data,
            database::replace_sessions,
            database::ensure_project_task,
            database::get_projects,
            database::get_task_queue,
            database::replace_task_queue,
            database::get_captures,
            database::save_capture,
            database::delete_capture,
            database::convert_capture,
            schedules::get_schedule_data,
            schedules::save_focus_schedule,
            schedules::delete_focus_schedule,
            schedules::respond_to_reminder,
            schedules::release_deferred_reminders
        ])
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("DeepHUD")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:deepwork-hud.db", migrations)
                .build(),
        )
        // Remember only the position. Restoring a saved size here races with
        // the HUD's compact/full sizing and can overwrite the selected height.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("hud") {
                allow_compact_linux_window(&window)?;
            }

            let show = MenuItem::with_id(app, "show", "Show DeepHUD", true, None::<&str>)?;
            let disable_click_through = MenuItem::with_id(
                app,
                "disable-click-through",
                "Turn off click-through",
                true,
                None::<&str>,
            )?;
            let toggle = MenuItem::with_id(app, "toggle", "Start / Pause", true, None::<&str>)?;
            let deep_work =
                MenuItem::with_id(app, "deep-work", "Start Deep Work", true, None::<&str>)?;
            let dashboard = MenuItem::with_id(
                app,
                "dashboard",
                "Productivity Dashboard",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &disable_click_through,
                    &toggle,
                    &deep_work,
                    &dashboard,
                    &quit,
                ],
            )?;

            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .tooltip("DeepHUD")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_hud(app),
                    "disable-click-through" => {
                        if let Some(window) = app.get_webview_window("hud") {
                            let _ = window.set_ignore_cursor_events(false);
                        }
                        let _ = app.emit("tray-action", "disable-click-through");
                        show_hud(app);
                    }
                    "toggle" => {
                        let _ = app.emit("tray-action", "toggle-timer");
                    }
                    "deep-work" => {
                        show_hud(app);
                        let _ = app.emit("tray-action", "start-deep-work");
                    }
                    "dashboard" => {
                        show_hud(app);
                        let _ = app.emit("tray-action", "dashboard");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            schedules::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DeepHUD");
}
