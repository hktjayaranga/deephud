import { useMemo, useState } from "react";
import { SessionRecord } from "../services/database";

interface Props {
  sessions: SessionRecord[];
  goalMinutes: number;
  onDelete: (id: number) => void;
  onUpdate: (session: SessionRecord) => Promise<void>;
  onExport: (format: "csv" | "json") => Promise<void>;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
  onResetDatabase: () => Promise<void>;
  onClose: () => void;
  onDragStart: () => void;
}

type Tab = "overview" | "history" | "projects";

export default function Dashboard({ sessions, goalMinutes, onDelete, onUpdate, onExport, onBackup, onRestore, onResetDatabase, onClose, onDragStart }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  const [actionError, setActionError] = useState("");
  const stats = useMemo(() => calculateStats(sessions, goalMinutes), [sessions, goalMinutes]);
  const projectNames = useMemo(() => [...new Set(sessions.map((session) => session.project).filter(Boolean))].sort(), [sessions]);
  const filteredSessions = useMemo(() => sessions.filter((session) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${session.task} ${session.project} ${session.sessionKind}`.toLocaleLowerCase().includes(query);
    return matchesSearch && (!projectFilter || session.project === projectFilter) && (!dateFilter || localDateKey(new Date(session.startedAt)) === dateFilter);
  }), [dateFilter, projectFilter, search, sessions]);
  const run = async (action: () => Promise<void>) => { try { setActionError(""); await action(); } catch (error) { setActionError(String(error)); } };

  return <section className="workspace dashboard">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">YOUR FOCUS</span><h1>Productivity</h1></div>
      <div className="streak">🔥 {stats.streak} day streak</div>
      <button className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <nav className="dashboard-tabs">{(["overview", "history", "projects"] as Tab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
    <div className="workspace__content dashboard__content">
      {tab === "overview" && <>
        <section className="goal-card">
          <div><span>Today's goal</span><b>{formatDuration(stats.todaySeconds)} <small>/ {formatDuration(goalMinutes * 60)}</small></b></div>
          <strong>{Math.min(100, Math.round(stats.todaySeconds / (goalMinutes * 60) * 100))}%</strong>
          <div className="goal-progress"><span style={{ width: `${Math.min(100, stats.todaySeconds / (goalMinutes * 60) * 100)}%` }} /></div>
          {stats.todaySeconds >= goalMinutes * 60 && <p>🎯 Daily goal reached!</p>}
        </section>
        <section className="stat-grid">
          <Stat label="Focused today" value={formatDuration(stats.todaySeconds)} />
          <Stat label="Sessions" value={String(stats.today.length)} />
          <Stat label="Longest" value={formatDuration(stats.longest)} />
          <Stat label="Average" value={formatDuration(stats.average)} />
        </section>
        <section className="dashboard-section"><div className="section-title"><h2>This week</h2><span>{formatDuration(stats.weekTotal)}</span></div><div className="week-chart">{stats.week.map((day) => <div className="week-row" key={day.label}><span>{day.label}</span><div><i style={{ width: `${day.percent}%` }} /></div><b>{formatDuration(day.seconds)}</b></div>)}</div></section>
        <section className="dashboard-section"><div className="section-title"><h2>Recent sessions</h2></div><HistoryList sessions={sessions.slice(0, 4)} onDelete={onDelete} /></section>
      </>}
      {tab === "history" && <section className="dashboard-section dashboard-section--flush">
        <div className="section-title"><h2>Session history</h2><span>{filteredSessions.length} shown</span></div>
        <div className="history-filters"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task or project" /><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>{projectNames.map((project) => <option key={project}>{project}</option>)}</select><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></div>
        <div className="data-actions"><button onClick={() => run(() => onExport("csv"))}>Export CSV</button><button onClick={() => run(() => onExport("json"))}>Export JSON</button><button onClick={() => run(onBackup)}>Backup</button><button onClick={() => run(onRestore)}>Restore</button><button className="danger-action" onClick={() => run(onResetDatabase)}>Reset database</button></div>
        {actionError && <p className="inline-error">{actionError}</p>}
        <HistoryList sessions={filteredSessions} onDelete={onDelete} onEdit={setEditing} />
      </section>}
      {tab === "projects" && <section className="dashboard-section dashboard-section--flush"><div className="section-title"><h2>Projects</h2><span>All time</span></div><div className="project-list">{stats.projects.length ? stats.projects.map((project) => <div key={project.name} className="project-row"><div><b>{project.name}</b><span>{project.tasks.map((task) => `${task.name} · ${formatDuration(task.seconds)}`).join("  ·  ")}</span></div><strong>{formatDuration(project.seconds)}</strong></div>) : <EmptyState />}</div></section>}
    </div>
    {editing && <EditSession session={editing} onCancel={() => setEditing(null)} onSave={(session) => run(async () => { await onUpdate(session); setEditing(null); })} />}
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><b>{value}</b></div>; }

function HistoryList({ sessions, onDelete, onEdit }: { sessions: SessionRecord[]; onDelete: (id: number) => void; onEdit?: (session: SessionRecord) => void }) {
  if (!sessions.length) return <EmptyState />;
  return <div className="history-list">{sessions.map((session) => {
    const start = new Date(session.startedAt);
    const end = new Date(session.endedAt);
    const elapsedSeconds = Math.max(session.focusSeconds, Math.round((end.getTime() - start.getTime()) / 1000));
    return <article key={session.id}><time>{start.toLocaleDateString([], { month: "short", day: "numeric" })}<small>{start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></time><div><b>{session.task || (session.sessionKind === "pomodoro" ? "Focus interval" : "Deep Work")}</b><span>{session.project || "Unassigned"} · {formatDuration(session.focusSeconds)} focused{elapsedSeconds > session.focusSeconds + 30 ? ` · ${formatDuration(elapsedSeconds)} elapsed` : ""}</span></div><div className="history-actions">{onEdit && <button onClick={() => onEdit(session)} aria-label="Edit session">Edit</button>}{session.id && <button onClick={() => onDelete(session.id!)} aria-label="Delete session">×</button>}</div></article>;
  })}</div>;
}

function EditSession({ session, onCancel, onSave }: { session: SessionRecord; onCancel: () => void; onSave: (session: SessionRecord) => void }) {
  const [draft, setDraft] = useState(session);
  return <div className="completion-backdrop"><form className="edit-session" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}><h2>Edit session</h2><div className="edit-grid"><label>Project<input value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} /></label><label>Task<input value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></label><label>Started<input type="datetime-local" value={toDateTimeInput(draft.startedAt)} onChange={(event) => setDraft({ ...draft, startedAt: new Date(event.target.value).toISOString() })} /></label><label>Ended<input type="datetime-local" value={toDateTimeInput(draft.endedAt)} onChange={(event) => setDraft({ ...draft, endedAt: new Date(event.target.value).toISOString() })} /></label><label>Focused minutes<input type="number" min="1" value={Math.round(draft.focusSeconds / 60)} onChange={(event) => setDraft({ ...draft, focusSeconds: Math.max(60, Number(event.target.value) * 60) })} /></label><label>Type<select value={draft.sessionKind} onChange={(event) => setDraft({ ...draft, sessionKind: event.target.value as SessionRecord["sessionKind"] })}><option value="deep-work">Deep Work</option><option value="pomodoro">Pomodoro</option><option value="stopwatch">Stopwatch</option></select></label></div><div className="edit-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit">Save changes</button></div></form></div>;
}

function EmptyState() { return <div className="empty-state"><b>No focus sessions yet</b><span>Complete a session and it will appear here.</span></div>; }

export function calculateStats(sessions: SessionRecord[], goalMinutes: number) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  const weekday = (startToday.getDay() + 6) % 7;
  startWeek.setDate(startWeek.getDate() - weekday);
  const today = sessions.filter((session) => new Date(session.startedAt) >= startToday);
  const todaySeconds = today.reduce((sum, session) => sum + session.focusSeconds, 0);
  const longest = today.reduce((max, session) => Math.max(max, session.focusSeconds), 0);
  const week = Array.from({ length: 7 }, (_, index) => {
    const dayStart = new Date(startWeek); dayStart.setDate(dayStart.getDate() + index);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const seconds = sessions.filter((session) => { const date = new Date(session.startedAt); return date >= dayStart && date < dayEnd; }).reduce((sum, session) => sum + session.focusSeconds, 0);
    return { label: dayStart.toLocaleDateString([], { weekday: "short" }), seconds, percent: 0 };
  });
  const maxDay = Math.max(...week.map((day) => day.seconds), goalMinutes * 60, 1);
  week.forEach((day) => { day.percent = day.seconds / maxDay * 100; });
  const projectMap = new Map<string, { seconds: number; tasks: Map<string, number> }>();
  sessions.forEach((session) => {
    const name = session.project || "Unassigned";
    const item = projectMap.get(name) ?? { seconds: 0, tasks: new Map() };
    item.seconds += session.focusSeconds;
    const task = session.task || "General focus";
    item.tasks.set(task, (item.tasks.get(task) ?? 0) + session.focusSeconds);
    projectMap.set(name, item);
  });
  const projects = [...projectMap].map(([name, item]) => ({ name, seconds: item.seconds, tasks: [...item.tasks].map(([taskName, seconds]) => ({ name: taskName, seconds })).sort((a, b) => b.seconds - a.seconds) })).sort((a, b) => b.seconds - a.seconds);
  const focusDays = new Set(sessions.map((session) => new Date(session.startedAt).toLocaleDateString("en-CA")));
  let streak = 0; const cursor = new Date(startToday);
  if (!focusDays.has(cursor.toLocaleDateString("en-CA"))) cursor.setDate(cursor.getDate() - 1);
  while (focusDays.has(cursor.toLocaleDateString("en-CA"))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return { today, todaySeconds, longest, average: today.length ? Math.round(todaySeconds / today.length) : 0, week, weekTotal: week.reduce((sum, day) => sum + day.seconds, 0), projects, streak };
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateTimeInput(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${minutes}m`;
}
