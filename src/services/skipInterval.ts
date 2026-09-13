import { saveSession } from "./database";
import { SessionPlan } from "./session";

/** Persist partial work before allowing the timer to move to its break. */
export async function saveSkippedWorkInterval(plan: SessionPlan, elapsedMs: number, pausedMs: number) {
  if (plan.kind !== "pomodoro" || plan.phase !== "work" || elapsedMs <= 0) return;
  await saveSession({
    queueItemId: plan.queueItemId,
    workSessionId: plan.workSessionId,
    cycleCompleted: false,
    startedAt: plan.startedAt,
    endedAt: new Date().toISOString(),
    plannedMinutes: plan.workMinutes,
    focusSeconds: Math.max(1, Math.round(elapsedMs / 1000)),
    pausedSeconds: Math.round(pausedMs / 1000),
    project: plan.project,
    task: plan.task,
    sessionKind: plan.kind,
  });
}
