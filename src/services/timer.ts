export type TimerMode = "stopwatch" | "countdown";
export type TimerStatus = "idle" | "running" | "paused" | "finished";

export interface TimerState {
  mode: TimerMode;
  status: TimerStatus;
  /** Elapsed time in ms since the session started (stopwatch: counts up,
   *  countdown: also counts up — we subtract from the target for display). */
  elapsedMs: number;
  /** Only used in countdown mode. */
  targetMs: number;
}

export const initialTimerState = (
  mode: TimerMode = "stopwatch",
  targetMinutes = 25,
): TimerState => ({
  mode,
  status: "idle",
  elapsedMs: 0,
  targetMs: targetMinutes * 60 * 1000,
});

/** Pure formatter: ms -> "HH:MM:SS" (drops the hour segment under 1h). */
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** What the HUD should currently display, given the raw state. */
export function displayMs(state: TimerState): number {
  if (state.mode === "stopwatch") return state.elapsedMs;
  return Math.max(0, state.targetMs - state.elapsedMs);
}
