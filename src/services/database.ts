import { invoke } from "@tauri-apps/api/core";

export type SessionKind = "deep-work" | "pomodoro" | "stopwatch";

export interface SessionRecord {
  id?: number;
  workSessionId?: string | null;
  workSessionEndedAt?: string | null;
  cycleCompleted?: boolean | null;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  focusSeconds: number;
  pausedSeconds: number;
  project: string;
  task: string;
  sessionKind: SessionKind;
}

export interface ProjectRecord {
  id: number;
  name: string;
  tasks: { id: number; name: string }[];
}

const FALLBACK_KEY = "deepwork-hud:sessions:v3";

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function initializeDatabase() {
  if (inTauri()) await invoke("initialize_database");
}

export async function saveSession(session: SessionRecord): Promise<void> {
  if (!inTauri()) {
    const sessions = await getSessions();
    sessions.unshift({ ...session, id: Math.max(Date.now(), ...sessions.map((item) => (item.id ?? 0) + 1)) });
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(sessions));
    return;
  }
  await invoke("save_session", { session });
}

export async function updateSession(session: SessionRecord): Promise<void> {
  if (!session.id) throw new Error("Cannot update a session without an id");
  if (!inTauri()) {
    const sessions = (await getSessions()).map((item) => item.id === session.id ? session : item);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(sessions));
    return;
  }
  await invoke("update_session", { session });
}

export async function getSessions(): Promise<SessionRecord[]> {
  if (!inTauri()) {
    try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? "[]"); }
    catch { return []; }
  }
  return invoke<SessionRecord[]>("get_sessions");
}

export async function deleteSession(id: number): Promise<void> {
  if (!inTauri()) {
    const sessions = (await getSessions()).filter((session) => session.id !== id);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(sessions));
    return;
  }
  await invoke("delete_session", { id });
}

export async function resetDatabase(): Promise<void> {
  if (!inTauri()) {
    localStorage.removeItem(FALLBACK_KEY);
    return;
  }
  await invoke("reset_database");
}

export async function replaceSessions(sessions: SessionRecord[]): Promise<void> {
  const validated = sessions.map(validateSession);
  if (!inTauri()) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(validated.map((session, index) => ({ ...session, id: Date.now() + index }))));
    return;
  }
  await invoke("replace_sessions", { sessions: validated });
}

export async function ensureProjectTask(project: string, task: string): Promise<void> {
  const projectName = project.trim();
  if (!projectName || !inTauri()) return;
  await invoke("ensure_project_task", { project: projectName, task: task.trim() });
}

export async function getProjects(): Promise<ProjectRecord[]> {
  if (!inTauri()) {
    const sessions = await getSessions();
    const names = [...new Set(sessions.map((session) => session.project).filter(Boolean))];
    return names.map((name, index) => ({ id: index + 1, name, tasks: [...new Set(sessions.filter((session) => session.project === name).map((session) => session.task).filter(Boolean))].map((task, taskIndex) => ({ id: taskIndex + 1, name: task })) }));
  }
  return invoke<ProjectRecord[]>("get_projects");
}

function validateSession(value: SessionRecord): SessionRecord {
  if (!value || !Number.isInteger(value.focusSeconds) || value.focusSeconds < 0 || value.focusSeconds > 365 * 24 * 60 * 60 || !Number.isInteger(value.pausedSeconds) || value.pausedSeconds < 0 || value.pausedSeconds > 365 * 24 * 60 * 60 || !Number.isInteger(value.plannedMinutes) || value.plannedMinutes < 0 || value.plannedMinutes > 1440 || Number.isNaN(Date.parse(value.startedAt)) || Number.isNaN(Date.parse(value.endedAt)) || Date.parse(value.endedAt) < Date.parse(value.startedAt) || typeof value.project !== "string" || value.project.length > 200 || typeof value.task !== "string" || value.task.length > 500 || !["deep-work", "pomodoro", "stopwatch"].includes(value.sessionKind)) throw new Error("Backup contains an invalid session record");
  return {
    ...validateSessionGrouping(value),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    plannedMinutes: value.plannedMinutes,
    focusSeconds: value.focusSeconds,
    pausedSeconds: value.pausedSeconds,
    project: value.project,
    task: value.task,
    sessionKind: value.sessionKind,
  };
}

/** Optional metadata keeps existing records and v1 backups compatible. */
export function validateSessionGrouping(value: { workSessionId?: unknown; workSessionEndedAt?: unknown; cycleCompleted?: unknown }) {
  const { workSessionId, workSessionEndedAt, cycleCompleted } = value;
  if (workSessionId != null && (typeof workSessionId !== "string" || !workSessionId.length || workSessionId.length > 100 || workSessionId.includes("\0"))) throw new Error("Invalid work session id");
  if (workSessionEndedAt != null && (typeof workSessionEndedAt !== "string" || workSessionEndedAt.length > 40 || !Number.isFinite(Date.parse(workSessionEndedAt)))) throw new Error("Invalid work session end");
  if (cycleCompleted != null && typeof cycleCompleted !== "boolean") throw new Error("Invalid cycle completion");
  return { workSessionId: workSessionId as string | undefined | null, workSessionEndedAt: workSessionEndedAt as string | undefined | null, cycleCompleted: cycleCompleted as boolean | undefined | null };
}
