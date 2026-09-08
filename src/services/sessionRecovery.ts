import { SessionRecord } from "./database";
import { FocusAudioPlan, SessionPlan } from "./session";
import { TimerState } from "./timer";

export const RECOVERY_KEY = "deephud:active-session:v1";
const MAX_MS = 365 * 24 * 60 * 60 * 1000;
export interface SessionSnapshot {
  version: 1;
  savedAt: number;
  plan: SessionPlan;
  timer: TimerState;
  pausedMs: number;
  warningShown: boolean;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: unknown, max = MAX_MS): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

function durableAudio(value: unknown): FocusAudioPlan | null {
  if (!object(value) || !object(value.track) || !bounded(value.volume, 100) || typeof value.pauseWithTimer !== "boolean") return null;
  const track = value.track;
  if (typeof track.name !== "string" || track.name.length > 500 || track.temporary || (typeof track.source === "string" && track.source.startsWith("blob:"))) return null;
  const text = (field: string) => typeof track[field] === "string" && track[field].length <= 4096 ? track[field] as string : undefined;
  const restored = { name: track.name, path: text("path"), libraryId: text("libraryId"), libraryPath: text("libraryPath"), source: text("source") };
  if (!restored.path && !restored.libraryId && !restored.libraryPath && !restored.source) return null;
  return { track: restored, volume: value.volume, pauseWithTimer: value.pauseWithTimer };
}

function breakProgress(plan: Record<string, unknown>): Partial<SessionPlan> {
  const result: Partial<SessionPlan> = {};
  for (const [field, min, max] of [["longBreakMinutes", 1, 240], ["cyclesBeforeLongBreak", 1, 12], ["completedFocusCycles", 0, 1_000_000], ["longBreakAtCount", 0, 1_000_000], ["activeBreakMinutes", 1, 1440]] as const) {
    const value = plan[field];
    if (value === undefined) continue;
    if (!bounded(value, max) || value < min || !Number.isInteger(value)) throw new Error("Invalid break progress");
    result[field] = value;
  }
  if (plan.breakKind !== undefined) {
    if (plan.breakKind !== "short" && plan.breakKind !== "long") throw new Error("Invalid break kind");
    result.breakKind = plan.breakKind;
  }
  if (plan.lastCompletedFocusStartedAt !== undefined) {
    if (typeof plan.lastCompletedFocusStartedAt !== "string" || !Number.isFinite(Date.parse(plan.lastCompletedFocusStartedAt))) throw new Error("Invalid completed cycle date");
    result.lastCompletedFocusStartedAt = plan.lastCompletedFocusStartedAt;
  }
  return result;
}

export function loadSessionSnapshot(): SessionSnapshot | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? "null");
    if (!object(value) || value.version !== 1 || !object(value.plan) || !object(value.timer)) return null;
    const { plan, timer } = value;
    if (!bounded(value.savedAt, 8.64e15) || !bounded(value.pausedMs) || typeof value.warningShown !== "boolean"
      || typeof plan.workSessionId !== "string" || !plan.workSessionId.length || plan.workSessionId.length > 100
      || typeof plan.startedAt !== "string" || !Number.isFinite(Date.parse(plan.startedAt))
      || typeof plan.task !== "string" || plan.task.length > 500 || typeof plan.project !== "string" || plan.project.length > 200
      || !["deep-work", "pomodoro", "stopwatch"].includes(String(plan.kind)) || !["work", "break"].includes(String(plan.phase))
      || !bounded(plan.workMinutes, 1440) || !bounded(plan.breakMinutes, 1440) || !Number.isInteger(plan.cycle) || !bounded(plan.cycle, 1_000_000) || plan.cycle === 0
      || !["countdown", "stopwatch"].includes(String(timer.mode)) || !["running", "paused", "finished"].includes(String(timer.status))
      || !bounded(timer.elapsedMs) || !bounded(timer.targetMs) || (timer.mode === "countdown" && (timer.targetMs === 0 || timer.elapsedMs > timer.targetMs))
      || (plan.kind === "stopwatch") !== (timer.mode === "stopwatch") || (plan.phase === "break" && plan.kind !== "pomodoro")) return null;
    // Durable audio references survive restart; temporary browser object URLs do not.
    return { version: 1, savedAt: value.savedAt, pausedMs: value.pausedMs, warningShown: value.warningShown, plan: { ...breakProgress(plan), kind: plan.kind, workSessionId: plan.workSessionId, startedAt: plan.startedAt, task: plan.task, project: plan.project, workMinutes: plan.workMinutes, breakMinutes: plan.breakMinutes, phase: plan.phase, cycle: plan.cycle, focusAudio: durableAudio(plan.focusAudio) } as SessionPlan, timer: { mode: timer.mode, status: timer.status, elapsedMs: timer.elapsedMs, targetMs: timer.targetMs } as TimerState };
  } catch { return null; }
}

export function saveSessionSnapshot(snapshot: SessionSnapshot) {
  // Avoid persisting temporary audio URLs or media contents.
  localStorage.setItem(RECOVERY_KEY, JSON.stringify({ ...snapshot, plan: { ...snapshot.plan, focusAudio: durableAudio(snapshot.plan.focusAudio) } }));
}
export function clearSessionSnapshot() { localStorage.removeItem(RECOVERY_KEY); }

export function savedRecoveryCycle(snapshot: SessionSnapshot, records: SessionRecord[]) {
  return records.find((record) => record.workSessionId === snapshot.plan.workSessionId && record.startedAt === snapshot.plan.startedAt);
}

/** A committed end takes precedence over a snapshot left behind by a crash. */
export function reconcileSessionSnapshot(snapshot: SessionSnapshot, records: SessionRecord[]): SessionSnapshot | null {
  if (records.some((record) => record.workSessionId === snapshot.plan.workSessionId && record.workSessionEndedAt)) return null;
  if (snapshot.plan.kind === "pomodoro" && snapshot.plan.completedFocusCycles === undefined) {
    // Older checkpoints lack counters. Rebuild from committed cycles, excluding the
    // current work interval: completion handling will count that interval once.
    const completed = records.filter((record) => record.workSessionId === snapshot.plan.workSessionId && record.cycleCompleted === true && record.startedAt !== snapshot.plan.startedAt).length;
    const every = snapshot.plan.cyclesBeforeLongBreak ?? 4;
    snapshot = { ...snapshot, plan: { ...snapshot.plan, completedFocusCycles: completed, longBreakAtCount: completed - completed % every } };
  }
  const saved = savedRecoveryCycle(snapshot, records);
  if (!saved) return snapshot;
  if (saved.cycleCompleted !== true || snapshot.plan.kind !== "pomodoro") return null;
  return { ...snapshot, timer: { ...snapshot.timer, elapsedMs: snapshot.timer.targetMs, status: "finished" } };
}

export function resumeSessionSnapshot(snapshot: SessionSnapshot, includeTimeAway: boolean, now = Date.now(), trackPausedTime = true) {
  const awayMs = Math.min(MAX_MS, Math.max(0, now - snapshot.savedAt));
  const canInclude = includeTimeAway && snapshot.timer.status === "running";
  const remaining = snapshot.timer.mode === "countdown" ? Math.max(0, snapshot.timer.targetMs - snapshot.timer.elapsedMs) : MAX_MS - snapshot.timer.elapsedMs;
  const includedMs = canInclude ? Math.min(awayMs, remaining) : 0;
  const elapsedMs = snapshot.timer.elapsedMs + includedMs;
  const finished = snapshot.timer.status === "finished" || (snapshot.timer.mode === "countdown" && elapsedMs >= snapshot.timer.targetMs);
  return {
    plan: snapshot.plan,
    timer: { ...snapshot.timer, elapsedMs, status: finished ? "finished" : "running" } as TimerState,
    pausedMs: Math.min(MAX_MS, snapshot.pausedMs + (trackPausedTime ? awayMs - includedMs : 0)),
  };
}
