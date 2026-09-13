use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use tauri::{Emitter, Manager, State};
use tauri_plugin_sql::DbInstances;

pub const MIGRATION: &str = "CREATE TABLE focus_schedules (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
CREATE TABLE schedule_occurrences (id TEXT PRIMARY KEY NOT NULL, schedule_id TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX idx_reminder_status ON schedule_occurrences(status, due_at);";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSchedule {
    pub id: String,
    pub title: String,
    pub project: String,
    pub weekdays: Vec<u32>,
    pub time: String,
    pub kind: String,
    pub work_minutes: u32,
    pub break_minutes: u32,
    pub long_break_minutes: u32,
    pub cycles_before_long_break: u32,
    pub enabled: bool,
    pub updated_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub id: String,
    pub schedule: FocusSchedule,
    pub due_at: String,
    pub status: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ScheduleData {
    pub schedules: Vec<FocusSchedule>,
    pub occurrences: Vec<Occurrence>,
}
fn valid_text(s: &str, max: usize, required: bool) -> bool {
    s.chars().count() <= max && !s.contains('\0') && (!required || !s.trim().is_empty())
}
impl FocusSchedule {
    pub fn validate(&self) -> Result<(), String> {
        let time = chrono::NaiveTime::parse_from_str(&self.time, "%H:%M");
        if !valid_text(&self.id, 100, true)
            || !valid_text(&self.title, 500, true)
            || !valid_text(&self.project, 200, false)
            || self.time.len() != 5
            || time.is_err()
            || self.weekdays.is_empty()
            || self.weekdays.len() > 7
            || self.weekdays.iter().any(|d| *d > 6)
            || self
                .weekdays
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.weekdays.len()
            || !matches!(self.kind.as_str(), "deep-work" | "pomodoro")
            || !(1..=1440).contains(&self.work_minutes)
            || !(1..=120).contains(&self.break_minutes)
            || !(1..=240).contains(&self.long_break_minutes)
            || !(1..=12).contains(&self.cycles_before_long_break)
            || (self.kind == "pomodoro" && self.long_break_minutes <= self.break_minutes)
            || DateTime::parse_from_rfc3339(&self.updated_at).is_err()
        {
            return Err("Invalid focus schedule".into());
        }
        Ok(())
    }
}
pub fn validate_data(data: &ScheduleData) -> Result<(), String> {
    if data.schedules.len() > 50 || data.occurrences.len() > 20000 {
        return Err("Too many schedules or occurrences".into());
    }
    let mut ids = std::collections::HashSet::new();
    for s in &data.schedules {
        s.validate()?;
        if !ids.insert(&s.id) {
            return Err("Duplicate schedule".into());
        }
    }
    ids.clear();
    for o in &data.occurrences {
        o.schedule.validate()?;
        if !valid_text(&o.id, 120, true)
            || !ids.insert(&o.id)
            || DateTime::parse_from_rfc3339(&o.due_at).is_err()
            || !matches!(
                o.status.as_str(),
                "pending" | "deferred" | "started" | "dismissed" | "expired"
            )
        {
            return Err("Invalid schedule occurrence".into());
        }
    }
    Ok(())
}
/// Recompute from wall time every tick. First occurrence wins on an ambiguous DST hour;
/// nonexistent local times are skipped. The local-date key prevents repeated-hour duplicates.
fn due<T: TimeZone>(s: &FocusSchedule, now: DateTime<T>) -> Vec<Occurrence> {
    if !s.enabled {
        return vec![];
    }
    let mut result = vec![];
    let Ok(time) = chrono::NaiveTime::parse_from_str(&s.time, "%H:%M") else {
        return result;
    };
    let Ok(updated) = DateTime::parse_from_rfc3339(&s.updated_at) else {
        return result;
    };
    for date in [now.date_naive().pred_opt(), Some(now.date_naive())]
        .into_iter()
        .flatten()
    {
        if !s.weekdays.contains(&date.weekday().num_days_from_sunday()) {
            continue;
        }
        let Some(at) = now
            .timezone()
            .from_local_datetime(&date.and_time(time))
            .earliest()
        else {
            continue;
        };
        let age = now.clone().signed_duration_since(&at);
        if age < Duration::zero() || age > Duration::minutes(15) || at < updated {
            continue;
        }
        result.push(Occurrence {
            id: format!("{}:{}", s.id, date),
            schedule: s.clone(),
            due_at: at.with_timezone(&Utc).to_rfc3339(),
            status: "pending".into(),
        });
    }
    result
}
async fn read_data(pool: &SqlitePool) -> Result<ScheduleData, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let schedules = sqlx::query("SELECT data FROM focus_schedules ORDER BY id")
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .map(|r| {
            serde_json::from_str::<FocusSchedule>(r.get::<&str, _>("data"))
                .map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let occurrences =
        sqlx::query("SELECT data, status FROM schedule_occurrences ORDER BY due_at, id")
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .map(|r| {
                let mut o: Occurrence =
                    serde_json::from_str(r.get::<&str, _>("data")).map_err(|e| e.to_string())?;
                o.status = r.get("status");
                Ok(o)
            })
            .collect::<Result<Vec<_>, String>>()?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(ScheduleData {
        schedules,
        occurrences,
    })
}
pub async fn write_data(
    tx: &mut Transaction<'_, Sqlite>,
    data: &ScheduleData,
) -> Result<(), String> {
    validate_data(data)?;
    for table in ["schedule_occurrences", "focus_schedules"] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    for s in &data.schedules {
        sqlx::query("INSERT INTO focus_schedules(id,data) VALUES (?,?)")
            .bind(&s.id)
            .bind(serde_json::to_string(s).map_err(|e| e.to_string())?)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    for o in &data.occurrences {
        insert_occurrence(tx, o).await?;
    }
    Ok(())
}
async fn insert_occurrence(
    tx: &mut Transaction<'_, Sqlite>,
    o: &Occurrence,
) -> Result<bool, String> {
    Ok(sqlx::query("INSERT OR IGNORE INTO schedule_occurrences(id,schedule_id,due_at,status,data) VALUES (?,?,?,?,?)")
        .bind(&o.id).bind(&o.schedule.id).bind(&o.due_at).bind(&o.status).bind(serde_json::to_string(o).map_err(|e|e.to_string())?)
        .execute(&mut **tx).await.map_err(|e|e.to_string())?.rows_affected() == 1)
}
#[tauri::command]
pub async fn get_schedule_data(instances: State<'_, DbInstances>) -> Result<ScheduleData, String> {
    read_data(&crate::database::sqlite_pool(&instances).await?).await
}
#[tauri::command]
pub async fn save_focus_schedule(
    instances: State<'_, DbInstances>,
    mut schedule: FocusSchedule,
) -> Result<(), String> {
    schedule.updated_at = Utc::now().to_rfc3339();
    schedule.validate()?;
    let pool = crate::database::sqlite_pool(&instances).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // Take the write lock before checking the limit (also serializes scheduler ticks).
    sqlx::query("UPDATE schedule_occurrences SET status='expired' WHERE schedule_id=? AND status IN ('pending','deferred')").bind(&schedule.id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM focus_schedules WHERE id != ?")
        .bind(&schedule.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if count >= 50 {
        return Err("You can save up to 50 schedules".into());
    }
    sqlx::query("INSERT INTO focus_schedules(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(&schedule.id).bind(serde_json::to_string(&schedule).map_err(|e|e.to_string())?).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_focus_schedule(
    instances: State<'_, DbInstances>,
    id: String,
) -> Result<(), String> {
    let pool = crate::database::sqlite_pool(&instances).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE schedule_occurrences SET status='expired' WHERE schedule_id=? AND status IN ('pending','deferred')").bind(&id).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("DELETE FROM focus_schedules WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn respond_to_reminder(
    instances: State<'_, DbInstances>,
    id: String,
    status: String,
) -> Result<(), String> {
    if !matches!(status.as_str(), "started" | "dismissed" | "deferred") {
        return Err("Invalid reminder action".into());
    }
    let pool = crate::database::sqlite_pool(&instances).await?;
    let changed = sqlx::query(
        "UPDATE schedule_occurrences SET status=? WHERE id=? AND status IN ('pending','deferred')",
    )
    .bind(status)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?
    .rows_affected();
    if changed != 1 {
        return Err("This reminder has expired or was already handled".into());
    }
    Ok(())
}
async fn tick(pool: &SqlitePool, now: DateTime<Local>) -> Result<Vec<Occurrence>, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE schedule_occurrences SET status='expired' WHERE (status='pending' AND julianday(due_at) < julianday(?)) OR (status='deferred' AND julianday(due_at) < julianday(?))")
        .bind((now - Duration::minutes(15)).to_rfc3339()).bind((now - Duration::days(1)).to_rfc3339()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    sqlx::query("DELETE FROM schedule_occurrences WHERE julianday(due_at) < julianday(?)")
        .bind((now - Duration::days(366)).to_rfc3339())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT data FROM focus_schedules")
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut newly_due = vec![];
    for row in rows {
        let s: FocusSchedule = serde_json::from_str(row.get("data")).map_err(|e| e.to_string())?;
        for o in due(&s, now) {
            if insert_occurrence(&mut tx, &o).await? {
                newly_due.push(o);
            }
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    newly_due.sort_by(|a, b| a.due_at.cmp(&b.due_at).then(a.id.cmp(&b.id)));
    Ok(newly_due)
}
fn notification(app: tauri::AppHandle, occurrence: Occurrence) {
    // Waiting for a native click must not block the scheduler or the UI thread.
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        #[cfg(target_os = "linux")]
        n.appname("DeepHUD");
        n.summary(&format!("Time for {}", occurrence.schedule.title))
            .body(&format!(
                "{} minutes{} · Open DeepHUD to start or dismiss",
                occurrence.schedule.work_minutes,
                if occurrence.schedule.project.is_empty() {
                    String::new()
                } else {
                    format!(" · {}", occurrence.schedule.project)
                }
            ))
            .timeout(60_000);
        #[cfg(not(target_os = "macos"))]
        n.action("default", "Open DeepHUD");
        #[cfg(target_os = "windows")]
        n.app_id(&app.config().identifier);
        #[cfg(target_os = "macos")]
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            &app.config().identifier
        });
        match n.show() {
            Ok(handle) => handle.wait_for_action(|action| {
                if action == "default" {
                    // Do not resurrect a reminder dismissed, deleted or expired while the toast remained.
                    let valid = tauri::async_runtime::block_on(async {
                        let pool =
                            crate::database::sqlite_pool(&app.state::<DbInstances>()).await?;
                        let status: Option<String> = sqlx::query_scalar(
                            "SELECT status FROM schedule_occurrences WHERE id=?",
                        )
                        .bind(&occurrence.id)
                        .fetch_optional(&pool)
                        .await
                        .map_err(|e| e.to_string())?;
                        Ok::<_, String>(status.is_some_and(|s| s == "pending" || s == "deferred"))
                    })
                    .unwrap_or(false);
                    if valid {
                        let _ = app.emit("schedule-open", &occurrence.id);
                        if let Some(window) = app.get_webview_window("hud") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
            }),
            Err(error) => {
                let _ = app.emit("schedule-notification-error", error.to_string());
            }
        }
    });
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let result = tauri::async_runtime::block_on(async {
            let pool = crate::database::sqlite_pool(&app.state::<DbInstances>()).await?;
            tick(&pool, Local::now()).await
        });
        match result {
            Ok(new) => {
                if !new.is_empty() {
                    let _ = app.emit("schedule-reminders-changed", ());
                }
                for o in new {
                    notification(app.clone(), o);
                }
            }
            Err(error) => {
                let _ = app.emit("schedule-storage-error", error);
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(10));
    });
}

#[tauri::command]
pub async fn release_deferred_reminders(
    app: tauri::AppHandle,
    instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let pool = crate::database::sqlite_pool(&instances).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE schedule_occurrences SET status='expired' WHERE status='deferred' AND julianday(due_at) < julianday(?)")
        .bind((Utc::now() - Duration::days(1)).to_rfc3339()).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    // Claim before notifying, so simultaneous frontend refreshes cannot notify twice.
    let rows = sqlx::query("UPDATE schedule_occurrences SET status='pending', due_at=? WHERE status='deferred' RETURNING data")
        .bind(Utc::now().to_rfc3339()).fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let mut reminders = Vec::new();
    for row in rows {
        let mut o: Occurrence = serde_json::from_str(row.get("data")).map_err(|e| e.to_string())?;
        o.status = "pending".into();
        o.due_at = Utc::now().to_rfc3339();
        sqlx::query("UPDATE schedule_occurrences SET data=? WHERE id=?")
            .bind(serde_json::to_string(&o).map_err(|e| e.to_string())?)
            .bind(&o.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        reminders.push(o);
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    if !reminders.is_empty() {
        let _ = app.emit("schedule-reminders-changed", ());
    }
    for o in reminders {
        notification(app.clone(), o);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> FocusSchedule {
        FocusSchedule {
            id: "writing".into(),
            title: "Writing".into(),
            project: "Personal".into(),
            weekdays: vec![1, 2, 3, 4, 5],
            time: "09:00".into(),
            kind: "pomodoro".into(),
            work_minutes: 50,
            break_minutes: 10,
            long_break_minutes: 25,
            cycles_before_long_break: 3,
            enabled: true,
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }
    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(MIGRATION).execute(&pool).await.unwrap();
        pool
    }
    #[test]
    fn local_weekdays_catchup_and_midnight() {
        let mut s = sample();
        assert_eq!(due(&s, utc("2026-09-14T09:15:00Z")).len(), 1);
        assert!(due(&s, utc("2026-09-14T09:15:01Z")).is_empty());
        assert!(due(&s, utc("2026-09-14T08:59:59Z")).is_empty());
        assert!(due(&s, utc("2026-09-13T09:00:00Z")).is_empty());
        let colombo = chrono::FixedOffset::east_opt(19800).unwrap();
        assert_eq!(
            due(&s, utc("2026-09-14T03:30:00Z").with_timezone(&colombo)).len(),
            1
        );
        assert!(due(&s, utc("2026-09-14T03:30:00Z")).is_empty());
        s.time = "23:55".into();
        assert_eq!(
            due(&s, utc("2026-09-01T00:05:00Z"))[0].id,
            "writing:2026-08-31"
        );
        s.enabled = false;
        assert!(due(&s, utc("2026-09-01T00:05:00Z")).is_empty());
    }
    #[test]
    fn validation_and_edits_do_not_backfill_reminders() {
        let mut s = sample();
        s.updated_at = "2026-09-14T09:00:01Z".into();
        assert!(due(&s, utc("2026-09-14T09:05:00Z")).is_empty());
        s.weekdays = vec![1, 1];
        assert!(s.validate().is_err());
        s.weekdays = vec![1];
        s.time = "24:00".into();
        assert!(s.validate().is_err());
        s.time = "09:00".into();
        s.long_break_minutes = 5;
        assert!(s.validate().is_err());
    }
    #[test]
    fn sqlite_ticks_deduplicate_restart_sleep_and_clock_changes() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let mut tx = pool.begin().await.unwrap();
            write_data(
                &mut tx,
                &ScheduleData {
                    schedules: vec![sample()],
                    occurrences: vec![],
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
            let now = Local
                .with_ymd_and_hms(2026, 9, 14, 9, 5, 0)
                .single()
                .unwrap();
            let first = tick(&pool, now).await.unwrap();
            assert_eq!(first.len(), 1);
            assert!(tick(&pool, now).await.unwrap().is_empty());
            assert!(tick(&pool, now - Duration::minutes(4))
                .await
                .unwrap()
                .is_empty());
            sqlx::query("UPDATE schedule_occurrences SET status='dismissed'")
                .execute(&pool)
                .await
                .unwrap();
            assert!(tick(&pool, now).await.unwrap().is_empty());
            assert_eq!(
                read_data(&pool).await.unwrap().occurrences[0].status,
                "dismissed"
            );
            assert_eq!(tick(&pool, now + Duration::days(1)).await.unwrap().len(), 1);
            tick(&pool, now + Duration::days(1) + Duration::minutes(20))
                .await
                .unwrap();
            assert_eq!(
                read_data(&pool).await.unwrap().occurrences[1].status,
                "expired"
            );
        });
    }
    #[test]
    fn schedule_backup_round_trip_and_failed_restore_preserve_data() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let mut tx = pool.begin().await.unwrap();
            let mut data = ScheduleData {
                schedules: vec![sample()],
                occurrences: due(&sample(), utc("2026-09-14T09:00:00Z")),
            };
            data.occurrences[0].status = "deferred".into();
            write_data(&mut tx, &data).await.unwrap();
            tx.commit().await.unwrap();
            let restored = read_data(&pool).await.unwrap();
            assert_eq!(restored.schedules[0].cycles_before_long_break, 3);
            assert_eq!(restored.occurrences[0].status, "deferred");
            let mut invalid = data.clone();
            invalid.schedules.push(sample());
            let mut tx = pool.begin().await.unwrap();
            assert!(write_data(&mut tx, &invalid).await.is_err());
            tx.rollback().await.unwrap();
            assert_eq!(read_data(&pool).await.unwrap().schedules.len(), 1);
            let mut tx = pool.begin().await.unwrap();
            write_data(&mut tx, &ScheduleData::default()).await.unwrap();
            tx.commit().await.unwrap();
            assert!(read_data(&pool).await.unwrap().occurrences.is_empty());
        });
    }
}
