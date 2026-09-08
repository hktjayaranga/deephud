import { SessionKind } from "./database";

export type SessionPhase = "work" | "break";

export interface FocusAudioTrack {
  name: string;
  /** Legacy native file path selected through Tauri's file dialog. */
  path?: string;
  /** Identifier of an audio recording copied into DeepHUD's local library. */
  libraryId?: string;
  /** App-data-relative path owned by DeepHUD. */
  libraryPath?: string;
  /** Temporary object URL used by the browser development build. */
  source?: string;
  /** True only when source is an object URL owned by DeepHUD. */
  temporary?: boolean;
}

export interface FocusAudioPlan {
  track: FocusAudioTrack;
  volume: number;
  pauseWithTimer: boolean;
}

export interface SessionPlan {
  workSessionId?: string;
  kind: SessionKind;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes?: number;
  cyclesBeforeLongBreak?: number;
  completedFocusCycles?: number;
  lastCompletedFocusStartedAt?: string;
  longBreakAtCount?: number;
  breakKind?: "short" | "long";
  activeBreakMinutes?: number;
  phase: SessionPhase;
  project: string;
  task: string;
  startedAt: string;
  cycle: number;
  /** Undefined inherits the preference; null explicitly selects silence. */
  focusAudio?: FocusAudioPlan | null;
}

/** Completing an interval is idempotent across saving, retrying and recovery. */
export function completeFocusCycle(plan: SessionPlan): SessionPlan {
  if (plan.kind !== "pomodoro" || plan.phase !== "work" || plan.lastCompletedFocusStartedAt === plan.startedAt) return plan;
  return { ...plan, completedFocusCycles: (plan.completedFocusCycles ?? 0) + 1, lastCompletedFocusStartedAt: plan.startedAt };
}

export function nextBreak(plan: SessionPlan) {
  const completed = plan.completedFocusCycles ?? 0;
  const every = plan.cyclesBeforeLongBreak ?? 4;
  const long = completed > 0 && completed % every === 0 && plan.longBreakAtCount !== completed;
  return { kind: long ? "long" as const : "short" as const, minutes: long ? Math.max(plan.breakMinutes + 1, plan.longBreakMinutes ?? 20) : plan.breakMinutes };
}

export function transitionSessionPhase(plan: SessionPlan, phase: SessionPhase, startedAt = new Date().toISOString()): SessionPlan {
  const rest = nextBreak(plan);
  return { ...plan, phase, startedAt, cycle: phase === "work" ? plan.cycle + 1 : plan.cycle,
    breakKind: phase === "break" ? rest.kind : undefined,
    activeBreakMinutes: phase === "break" ? rest.minutes : undefined,
    longBreakAtCount: phase === "break" && rest.kind === "long" ? plan.completedFocusCycles : plan.longBreakAtCount,
  };
}
