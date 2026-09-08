import { useState } from "react";
import { SessionSnapshot, resumeSessionSnapshot } from "../services/sessionRecovery";
import { displayMs, formatMs } from "../services/timer";

interface Props {
  snapshot: SessionSnapshot;
  busy: boolean;
  error: string;
  onResume: (includeTimeAway: boolean) => void;
  onDiscard: () => void;
}

export default function SessionRecovery({ snapshot, busy, error, onResume, onDiscard }: Props) {
  const [includeTimeAway, setIncludeTimeAway] = useState(false);
  const preview = resumeSessionSnapshot(snapshot, includeTimeAway);
  const phase = snapshot.plan.phase === "break" ? (snapshot.plan.breakKind === "long" ? "Long break" : "Break") : "Focus";
  const label = preview.timer.status === "finished" ? "Continue completed interval" : preview.timer.mode === "countdown" ? `Resume with ${formatMs(displayMs(preview.timer))} remaining` : `Resume at ${formatMs(preview.timer.elapsedMs)}`;
  return <div className="completion-backdrop recovery-backdrop"><section className="completion-card recovery-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
    <span aria-hidden="true">↺</span>
    <h2 id="recovery-title">Resume your session?</h2>
    <p className="recovery-task">{snapshot.plan.task || snapshot.plan.project || "Focus session"}</p>
    <p>{phase}{snapshot.plan.kind === "pomodoro" ? ` · Cycle ${snapshot.plan.cycle}` : ""} · {formatMs(snapshot.timer.elapsedMs)} recorded in this interval.<br />Completed cycles remain in your history.</p>
    <label className="recovery-option"><input type="checkbox" checked={includeTimeAway} disabled={busy || snapshot.timer.status !== "running"} onChange={(event) => setIncludeTimeAway(event.target.checked)} />Include time away{snapshot.plan.phase === "work" ? " as focused time" : " in this break"}</label>
    <p>{snapshot.timer.status !== "running" ? "The timer was paused or finished. Time away stays excluded." : "Time away is excluded unless selected. Only this interval can finish; no extra cycles are added."}</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div><button className="primary-action" disabled={busy} autoFocus onClick={() => onResume(includeTimeAway)}>{busy ? "Checking history…" : label}</button><button disabled={busy} onClick={onDiscard}>Discard unfinished interval</button></div>
  </section></div>;
}
