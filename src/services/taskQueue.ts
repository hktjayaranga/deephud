import { invoke } from "@tauri-apps/api/core";
import type { SessionRecord } from "./database";
import type { SessionPlan } from "./session";

export interface DailyQueueItem {
  id: string;
  scheduledDate: string;
  title: string;
  project: string;
  position: number;
  estimatedSessions: number;
  focusMinutes: number;
  kind: "deep-work" | "pomodoro";
  completedAt: string | null;
}

export const QUEUE_KEY = "deephud:task-queue:v1";
export const MAX_QUEUE_ITEMS = 5000;
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function validateQueueId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !value.length || value.length > 100 || value.includes("\0")) throw new Error("Invalid queue item id");
  return value;
}
export function validateQueue(value: unknown): DailyQueueItem[] {
  if (!Array.isArray(value) || value.length > MAX_QUEUE_ITEMS) throw new Error("Invalid task queue size");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || !validateQueueId(item.id) || ids.has(item.id)
      || typeof item.title !== "string" || !item.title.trim() || item.title.length > 500 || item.title.includes("\0")
      || typeof item.project !== "string" || item.project.length > 200 || item.project.includes("\0")
      || typeof item.scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.scheduledDate)
      || !Number.isFinite(Date.parse(item.scheduledDate)) || new Date(item.scheduledDate).toISOString().slice(0, 10) !== item.scheduledDate
      || !Number.isInteger(item.position) || item.position < 0 || item.position > MAX_QUEUE_ITEMS
      || !Number.isInteger(item.estimatedSessions) || item.estimatedSessions < 1 || item.estimatedSessions > 100
      || !Number.isInteger(item.focusMinutes) || item.focusMinutes < 1 || item.focusMinutes > 240
      || !["deep-work", "pomodoro"].includes(item.kind)
      || (item.completedAt !== null && (typeof item.completedAt !== "string" || item.completedAt.length > 40 || !Number.isFinite(Date.parse(item.completedAt))))) throw new Error("Invalid task queue item");
    ids.add(item.id);
    return { id: item.id, title: item.title.trim(), project: item.project.trim(), scheduledDate: item.scheduledDate, position: item.position, estimatedSessions: item.estimatedSessions, focusMinutes: item.focusMinutes, kind: item.kind, completedAt: item.completedAt };
  });
}
export async function getQueue(): Promise<DailyQueueItem[]> {
  return validateQueue(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? await invoke("get_task_queue") : JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"));
}
export function normalizeQueue(items: DailyQueueItem[]) {
  const days = [...new Set(items.map((item) => item.scheduledDate))].sort();
  return days.flatMap((day) => orderedQueue(items, day).map((item, position) => ({ ...item, position })));
}
export async function saveQueue(items: DailyQueueItem[]) {
  const validated = validateQueue(items);
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) await invoke("replace_task_queue", { items: validated });
  else localStorage.setItem(QUEUE_KEY, JSON.stringify(validated));
}
export const orderedQueue = (items: DailyQueueItem[], day: string) => items.filter((item) => item.scheduledDate === day).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
export function moveQueueItem(items: DailyQueueItem[], id: string, direction: -1 | 1) {
  const item = items.find((entry) => entry.id === id);
  if (!item) return items;
  const dayItems = orderedQueue(items, item.scheduledDate).filter((entry) => !entry.completedAt);
  const index = dayItems.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= dayItems.length) return items;
  [dayItems[index], dayItems[target]] = [dayItems[target], dayItems[index]];
  const positions = new Map(dayItems.map((entry, position) => [entry.id, position]));
  return items.map((entry) => positions.has(entry.id) ? { ...entry, position: positions.get(entry.id)! } : entry);
}
export function queueProgress(id: string, sessions: SessionRecord[]) {
  // A retry or an older imported duplicate must not inflate completed blocks.
  const seen = new Set<string>();
  const records = sessions.filter((record) => {
    if (record.queueItemId !== id) return false;
    const key = `${record.workSessionId ?? record.id}:${record.startedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { completedSessions: records.filter((record) => record.cycleCompleted === true).length, focusSeconds: records.reduce((sum, record) => sum + record.focusSeconds, 0) };
}
export const nextQueueItem = (items: DailyQueueItem[], currentId?: string, day = localDay()) => orderedQueue(items, day).find((item) => !item.completedAt && item.id !== currentId);
export function queuePlan(item: DailyQueueItem, breakMinutes: number): SessionPlan {
  return { queueItemId: item.id, kind: item.kind, task: item.title, project: item.project, workMinutes: item.focusMinutes, breakMinutes, phase: "work", startedAt: new Date().toISOString(), cycle: 1 };
}
