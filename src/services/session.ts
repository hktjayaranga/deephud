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
  kind: Exclude<SessionKind, "stopwatch">;
  workMinutes: number;
  breakMinutes: number;
  phase: SessionPhase;
  project: string;
  task: string;
  startedAt: string;
  cycle: number;
  /** Undefined inherits the preference; null explicitly selects silence. */
  focusAudio?: FocusAudioPlan | null;
}
