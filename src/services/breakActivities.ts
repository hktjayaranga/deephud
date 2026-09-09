import { SessionPlan } from "./session";
import { TimerState } from "./timer";

export const breakActivities = [
  { id: "breathing", title: "Breathing exercise", description: "Follow the square · 4 seconds per step" },
] as const;
export type BreakActivityId = typeof breakActivities[number]["id"];
export interface BreakActivityChoice {
  breakKey: string;
  activity: BreakActivityId | "none";
  startedMs: number;
  /** Undefined: choosing cycles; null: run until the break ends. */
  cycles?: number | null;
}

// A choice belongs to one interval only. It never changes the session or timer.
export function breakActivityState(plan: SessionPlan | null, timer: TimerState, choice: BreakActivityChoice | null) {
  const active = plan?.phase === "break" && (timer.status === "running" || timer.status === "paused");
  const key = active ? `${plan.workSessionId ?? ""}:${plan.startedAt}:${plan.cycle}` : null;
  const current = key && choice?.breakKey === key ? choice : null;
  const completed = current?.activity === "breathing" && current.cycles != null
    && breathingRunProgress(breathingElapsed(timer, current.startedMs), current.cycles).complete;
  return { key, choice: current, visible: Boolean(key && current?.activity !== "none" && !completed) };
}

export const breathingStages = ["Inhale", "Hold", "Exhale", "Hold"] as const;
export const BREATHING_CYCLE_MS = 16_000;
export function parseBreathingCycles(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const cycles = Number(value);
  return Number.isInteger(cycles) && cycles >= 1 && cycles <= 999 ? cycles : null;
}

export function breathingRunProgress(elapsedMs: number, cycles: number | null) {
  const elapsed = Math.max(0, elapsedMs);
  const complete = cycles !== null && elapsed >= cycles * BREATHING_CYCLE_MS;
  return {
    complete,
    cycle: Math.min(Math.floor(elapsed / BREATHING_CYCLE_MS) + 1, cycles ?? Infinity),
    // Keep the last hold visible until the authoritative timer confirms completion.
    animationMs: cycles === null ? elapsed : Math.min(elapsed, cycles * BREATHING_CYCLE_MS - 1),
  };
}
export function breathingProgress(elapsedMs: number) {
  const cycleMs = Math.max(0, elapsedMs) % 16_000;
  const stage = Math.floor(cycleMs / 4_000);
  return { stage, label: breathingStages[stage], count: 4 - Math.floor(cycleMs % 4_000 / 1000), progress: cycleMs / 16_000 };
}

export function breathingElapsed(timer: TimerState, startedMs: number, sinceSampleMs = 0) {
  // Interpolate only the current 200ms timer sample, so throttled windows cannot
  // run the exercise ahead of the authoritative break clock.
  const extra = timer.status === "running" ? Math.min(200, Math.max(0, sinceSampleMs)) : 0;
  return Math.max(0, Math.min(timer.targetMs, timer.elapsedMs + extra) - startedMs);
}
