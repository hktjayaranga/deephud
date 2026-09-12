import { invoke } from "@tauri-apps/api/core";
import { DailyQueueItem, MAX_QUEUE_ITEMS, QUEUE_KEY, getQueue, localDay, normalizeQueue, validateQueue, validateQueueId } from "./taskQueue";

export interface DistractionCapture {
  id: string;
  text: string;
  createdAt: string;
  workSessionId: string | null;
  queueItemId: string | null;
  handledAt: string | null;
  convertedQueueItemId: string | null;
}
export const CAPTURES_KEY = "deephud:distractions:v1";
export const MAX_CAPTURES = 5000;
const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10);
export function validateCaptures(value: unknown): DistractionCapture[] {
  if (!Array.isArray(value) || value.length > MAX_CAPTURES) throw new Error("Invalid saved thoughts list");
  const ids = new Set<string>();
  return value.map((capture) => {
    if (!capture || typeof capture !== "object" || !validateQueueId(capture.id) || ids.has(capture.id)
      || typeof capture.text !== "string" || !capture.text.trim() || capture.text.length > 500 || capture.text.includes("\0")
      || !validDate(capture.createdAt) || (capture.handledAt !== null && !validDate(capture.handledAt))) throw new Error("Invalid saved thought");
    ids.add(capture.id);
    return { id: capture.id, text: capture.text.trim(), createdAt: capture.createdAt, handledAt: capture.handledAt,
      workSessionId: validateQueueId(capture.workSessionId) ?? null, queueItemId: validateQueueId(capture.queueItemId) ?? null,
      convertedQueueItemId: validateQueueId(capture.convertedQueueItemId) ?? null };
  });
}
export async function getCaptures(): Promise<DistractionCapture[]> {
  return validateCaptures(native() ? await invoke("get_captures") : JSON.parse(localStorage.getItem(CAPTURES_KEY) ?? "[]"));
}
async function saveCaptureNow(capture: DistractionCapture) {
  const valid = validateCaptures([capture])[0];
  if (native()) { await invoke("save_capture", { capture: valid }); return; }
  const captures = await getCaptures();
  const existing = captures.find((item) => item.id === valid.id);
  const updated = existing ? captures.map((item) => item.id === valid.id ? { ...item, text: valid.text, handledAt: valid.handledAt } : item) : [...captures, { ...valid, convertedQueueItemId: null }];
  localStorage.setItem(CAPTURES_KEY, JSON.stringify(validateCaptures(updated)));
}
async function deleteCaptureNow(id: string) {
  validateQueueId(id);
  if (native()) await invoke("delete_capture", { id });
  else localStorage.setItem(CAPTURES_KEY, JSON.stringify((await getCaptures()).filter((item) => item.id !== id)));
}

/** Conversion commits the new task and its source link together. Retrying returns the same task. */
async function convertCaptureNow(id: string, item: DailyQueueItem): Promise<string> {
  validateQueueId(id);
  const valid = validateQueue([item])[0];
  if (native()) return invoke("convert_capture", { id, item: valid });
  const captures = await getCaptures();
  const source = captures.find((capture) => capture.id === id);
  if (!source) throw new Error("This thought is no longer available");
  if (source.convertedQueueItemId) return source.convertedQueueItemId;
  const queue = await getQueue();
  if (queue.length >= MAX_QUEUE_ITEMS) throw new Error("Your task queue is full");
  if (queue.some((entry) => entry.id === valid.id)) throw new Error("Task id is already in use");
  const next = normalizeQueue([...queue, { ...valid, position: MAX_QUEUE_ITEMS }]);
  const updated = captures.map((capture) => capture.id === id ? { ...capture, convertedQueueItemId: valid.id, handledAt: new Date().toISOString() } : capture);
  const oldQueue = localStorage.getItem(QUEUE_KEY);
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    localStorage.setItem(CAPTURES_KEY, JSON.stringify(updated));
  } catch (error) {
    if (oldQueue === null) localStorage.removeItem(QUEUE_KEY); else localStorage.setItem(QUEUE_KEY, oldQueue);
    throw error;
  }
  return valid.id;
}
export const pendingCaptures = (captures: DistractionCapture[]) => captures.filter((capture) => !capture.handledAt && !capture.convertedQueueItemId);
export function captureTask(text: string, defaultMinutes: number): DailyQueueItem {
  return { id: crypto.randomUUID(), title: text, project: "", scheduledDate: localDay(), position: MAX_QUEUE_ITEMS, estimatedSessions: 1, focusMinutes: defaultMinutes, kind: "pomodoro", completedAt: null };
}

// Serialize browser read/modify/write operations as well as repeated UI submissions.
let mutation = Promise.resolve<unknown>(undefined);
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = mutation.then(action);
  mutation = result.catch(() => undefined);
  return result;
}
export const saveCapture = (capture: DistractionCapture) => serialize(() => saveCaptureNow(capture));
export const deleteCapture = (id: string) => serialize(() => deleteCaptureNow(id));
export const convertCapture = (id: string, item: DailyQueueItem) => serialize(() => convertCaptureNow(id, item));

export function deferIdleForCapture(open: boolean, lastInteraction: number, idleMinutes: number, now: number) {
  return open || now - lastInteraction < idleMinutes * 60_000;
}
