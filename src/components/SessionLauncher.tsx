import { useState } from "react";
import { ProjectRecord } from "../services/database";
import { Settings } from "../services/settings";
import { SessionPlan } from "../services/session";
import { validateLauncherDuration } from "../services/launcherDuration";

interface Props {
  settings: Settings;
  projects: ProjectRecord[];
  initialTask: string;
  onStart: (plan: SessionPlan) => void;
  onToday: () => void;
  onClose: () => void;
  onDragStart: () => void;
}

const intervalPresets = [
  { name: "Classic", work: 25, rest: 5 },
  { name: "Deep Work", work: 50, rest: 10 },
  { name: "Long Focus", work: 90, rest: 20 },
];

export default function SessionLauncher({ settings, projects, initialTask, onStart, onToday, onClose, onDragStart }: Props) {
  const [kind, setKind] = useState<"deep-work" | "pomodoro">("deep-work");
  const [workMinutes, setWorkMinutes] = useState("90");
  const [breakMinutes, setBreakMinutes] = useState(String(settings.pomodoroBreakMinutes));
  const [project, setProject] = useState("");
  const [task, setTask] = useState(initialTask);
  const taskSuggestions = projects.find((item) => item.name.toLocaleLowerCase() === project.trim().toLocaleLowerCase())?.tasks ?? [];
  const duration = validateLauncherDuration(kind, workMinutes, breakMinutes);
  const workError = duration.valid ? undefined : duration.workError;
  const breakError = duration.valid ? undefined : duration.breakError;

  const start = () => {
    if (!duration.valid) return;
    onStart({
      kind,
      workMinutes: duration.workMinutes,
      breakMinutes: duration.breakMinutes ?? settings.pomodoroBreakMinutes,
      phase: "work",
      project: project.trim(),
      task: task.trim(),
      startedAt: new Date().toISOString(),
      cycle: 1,
    });
  };

  return <section className="workspace launcher">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">START FOCUSING</span><h1>New session</h1></div>
      <button type="button" className="workspace-nav-button" onClick={onToday}>Today’s queue</button>
      <button className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <form className="workspace__content" noValidate onSubmit={(event) => { event.preventDefault(); start(); }}>
      <div className="mode-cards">
        <button type="button" className={kind === "deep-work" ? "is-active" : ""} onClick={() => setKind("deep-work")}><b>Deep Work</b><span>One intentional focus block</span></button>
        <button type="button" className={kind === "pomodoro" ? "is-active" : ""} onClick={() => { setKind("pomodoro"); setWorkMinutes(String(settings.pomodoroWorkMinutes)); setBreakMinutes(String(settings.pomodoroBreakMinutes)); }}><b>Focus intervals</b><span>Alternating work and breaks</span></button>
      </div>

      <div className="launcher-section">
        <h2>{kind === "deep-work" ? "Session duration" : "Interval rhythm"}</h2>
        {kind === "deep-work" ? <div className="duration-grid">
          {[25, 50, 90, 120].map((minutes) => <button type="button" key={minutes} className={Number(workMinutes) === minutes ? "is-active" : ""} onClick={() => setWorkMinutes(String(minutes))}><b>{minutes}</b><span>minutes</span>{minutes === 90 && <em>Recommended</em>}</button>)}
          <label><span>Custom</span><input type="number" min="1" max="1440" step="1" required aria-invalid={Boolean(workError)} aria-describedby={workError ? "launcher-work-error" : undefined} value={workMinutes} onChange={(event) => setWorkMinutes(event.target.value)} /><small>min</small></label>
        </div> : <>
          <div className="interval-list">
            {intervalPresets.map((preset) => <button type="button" key={preset.name} className={Number(workMinutes) === preset.work && Number(breakMinutes) === preset.rest ? "is-active" : ""} onClick={() => { setWorkMinutes(String(preset.work)); setBreakMinutes(String(preset.rest)); }}><span><b>{preset.name}</b><small>{preset.work} min work · {preset.rest} min break</small></span><i>{preset.work} / {preset.rest}</i></button>)}
          </div>
          <div className="custom-interval"><label>Work<input type="number" min="1" max="240" step="1" required aria-invalid={Boolean(workError)} aria-describedby={workError ? "launcher-work-error" : undefined} value={workMinutes} onChange={(event) => setWorkMinutes(event.target.value)} /></label><span>/</span><label>Break<input type="number" min="1" max="120" step="1" required aria-invalid={Boolean(breakError)} aria-describedby={breakError ? "launcher-break-error" : undefined} value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label><small>minutes</small></div>
        </>}
        {workError && <p id="launcher-work-error" className="inline-error" role="alert">{kind === "deep-work" ? "Session duration" : "Work duration"}: {workError}</p>}
        {breakError && <p id="launcher-break-error" className="inline-error" role="alert">Break duration: {breakError}</p>}
      </div>

      <div className="launcher-section intent-fields">
        <h2>What are you working on?</h2>
        <label><span>Project</span><input list="project-options" value={project} onChange={(event) => setProject(event.target.value)} placeholder="e.g. MyDrive" /><datalist id="project-options">{projects.map((item) => <option key={item.id} value={item.name} />)}</datalist></label>
        <label><span>Task</span><input list="task-options" value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. Implement audit events" autoFocus /><datalist id="task-options">{taskSuggestions.map((item) => <option key={item.id} value={item.name} />)}</datalist></label>
      </div>

      {kind === "pomodoro" && duration.valid && <p className="long-break-hint">{Math.max(duration.breakMinutes! + 1, settings.longBreakMinutes)}-minute long break after every {settings.cyclesBeforeLongBreak} completed cycles.</p>}
      <button type="submit" className="start-session" disabled={!duration.valid}><span>Start {kind === "deep-work" ? "Deep Work" : "Focus Interval"}</span><small>{duration.valid ? `${duration.workMinutes} min${kind === "pomodoro" ? ` · then ${duration.breakMinutes} min break` : ""}` : "Enter valid durations to start"}</small></button>
    </form>
  </section>;
}
