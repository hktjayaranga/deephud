import { useRef, useState } from "react";
import { ProjectRecord, SessionRecord } from "../services/database";
import { DailyQueueItem, MAX_QUEUE_ITEMS, moveQueueItem, orderedQueue, queueProgress } from "../services/taskQueue";
import { formatDuration } from "./Dashboard";

interface Props {
  items: DailyQueueItem[];
  sessions: SessionRecord[];
  projects: ProjectRecord[];
  today: string;
  activeId?: string;
  canStart: boolean;
  ready: boolean;
  defaultMinutes: number;
  onChange: (items: DailyQueueItem[]) => Promise<void>;
  onStart: (item: DailyQueueItem) => Promise<void>;
  onClose: () => void;
  onDragStart: () => void;
  notices?: React.ReactNode;
}

export default function TodayQueue({ items, sessions, projects, today, activeId, canStart, ready, defaultMinutes, onChange, onStart, onClose, onDragStart, notices }: Props) {
  const [editing, setEditing] = useState<DailyQueueItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const todayItems = orderedQueue(items, today);
  const pendingItems = todayItems.filter((item) => !item.completedAt);
  const completed = todayItems.filter((item) => item.completedAt);
  const earlier = items.filter((item) => item.scheduledDate < today && !item.completedAt).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.position - b.position);
  const run = async (action: () => Promise<void>, message = "") => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(message); }
    catch (error) { setError(String(error)); }
    finally { pending.current = false; setBusy(false); }
  };
  const update = (item: DailyQueueItem) => onChange(items.map((entry) => entry.id === item.id ? item : entry));
  const renderItem = (item: DailyQueueItem, previousDay = false) => {
    const progress = queueProgress(item.id, sessions);
    const active = item.id === activeId;
    const index = pendingItems.findIndex((entry) => entry.id === item.id);
    return <article className={`queue-item ${item.completedAt ? "is-complete" : ""} ${active ? "is-active" : ""}`} key={item.id}>
      <div className="queue-item__heading">
        <button type="button" className="queue-check" disabled={busy || active || !ready} aria-label={`${item.completedAt ? "Reopen" : "Complete"} ${item.title}`} aria-pressed={Boolean(item.completedAt)} title={active ? "Finish the current focus block before completing this task" : item.completedAt ? "Reopen task" : "Mark task done"} onClick={() => void run(() => update({ ...item, completedAt: item.completedAt ? null : new Date().toISOString() }), item.completedAt ? "Task reopened" : "Task completed")}>{item.completedAt ? "✓" : ""}</button>
        <div className="queue-item__text"><b>{item.title}</b><span>{item.project || "No project"}{active && " · Current task"}{previousDay && ` · ${item.scheduledDate}`}</span></div>
        {!item.completedAt && !previousDay && <button type="button" className="primary-action" disabled={busy || !canStart || !ready} onClick={() => void run(() => onStart(item))}>{active ? "Active" : "Start"}</button>}
      </div>
      <div className="queue-item__progress"><span>{progress.completedSessions} / {item.estimatedSessions} sessions · {item.focusMinutes} min each</span><span>{formatDuration(progress.focusSeconds)} focused</span></div>
      <div className="goal-progress"><span style={{ width: `${Math.min(100, progress.completedSessions / item.estimatedSessions * 100)}%` }} /></div>
      <div className="queue-item__actions">
        {!item.completedAt && !previousDay && <><button type="button" disabled={busy || !ready || index === 0} aria-label={`Move ${item.title} up`} onClick={() => void run(() => onChange(moveQueueItem(items, item.id, -1)), "Task moved up")}>↑</button><button type="button" disabled={busy || !ready || index === pendingItems.length - 1} aria-label={`Move ${item.title} down`} onClick={() => void run(() => onChange(moveQueueItem(items, item.id, 1)), "Task moved down")}>↓</button></>}
        <span>{item.kind === "pomodoro" ? "Focus intervals" : "Deep Work"}</span>
        {previousDay && <button type="button" disabled={busy || !ready || active} onClick={() => void run(() => update({ ...item, scheduledDate: today, position: MAX_QUEUE_ITEMS }), "Task moved to today")}>Move to today</button>}
        <button type="button" disabled={busy || !ready || active} onClick={() => { setEditing(item); setAdding(false); }}>Edit</button>
        <button type="button" className="danger-action" disabled={busy || !ready || active} onClick={() => {
          if (window.confirm(`Remove “${item.title}” from the queue? Its focus history will be kept.`)) void run(() => onChange(items.filter((entry) => entry.id !== item.id)), "Task removed");
        }}>Remove</button>
      </div>
    </article>;
  };
  return <section className="workspace today-queue">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">PLAN YOUR FOCUS</span><h1>Today</h1></div>
      <span className="streak">{completed.length} / {todayItems.length} done</span>
      <button type="button" className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <div className="workspace__content">
      {notices}
      <div className="section-title"><h2>Your task queue</h2><button type="button" className="queue-add" disabled={busy || !ready || items.length >= MAX_QUEUE_ITEMS} onClick={() => { setAdding(true); setEditing(null); }}>+ Add task</button></div>
      <p className="queue-hint">One session is one completed focus block. Mark tasks done when the work is finished.</p>
      {!canStart && <p className="queue-hint" role="status">A session is open. Return to the timer to finish or end &amp; save it before starting another task.</p>}
      {!ready && <p className="queue-hint" role="status">The queue is not loaded yet. If storage needs attention, use Reload history above.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="queue-notice" role="status">{notice}</p>}
      {(adding || editing) && <QueueEditor key={editing?.id ?? "new"} item={editing} today={today} projects={projects} defaultMinutes={defaultMinutes} busy={busy} onCancel={() => { setAdding(false); setEditing(null); }} onSave={(draft) => void run(async () => {
        const item: DailyQueueItem = { ...draft, id: editing?.id ?? crypto.randomUUID(), scheduledDate: editing?.scheduledDate ?? today, position: editing?.position ?? MAX_QUEUE_ITEMS, completedAt: editing?.completedAt ?? null };
        await onChange(editing ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item]);
        setAdding(false); setEditing(null);
      }, editing ? "Task updated" : "Task added")} />}
      <div className="queue-list">{pendingItems.map((item) => renderItem(item))}</div>
      {ready && !pendingItems.length && <div className="empty-state"><b>{completed.length ? "Today's queue is complete" : "Make room for your next focus"}</b><span>{completed.length ? "Add another task whenever you’re ready." : "Add a task, estimate your sessions, then start focusing."}</span></div>}
      {completed.length > 0 && <details className="queue-section" open><summary>Completed today · {completed.length}</summary><div className="queue-list">{completed.map((item) => renderItem(item))}</div></details>}
      {earlier.length > 0 && <details className="queue-section"><summary>Unfinished from earlier · {earlier.length}</summary><p className="queue-hint">Move a task to today to continue it. Its progress stays with it.</p><div className="queue-list">{earlier.map((item) => renderItem(item, true))}</div></details>}
    </div>
  </section>;
}

export type QueueDraft = Pick<DailyQueueItem, "title" | "project" | "estimatedSessions" | "focusMinutes" | "kind">;
export function QueueEditor({ item, today, projects, defaultMinutes, busy, onSave, onCancel, initialTitle = "" }: { item: DailyQueueItem | null; today: string; projects: ProjectRecord[]; defaultMinutes: number; busy: boolean; onSave: (draft: QueueDraft) => void; onCancel: () => void; initialTitle?: string }) {
  const [draft, setDraft] = useState<QueueDraft>(() => item ?? { title: initialTitle, project: "", estimatedSessions: 1, focusMinutes: Math.max(1, Math.min(240, defaultMinutes)), kind: "pomodoro" });
  return <form className="queue-editor" onSubmit={(event) => { event.preventDefault(); if (draft.title.trim()) onSave({ ...draft, title: draft.title.trim(), project: draft.project.trim() }); }}>
    <h2>{item ? "Edit task" : "Add a task"}</h2>
    <fieldset disabled={busy}>
      <label>Task<input autoFocus required maxLength={500} value={draft.title} placeholder="What will you work on?" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Project <small>(optional)</small><input maxLength={200} list="queue-projects" value={draft.project} placeholder="e.g. DeepHUD" onChange={(event) => setDraft({ ...draft, project: event.target.value })} /><datalist id="queue-projects">{projects.map((project) => <option key={project.id} value={project.name} />)}</datalist></label>
      <div className="queue-editor__numbers"><label>Estimated sessions<input type="number" required min={1} max={100} step={1} value={draft.estimatedSessions || ""} onChange={(event) => setDraft({ ...draft, estimatedSessions: Number(event.target.value) })} /></label><label>Minutes per session<input type="number" required min={1} max={240} step={1} value={draft.focusMinutes || ""} onChange={(event) => setDraft({ ...draft, focusMinutes: Number(event.target.value) })} /></label></div>
      <label>Session mode<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as QueueDraft["kind"] })}><option value="pomodoro">Focus intervals · with breaks</option><option value="deep-work">Deep Work · one focus block</option></select></label>
      <p className="queue-hint">{item?.scheduledDate ?? today} · {draft.estimatedSessions * draft.focusMinutes || 0} estimated focus minutes</p>
      <div className="edit-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-action" disabled={!draft.title.trim()}>{busy ? "Saving…" : item ? "Save changes" : "Add task"}</button></div>
    </fieldset>
  </form>;
}
