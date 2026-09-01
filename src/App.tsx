import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { confirm } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import Timer from "./components/Timer";
import Controls from "./components/Controls";
import Dashboard from "./components/Dashboard";
import SessionLauncher from "./components/SessionLauncher";
import SettingsPanel from "./components/SettingsPanel";
import { ProjectRecord, SessionRecord, deleteSession, ensureProjectTask, getProjects, getSessions, initializeDatabase, replaceSessions, saveSession, updateSession } from "./services/database";
import { createBackup, exportSessions, selectBackup } from "./services/dataTransfer";
import { playChime, notify } from "./services/notifications";
import { SessionPhase, SessionPlan } from "./services/session";
import { TimerState, initialTimerState } from "./services/timer";
import { adjustedTarget, advanceElapsed, hasFinished } from "./services/timerMath";
import { HudPosition, Settings, loadSettings, saveSettings } from "./services/settings";
import "./App.css";

type View = "hud" | "launcher" | "dashboard" | "settings";
type Completion = { phase: "deep" | SessionPhase; title: string; body: string };

const isTauri = () => "__TAURI_INTERNALS__" in window;
const appWindow = isTauri() ? getCurrentWindow() : null;
const hudDimensions = { small: [280, 86], medium: [340, 286], large: [420, 400] } as const;
const reliableNow = () => isTauri() ? invoke<number>("monotonic_millis") : Promise.resolve(performance.now());

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [state, setState] = useState<TimerState>(() => initialTimerState(settings.defaultMode, settings.defaultDuration));
  const [sessionName, setSessionName] = useState(() => localStorage.getItem("deepwork-hud:session") ?? "");
  const [activePlan, setActivePlan] = useState<SessionPlan | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [view, setView] = useState<View>("hud");
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [customPresetOpen, setCustomPresetOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(settings.defaultDuration);
  const [shortcutError, setShortcutError] = useState("");
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [clickThroughNotice, setClickThroughNotice] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const lastTickRef = useRef(0);
  const pauseStartedRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const completionKeyRef = useRef("");
  const warningKeyRef = useRef("");
  const idlePausedRef = useRef(false);
  const actionsRef = useRef({ startPause: () => {}, reset: () => {}, clickThrough: () => {}, startDeepWork: () => {}, dashboard: () => {} });

  const refreshSessions = useCallback(async () => {
    try {
      const [nextSessions, nextProjects] = await Promise.all([getSessions(), getProjects()]);
      setSessions(nextSessions);
      setProjects(nextProjects);
    }
    catch (error) { setDatabaseError(String(error)); }
  }, []);

  useEffect(() => {
    initializeDatabase().then(refreshSessions).catch((error) => setDatabaseError(String(error)));
  }, [refreshSessions]);

  useEffect(() => {
    if (state.status !== "running") return;
    let cancelled = false;
    let timeout: number | undefined;

    const tick = async () => {
      const now = await reliableNow();
      if (cancelled) return;
      const previousSample = lastTickRef.current;
      lastTickRef.current = now;
      if (previousSample > 0) {
        setState((previous) => {
          const elapsedMs = advanceElapsed(previous.elapsedMs, previousSample, now);
          const finished = previous.mode === "countdown" && hasFinished(elapsedMs, previous.targetMs);
          return { ...previous, elapsedMs: finished ? previous.targetMs : elapsedMs, status: finished ? "finished" : previous.status };
        });
      }
      timeout = window.setTimeout(tick, 200);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      lastTickRef.current = 0;
    };
  }, [state.status]);

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.style.setProperty("--custom-accent", settings.customAccent);
  }, [settings]);

  useEffect(() => { localStorage.setItem("deepwork-hud:session", sessionName); }, [sessionName]);

  const handleStartPause = useCallback(() => {
    setState((previous) => {
      const pausing = previous.status === "running";
      if (pausing) {
        pauseStartedRef.current = performance.now();
        notify("Timer paused", "Your focus session is waiting for you.", settings.notifications);
      } else {
        if (previous.status === "paused" && pauseStartedRef.current && settings.trackPausedTime) pausedMsRef.current += performance.now() - pauseStartedRef.current;
        pauseStartedRef.current = null;
        notify("Timer resumed", "Back to focused work.", settings.notifications);
      }
      return { ...previous, elapsedMs: previous.status === "finished" ? 0 : previous.elapsedMs, status: pausing ? "paused" : "running" };
    });
  }, [settings.notifications, settings.trackPausedTime]);

  const cancelOrReset = useCallback(() => {
    if (activePlan && state.elapsedMs > 0 && !window.confirm("End this session without adding it to history?")) return;
    setActivePlan(null);
    setCompletion(null);
    pausedMsRef.current = 0;
    pauseStartedRef.current = null;
    setState(initialTimerState(settings.defaultMode, settings.defaultDuration));
  }, [activePlan, state.elapsedMs, settings.defaultMode, settings.defaultDuration]);

  const toggleClickThrough = useCallback(() => setSettings((previous) => ({ ...previous, clickThrough: !previous.clickThrough })), []);

  const startPlan = useCallback((plan: SessionPlan) => {
    const startedPlan = { ...plan, phase: "work" as const, startedAt: new Date().toISOString() };
    setActivePlan(startedPlan);
    setSessionName(plan.task);
    setState({ mode: "countdown", status: "running", elapsedMs: 0, targetMs: plan.workMinutes * 60_000 });
    pausedMsRef.current = 0;
    pauseStartedRef.current = null;
    completionKeyRef.current = "";
    warningKeyRef.current = "";
    ensureProjectTask(plan.project, plan.task).then(refreshSessions).catch((error) => setDatabaseError(String(error)));
    setView("hud");
  }, [refreshSessions]);

  const startDefaultDeepWork = useCallback(() => startPlan({
    kind: "deep-work",
    workMinutes: settings.defaultDuration,
    breakMinutes: settings.pomodoroBreakMinutes,
    phase: "work",
    project: "",
    task: sessionName,
    startedAt: new Date().toISOString(),
    cycle: 1,
  }), [sessionName, settings.defaultDuration, settings.pomodoroBreakMinutes, startPlan]);

  actionsRef.current = {
    startPause: handleStartPause,
    reset: cancelOrReset,
    clickThrough: toggleClickThrough,
    startDeepWork: startDefaultDeepWork,
    dashboard: () => setView("dashboard"),
  };

  const startPhase = useCallback((phase: SessionPhase) => {
    if (!activePlan) return;
    const next = { ...activePlan, phase, startedAt: new Date().toISOString(), cycle: phase === "work" ? activePlan.cycle + 1 : activePlan.cycle };
    setActivePlan(next);
    setState({ mode: "countdown", status: "running", elapsedMs: 0, targetMs: (phase === "work" ? next.workMinutes : next.breakMinutes) * 60_000 });
    pausedMsRef.current = 0;
    completionKeyRef.current = "";
    warningKeyRef.current = "";
    setCompletion(null);
  }, [activePlan]);

  useEffect(() => {
    if (!activePlan || state.status !== "finished") return;
    const key = `${activePlan.startedAt}:${activePlan.phase}`;
    if (completionKeyRef.current === key) return;
    completionKeyRef.current = key;
    const complete = async () => {
      if (settings.sound) playChime(settings.volume, activePlan.phase === "work" ? "work" : "break");
      if (activePlan.phase === "work") {
        const record: SessionRecord = {
          startedAt: activePlan.startedAt,
          endedAt: new Date().toISOString(),
          plannedMinutes: activePlan.workMinutes,
          focusSeconds: Math.round(state.targetMs / 1000),
          pausedSeconds: Math.round(pausedMsRef.current / 1000),
          project: activePlan.project,
          task: activePlan.task,
          sessionKind: activePlan.kind,
        };
        try {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const previousToday = sessions.filter((item) => new Date(item.startedAt) >= todayStart).reduce((sum, item) => sum + item.focusSeconds, 0);
          await saveSession(record);
          await refreshSessions();
          if (previousToday < settings.dailyGoalMinutes * 60 && previousToday + record.focusSeconds >= settings.dailyGoalMinutes * 60) notify("🎯 Daily goal reached!", `${Math.round((previousToday + record.focusSeconds) / 60)} minutes focused today.`, settings.notifications);
        } catch (error) { setDatabaseError(String(error)); }
        const title = activePlan.kind === "pomodoro" ? "Focus session complete" : "Deep work session completed";
        await notify(`🎉 ${title}`, `You focused for ${activePlan.workMinutes} minutes.`, settings.notifications);
        if (activePlan.kind === "pomodoro") {
          if (settings.autoStartBreak) startPhase("break");
          else setCompletion({ phase: "work", title, body: `You focused for ${activePlan.workMinutes} minutes. Start a ${activePlan.breakMinutes}-minute break?` });
        } else setCompletion({ phase: "deep", title, body: `${activePlan.workMinutes} minutes of focused work recorded.` });
      } else {
        await notify("Break finished", "Ready for another focus session?", settings.notifications);
        if (settings.autoStartWork) startPhase("work");
        else setCompletion({ phase: "break", title: "Break finished", body: `Ready for focus cycle ${activePlan.cycle + 1}?` });
      }
    };
    complete();
  }, [activePlan, refreshSessions, sessions, settings, startPhase, state.status, state.targetMs]);

  useEffect(() => {
    if (!activePlan || activePlan.phase !== "work" || state.status !== "running" || !settings.fiveMinuteWarning) return;
    const remaining = state.targetMs - state.elapsedMs;
    const key = `${activePlan.startedAt}:warning`;
    if (remaining <= 300_000 && remaining > 0 && warningKeyRef.current !== key) {
      warningKeyRef.current = key;
      notify("🔥 5 minutes remaining", "Stay focused. You're almost there.", settings.notifications);
    }
  }, [activePlan, settings.fiveMinuteWarning, settings.notifications, state.elapsedMs, state.status, state.targetMs]);

  useEffect(() => {
    if (!isTauri() || !settings.autoPauseIdle) return;
    const interval = window.setInterval(async () => {
      try {
        const idleSeconds = await invoke<number>("system_idle_seconds");
        if (settings.idleBehavior === "count") return;
        if (idleSeconds >= settings.idleMinutes * 60 && state.status === "running") {
          idlePausedRef.current = settings.idleBehavior === "exclude";
          handleStartPause();
        } else if (idleSeconds < 5 && idlePausedRef.current && state.status === "paused") {
          idlePausedRef.current = false;
          handleStartPause();
        }
      } catch (error) { console.warn("Idle detection unavailable", error); }
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [handleStartPause, settings.autoPauseIdle, settings.idleBehavior, settings.idleMinutes, state.status]);

  useEffect(() => { if (appWindow) appWindow.setAlwaysOnTop(settings.alwaysOnTop).catch(console.error); }, [settings.alwaysOnTop]);
  useEffect(() => {
    if (!isTauri()) return;
    isAutostartEnabled().then((enabled) => {
      if (settings.startOnLogin && !enabled) return enableAutostart();
      if (!settings.startOnLogin && enabled) return disableAutostart();
    }).catch((error) => setDatabaseError(`Autostart: ${String(error)}`));
  }, [settings.startOnLogin]);

  useEffect(() => {
    if (!appWindow) return;
    let removeListener: (() => void) | undefined;
    appWindow.onCloseRequested(async (event) => {
      if (settings.closeToTray) {
        event.preventDefault();
        await appWindow.hide();
      }
    }).then((unlisten) => { removeListener = unlisten; });
    return () => removeListener?.();
  }, [settings.closeToTray]);

  useEffect(() => {
    if (!appWindow) return;
    if (settings.clickThrough) {
      setClickThroughNotice(true);
      const timer = window.setTimeout(() => { appWindow.setIgnoreCursorEvents(true).catch(console.error); setClickThroughNotice(false); }, 900);
      return () => window.clearTimeout(timer);
    }
    appWindow.setIgnoreCursorEvents(false).catch(console.error);
  }, [settings.clickThrough]);

  useEffect(() => {
    if (!appWindow) return;
    let cancelled = false;
    const resize = async () => {
      const compact = settings.displayMode === "compact";
      const hudSize = completion && (compact || settings.size === "small") ? hudDimensions.medium : compact ? hudDimensions.small : hudDimensions[settings.size];
      const desired = view === "hud" ? hudSize : [view === "dashboard" ? 580 : 500, 740] as const;
      const monitor = await currentMonitor();
      const workArea = monitor?.workArea.size.toLogical(monitor.scaleFactor);
      const width = workArea ? Math.max(280, Math.min(desired[0], workArea.width - 16)) : desired[0];
      const height = workArea ? Math.max(42, Math.min(desired[1], workArea.height - 16)) : desired[1];
      if (cancelled) return;
      await appWindow.setSize(new LogicalSize(Math.round(width), Math.round(height)));
      if (!cancelled && view === "hud" && settings.position !== "custom") await positionWindow(settings.position);
    };
    resize().catch(console.error);
    return () => { cancelled = true; };
  }, [completion, settings.displayMode, settings.size, settings.position, view]);

  useEffect(() => {
    if (view === "hud") return;
    const returnToHud = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setView("hud");
    };
    window.addEventListener("keydown", returnToHud);
    return () => window.removeEventListener("keydown", returnToHud);
  }, [view]);

  useEffect(() => {
    if (!appWindow) return;
    if (shortcutRecording) {
      unregisterAll().catch((error) => setShortcutError(String(error)));
      return;
    }
    const timer = window.setTimeout(async () => {
      const shortcuts = settings.shortcuts;
      const values = Object.values(shortcuts).map((value) => value.trim()).filter(Boolean);
      try {
        await unregisterAll();
        if (new Set(values).size !== values.length) throw new Error("Each shortcut must be unique");
        await register(values, async (event) => {
          if (event.state !== "Pressed") return;
          if (event.shortcut === shortcuts.startPause) actionsRef.current.startPause();
          if (event.shortcut === shortcuts.reset) actionsRef.current.reset();
          if (event.shortcut === shortcuts.clickThrough) actionsRef.current.clickThrough();
          if (event.shortcut === shortcuts.startDeepWork) actionsRef.current.startDeepWork();
          if (event.shortcut === shortcuts.showHide) (await appWindow.isVisible()) ? await appWindow.hide() : await appWindow.show();
        });
        setShortcutError("");
      } catch (error) { setShortcutError(String(error)); }
    }, 450);
    return () => { window.clearTimeout(timer); unregisterAll().catch(console.error); };
  }, [settings.shortcuts, shortcutRecording]);

  useEffect(() => {
    if (!isTauri()) return;
    let removeListener: (() => void) | undefined;
    listen<string>("tray-action", (event) => {
      if (event.payload === "toggle-timer") actionsRef.current.startPause();
      if (event.payload === "start-deep-work") actionsRef.current.startDeepWork();
      if (event.payload === "dashboard") actionsRef.current.dashboard();
    }).then((unlisten) => { removeListener = unlisten; });
    return () => removeListener?.();
  }, []);

  useEffect(() => {
    if (!appWindow || !settings.cornerSnapping || view !== "hud") return;
    let removeListener: (() => void) | undefined;
    let debounce: number | undefined;
    appWindow.onMoved((event) => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(async () => {
        const snapped = await snapToCorner(event.payload);
        if (snapped) setSettings((previous) => ({ ...previous, position: snapped }));
      }, 250);
    }).then((unlisten) => { removeListener = unlisten; });
    return () => { window.clearTimeout(debounce); removeListener?.(); };
  }, [settings.cornerSnapping, view]);

  const adjustActiveTime = (minutes: number) => {
    setState((previous) => {
      if (previous.mode !== "countdown") return previous;
      const targetMs = adjustedTarget(previous.targetMs, previous.elapsedMs, minutes);
      setActivePlan((plan) => plan ? {
        ...plan,
        ...(plan.phase === "work" ? { workMinutes: Math.round(targetMs / 60_000) } : { breakMinutes: Math.round(targetMs / 60_000) }),
      } : plan);
      return { ...previous, targetMs };
    });
  };

  const skipInterval = () => {
    if (!activePlan || activePlan.kind !== "pomodoro") return;
    startPhase(activePlan.phase === "work" ? "break" : "work");
  };

  const changeSettings = (patch: Partial<Settings>) => setSettings((previous) => ({ ...previous, ...patch }));
  const expandHud = () => setSettings((previous) => ({
    ...previous,
    displayMode: "full",
    size: previous.size === "small" ? "medium" : previous.size,
  }));
  const dragStart = () => changeSettings({ position: "custom" });
  const customRgb = hexToRgb(settings.customAccent);
  const shellStyle = {
    "--hud-opacity": settings.opacity / 100,
    ...(settings.accent === "custom" ? { "--accent": settings.customAccent, "--accent-rgb": customRgb } : {}),
  } as React.CSSProperties;

  if (view === "launcher") return <main className="app-shell app-shell--workspace" style={shellStyle}><SessionLauncher settings={settings} projects={projects} initialTask={sessionName} onStart={startPlan} onClose={() => setView("hud")} onDragStart={dragStart} /></main>;
  if (view === "dashboard") return <main className="app-shell app-shell--workspace" style={shellStyle}><Dashboard
    sessions={sessions}
    goalMinutes={settings.dailyGoalMinutes}
    onDelete={async (id) => { await deleteSession(id); refreshSessions(); }}
    onUpdate={async (session) => { await updateSession(session); refreshSessions(); }}
    onExport={(format) => exportSessions(format, sessions)}
    onBackup={() => createBackup(settings, sessions)}
    onRestore={async () => {
      const backup = await selectBackup();
      if (!backup || !await confirm(`Replace current history with ${backup.sessions.length} backed-up sessions and restore all backed-up settings? This can change autostart, shortcuts, and click-through behavior.`, { title: "Restore history and settings", kind: "warning" })) return;
      await replaceSessions(backup.sessions);
      setSettings((previous) => ({ ...previous, ...backup.settings, shortcuts: { ...previous.shortcuts, ...backup.settings.shortcuts } }));
      await refreshSessions();
    }}
    onClose={() => setView("hud")}
    onDragStart={dragStart}
  /></main>;
  if (view === "settings") return <main className="app-shell app-shell--settings" style={shellStyle}><SettingsPanel settings={settings} onChange={changeSettings} onClose={() => setView("hud")} onDragStart={dragStart} onShortcutRecordingChange={setShortcutRecording} /></main>;

  const displayName = activePlan?.task || sessionName;
  const label = activePlan?.phase === "break" ? "RECOVERY BREAK" : activePlan ? "DEEP WORK" : state.mode === "stopwatch" ? "DEEP WORK" : "COUNTDOWN";
  const statusLabel = activePlan?.phase === "break" && state.status === "running" ? "RECHARGING" : state.status === "running" ? "WORKING" : state.status === "paused" ? "PAUSED" : state.status === "finished" ? "COMPLETE" : "READY";

  const configuredSize = settings.displayMode === "compact" ? "small" : settings.size;
  const effectiveSize = completion && configuredSize === "small" ? "medium" : configuredSize;
  return <main className={`app-shell size-${effectiveSize} display-${settings.displayMode}`} style={shellStyle}>
    <section className={`hud hud--${state.status} ${activePlan?.phase === "break" ? "hud--break" : ""}`}>
      <header className="hud__header" data-tauri-drag-region onMouseDown={dragStart}>
        <button className="brand" onClick={() => !activePlan && setState((previous) => initialTimerState(previous.mode === "stopwatch" ? "countdown" : "stopwatch", settings.defaultDuration))} title={activePlan ? label : "Switch timer mode"}><span className="status-dot" /><span>{label}</span></button>
        {activePlan?.kind === "pomodoro" && <span className="cycle-label">CYCLE {activePlan.cycle}</span>}
        <div className="hud__header-actions">
          <span className={`status-label status-label--${state.status}`}>{statusLabel}</span>
          <button
            className="hud__minimize"
            type="button"
            title="Switch to compact HUD"
            aria-label="Switch to compact HUD"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => changeSettings({ displayMode: "compact" })}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>
          </button>
        </div>
      </header>
      <div className="hud__body">
        {activePlan ? <div className="active-intent"><span>{activePlan.project || "FOCUS SESSION"}</span><b>{displayName || "Deep Work"}</b></div> : <label className="session-field"><span className="sr-only">Session name</span><input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={80} placeholder="What are you focusing on?" /></label>}
        <Timer state={state} sessionName={displayName} />
        {!activePlan && <div className="presets" aria-label="Quick start presets">{[25, 50, 90, 120].map((minutes) => <button key={minutes} onClick={() => startPlan({ kind: "deep-work", workMinutes: minutes, breakMinutes: settings.pomodoroBreakMinutes, phase: "work", project: "", task: sessionName, startedAt: new Date().toISOString(), cycle: 1 })}>{minutes === 120 ? "2 hr" : `${minutes} min`}</button>)}<button onClick={() => setCustomPresetOpen((open) => !open)}>Custom</button></div>}
        {customPresetOpen && !activePlan && <form className="custom-preset" onSubmit={(event) => { event.preventDefault(); startPlan({ kind: "deep-work", workMinutes: Math.max(1, customMinutes), breakMinutes: settings.pomodoroBreakMinutes, phase: "work", project: "", task: sessionName, startedAt: new Date().toISOString(), cycle: 1 }); setCustomPresetOpen(false); }}><input aria-label="Custom duration in minutes" type="number" min="1" max="1440" value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} autoFocus /><span>min</span><button type="submit">Start</button></form>}
        {activePlan && <div className="interval-tools"><button onClick={() => adjustActiveTime(-5)} title="Remove five minutes">−5</button><button onClick={() => adjustActiveTime(5)} title="Add five minutes">+5</button>{activePlan.kind === "pomodoro" && <button onClick={skipInterval} title="Skip interval">Skip</button>}</div>}
        <Controls status={state.status} activeSession={Boolean(activePlan)} onStartPause={handleStartPause} onReset={cancelOrReset} onNewSession={() => setView("launcher")} onDashboard={() => setView("dashboard")} onOpenSettings={() => setView("settings")} onExpand={expandHud} />
      </div>
      {completion && <div className="completion-backdrop"><div className="completion-card"><span>{completion.phase === "break" ? "☕" : "✓"}</span><h2>{completion.title}</h2><p>{completion.body}</p><div>{completion.phase === "work" && <button className="primary-action" onClick={() => startPhase("break")}>Start break</button>}{completion.phase === "break" && <button className="primary-action" onClick={() => startPhase("work")}>Start focus</button>}{completion.phase === "deep" && <button className="primary-action" onClick={() => { setActivePlan(null); setCompletion(null); setState(initialTimerState(settings.defaultMode, settings.defaultDuration)); }}>Done</button>}{completion.phase !== "deep" && <button onClick={() => { setActivePlan(null); setCompletion(null); setState(initialTimerState(settings.defaultMode, settings.defaultDuration)); }}>Not now</button>}</div></div></div>}
      {clickThroughNotice && <div className="notice">Click-through on · Ctrl + Alt + C to disable</div>}
      {(shortcutError || databaseError) && <button className="error-notice" onClick={() => { setShortcutError(""); setDatabaseError(""); }} title={shortcutError || databaseError}>{databaseError ? "History storage unavailable" : "Shortcuts unavailable"}</button>}
    </section>
  </main>;
}

async function positionWindow(position: Exclude<HudPosition, "custom">) {
  if (!appWindow) return;
  const monitor = await currentMonitor(); if (!monitor) return;
  const workPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const workSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
  const windowSize = (await appWindow.outerSize()).toLogical(monitor.scaleFactor);
  const margin = 20;
  const x = position.endsWith("left") ? workPosition.x + margin : position.endsWith("right") ? workPosition.x + workSize.width - windowSize.width - margin : workPosition.x + (workSize.width - windowSize.width) / 2;
  const y = position.startsWith("top") ? workPosition.y + margin : workPosition.y + workSize.height - windowSize.height - margin;
  await appWindow.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
}

async function snapToCorner(position: { x: number; y: number }): Promise<HudPosition | null> {
  if (!appWindow) return null;
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const work = monitor.workArea;
  const size = await appWindow.outerSize();
  const margin = Math.round(20 * monitor.scaleFactor);
  const threshold = Math.round(48 * monitor.scaleFactor);
  const left = work.position.x + margin;
  const right = work.position.x + work.size.width - size.width - margin;
  const top = work.position.y + margin;
  const bottom = work.position.y + work.size.height - size.height - margin;
  const nearLeft = Math.abs(position.x - left) <= threshold;
  const nearRight = Math.abs(position.x - right) <= threshold;
  const nearTop = Math.abs(position.y - top) <= threshold;
  const nearBottom = Math.abs(position.y - bottom) <= threshold;
  const snapped = nearLeft && nearTop ? "top-left" : nearRight && nearTop ? "top-right" : nearLeft && nearBottom ? "bottom-left" : nearRight && nearBottom ? "bottom-right" : null;
  if (!snapped) return null;
  await appWindow.setPosition(new PhysicalPosition(snapped.endsWith("left") ? left : right, snapped.startsWith("top") ? top : bottom));
  return snapped;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return "103, 230, 163";
  return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
}
