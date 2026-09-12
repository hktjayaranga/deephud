use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Acquire, Row, Sqlite, SqlitePool, Transaction};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:deepwork-hud.db";
const MAX_SESSION_SECONDS: i64 = 365 * 24 * 60 * 60;
const MAX_SESSIONS_PER_RESTORE: usize = 50_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: Option<i64>,
    pub queue_item_id: Option<String>,
    pub work_session_id: Option<String>,
    pub work_session_ended_at: Option<String>,
    pub cycle_completed: Option<bool>,
    pub started_at: String,
    pub ended_at: String,
    pub planned_minutes: i64,
    pub focus_seconds: i64,
    pub paused_seconds: i64,
    pub project: String,
    pub task: String,
    pub session_kind: String,
}

#[derive(Serialize)]
pub struct TaskRecord {
    id: i64,
    name: String,
}

#[derive(Serialize)]
pub struct ProjectRecord {
    id: i64,
    name: String,
    tasks: Vec<TaskRecord>,
}

async fn sqlite_pool(instances: &State<'_, DbInstances>) -> Result<SqlitePool, String> {
    let databases = instances.0.read().await;
    match databases.get(DB_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        _ => Err("History database is not initialized".into()),
    }
}

fn validate_session(session: &SessionRecord, require_id: bool) -> Result<(), String> {
    if require_id && session.id.filter(|id| *id > 0).is_none() {
        return Err("A positive session id is required".into());
    }
    let started = DateTime::parse_from_rfc3339(&session.started_at)
        .map_err(|_| "Invalid session start date")?;
    let ended =
        DateTime::parse_from_rfc3339(&session.ended_at).map_err(|_| "Invalid session end date")?;
    let earliest =
        DateTime::parse_from_rfc3339("2000-01-01T00:00:00Z").expect("static date must be valid");
    if started < earliest || ended < started || ended > Utc::now() + chrono::Duration::days(1) {
        return Err("Invalid session date range".into());
    }
    if !(0..=1440).contains(&session.planned_minutes)
        || !(0..=MAX_SESSION_SECONDS).contains(&session.focus_seconds)
        || !(0..=MAX_SESSION_SECONDS).contains(&session.paused_seconds)
        || session.project.chars().count() > 200
        || session.task.chars().count() > 500
        || session.project.contains('\0')
        || session.task.contains('\0')
        || !matches!(
            session.session_kind.as_str(),
            "deep-work" | "pomodoro" | "stopwatch"
        )
    {
        return Err("Invalid session values".into());
    }
    if let Some(id) = &session.work_session_id {
        if id.is_empty() || id.len() > 100 || id.contains('\0') {
            return Err("Invalid work session id".into());
        }
    }
    if let Some(id) = &session.queue_item_id {
        if id.is_empty() || id.len() > 100 || id.contains('\0') {
            return Err("Invalid queue item id".into());
        }
    }
    if let Some(end) = &session.work_session_ended_at {
        DateTime::parse_from_rfc3339(end).map_err(|_| "Invalid work session end")?;
    }
    Ok(())
}

async fn add_project_task(
    transaction: &mut Transaction<'_, Sqlite>,
    project: &str,
    task: &str,
) -> Result<(), sqlx::Error> {
    let project = project.trim();
    let task = task.trim();
    if project.is_empty() {
        return Ok(());
    }
    let connection = transaction.acquire().await?;
    sqlx::query("INSERT OR IGNORE INTO projects(name, created_at) VALUES (?1, datetime('now'))")
        .bind(project)
        .execute(&mut *connection)
        .await?;
    if !task.is_empty() {
        sqlx::query(
            "INSERT OR IGNORE INTO tasks(project_id, name, created_at) \
             SELECT id, ?2, datetime('now') FROM projects WHERE name = ?1 COLLATE NOCASE",
        )
        .bind(project)
        .bind(task)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

async fn insert_session(
    transaction: &mut Transaction<'_, Sqlite>,
    session: &SessionRecord,
) -> Result<(), sqlx::Error> {
    let connection = transaction.acquire().await?;
    sqlx::query(
        "INSERT INTO sessions \
         (started_at, ended_at, planned_minutes, focus_seconds, paused_seconds, project, task, session_kind, work_session_id, work_session_ended_at, cycle_completed, queue_item_id) \
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE ?9 IS NULL OR NOT EXISTS (SELECT 1 FROM sessions WHERE work_session_id = ?9 AND started_at = ?1)",
    )
    .bind(&session.started_at)
    .bind(&session.ended_at)
    .bind(session.planned_minutes)
    .bind(session.focus_seconds)
    .bind(session.paused_seconds)
    .bind(&session.project)
    .bind(&session.task)
    .bind(&session.session_kind)
    .bind(&session.work_session_id)
    .bind(&session.work_session_ended_at)
    .bind(session.cycle_completed)
    .bind(&session.queue_item_id)
    .execute(&mut *connection)
    .await?;
    add_project_task(transaction, &session.project, &session.task).await
}

#[tauri::command]
pub async fn initialize_database(instances: State<'_, DbInstances>) -> Result<(), String> {
    sqlite_pool(&instances).await.map(|_| ())
}

#[tauri::command]
pub async fn save_session(
    instances: State<'_, DbInstances>,
    session: SessionRecord,
) -> Result<(), String> {
    validate_session(&session, false)?;
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    insert_session(&mut transaction, &session)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_session(
    instances: State<'_, DbInstances>,
    session: SessionRecord,
) -> Result<(), String> {
    validate_session(&session, true)?;
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let result = sqlx::query(
        "UPDATE sessions SET started_at = ?1, ended_at = ?2, planned_minutes = ?3, \
         focus_seconds = ?4, paused_seconds = ?5, project = ?6, task = ?7, session_kind = ?8, work_session_id = ?9, work_session_ended_at = ?10, cycle_completed = ?11, queue_item_id = ?12 WHERE id = ?13",
    )
    .bind(&session.started_at)
    .bind(&session.ended_at)
    .bind(session.planned_minutes)
    .bind(session.focus_seconds)
    .bind(session.paused_seconds)
    .bind(&session.project)
    .bind(&session.task)
    .bind(&session.session_kind)
    .bind(&session.work_session_id)
    .bind(&session.work_session_ended_at)
    .bind(session.cycle_completed)
    .bind(&session.queue_item_id)
    .bind(session.id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    if result.rows_affected() != 1 {
        return Err("Session was not found".into());
    }
    add_project_task(&mut transaction, &session.project, &session.task)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_sessions(instances: State<'_, DbInstances>) -> Result<Vec<SessionRecord>, String> {
    let pool = sqlite_pool(&instances).await?;
    let rows = sqlx::query(
        "SELECT id, started_at, ended_at, planned_minutes, focus_seconds, paused_seconds, project, task, session_kind, work_session_id, work_session_ended_at, cycle_completed, queue_item_id \
         FROM sessions ORDER BY started_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| SessionRecord {
            id: Some(row.get("id")),
            queue_item_id: row.get("queue_item_id"),
            work_session_id: row.get("work_session_id"),
            work_session_ended_at: row.get("work_session_ended_at"),
            cycle_completed: row.get("cycle_completed"),
            started_at: row.get("started_at"),
            ended_at: row.get("ended_at"),
            planned_minutes: row.get("planned_minutes"),
            focus_seconds: row.get("focus_seconds"),
            paused_seconds: row.get("paused_seconds"),
            project: row.get("project"),
            task: row.get("task"),
            session_kind: row.get("session_kind"),
        })
        .collect())
}

#[tauri::command]
pub async fn delete_session(instances: State<'_, DbInstances>, id: i64) -> Result<(), String> {
    if id <= 0 {
        return Err("A positive session id is required".into());
    }
    let pool = sqlite_pool(&instances).await?;
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reset_database(instances: State<'_, DbInstances>) -> Result<(), String> {
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM daily_queue_items")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM tasks")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM sessions")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM projects")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn replace_sessions(
    instances: State<'_, DbInstances>,
    sessions: Vec<SessionRecord>,
    queue_items: Option<Vec<DailyQueueItem>>,
) -> Result<(), String> {
    if sessions.len() > MAX_SESSIONS_PER_RESTORE {
        return Err("Backup contains too many sessions".into());
    }
    for session in &sessions {
        validate_session(session, false)?;
    }
    if let Some(items) = &queue_items {
        validate_queue(items)?;
    }
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM sessions")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(items) = &queue_items {
        write_queue(&mut transaction, items)
            .await
            .map_err(|error| error.to_string())?;
    }
    for session in &sessions {
        insert_session(&mut transaction, session)
            .await
            .map_err(|error| error.to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ensure_project_task(
    instances: State<'_, DbInstances>,
    project: String,
    task: String,
) -> Result<(), String> {
    if project.chars().count() > 200
        || task.chars().count() > 500
        || project.contains('\0')
        || task.contains('\0')
    {
        return Err("Invalid project or task".into());
    }
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    add_project_task(&mut transaction, &project, &task)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_projects(instances: State<'_, DbInstances>) -> Result<Vec<ProjectRecord>, String> {
    let pool = sqlite_pool(&instances).await?;
    let projects = sqlx::query("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE")
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let tasks = sqlx::query("SELECT id, project_id, name FROM tasks ORDER BY name COLLATE NOCASE")
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(projects
        .into_iter()
        .map(|project| {
            let project_id: i64 = project.get("id");
            ProjectRecord {
                id: project_id,
                name: project.get("name"),
                tasks: tasks
                    .iter()
                    .filter(|task| task.get::<i64, _>("project_id") == project_id)
                    .map(|task| TaskRecord {
                        id: task.get("id"),
                        name: task.get("name"),
                    })
                    .collect(),
            }
        })
        .collect())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyQueueItem {
    id: String,
    scheduled_date: String,
    title: String,
    project: String,
    position: i64,
    estimated_sessions: i64,
    focus_minutes: i64,
    kind: String,
    completed_at: Option<String>,
}

fn validate_queue(items: &[DailyQueueItem]) -> Result<(), String> {
    if items.len() > 5000 {
        return Err("Too many queue items".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in items {
        if item.id.is_empty()
            || item.id.len() > 100
            || item.id.contains('\0')
            || !ids.insert(&item.id)
            || item.title.trim().is_empty()
            || item.title.chars().count() > 500
            || item.title.contains('\0')
            || item.project.chars().count() > 200
            || item.project.contains('\0')
            || !(0..=5000).contains(&item.position)
            || !(1..=100).contains(&item.estimated_sessions)
            || !(1..=240).contains(&item.focus_minutes)
            || !matches!(item.kind.as_str(), "deep-work" | "pomodoro")
        {
            return Err("Invalid task queue item".into());
        }
        let date = chrono::NaiveDate::parse_from_str(&item.scheduled_date, "%Y-%m-%d")
            .map_err(|_| "Invalid queue date")?;
        if date.format("%Y-%m-%d").to_string() != item.scheduled_date {
            return Err("Invalid queue date".into());
        }
        if let Some(end) = &item.completed_at {
            if end.len() > 40 {
                return Err("Invalid task completion date".into());
            }
            DateTime::parse_from_rfc3339(end).map_err(|_| "Invalid task completion date")?;
        }
    }
    Ok(())
}

async fn write_queue(
    transaction: &mut Transaction<'_, Sqlite>,
    items: &[DailyQueueItem],
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM daily_queue_items")
        .execute(&mut **transaction)
        .await?;
    for item in items {
        sqlx::query("INSERT INTO daily_queue_items (id, scheduled_date, title, project, position, estimated_sessions, focus_minutes, kind, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
            .bind(&item.id).bind(&item.scheduled_date).bind(item.title.trim()).bind(item.project.trim())
            .bind(item.position).bind(item.estimated_sessions).bind(item.focus_minutes).bind(&item.kind).bind(&item.completed_at)
            .execute(&mut **transaction).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_task_queue(
    instances: State<'_, DbInstances>,
) -> Result<Vec<DailyQueueItem>, String> {
    let pool = sqlite_pool(&instances).await?;
    let rows = sqlx::query("SELECT * FROM daily_queue_items ORDER BY scheduled_date, position, id")
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| DailyQueueItem {
            id: row.get("id"),
            scheduled_date: row.get("scheduled_date"),
            title: row.get("title"),
            project: row.get("project"),
            position: row.get("position"),
            estimated_sessions: row.get("estimated_sessions"),
            focus_minutes: row.get("focus_minutes"),
            kind: row.get("kind"),
            completed_at: row.get("completed_at"),
        })
        .collect())
}

#[tauri::command]
pub async fn replace_task_queue(
    instances: State<'_, DbInstances>,
    items: Vec<DailyQueueItem>,
) -> Result<(), String> {
    validate_queue(&items)?;
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    write_queue(&mut transaction, &items)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    fn item() -> DailyQueueItem {
        DailyQueueItem {
            id: "queue-a".into(),
            scheduled_date: "2026-09-12".into(),
            title: "Task".into(),
            project: "DeepHUD".into(),
            position: 0,
            estimated_sessions: 3,
            focus_minutes: 25,
            kind: "pomodoro".into(),
            completed_at: None,
        }
    }

    #[test]
    fn queue_validation_rejects_duplicates_and_impossible_dates() {
        assert!(validate_queue(&[item()]).is_ok());
        assert!(validate_queue(&[item(), item()]).is_err());
        let mut invalid = item();
        invalid.scheduled_date = "2026-02-30".into();
        assert!(validate_queue(&[invalid]).is_err());
    }

    #[test]
    fn migration_queue_and_linked_sessions_round_trip_without_duplicate_saves() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            for migration in crate::database_migrations() {
                sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
            }
            let session = SessionRecord {
                id: None,
                queue_item_id: Some("queue-a".into()),
                work_session_id: Some("work-a".into()),
                work_session_ended_at: None,
                cycle_completed: Some(true),
                started_at: "2026-09-12T09:00:00Z".into(),
                ended_at: "2026-09-12T09:25:00Z".into(),
                planned_minutes: 25,
                focus_seconds: 1500,
                paused_seconds: 0,
                project: "DeepHUD".into(),
                task: "Task".into(),
                session_kind: "pomodoro".into(),
            };
            let mut tx = pool.begin().await.unwrap();
            write_queue(&mut tx, &[item()]).await.unwrap();
            insert_session(&mut tx, &session).await.unwrap();
            insert_session(&mut tx, &session).await.unwrap();
            tx.commit().await.unwrap();
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE queue_item_id = 'queue-a'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1);
            let title: String =
                sqlx::query_scalar("SELECT title FROM daily_queue_items WHERE id = 'queue-a'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Task");
            // Failed restores must leave both the queue and session history intact.
            let mut tx = pool.begin().await.unwrap();
            sqlx::query("DELETE FROM sessions")
                .execute(&mut *tx)
                .await
                .unwrap();
            assert!(write_queue(&mut tx, &[item(), item()]).await.is_err());
            tx.rollback().await.unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_queue_items")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
            // Removing a queue item retains the historical link and focus time.
            let mut tx = pool.begin().await.unwrap();
            write_queue(&mut tx, &[]).await.unwrap();
            tx.commit().await.unwrap();
            let seconds: i64 = sqlx::query_scalar(
                "SELECT focus_seconds FROM sessions WHERE queue_item_id = 'queue-a'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(seconds, 1500);
        });
    }
}
