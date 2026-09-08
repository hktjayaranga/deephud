import { MotivationSituation } from "./motivation";
import { SessionKind } from "./database";
import { TimerState } from "./timer";

export function focusCompletionNotice(kind: SessionKind, minutes: number, goalReached: boolean, todayMinutes: number, motivationalMessages: boolean) {
  const title = kind === "pomodoro" ? "Focus cycle completed" : "Deep work session completed";
  return {
    title: `${goalReached ? "🎯" : "🎉"} ${title}${goalReached ? " · Daily goal reached" : ""}`,
    body: `${minutes} minutes focused.${goalReached ? ` ${todayMinutes} minutes focused today.` : ""}`,
    motivation: motivationalMessages ? (goalReached ? "goal" : "complete") as MotivationSituation : undefined,
  };
}

export function isFocusReminderDue(state: TimerState, phase: "work" | "break" | undefined, enabled: boolean) {
  const remaining = state.targetMs - state.elapsedMs;
  return enabled && phase === "work" && state.mode === "countdown" && state.status === "running" && state.targetMs > 300_000 && remaining > 0 && remaining <= 300_000;
}
