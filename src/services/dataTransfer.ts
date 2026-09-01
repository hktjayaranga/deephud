import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { SessionRecord } from "./database";
import { Settings, validateSettings } from "./settings";

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_SESSIONS = 50_000;
const MAX_SESSION_SECONDS = 365 * 24 * 60 * 60;
const EARLIEST_SESSION = Date.parse("2000-01-01T00:00:00.000Z");

export interface DeepHUDBackup {
  application: "DeepHUD";
  schemaVersion: 1;
  exportedAt: string;
  settings: Settings;
  sessions: SessionRecord[];
}

const inTauri = () => "__TAURI_INTERNALS__" in window;
const dateStamp = () => new Date().toISOString().slice(0, 10);

export async function exportSessions(format: "csv" | "json", sessions: SessionRecord[]) {
  const content = format === "json" ? JSON.stringify(sessions, null, 2) : sessionsToCsv(sessions);
  await saveContent(`deephud-sessions-${dateStamp()}.${format}`, format, content);
}

export async function createBackup(settings: Settings, sessions: SessionRecord[]) {
  const backup: DeepHUDBackup = { application: "DeepHUD", schemaVersion: 1, exportedAt: new Date().toISOString(), settings, sessions };
  await saveContent(`deephud-backup-${dateStamp()}.json`, "json", JSON.stringify(backup, null, 2));
}

export async function selectBackup(): Promise<DeepHUDBackup | null> {
  if (!inTauri()) throw new Error("Restore is only available in the desktop application");
  const selected = await open({ title: "Restore DeepHUD backup", multiple: false, filters: [{ name: "DeepHUD backup", extensions: ["json"] }] });
  if (!selected || Array.isArray(selected)) return null;
  const file = await stat(selected);
  if (!file.isFile || file.size > MAX_BACKUP_BYTES) throw new Error("Backup must be a JSON file no larger than 10 MB");
  return validateBackup(JSON.parse(await readTextFile(selected)));
}

export function validateBackup(value: unknown, now = Date.now()): DeepHUDBackup {
  if (!isRecord(value) || (value.application !== "DeepHUD" && value.application !== "DeepWork HUD") || value.schemaVersion !== 1 || !Array.isArray(value.sessions)) throw new Error("This is not a valid DeepHUD v1 backup");
  if (value.sessions.length > MAX_BACKUP_SESSIONS) throw new Error(`Backup exceeds the ${MAX_BACKUP_SESSIONS.toLocaleString()} session limit`);
  const exportedAt = validDate(value.exportedAt, "export date", now);
  return {
    application: "DeepHUD",
    schemaVersion: 1,
    exportedAt,
    settings: validateSettings(value.settings),
    sessions: value.sessions.map((session, index) => validateBackupSession(session, index, now)),
  };
}

function validateBackupSession(value: unknown, index: number, now: number): SessionRecord {
  if (!isRecord(value)) throw new Error(`Backup session ${index + 1} is invalid`);
  const startedAt = validDate(value.startedAt, `session ${index + 1} start`, now);
  const endedAt = validDate(value.endedAt, `session ${index + 1} end`, now);
  if (Date.parse(endedAt) < Date.parse(startedAt)) throw new Error(`Backup session ${index + 1} ends before it starts`);
  const text = (field: "project" | "task", maximum: number) => {
    const candidate = value[field];
    if (typeof candidate !== "string" || candidate.length > maximum || candidate.includes("\0")) throw new Error(`Backup session ${index + 1} has an invalid ${field}`);
    return candidate;
  };
  const integer = (field: "plannedMinutes" | "focusSeconds" | "pausedSeconds", maximum: number) => {
    const candidate = value[field];
    if (!Number.isInteger(candidate) || (candidate as number) < 0 || (candidate as number) > maximum) throw new Error(`Backup session ${index + 1} has an invalid ${field}`);
    return candidate as number;
  };
  if (value.sessionKind !== "deep-work" && value.sessionKind !== "pomodoro" && value.sessionKind !== "stopwatch") throw new Error(`Backup session ${index + 1} has an invalid type`);
  return {
    startedAt,
    endedAt,
    plannedMinutes: integer("plannedMinutes", 1440),
    focusSeconds: integer("focusSeconds", MAX_SESSION_SECONDS),
    pausedSeconds: integer("pausedSeconds", MAX_SESSION_SECONDS),
    project: text("project", 200),
    task: text("task", 500),
    sessionKind: value.sessionKind,
  };
}

function validDate(value: unknown, name: string, now: number): string {
  if (typeof value !== "string" || value.length > 40) throw new Error(`Backup contains an invalid ${name}`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < EARLIEST_SESSION || timestamp > now + 24 * 60 * 60 * 1000) throw new Error(`Backup contains an invalid ${name}`);
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sessionsToCsv(sessions: SessionRecord[]) {
  const header = ["Started", "Ended", "Type", "Project", "Task", "Planned minutes", "Focus seconds", "Paused seconds"];
  const rows = sessions.map((session) => [session.startedAt, session.endedAt, session.sessionKind, session.project, session.task, session.plannedMinutes, session.focusSeconds, session.pausedSeconds]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string | number) {
  const original = String(value);
  const text = /^[\t\r]|^\s*[=+\-@]/.test(original) ? `'${original}` : original;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function saveContent(defaultName: string, extension: string, content: string) {
  if (inTauri()) {
    const path = await save({ title: `Save ${defaultName}`, defaultPath: defaultName, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (path) await writeTextFile(path, content);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: extension === "json" ? "application/json" : "text/csv" }));
  link.download = defaultName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export { sessionsToCsv };
