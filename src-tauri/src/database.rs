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
         (started_at, ended_at, planned_minutes, focus_seconds, paused_seconds, project, task, session_kind) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&session.started_at)
    .bind(&session.ended_at)
    .bind(session.planned_minutes)
    .bind(session.focus_seconds)
    .bind(session.paused_seconds)
    .bind(&session.project)
    .bind(&session.task)
    .bind(&session.session_kind)
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
         focus_seconds = ?4, paused_seconds = ?5, project = ?6, task = ?7, session_kind = ?8 WHERE id = ?9",
    )
    .bind(&session.started_at)
    .bind(&session.ended_at)
    .bind(session.planned_minutes)
    .bind(session.focus_seconds)
    .bind(session.paused_seconds)
    .bind(&session.project)
    .bind(&session.task)
    .bind(&session.session_kind)
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
        "SELECT id, started_at, ended_at, planned_minutes, focus_seconds, paused_seconds, project, task, session_kind \
         FROM sessions ORDER BY started_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| SessionRecord {
            id: Some(row.get("id")),
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
) -> Result<(), String> {
    if sessions.len() > MAX_SESSIONS_PER_RESTORE {
        return Err("Backup contains too many sessions".into());
    }
    for session in &sessions {
        validate_session(session, false)?;
    }
    let pool = sqlite_pool(&instances).await?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM sessions")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
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
