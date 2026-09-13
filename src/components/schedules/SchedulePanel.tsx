import DeletionConfirmation from "../DeletionConfirmation";
import { useRef, useState } from "react";
import { ProjectRecord } from "../../services/database";
import { FocusSchedule, validateSchedule } from "../../services/schedules";
import { Settings } from "../../services/settings";
const days = [{ id: 1, name: "Mon" }, { id: 2, name: "Tue" }, { id: 3, name: "Wed" }, { id: 4, name: "Thu" }, { id: 5, name: "Fri" }, { id: 6, name: "Sat" }, { id: 0, name: "Sun" }];
export default function SchedulePanel({ schedules, settings, projects, ready, onSave, onDelete }: {
  schedules: FocusSchedule[]; settings: Settings; projects: ProjectRecord[]; ready: boolean;
  onSave: (s: FocusSchedule) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<FocusSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<FocusSchedule | null>(null);
  const run = async (action: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(""); try { await action(); } catch (e) { setError(String(e)); } finally { busyRef.current = false; setBusy(false); } };
  const add = () => setEditing({ id: crypto.randomUUID(), title: "", project: "", weekdays: [1,2,3,4,5], time: "09:00", kind: "deep-work", workMinutes: 50, breakMinutes: settings.pomodoroBreakMinutes, longBreakMinutes: Math.max(settings.pomodoroBreakMinutes + 1, settings.longBreakMinutes), cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak, enabled: true, updatedAt: new Date().toISOString() });
  return <section className="dashboard-section schedule-panel">
    <div className="section-title"><h2>Focus schedule</h2><button type="button" className="workspace-nav-button" disabled={!ready || busy || !!editing || schedules.length >= 50} onClick={add}>Add schedule</button></div>
    <p className="insight-note">Local time · DeepHUD must be running, including in the tray. Reminders never start a session automatically.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {editing && <form className="queue-editor" onSubmit={e => { e.preventDefault(); void run(async () => { await onSave(validateSchedule(editing)); setEditing(null); }); }}>
      <h2>{schedules.some(s => s.id === editing.id) ? "Edit schedule" : "New schedule"}</h2>
      <fieldset disabled={busy}>
        <label>Activity<input required maxLength={500} autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Writing" /></label>
        <label>Project (optional)<input maxLength={200} list="schedule-projects" value={editing.project} onChange={e => setEditing({ ...editing, project: e.target.value })} /><datalist id="schedule-projects">{projects.map(p => <option key={p.id} value={p.name} />)}</datalist></label>
        <div className="schedule-days" role="group" aria-label="Repeat on weekdays">{days.map(d => <button type="button" key={d.id} aria-pressed={editing.weekdays.includes(d.id)} onClick={() => setEditing({ ...editing, weekdays: editing.weekdays.includes(d.id) ? editing.weekdays.filter(x => x !== d.id) : [...editing.weekdays, d.id] })}>{d.name}</button>)}</div>
        <label>Reminder time<input type="time" required value={editing.time} onChange={e => setEditing({ ...editing, time: e.target.value })} /></label>
        <div className="mode-cards"><button type="button" className={editing.kind === "deep-work" ? "is-active" : ""} onClick={() => setEditing({ ...editing, kind: "deep-work" })}><b>Deep Work</b><span>One focus block</span></button><button type="button" className={editing.kind === "pomodoro" ? "is-active" : ""} onClick={() => setEditing({ ...editing, kind: "pomodoro" })}><b>Focus intervals</b><span>Work and breaks</span></button></div>
        <div className="queue-editor__numbers"><label>Focus minutes<input type="number" required min={1} max={1440} value={editing.workMinutes} onChange={e => setEditing({ ...editing, workMinutes: Number(e.target.value) })} /></label>
          {editing.kind === "pomodoro" && <><label>Short break minutes<input type="number" required min={1} max={120} value={editing.breakMinutes} onChange={e => setEditing({ ...editing, breakMinutes: Number(e.target.value) })} /></label><label>Long break minutes<input type="number" required min={editing.breakMinutes + 1} max={240} value={editing.longBreakMinutes} onChange={e => setEditing({ ...editing, longBreakMinutes: Number(e.target.value) })} /></label><label>Cycles before long break<input type="number" required min={1} max={12} value={editing.cyclesBeforeLongBreak} onChange={e => setEditing({ ...editing, cyclesBeforeLongBreak: Number(e.target.value) })} /></label></>}
        </div>
        <div className="schedule-actions"><button type="button" onClick={() => { setEditing(null); setError(""); }}>Cancel</button><button type="submit">{busy ? "Saving…" : "Save schedule"}</button></div>
      </fieldset>
    </form>}
    {!ready && <p className="empty-state">Loading schedules…</p>}
    {ready && !schedules.length && !editing && <p className="empty-state">Plan a regular time for focused work.</p>}
    {[...schedules].sort((a,b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title)).map(s => <article className="insight-card schedule-card" key={s.id}>
      <div className="section-title"><h3>{s.title}</h3><button type="button" role="switch" aria-checked={s.enabled} aria-label={`Enable ${s.title}`} disabled={busy} className="workspace-nav-button" onClick={() => void run(() => onSave({ ...s, enabled: !s.enabled }))}>{s.enabled ? "On" : "Off"}</button></div>
      <p>{days.filter(d => s.weekdays.includes(d.id)).map(d => d.name).join(" · ")} · <b>{s.time}</b></p>
      <p>{s.kind === "pomodoro" ? "Focus intervals" : "Deep Work"} · {s.workMinutes} min{s.project ? ` · ${s.project}` : ""}</p>
      {s.kind === "pomodoro" && <p>{s.breakMinutes} min break · {s.longBreakMinutes} min long break every {s.cyclesBeforeLongBreak} cycles</p>}
      <div className="schedule-actions"><button type="button" disabled={busy || !!editing} onClick={() => { setEditing({ ...s, weekdays: [...s.weekdays] }); setError(""); }}>Edit</button><button type="button" className="danger-action" disabled={busy} onClick={() => setDeleting(s)}>Delete schedule</button></div>
    </article>)}
    {deleting && <DeletionConfirmation title="Delete this schedule and cancel its reminders?" confirmLabel="Delete schedule" errorMessage="Could not delete this schedule."
      description={<><p className="deletion-target">{deleting.title}</p><p>This permanently deletes this recurring schedule and cancels its pending and deferred reminders. Existing focus sessions and reminder history are kept. This cannot be undone.</p></>}
      onCancel={() => setDeleting(null)} onConfirm={async () => { await onDelete(deleting.id); if (editing?.id === deleting.id) setEditing(null); }} />}
  </section>;
}
