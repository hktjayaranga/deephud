import { invoke } from "@tauri-apps/api/core";
import { SessionPlan } from "./session";
import { localDay } from "./taskQueue";

export interface FocusSchedule {
  id: string;
  title: string;
  project: string;
  weekdays: number[]; // Sunday = 0; follows the computer's local timezone.
  time: string;
  kind: "deep-work" | "pomodoro";
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  enabled: boolean;
  updatedAt: string;
}
export interface ScheduleOccurrence {
  id: string;
  schedule: FocusSchedule;
  dueAt: string;
  status: "pending" | "deferred" | "dismissed" | "started" | "expired";
}
export interface ScheduleData { schedules: FocusSchedule[]; occurrences: ScheduleOccurrence[] }
export const SCHEDULES_KEY = "deephud:schedules:v1";
export const MISSED_REMINDER_MS = 15 * 60_000;
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const text = (v: unknown, max: number, required = false): string => {
  if (typeof v !== "string" || v.length > max || v.includes("\0") || (required && !v.trim())) throw new Error("Invalid schedule text");
  return v.trim();
};
const integer = (v: unknown, max: number) => {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) throw new Error("Invalid schedule duration or cycle count");
  return v as number;
};
export function validateSchedule(value: unknown): FocusSchedule {
  if (!value || typeof value !== "object") throw new Error("Invalid schedule");
  const s = value as FocusSchedule;
  if (!Array.isArray(s.weekdays) || !s.weekdays.length || s.weekdays.length > 7 || new Set(s.weekdays).size !== s.weekdays.length || s.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Choose at least one weekday");
  if (typeof s.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error("Choose a valid reminder time");
  if (!["deep-work", "pomodoro"].includes(s.kind) || typeof s.enabled !== "boolean" || typeof s.updatedAt !== "string" || !Number.isFinite(Date.parse(s.updatedAt))) throw new Error("Invalid schedule settings");
  const result = { id: text(s.id, 100, true), title: text(s.title, 500, true), project: text(s.project, 200), weekdays: [...s.weekdays].sort(), time: s.time, kind: s.kind, workMinutes: integer(s.workMinutes, 1440), breakMinutes: integer(s.breakMinutes, 120), longBreakMinutes: integer(s.longBreakMinutes, 240), cyclesBeforeLongBreak: integer(s.cyclesBeforeLongBreak, 12), enabled: s.enabled, updatedAt: s.updatedAt };
  if (result.kind === "pomodoro" && result.longBreakMinutes <= result.breakMinutes) throw new Error("Long break must be longer than the short break");
  return result;
}
export function validateScheduleData(value: unknown): ScheduleData {
  if (!value || typeof value !== "object") throw new Error("Invalid schedule backup");
  const v = value as ScheduleData;
  if (!Array.isArray(v.schedules) || v.schedules.length > 50 || !Array.isArray(v.occurrences) || v.occurrences.length > 20000) throw new Error("Too many or invalid schedules/reminders");
  const schedules = v.schedules.map(validateSchedule);
  const occurrences = v.occurrences.map(o => {
    if (!o || !["pending", "deferred", "dismissed", "started", "expired"].includes(o.status) || typeof o.dueAt !== "string" || !Number.isFinite(Date.parse(o.dueAt))) throw new Error("Invalid reminder occurrence");
    return { id: text(o.id, 120, true), schedule: validateSchedule(o.schedule), dueAt: o.dueAt, status: o.status };
  });
  if (new Set(schedules.map(s => s.id)).size !== schedules.length || new Set(occurrences.map(o => o.id)).size !== occurrences.length) throw new Error("Duplicate schedule or reminder");
  return { schedules, occurrences };
}
export function schedulePlan(schedule: FocusSchedule): SessionPlan {
  return { kind: schedule.kind, task: schedule.title, project: schedule.project, workMinutes: schedule.workMinutes, breakMinutes: schedule.breakMinutes, longBreakMinutes: schedule.longBreakMinutes, cyclesBeforeLongBreak: schedule.cyclesBeforeLongBreak, phase: "work", startedAt: new Date().toISOString(), cycle: 1 };
}
/** Find the next future local reminder, skipping nonexistent daylight-saving times. */
export function nextScheduledSession(schedules: FocusSchedule[], now = new Date()) {
  let next: { schedule: FocusSchedule; dueAt: Date } | null = null;
  for (const schedule of schedules.filter(s => s.enabled)) {
    const [hour, minute] = schedule.time.split(":").map(Number);
    for (let offset = 0; offset <= 14; offset++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
      if (!schedule.weekdays.includes(day.getDay())) continue;
      const dueAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (dueAt <= now || dueAt.getHours() !== hour || dueAt.getMinutes() !== minute || dueAt.getTime() < Date.parse(schedule.updatedAt)) continue;
      if (!next || dueAt < next.dueAt || (+dueAt === +next.dueAt && schedule.title.localeCompare(next.schedule.title) < 0)) next = { schedule, dueAt };
      break;
    }
  }
  return next;
}
/** Once per local date; nonexistent DST times are skipped, repeated times use the first occurrence. */
export function dueOccurrences(schedules: FocusSchedule[], now = new Date()): ScheduleOccurrence[] {
  const result: ScheduleOccurrence[] = [];
  for (const s of schedules.filter(s => s.enabled)) {
    for (const offset of [-1, 0]) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
      if (!s.weekdays.includes(day.getDay())) continue;
      const [hour, minute] = s.time.split(":").map(Number);
      const due = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      const age = now.getTime() - due.getTime();
      if (due.getHours() !== hour || due.getMinutes() !== minute || age < 0 || age > MISSED_REMINDER_MS || due.getTime() < Date.parse(s.updatedAt)) continue;
      result.push({ id: `${s.id}:${localDay(day)}`, schedule: s, dueAt: due.toISOString(), status: "pending" });
    }
  }
  return result.sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}
export function reconcileOccurrences(data: ScheduleData, now = new Date()): ScheduleData {
  const enabled = new Set(data.schedules.filter(s => s.enabled).map(s => s.id));
  const occurrences = data.occurrences.filter(o => now.getTime() - Date.parse(o.dueAt) < 366 * 86400_000).map(o => {
    const age = now.getTime() - Date.parse(o.dueAt);
    return { ...o, status: (o.status === "pending" && age > MISSED_REMINDER_MS) || (o.status === "deferred" && age > 86400_000) || (!enabled.has(o.schedule.id) && ["pending", "deferred"].includes(o.status)) ? "expired" as const : o.status };
  });
  const seen = new Set(occurrences.map(o => o.id));
  return { schedules: data.schedules, occurrences: [...occurrences, ...dueOccurrences(data.schedules, now).filter(o => !seen.has(o.id))] };
}
export function pendingReminders(data: ScheduleData, active: boolean) {
  return data.occurrences.filter(o => o.status === "pending" || (!active && o.status === "deferred")).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}
export async function getScheduleData(): Promise<ScheduleData> {
  if (inTauri()) return invoke("get_schedule_data");
  const data = reconcileOccurrences(validateScheduleData(JSON.parse(localStorage.getItem(SCHEDULES_KEY) ?? '{"schedules":[],"occurrences":[]}')));
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(data));
  return data;
}
export async function saveSchedule(schedule: FocusSchedule) {
  const s = validateSchedule({ ...schedule, updatedAt: new Date().toISOString() });
  if (inTauri()) return invoke<void>("save_focus_schedule", { schedule: s });
  const data = await getScheduleData();
  data.schedules = [...data.schedules.filter(x => x.id !== s.id), s];
  data.occurrences = data.occurrences.map(o => o.schedule.id === s.id && ["pending", "deferred"].includes(o.status) ? { ...o, status: "expired" } : o);
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(validateScheduleData(data)));
}
export async function deleteSchedule(id: string) {
  if (inTauri()) return invoke<void>("delete_focus_schedule", { id });
  const data = await getScheduleData();
  data.schedules = data.schedules.filter(s => s.id !== id);
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(reconcileOccurrences(data)));
}
export async function respondToReminder(id: string, status: "started" | "dismissed" | "deferred") {
  if (inTauri()) return invoke<void>("respond_to_reminder", { id, status });
  const data = await getScheduleData();
  const occurrence = data.occurrences.find(o => o.id === id && ["pending", "deferred"].includes(o.status));
  if (!occurrence) throw new Error("This reminder has expired or was already handled");
  occurrence.status = status;
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(data));
}

export async function releaseDeferredReminders() {
  if (inTauri()) return invoke<void>("release_deferred_reminders");
  const data = await getScheduleData();
  data.occurrences = data.occurrences.map(o => o.status === "deferred" ? { ...o, status: "pending", dueAt: new Date().toISOString() } : o);
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(data));
}
