import { SessionRecord } from "./database";
import { SessionPlan } from "./session";
import { TimerState } from "./timer";

/** Use recorded focus durations, never wall-clock time or the number of cycles. */
export function sessionProgress(plan: SessionPlan | null, timer: TimerState, records: SessionRecord[]): string | undefined {
  if (!plan || plan.kind !== "pomodoro") return undefined;
  const matching = plan.workSessionId ? records.filter((record) => record.workSessionId === plan.workSessionId) : [];
  let seconds = matching.reduce((sum, record) => sum + record.focusSeconds, 0);
  const currentSaved = matching.some((record) => record.startedAt === plan.startedAt);
  if (plan.phase === "work" && !currentSaved) {
    const focusedMs = timer.mode === "countdown" ? Math.min(timer.elapsedMs, timer.targetMs) : timer.elapsedMs;
    seconds += Math.max(0, Math.floor(focusedMs / 1000));
  }
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const duration = hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
  return `Cycle ${plan.cycle} · ${duration} focused`;
}
