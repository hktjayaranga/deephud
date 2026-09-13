import { useEffect, useMemo, useState } from "react";
import { SessionRecord } from "../services/database";
import { groupSessions, WorkSession } from "../services/sessionHistory";
import { calculateMonthlyInsights, monthKey, shiftMonth } from "../services/insights";
import MonthlySummary from "./insights/MonthlySummary";
import FocusCalendar from "./insights/FocusCalendar";
import ProjectComparison from "./insights/ProjectComparison";
import HourlyFocusChart from "./insights/HourlyFocusChart";
import HistoryConfirmation from "./HistoryConfirmation";

interface Props {
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  sessions: SessionRecord[];
  goalMinutes: number;
  onDelete: (id: number) => Promise<void>;
  onUpdate: (session: SessionRecord) => Promise<void>;
  onExport: (format: "csv" | "json") => Promise<void>;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
  onResetDatabase: () => Promise<void>;
  onToday: () => void;
  onClose: () => void;
  onDragStart: () => void;
  notices?: React.ReactNode;
}

export type DashboardTab = "overview" | "history" | "projects";

export default function Dashboard({ tab, onTabChange, sessions, goalMinutes, onDelete, onUpdate, onExport, onBackup, onRestore, onResetDatabase, onToday, onClose, onDragStart, notices }: Props) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const month = selectedMonth ?? monthKey(now);
  const insights = useMemo(() => calculateMonthlyInsights(sessions, month), [sessions, month, now]);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  const [actionError, setActionError] = useState("");
  const [deletion, setDeletion] = useState<{ id: number } | "all" | null>(null);
  const requestDelete = (id: number) => setDeletion({ id });
  const hasFilters = Boolean(search.trim() || projectFilter || dateFilter);
  const clearFilters = () => { setSearch(""); setProjectFilter(""); setDateFilter(""); };
  const stats = useMemo(() => calculateStats(sessions, goalMinutes, now), [sessions, goalMinutes, now]);
  const projectNames = useMemo(() => [...new Set(sessions.map((session) => session.project).filter(Boolean))].sort(), [sessions]);
  const workSessions = useMemo(() => groupSessions(sessions), [sessions]);
  const filteredSessions = useMemo(() => groupSessions(filterHistoryRecords(sessions, search, projectFilter, dateFilter)), [dateFilter, projectFilter, search, sessions]);
  const openDay = (date: string) => { setSearch(""); setProjectFilter(""); setDateFilter(date); onTabChange("history"); };
  const run = async (action: () => Promise<void>) => { try { setActionError(""); await action(); } catch (error) { setActionError(String(error)); } };

  return <section className="workspace dashboard">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">YOUR FOCUS</span><h1>Productivity</h1></div>
      <button type="button" className="workspace-nav-button" onClick={onToday}>Today</button>
      <div className="streak">🔥 {stats.streak} day streak</div>
      <button className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <nav className="dashboard-tabs" aria-label="Dashboard sections">{(["overview", "history", "projects"] as DashboardTab[]).map((item) => <button type="button" key={item} className={tab === item ? "is-active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => onTabChange(item)}>{item}</button>)}</nav>
    <div className="workspace__content dashboard__content">
      {notices}
      {tab === "overview" && <>
        <section className="goal-card">
          <div><span>Today's goal</span><b>{formatDuration(stats.todaySeconds)} <small>/ {formatDuration(goalMinutes * 60)}</small></b></div>
          <strong>{Math.min(100, Math.round(stats.todaySeconds / (goalMinutes * 60) * 100))}%</strong>
          <div className="goal-progress"><span style={{ width: `${Math.min(100, stats.todaySeconds / (goalMinutes * 60) * 100)}%` }} /></div>
          {stats.todaySeconds >= goalMinutes * 60 && <p>🎯 Daily goal reached!</p>}
        </section>
        <section className="stat-grid">
          <Stat label="Focused today" value={formatDuration(stats.todaySeconds)} />
          <Stat label="Sessions" value={String(stats.todaySessionCount)} />
          <Stat label="Longest" value={formatDuration(stats.longest)} />
          <Stat label="Average" value={formatDuration(stats.average)} />
        </section>
        <div className="insights-period" role="group" aria-label="Statistics period">
          <button type="button" aria-pressed={period === "week"} className={period === "week" ? "is-active" : ""} onClick={() => setPeriod("week")}>Week</button>
          <button type="button" aria-pressed={period === "month"} className={period === "month" ? "is-active" : ""} onClick={() => setPeriod("month")}>Month</button>
        </div>
        {period === "week" ? <>
        <section className="dashboard-section"><div className="section-title"><h2>This week</h2><span>{formatDuration(stats.weekTotal)}</span></div><div className="week-chart">{stats.week.map((day) => <div className="week-row" key={day.label}><span>{day.label}</span><div><i style={{ width: `${day.percent}%` }} /></div><b>{formatDuration(day.seconds)}</b></div>)}</div></section>
        </> : <>
          <div className="insights-month-nav">
            <button type="button" className="icon-button" aria-label="Previous month" title="Previous month" disabled={month <= "2000-01"} onClick={() => setSelectedMonth(shiftMonth(month, -1))}>←</button>
            <strong aria-live="polite">{insights.label}</strong>
            <button type="button" className="icon-button" aria-label="Next month" title="Next month" disabled={month >= monthKey(now)} onClick={() => setSelectedMonth(shiftMonth(month, 1))}>→</button>
            <button type="button" className="workspace-nav-button" onClick={() => { setNow(new Date()); setSelectedMonth(null); }}>This month</button>
          </div>
          <MonthlySummary insights={insights} />
          <FocusCalendar insights={insights} onSelectDay={openDay} />
          <ProjectComparison insights={insights} />
          <HourlyFocusChart insights={insights} />
        </>}

        <section className="dashboard-section"><div className="section-title"><h2>Recent sessions</h2></div><HistoryList sessions={workSessions.slice(0, 4)} onDelete={requestDelete} /></section>
      </>}
      {tab === "history" && <section className="dashboard-section dashboard-section--flush">
        <div className="section-title"><h2>Session history</h2><span>{filteredSessions.length} shown</span></div>
        <div className="history-filters"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task or project" /><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>{projectNames.map((project) => <option key={project}>{project}</option>)}</select><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></div>
        {dateFilter && <p className="insight-note">Showing intervals started on {dateFilter} (local time). <button type="button" className="workspace-nav-button" onClick={clearFilters}>Clear filters</button></p>}
        <div className="data-actions"><button onClick={() => run(() => onExport("csv"))}>Export CSV</button><button onClick={() => run(() => onExport("json"))}>Export JSON</button><button onClick={() => run(onBackup)}>Backup</button><button onClick={() => run(onRestore)}>Restore</button><button className="danger-action" onClick={() => setDeletion("all")}>Reset database</button></div>
        {actionError && <p className="inline-error">{actionError}</p>}
        <HistoryList sessions={filteredSessions} onDelete={requestDelete} onEdit={setEditing} onClearFilters={hasFilters ? clearFilters : undefined} />
      </section>}
      {tab === "projects" && <section className="dashboard-section dashboard-section--flush"><div className="section-title"><h2>Projects</h2><span>All time</span></div><div className="project-list">{stats.projects.length ? stats.projects.map((project) => <div key={project.name} className="project-row"><div><b>{project.name}</b><span>{project.tasks.map((task) => `${task.name} · ${formatDuration(task.seconds)}`).join("  ·  ")}</span></div><strong>{formatDuration(project.seconds)}</strong></div>) : <EmptyState />}</div></section>}
    </div>
    {editing && <EditSession session={editing} onCancel={() => setEditing(null)} onSave={(session) => run(async () => { await onUpdate(session); setEditing(null); })} />}
    {deletion !== null && <HistoryConfirmation reset={deletion === "all"} onCancel={() => setDeletion(null)} onConfirm={() => deletion === "all" ? onResetDatabase() : onDelete(deletion.id)} />}
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><b>{value}</b></div>; }

export function HistoryList({ sessions, onDelete, onEdit, onClearFilters }: { sessions: WorkSession[]; onDelete: (id: number) => void; onEdit?: (session: SessionRecord) => void; onClearFilters?: () => void }) {
  if (!sessions.length) return onClearFilters
    ? <div className="empty-state"><b role="status">No matching sessions</b><span>Try another search, project, or date.</span><button type="button" onClick={onClearFilters}>Clear filters</button></div>
    : <EmptyState />;
  return <div className="history-list">{sessions.map((group) => {
    const hasIntervals = group.cycles.some((cycle) => cycle.sessionKind === "pomodoro");
    const title = group.tasks.length === 1 ? group.tasks[0].task || group.tasks[0].project || "Focus session" : "Focus session · Multiple tasks";
    return <section className="history-session" key={group.key}>
      <article className="history-summary"><SessionTime startedAt={group.startedAt} endedAt={group.endedAt} /><div>
        <b title={title}>{title}</b>
        <strong className="history-focus">{formatDuration(group.focusSeconds)} focused{hasIntervals && ` · ${group.completedCycles} ${group.completedCycles === 1 ? "cycle" : "cycles"} completed`}</strong>
        <span>{group.tasks.length === 1 && `${group.tasks[0].project || "Unassigned"} · `}Total elapsed: {formatDuration(group.elapsedSeconds)} (including breaks and pauses)</span>
      </div></article>
      <details className="history-cycles"><summary>View {hasIntervals ? "cycles" : "details"} ({group.cycles.length})</summary>
        {group.tasks.map((task, taskIndex) => <section key={taskIndex}>
          {group.tasks.length > 1 && <h3>{task.task || "General focus"}<small>{task.project || "Unassigned"}</small></h3>}
          {task.cycles.map((cycle, index) => <article key={cycle.id ?? index}>
            <SessionTime startedAt={cycle.startedAt} endedAt={cycle.endedAt} />
            <div><b>{cycle.sessionKind === "pomodoro" ? "Focus cycle" : cycle.sessionKind === "stopwatch" ? "Stopwatch" : "Deep work"}</b><span>{formatDuration(cycle.focusSeconds)} focused{cycle.cycleCompleted === false ? " · Ended early" : ""}</span></div>
            <div className="history-actions">{onEdit && <button onClick={() => onEdit(cycle)} aria-label="Edit interval">Edit</button>}{cycle.id != null && <button onClick={() => onDelete(cycle.id!)} aria-label="Delete interval">×</button>}</div>
          </article>)}
        </section>)}
      </details>
    </section>;
  })}</div>;
}

function SessionTime({ startedAt, endedAt }: { startedAt: string; endedAt: string }) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const date = (value: Date) => value.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = (value: Date) => value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <time dateTime={startedAt}>{date(start)}<small>{time(start)} – {localDateKey(start) !== localDateKey(end) && `${date(end)} `}{time(end)}</small></time>;
}

function EditSession({ session, onCancel, onSave }: { session: SessionRecord; onCancel: () => void; onSave: (session: SessionRecord) => void }) {
  const [draft, setDraft] = useState(session);
  return <div className="completion-backdrop"><form className="edit-session" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}><h2>Edit session</h2><div className="edit-grid"><label>Project<input value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} /></label><label>Task<input value={draft.task} onChange={(event) => setDraft({ ...draft, task: event.target.value })} /></label><label>Started<input type="datetime-local" value={toDateTimeInput(draft.startedAt)} onChange={(event) => setDraft({ ...draft, startedAt: new Date(event.target.value).toISOString() })} /></label><label>Ended<input type="datetime-local" value={toDateTimeInput(draft.endedAt)} onChange={(event) => setDraft({ ...draft, endedAt: new Date(event.target.value).toISOString() })} /></label><label>Focused minutes<input type="number" min="1" value={Math.round(draft.focusSeconds / 60)} onChange={(event) => setDraft({ ...draft, focusSeconds: Math.max(60, Number(event.target.value) * 60) })} /></label><label>Type<select value={draft.sessionKind} onChange={(event) => setDraft({ ...draft, sessionKind: event.target.value as SessionRecord["sessionKind"] })}><option value="deep-work">Deep Work</option><option value="pomodoro">Pomodoro</option><option value="stopwatch">Stopwatch</option></select></label></div><div className="edit-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary-action" type="submit">Save changes</button></div></form></div>;
}

function EmptyState() { return <div className="empty-state"><b>No focus sessions yet</b><span>Complete a session and it will appear here.</span></div>; }

export function calculateStats(sessions: SessionRecord[], goalMinutes: number, now = new Date()) {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  const weekday = (startToday.getDay() + 6) % 7;
  startWeek.setDate(startWeek.getDate() - weekday);
  const today = sessions.filter((session) => new Date(session.startedAt) >= startToday);
  const todaySeconds = today.reduce((sum, session) => sum + session.focusSeconds, 0);
  const todayGroups = groupSessions(today);
  const longest = todayGroups.reduce((max, session) => Math.max(max, session.focusSeconds), 0);
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
  return { today, todaySessionCount: todayGroups.length, todaySeconds, longest, average: todayGroups.length ? Math.round(todaySeconds / todayGroups.length) : 0, week, weekTotal: week.reduce((sum, day) => sum + day.seconds, 0), projects, streak };
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


/** Filter intervals before grouping, so a day selection cannot include other days' cycles. */
export function filterHistoryRecords(sessions: SessionRecord[], search = "", project = "", date = "") {
  const query = search.trim().toLocaleLowerCase();
  return sessions.filter((session) => (!query || `${session.task} ${session.project} ${session.sessionKind}`.toLocaleLowerCase().includes(query))
    && (!project || session.project === project) && (!date || localDateKey(new Date(session.startedAt)) === date));
}
