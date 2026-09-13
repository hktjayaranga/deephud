import { useRef, useState } from "react";
import { ProjectRecord } from "../services/database";
import { DailyQueueItem, localDay } from "../services/taskQueue";
import { DistractionCapture, captureTask, pendingCaptures } from "../services/distractions";
import { QueueEditor } from "./TodayQueue";

interface Props {
  captures: DistractionCapture[];
  projects: ProjectRecord[];
  defaultMinutes: number;
  ready: boolean;
  onUpdate: (capture: DistractionCapture) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvert: (capture: DistractionCapture, task: DailyQueueItem) => Promise<void>;
}
export default function CaptureReview({ captures, projects, defaultMinutes, ready, onUpdate, onDelete, onConvert }: Props) {
  const [conversion, setConversion] = useState<{ capture: DistractionCapture; task: DailyQueueItem } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deferred, setDeferred] = useState<string[]>([]);
  const run = async (action: () => Promise<void>, message: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); setNotice(message); }
    catch (error) { setError(String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  const unhandled = pendingCaptures(captures).filter((capture) => !deferred.includes(capture.id));
  const handled = captures.filter((capture) => capture.handledAt || capture.convertedQueueItemId);
  const card = (capture: DistractionCapture) => <article className="queue-item capture-item" key={capture.id}>
    <p>{capture.text}</p><time dateTime={capture.createdAt}>{new Date(capture.createdAt).toLocaleString()}</time>
    <div className="queue-item__actions">
      {capture.convertedQueueItemId ? <span>Added to Today</span> : <>
        <button type="button" disabled={busy || !ready} onClick={() => void run(() => onUpdate({ ...capture, handledAt: capture.handledAt ? null : new Date().toISOString() }), capture.handledAt ? "Thought reopened" : "Marked handled")}>{capture.handledAt ? "Reopen" : "Mark handled"}</button>
        {!capture.handledAt && <><button type="button" disabled={busy || !ready} onClick={() => { setConversion({ capture, task: captureTask(capture.text, defaultMinutes) }); setError(""); }}>Add to Today</button><button type="button" disabled={busy} onClick={() => { setDeferred((ids) => [...ids, capture.id]); setNotice("Kept for later. This thought will appear when you reopen the list."); }}>Keep for later</button></>}
      </>}
      <button type="button" className="danger-action" disabled={busy || !ready} onClick={() => { if (window.confirm("Delete this saved thought? Any task created from it will be kept.")) void run(() => onDelete(capture.id), "Thought deleted"); }}>Delete</button>
    </div>
  </article>;
  return <section className="capture-review" aria-labelledby="saved-thoughts-title">
    <div className="section-title"><h2 id="saved-thoughts-title">Your saved thoughts</h2></div>
    <p className="queue-hint">Review whenever you’re ready. Your timer keeps its current rhythm.</p>
      {!ready && <p role="status" className="queue-hint">Saved thoughts are not loaded yet. Use Reload history if storage needs attention.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="queue-notice" role="status">{notice}</p>}
      {conversion ? <QueueEditor key={conversion.capture.id} item={null} initialTitle={conversion.capture.text} today={localDay()} projects={projects} defaultMinutes={defaultMinutes} busy={busy}
        onCancel={() => setConversion(null)} onSave={(draft) => void run(async () => { await onConvert(conversion.capture, { ...conversion.task, ...draft, scheduledDate: localDay() }); setConversion(null); }, "Added to Today. Start it when you’re ready.")} /> : <>
        <div className="queue-list">{unhandled.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(card)}</div>
        {ready && !unhandled.length && <div className="empty-state"><b>No thoughts to review right now</b><span>{deferred.length ? "Your deferred thoughts are still saved for later." : "Capture a thought beside the session name or use your shortcut."}</span></div>}
        {handled.length > 0 && <details className="queue-section"><summary>Handled · {handled.length}</summary><div className="queue-list">{handled.map(card)}</div></details>}
      </>}
  </section>;
}
