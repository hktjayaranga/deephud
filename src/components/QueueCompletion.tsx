import { useEffect, useRef, useState } from "react";
import { DailyQueueItem, queueProgress } from "../services/taskQueue";
import { SessionRecord } from "../services/database";
import { SessionPlan, nextBreak } from "../services/session";

interface Props {
  plan: SessionPlan;
  item?: DailyQueueItem;
  next?: DailyQueueItem;
  sessions: SessionRecord[];
  onDone: () => Promise<void>;
  onContinue: () => Promise<void>;
  onNext: () => Promise<void>;
  onBreak: () => void;
  onClose: () => Promise<void>;
}
export default function QueueCompletion({ plan, item, next, sessions, onDone, onContinue, onNext, onBreak, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const needsBreak = plan.kind === "pomodoro" && plan.phase === "work";
  const progress = queueProgress(plan.queueItemId!, sessions);
  const run = async (action: () => Promise<void> | void) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (error) { setError(String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <dialog ref={dialogRef} className="completion-card history-confirmation queue-completion" onCancel={(event) => { event.preventDefault(); void run(onClose); }} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} aria-modal="true" aria-labelledby="queue-completion-title" aria-busy={busy}>
    <span aria-hidden="true">{plan.phase === "break" ? "☕" : "✓"}</span>
    <h2 id="queue-completion-title">{plan.phase === "break" ? "Break complete" : "Focus block complete"}</h2>
    <div className="queue-completion__details"><b>{item?.title ?? plan.task}</b><small>{progress.completedSessions}{item ? ` of ${item.estimatedSessions} estimated` : ""} sessions · {Math.round(progress.focusSeconds / 60)} min focused{item?.completedAt && " · Task done"}</small></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="queue-completion__actions">
      {needsBreak ? <button type="button" className="primary-action" disabled={busy} onClick={() => void run(onBreak)}>Start {nextBreak(plan).minutes}-min break</button>
        : item && !item.completedAt && <button type="button" className="primary-action" disabled={busy} onClick={() => void run(onContinue)}>Continue this task</button>}
      {item && !item.completedAt && <button type="button" disabled={busy} onClick={() => void run(onDone)}>Mark task done</button>}
    </div>
    <p className="queue-next">{needsBreak ? "Choose your next task after the break." : next ? `Next: ${next.title}` : "No other tasks in today’s queue."}</p>
    <div className="queue-completion__actions">
      {!needsBreak && next && <button type="button" disabled={busy} onClick={() => void run(onNext)}>Switch to next task</button>}
      <button type="button" disabled={busy} onClick={() => void run(onClose)}>Not now · End session</button>
    </div>
  </dialog>;
}
