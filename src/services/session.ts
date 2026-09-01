import { SessionKind } from "./database";

export type SessionPhase = "work" | "break";

export interface SessionPlan {
  kind: Exclude<SessionKind, "stopwatch">;
  workMinutes: number;
  breakMinutes: number;
  phase: SessionPhase;
  project: string;
  task: string;
  startedAt: string;
  cycle: number;
}

