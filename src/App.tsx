import DeletionConfirmation from "./components/DeletionConfirmation";
import ScheduleWorkspace from "./components/schedules/ScheduleWorkspace";
import SchedulePreview from "./components/schedules/SchedulePreview";
import ScheduleReminder from "./components/schedules/ScheduleReminder";
import { useSchedules } from "./services/useSchedules";
import { getScheduleData, releaseDeferredReminders, pendingReminders, respondToReminder, schedulePlan } from "./services/schedules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { currentHudMonitor } from "./services/monitor";
import Timer from "./components/Timer";
import ScrollingName from "./components/ScrollingName";
import BreakActivities from "./components/BreakActivities";
import { BreakActivityChoice, breakActivityState } from "./services/breakActivities";
import Controls, { Icon } from "./components/Controls";
import DistractionCaptureInput from "./components/DistractionCapture";
import SavedThoughtsWorkspace from "./components/SavedThoughtsWorkspace";
import { DistractionCapture, getCaptures, saveCapture, deleteCapture, convertCapture, pendingCaptures, deferIdleForCapture } from "./services/distractions";
import TodayQueue from "./components/TodayQueue";
import QueueCompletion from "./components/QueueCompletion";
import { DailyQueueItem, getQueue, localDay, nextQueueItem, normalizeQueue, queuePlan, saveQueue } from "./services/taskQueue";
import Dashboard, { DashboardTab } from "./components/Dashboard";
import SessionLauncher from "./components/SessionLauncher";
import SettingsPanel from "./components/SettingsPanel";
import { ProjectRecord, SessionRecord, deleteSession, ensureProjectTask, getProjects, getSessions, initializeDatabase, replaceSessions, deleteData, saveSession, updateSession } from "./services/database";
import { createBackup, exportSessions, selectBackup } from "./services/dataTransfer";
import { FOCUS_AUDIO_EXTENSIONS, RECORDED_FOCUS_PRESETS, UserAudioRecording, importUserAudioRecording, isSupportedRecording, loadFocusAudioPreference, loadUserAudioLibrary, removeUserAudioRecording, renameUserAudioRecording, resolveFocusAudio, saveFocusAudioPreference, saveFocusAudioVolume, toFocusAudioTrack } from "./services/focusAudio";
import { notify } from "./services/notifications";
import { playChime, scheduleCountdown, stopTimerSounds, unlockAudio } from "./services/timerSounds";
import { FocusAudioPlan, FocusAudioTrack, SessionPhase, SessionPlan, completeFocusCycle, nextBreak, shouldAutoStartWork, transitionSessionPhase } from "./services/session";
import { TimerState, initialTimerState } from "./services/timer";
import { adjustedTarget, advanceElapsed, hasFinished } from "./services/timerMath";
import { HudPosition, Settings, effectiveIdleBehavior, loadSettings, saveSettings } from "./services/settings";
import { saveSkippedWorkInterval } from "./services/skipInterval";
import { clickThroughHint } from "./services/shortcuts";
import "./App.css";

import { focusCompletionNotice, isFocusReminderDue } from "./services/notificationPolicy";

import { sessionProgress } from "./services/sessionProgress";
import StatusToast from "./components/StatusToast";
import SessionRecovery from "./components/SessionRecovery";
import ErrorNotice from "./components/ErrorNotice";
import { SessionSnapshot, clearSessionSnapshot, loadSessionSnapshot, reconcileSessionSnapshot, resumeSessionSnapshot, saveSessionSnapshot, savedRecoveryCycle } from "./services/sessionRecovery";

type View = "saved" | "schedule" | "today" | "hud" | "launcher" | "dashboard" | "settings";
type Completion = { phase: "save-error" | SessionPhase; title: string; body: string };

const isTauri = () => "__TAURI_INTERNALS__" in window;
const appWindow = isTauri() ? getCurrentWindow() : null;
const hudDimensions = { small: [280, 86], medium: [340, 286], large: [420, 400] } as const;
const reliableNow = () => isTauri() ? invoke<number>("monotonic_millis") : Promise.resolve(performance.now());

function focusAudioPlayError(error: unknown) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const message = error instanceof Error || error instanceof DOMException ? error.message : String(error);
  if (name === "AbortError") return null;
  if (name === "NotAllowedError") return "Playback needs permission. Interact with the audio control and try again.";
  if (name === "NotSupportedError") return "This recording is corrupt or its format is not supported on this device.";
  return `Unable to play this recording: ${message || name || "Unknown playback error"}`;
}

function isSameFocusAudioTrack(left?: FocusAudioTrack | null, right?: FocusAudioTrack | null) {
  if (!left || !right) return false;
  if (left.libraryId || right.libraryId) return left.libraryId === right.libraryId;
  return left.path === right.path && left.source === right.source;
}

export default function App() {
  const [deletingRecording, setDeletingRecording] = useState<UserAudioRecording | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [state, setState] = useState<TimerState>(() => initialTimerState(settings.defaultMode, settings.defaultDuration));
  const [sessionName, setSessionName] = useState(() => localStorage.getItem("deepwork-hud:session") ?? "");
  const [recovery, setRecovery] = useState(loadSessionSnapshot);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const savedCycleKeyRef = useRef("");
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const lastSnapshotRef = useRef<{ at: number; plan: SessionPlan; status: string; targetMs: number } | null>(null);
  const [activePlan, setActivePlan] = useState<SessionPlan | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const progressRecords = useMemo(() => activePlan?.workSessionId ? sessions.filter((record) => record.workSessionId === activePlan.workSessionId) : [], [sessions, activePlan?.workSessionId]);
  const [view, setView] = useState<View>("hud");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("overview");
  const [captures, setCaptures] = useState<DistractionCapture[]>([]);
  const [capturesReady, setCapturesReady] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<DistractionCapture | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const captureSavingRef = useRef(false);
  const captureActivityRef = useRef(-Infinity);
  const captureOpen = captureDraft !== null && view === "hud";
  const thoughtCount = pendingCaptures(captures).length;
  const scheduleStartingRef = useRef(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState("");
  const scheduleStore = useSchedules(() => {
    setHudPopover(null); setView("schedule");
  });
  const scheduleSessionActive = Boolean(activePlan) || state.status === "running" || state.status === "paused";
  const reminders = pendingReminders(scheduleStore.data, scheduleSessionActive);
  const reminder = reminders[0];
  const deferredReleaseRef = useRef(false);
  useEffect(() => {
    if (scheduleSessionActive || recovery || !recoveryChecked || !scheduleStore.ready || deferredReleaseRef.current || !scheduleStore.data.occurrences.some(o => o.status === "deferred")) return;
    deferredReleaseRef.current = true;
    void releaseDeferredReminders().then(() => scheduleStore.refresh()).catch(e => setReminderError(String(e))).finally(() => { deferredReleaseRef.current = false; });
  }, [scheduleSessionActive, recovery, recoveryChecked, scheduleStore.ready, scheduleStore.data, scheduleStore.refresh]);


  const [queueItems, setQueueItems] = useState<DailyQueueItem[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const queueWriteRef = useRef(false);
  const queueTransitionRef = useRef(false);
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    const update = () => setToday(localDay());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const changeQueue = async (items: DailyQueueItem[]) => {
    if (queueWriteRef.current) throw new Error("A queue change is still saving. Please try again.");
    if (!queueReady) throw new Error("Load the queue before making changes.");
    queueWriteRef.current = true;
    try { const normalized = normalizeQueue(items); await saveQueue(normalized); setQueueItems(normalized); }
    finally { queueWriteRef.current = false; }
  };
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [breakChoice, setBreakChoice] = useState<BreakActivityChoice | null>(null);
  const breakActivity = breakActivityState(activePlan, state, breakChoice);
  const showBreakActivities = breakActivity.visible && !completion && !recovery;
  const breakActivitiesOnScreen = showBreakActivities && view === "hud";
  const reminderOpen = Boolean(reminder) && !captureOpen && !completion && !recovery && recoveryChecked && !showBreakActivities && view === "hud";
  const [customPresetOpen, setCustomPresetOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(settings.defaultDuration);
  const [shortcutError, setShortcutError] = useState("");
  const [registeredShortcuts, setRegisteredShortcuts] = useState<Settings["shortcuts"] | null>(null);
  const clickThroughShortcutAvailable = registeredShortcuts === settings.shortcuts && Boolean(settings.shortcuts.clickThrough);
  const [shortcutRetry, setShortcutRetry] = useState(0);
  const [historyReloadNotice, setHistoryReloadNotice] = useState("");
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [clickThroughNotice, setClickThroughNotice] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const [statusNotice, setStatusNotice] = useState<{ text: string; id: number } | null>(null);
  const showStatus = useCallback((text: string) => setStatusNotice((previous) => ({ text, id: (previous?.id ?? 0) + 1 })), []);
  const dismissStatus = useCallback(() => setStatusNotice(null), []);
  const lastTickRef = useRef(0);
  const pauseStartedRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const completionKeyRef = useRef("");
  const warningKeyRef = useRef("");
  const idlePausedRef = useRef(false);
  const focusAudioRef = useRef<HTMLAudioElement | null>(null);
  const focusAudioUrlRef = useRef("");
  const focusAudioShouldPlayRef = useRef(false);
  const [focusAudioMuted, setFocusAudioMuted] = useState(false);
  const [focusAudioVolume, setFocusAudioVolume] = useState(() => loadFocusAudioPreference().volume);
  const [focusAudioActuallyPlaying, setFocusAudioActuallyPlaying] = useState(false);
  const [focusAudioError, setFocusAudioError] = useState("");
  const [focusAudioPreviewing, setFocusAudioPreviewing] = useState(false);
  const [userAudioRecordings, setUserAudioRecordings] = useState<UserAudioRecording[]>([]);
  const [focusAudioLibraryBusy, setFocusAudioLibraryBusy] = useState(false);
  const [standaloneFocusAudio, setStandaloneFocusAudio] = useState<FocusAudioPlan | null>(() => {
    const preference = loadFocusAudioPreference();
    return preference.track ? { track: preference.track, volume: preference.volume, pauseWithTimer: true } : null;
  });
  const [hudPopover, setHudPopover] = useState<"audio" | "more" | null>(null);
  const activeAudioFileRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef({ startPause: () => {}, reset: () => {}, clickThrough: () => {}, startDeepWork: () => {}, dashboard: () => {}, captureThought: () => {} });
  const effectiveFocusAudio = activePlan ? activePlan.focusAudio : standaloneFocusAudio;
  const effectiveFocusPhase: SessionPhase = activePlan?.phase ?? "work";
  const focusAudioIsPlaying = focusAudioActuallyPlaying && !focusAudioMuted && focusAudioVolume > 0;

  const closeCapture = () => {
    if (captureSavingRef.current) return;
    captureActivityRef.current = performance.now();
    setCaptureDraft(null); setCaptureError("");
  };
  const openCapture = async () => {
    if (recovery) { setRecoveryError("Resolve the recovered session before capturing a thought."); return; }
    captureActivityRef.current = performance.now();
    setHudPopover(null); setView("hud");
    setSettings((previous) => previous.displayMode === "compact" || previous.size === "small" ? { ...previous, displayMode: "full", size: previous.size === "small" ? "medium" : previous.size } : previous);
    setCaptureDraft((previous) => previous ?? { id: crypto.randomUUID(), text: "", createdAt: new Date().toISOString(), workSessionId: activePlan?.workSessionId ?? null, queueItemId: activePlan?.queueItemId ?? null, handledAt: null, convertedQueueItemId: null });
    try {
      if (appWindow) { await appWindow.setIgnoreCursorEvents(false); await appWindow.show(); await appWindow.unminimize(); await appWindow.setFocus(); }
    } catch (error) { setCaptureError(`Unable to bring the capture input forward: ${String(error)}`); }
  };
  const commitCapture = async () => {
    if (!captureDraft?.text.trim() || captureSavingRef.current) return;
    if (!capturesReady) { setCaptureError("Saved thoughts are not loaded yet. Open Saved for later and use Reload history if storage needs attention."); return; }
    captureSavingRef.current = true; setCaptureBusy(true); setCaptureError("");
    try {
      const saved = { ...captureDraft, text: captureDraft.text.trim() };
      await saveCapture(saved);
      setCaptures((previous) => [...previous.filter((item) => item.id !== saved.id), saved]);
      setCaptureDraft(null); showStatus("Saved for later");
    } catch (error) { setCaptureError(`Could not save. Your thought is still here. ${String(error)}`); }
    finally { captureSavingRef.current = false; setCaptureBusy(false); captureActivityRef.current = performance.now(); }
  };

  const refreshSessions = useCallback(async (strict = false) => {
    try {
      const [nextSessions, nextProjects] = await Promise.all([getSessions(), getProjects()]);
      setSessions(nextSessions);
      setProjects(nextProjects);
    }
    catch (error) { setDatabaseError(String(error)); if (strict) throw error; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        await initializeDatabase();
        const [records, queue, thoughts] = await Promise.all([getSessions(), getQueue(), getCaptures()]);
        if (cancelled) return;
        setQueueItems(queue);
        setQueueReady(true);
        setCaptures(thoughts);
        setCapturesReady(true);
        const pending = loadSessionSnapshot();
        const reconciled = pending ? reconcileSessionSnapshot(pending, records) : null;
        if (pending && !reconciled) clearSessionSnapshot();
        setRecovery(reconciled);
        setRecoveryChecked(true);
        await refreshSessions();
      } catch (error) {
        if (!cancelled) { setRecoveryError(String(error)); setDatabaseError(String(error)); setRecoveryChecked(true); }
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [refreshSessions]);

  useEffect(() => {
    if (recovery || !recoveryChecked) return;
    try {
      if (!activePlan) {
        snapshotRef.current = null;
        lastSnapshotRef.current = null;
        clearSessionSnapshot();
        return;
      }
      const now = Date.now();
      const snapshot: SessionSnapshot = {
        version: 1, savedAt: now, plan: activePlan, timer: state,
        pausedMs: pausedMsRef.current + (settings.trackPausedTime && pauseStartedRef.current !== null ? performance.now() - pauseStartedRef.current : 0),
        warningShown: warningKeyRef.current === `${activePlan.startedAt}:warning`,
      };
      snapshotRef.current = snapshot;
      const last = lastSnapshotRef.current;
      if (!last || last.plan !== activePlan || last.status !== state.status || last.targetMs !== state.targetMs || now - last.at >= 1000) {
        saveSessionSnapshot(snapshot);
        lastSnapshotRef.current = { at: now, plan: activePlan, status: state.status, targetMs: state.targetMs };
      }
    } catch (error) { setDatabaseError(`Session recovery unavailable: ${String(error)}`); }
  }, [activePlan, state, recovery, recoveryChecked, settings.trackPausedTime]);

  useEffect(() => {
    const checkpoint = () => {
      if (!snapshotRef.current) return;
      try { saveSessionSnapshot(snapshotRef.current); }
      catch (error) { console.warn("Unable to checkpoint session", error); }
    };
    window.addEventListener("pagehide", checkpoint);
    window.addEventListener("beforeunload", checkpoint);
    return () => { window.removeEventListener("pagehide", checkpoint); window.removeEventListener("beforeunload", checkpoint); };
  }, []);

  const quitApp = async () => {
    if (!appWindow) return;
    try {
      if (snapshotRef.current) saveSessionSnapshot(snapshotRef.current);
      await invoke("quit_app");
    } catch (error) {
      setDatabaseError(`Unable to close DeepHUD: ${String(error)}`);
    }
  };

  const recoverSession = async (includeTimeAway: boolean) => {
    if (!recovery || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      await initializeDatabase();
      const records = await getSessions();
      const pending = reconcileSessionSnapshot(recovery, records);
      if (!pending) {
        clearSessionSnapshot();
        setRecovery(null);
        showStatus("This session was already saved");
        return;
      }
      const restored = resumeSessionSnapshot(pending, includeTimeAway, Date.now(), settings.trackPausedTime);
      const key = `${restored.plan.startedAt}:${restored.plan.phase}`;
      savedCycleKeyRef.current = savedRecoveryCycle(pending, records) ? key : "";
      completionKeyRef.current = "";
      warningKeyRef.current = pending.warningShown ? `${restored.plan.startedAt}:warning` : "";
      pausedMsRef.current = restored.pausedMs;
      pauseStartedRef.current = null;
      lastTickRef.current = 0;
      // Write the user's choice before restarting the timer, including another immediate crash.
      saveSessionSnapshot({ ...pending, timer: restored.timer, pausedMs: restored.pausedMs, savedAt: Date.now() });
      setActivePlan(restored.plan);
      setSessionName(restored.plan.task);
      setFocusAudioVolume(restored.plan.focusAudio?.volume ?? 55);
      setFocusAudioMuted(false);
      setFocusAudioError("");
      setState(restored.timer);
      setCompletion(null);
      setRecovery(null);
      setView("hud");
      showStatus("Session recovered");
    } catch (error) { setRecoveryError(String(error)); }
    finally { setRecoveryBusy(false); }
  };

  const discardRecovery = async () => {
    if (!recovery || recoveryBusy) return;
    if (!window.confirm("Permanently discard this unfinished interval without saving its focused time? Previously saved intervals and queued tasks are kept. This cannot be undone.")) return;
    setRecoveryBusy(true);
    try {
      const records = (await getSessions()).filter((record) => record.workSessionId === recovery.plan.workSessionId);
      const last = records.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))[0];
      if (last && !last.workSessionEndedAt) await updateSession({ ...last, workSessionEndedAt: new Date(Math.max(recovery.savedAt, Date.parse(last.endedAt))).toISOString() });
      clearSessionSnapshot();
      setRecovery(null);
      setRecoveryError("");
      await refreshSessions();
    } catch (error) { setRecoveryError(String(error)); }
    finally { setRecoveryBusy(false); }
  };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    loadUserAudioLibrary()
      .then((recordings) => { if (!cancelled) setUserAudioRecordings(recordings); })
      .catch((error) => { if (!cancelled) setFocusAudioError(`Unable to load the local audio library: ${String(error)}`); });
    return () => { cancelled = true; };
  }, []);

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

  useEffect(() => {
    const unlock = () => {
      void unlockAudio().catch((error) => console.warn("Unable to enable audio", error));
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Reschedule on timer controls, not on display ticks. The final ten
  // seconds play as one media clip, including when the window is hidden.
  const soundSettings = useRef(settings);
  soundSettings.current = settings;
  const soundTimerState = useRef(state);
  soundTimerState.current = state;
  useEffect(() => {
    const timer = soundTimerState.current;
    if (timer.status === "running" && timer.mode === "countdown" && settings.sound && settings.countdownSound) {
      void scheduleCountdown(settings.volume, timer.targetMs - timer.elapsedMs);
    }
    return () => stopTimerSounds("countdown");
  }, [state.status, state.mode, state.targetMs, activePlan?.startedAt, activePlan?.phase, settings.sound, settings.countdownSound, settings.volume]);

  const previousSoundStatus = useRef(state.status);
  useEffect(() => {
    // A completed standalone timer returns to idle while its chime is playing.
    const reset = state.status === "idle" && previousSoundStatus.current !== "finished";
    previousSoundStatus.current = state.status;
    if (state.status === "paused" || reset || !settings.sound || settings.volume === 0) stopTimerSounds();
    if (!settings.transitionSound) {
      stopTimerSounds("work");
      stopTimerSounds("break");
    }
  }, [state.status, settings.sound, settings.transitionSound, settings.volume]);

  useEffect(() => () => stopTimerSounds(), []);

  useEffect(() => { localStorage.setItem("deepwork-hud:session", sessionName); }, [sessionName]);

  useEffect(() => {
    const audio = new Audio();
    const stopPlayingIndicator = () => setFocusAudioActuallyPlaying(false);
    const handlePlaying = () => {
      setFocusAudioActuallyPlaying(true);
      setFocusAudioError("");
    };
    const handleError = () => {
      stopPlayingIndicator();
      const code = audio.error?.code;
      if (code === 2) setFocusAudioError("This recording could not be loaded from its location.");
      else if (code === 3) setFocusAudioError("This recording is corrupt or could not be decoded.");
      else if (code === 4) setFocusAudioError("This recording format is not supported on this device.");
      else if (code !== 1) setFocusAudioError("Unable to play this recording.");
    };

    audio.loop = true;
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", stopPlayingIndicator);
    audio.addEventListener("ended", stopPlayingIndicator);
    audio.addEventListener("emptied", stopPlayingIndicator);
    audio.addEventListener("loadstart", stopPlayingIndicator);
    audio.addEventListener("waiting", stopPlayingIndicator);
    audio.addEventListener("error", handleError);
    focusAudioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", stopPlayingIndicator);
      audio.removeEventListener("ended", stopPlayingIndicator);
      audio.removeEventListener("emptied", stopPlayingIndicator);
      audio.removeEventListener("loadstart", stopPlayingIndicator);
      audio.removeEventListener("waiting", stopPlayingIndicator);
      audio.removeEventListener("error", handleError);
      if (focusAudioUrlRef.current) URL.revokeObjectURL(focusAudioUrlRef.current);
      focusAudioUrlRef.current = "";
      focusAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const track = effectiveFocusAudio?.track;
    const audio = focusAudioRef.current;
    if (!audio) return;
    let cancelled = false;

    audio.pause();
    if (audio.hasAttribute("src")) {
      audio.removeAttribute("src");
      audio.load();
    }
    if (focusAudioUrlRef.current) URL.revokeObjectURL(focusAudioUrlRef.current);
    focusAudioUrlRef.current = "";
    setFocusAudioError("");
    if (!track) return;

    resolveFocusAudio(track).then(({ url, revoke }) => {
      if (cancelled) {
        if (revoke) URL.revokeObjectURL(url);
        return;
      }
      focusAudioUrlRef.current = revoke ? url : "";
      audio.src = url;
      audio.load();
      if (focusAudioShouldPlayRef.current) {
        const requestedSource = audio.src;
        audio.play().catch((error: unknown) => {
          const message = focusAudioPlayError(error);
          if (cancelled || audio.src !== requestedSource || !message) return;
          setFocusAudioActuallyPlaying(false);
          setFocusAudioError(message);
        });
      }
    }).catch((error) => {
      if (!cancelled) setFocusAudioError(`Unable to open this recording: ${String(error)}`);
    });

    return () => { cancelled = true; };
  }, [effectiveFocusAudio?.track.libraryPath, effectiveFocusAudio?.track.path, effectiveFocusAudio?.track.source]);

  useEffect(() => {
    const audio = focusAudioRef.current;
    const configured = effectiveFocusAudio;
    const shouldPlay = Boolean(configured && effectiveFocusPhase === "work" && (focusAudioPreviewing || state.status === "running" || (!configured.pauseWithTimer && state.status === "paused")));
    focusAudioShouldPlayRef.current = shouldPlay;
    if (!audio || !configured) return;
    audio.volume = Math.max(0, Math.min(1, focusAudioVolume / 100));
    audio.muted = focusAudioMuted;
    if (shouldPlay && audio.src) {
      const requestedSource = audio.src;
      audio.play().catch((error: unknown) => {
        const message = focusAudioPlayError(error);
        if (audio.src !== requestedSource || !message) return;
        setFocusAudioActuallyPlaying(false);
        setFocusAudioError(message);
      });
    }
    else audio.pause();
  }, [effectiveFocusAudio, effectiveFocusPhase, focusAudioMuted, focusAudioPreviewing, focusAudioVolume, state.status]);

  useEffect(() => {
    if (!focusAudioPreviewing) return;
    if (state.status === "running" || hudPopover !== "audio") {
      setFocusAudioPreviewing(false);
      return;
    }
    const timer = window.setTimeout(() => setFocusAudioPreviewing(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [effectiveFocusAudio?.track.libraryPath, effectiveFocusAudio?.track.path, effectiveFocusAudio?.track.source, focusAudioPreviewing, hudPopover, state.status]);

  useEffect(() => {
    if (!activePlan) setHudPopover(null);
  }, [activePlan]);

  useEffect(() => {
    if (!hudPopover) return;
    const closePopover = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHudPopover(null);
    };
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".hud-popover, .control-audio, .control-more")) setHudPopover(null);
    };
    window.addEventListener("keydown", closePopover);
    window.addEventListener("pointerdown", closeFromOutside);
    return () => {
      window.removeEventListener("keydown", closePopover);
      window.removeEventListener("pointerdown", closeFromOutside);
    };
  }, [hudPopover]);

  const handleStartPause = useCallback(() => {
    if (recovery || !recoveryChecked || queueTransitionRef.current || scheduleStartingRef.current) return;
    // Finished intervals must be saved and resolved before the timer can restart.
    if (activePlan && state.status === "finished") return;
    if (state.status !== "running" && !activePlan) {
      const preference = loadFocusAudioPreference();
      const audio = preference.track ? { track: preference.track, volume: preference.volume, pauseWithTimer: true } : null;
      const quickSession: SessionPlan = {
        workSessionId: crypto.randomUUID(),
        kind: state.mode === "stopwatch" ? "stopwatch" : "deep-work",
        workMinutes: state.mode === "countdown" ? Math.round(state.targetMs / 60_000) : 0,
        breakMinutes: settings.pomodoroBreakMinutes,
        phase: "work",
        project: "",
        task: sessionName.trim(),
        startedAt: new Date().toISOString(),
        cycle: 1,
        focusAudio: audio,
      };
      setActivePlan(quickSession);
      setStandaloneFocusAudio(audio);
      setFocusAudioVolume(preference.volume);
      setFocusAudioMuted(false);
      setFocusAudioError("");
    }
    if (state.status === "running") {
      showStatus(activePlan?.phase === "break" ? "Break paused" : "Timer paused");
    } else if (!activePlan) {
      showStatus("Focus session started");
    } else {
      showStatus(activePlan?.phase === "break" ? "Break resumed" : "Timer resumed");
    }
    setState((previous) => {
      const pausing = previous.status === "running";
      if (pausing) {
        pauseStartedRef.current = performance.now();
      } else {
        if (previous.status === "paused" && pauseStartedRef.current && settings.trackPausedTime) pausedMsRef.current += performance.now() - pauseStartedRef.current;
        pauseStartedRef.current = null;
      }
      return { ...previous, elapsedMs: previous.status === "finished" ? 0 : previous.elapsedMs, status: pausing ? "paused" : "running" };
    });
  }, [recovery, recoveryChecked, activePlan, sessionName, showStatus, settings.pomodoroBreakMinutes, settings.trackPausedTime, state.mode, state.status, state.targetMs]);

  const finishWorkSession = useCallback(async () => {
    if (!activePlan?.workSessionId) return;
    const records = (await getSessions()).filter((record) => record.workSessionId === activePlan.workSessionId);
    const last = records.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))[0];
    if (last) {
      await updateSession({ ...last, workSessionEndedAt: new Date().toISOString() });
      await refreshSessions();
    }
  }, [activePlan, refreshSessions]);

  const closeCompletedSession = async () => {
    try { await finishWorkSession(); }
    catch (error) { setDatabaseError(String(error)); throw error; }
    setActivePlan(null);
    setCompletion(null);
    setState(initialTimerState(settings.defaultMode, settings.defaultDuration));
  };

  const cancelOrReset = useCallback(async () => {
    if (recovery || !recoveryChecked || queueTransitionRef.current || scheduleStartingRef.current) return;
    if (completion?.phase === "save-error") return;
    let savedPartial = false;
    // Completion saves asynchronously; don't record the same finished interval twice.
    if (activePlan && state.status === "finished" && !completion) return;
    if (activePlan?.phase === "work" && state.elapsedMs > 0 && state.status !== "finished") {
      const focusSeconds = Math.max(1, Math.round(state.elapsedMs / 1000));
      if (!window.confirm(`End this session and save ${focusSeconds < 60 ? `${focusSeconds} sec` : `${Math.round(focusSeconds / 60)} min`} of focused time to history?`)) return;
      const record: SessionRecord = {
        queueItemId: activePlan.queueItemId,
        workSessionId: activePlan.workSessionId,
        cycleCompleted: false,
        workSessionEndedAt: new Date().toISOString(),
        startedAt: activePlan.startedAt,
        endedAt: new Date().toISOString(),
        plannedMinutes: activePlan.workMinutes,
        focusSeconds,
        pausedSeconds: Math.round((pausedMsRef.current + (settings.trackPausedTime && pauseStartedRef.current !== null ? performance.now() - pauseStartedRef.current : 0)) / 1000),
        project: activePlan.project,
        task: activePlan.task,
        sessionKind: activePlan.kind,
      };
      try {
        await saveSession(record);
        savedPartial = true;
      } catch (error) {
        setDatabaseError(String(error));
        return;
      }
    } else if (activePlan && !window.confirm("End this session?")) return;
    try { if (!savedPartial) await finishWorkSession(); }
    catch (error) { setDatabaseError(String(error)); return; }
    setActivePlan(null);
    setCompletion(null);
    pausedMsRef.current = 0;
    pauseStartedRef.current = null;
    setState(initialTimerState(settings.defaultMode, settings.defaultDuration));
    if (savedPartial) await refreshSessions().catch((error) => setDatabaseError(String(error)));
  }, [recovery, recoveryChecked, activePlan, completion, finishWorkSession, refreshSessions, state.elapsedMs, state.status, settings.defaultMode, settings.defaultDuration, settings.trackPausedTime]);

  const toggleClickThrough = useCallback(() => setSettings((previous) => ({ ...previous, clickThrough: !previous.clickThrough })), []);

  const startPlan = useCallback((plan: SessionPlan, replaceFinished = false, scheduled = false) => {
    if (recovery || !recoveryChecked || (scheduleStartingRef.current && !scheduled)) return false;
    if (activePlan && !(replaceFinished && state.status === "finished" && completion && completion.phase !== "save-error")) {
      showStatus("Finish or end & save the current session before starting another task");
      setView("hud");
      return;
    }
    setCompletion(null);
    const preference = loadFocusAudioPreference();
    const selectedAudio = plan.focusAudio === undefined
      ? (preference.track ? { track: preference.track, volume: preference.volume, pauseWithTimer: true } : null)
      : plan.focusAudio;
    if (plan.focusAudio !== undefined) saveFocusAudioPreference(plan.focusAudio);
    const startedPlan = { ...plan, completedFocusCycles: 0, lastCompletedFocusStartedAt: undefined, longBreakAtCount: undefined, breakKind: undefined, activeBreakMinutes: undefined, longBreakMinutes: plan.longBreakMinutes ?? settings.longBreakMinutes, cyclesBeforeLongBreak: plan.cyclesBeforeLongBreak ?? settings.cyclesBeforeLongBreak, workSessionId: crypto.randomUUID(), focusAudio: selectedAudio, phase: "work" as const, startedAt: new Date().toISOString() };
    setStandaloneFocusAudio(selectedAudio);
    setActivePlan(startedPlan);
    setSessionName(plan.task);
    showStatus("Focus session started");
    setState({ mode: "countdown", status: "running", elapsedMs: 0, targetMs: plan.workMinutes * 60_000 });
    pausedMsRef.current = 0;
    pauseStartedRef.current = null;
    completionKeyRef.current = "";
    warningKeyRef.current = "";
    setFocusAudioVolume(selectedAudio?.volume ?? preference.volume);
    setFocusAudioMuted(false);
    setFocusAudioError("");
    ensureProjectTask(plan.project, plan.task).then(() => refreshSessions()).catch((error) => setDatabaseError(String(error)));
    setView("hud");
  }, [recovery, recoveryChecked, activePlan, state.status, completion, refreshSessions, showStatus, settings.longBreakMinutes, settings.cyclesBeforeLongBreak]);

  const scheduleLive = useRef({ active: scheduleSessionActive, blocked: false, startPlan });
  scheduleLive.current = { active: scheduleSessionActive, blocked: Boolean(recovery) || !recoveryChecked, startPlan };
  const respondSchedule = async (status: "started" | "dismissed" | "deferred") => {
    if (!reminder || scheduleStartingRef.current) return;
    if (status === "started" && (scheduleLive.current.active || scheduleLive.current.blocked || queueTransitionRef.current)) { setReminderError("Finish the current session first."); return; }
    scheduleStartingRef.current = true; setReminderBusy(true); setReminderError("");
    try {
      await respondToReminder(reminder.id, status);
      if (status === "started") scheduleLive.current.startPlan(schedulePlan(reminder.schedule), false, true);
      await scheduleStore.refresh();
    } catch (error) { setReminderError(String(error)); }
    finally { scheduleStartingRef.current = false; setReminderBusy(false); }
  };

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
    captureThought: () => { void openCapture(); },
  };

  const startPhase = useCallback((phase: SessionPhase, plan = activePlan) => {
    if (!plan) return;
    const next = transitionSessionPhase(plan, phase);
    setActivePlan(next);
    setState({ mode: "countdown", status: "running", elapsedMs: 0, targetMs: (phase === "work" ? next.workMinutes : next.activeBreakMinutes ?? next.breakMinutes) * 60_000 });
    pausedMsRef.current = 0;
    pauseStartedRef.current = null;
    lastTickRef.current = 0;
    savedCycleKeyRef.current = "";
    completionKeyRef.current = "";
    warningKeyRef.current = "";
    setCompletion(null);
  }, [activePlan]);

  const startQueueTask = async (item: DailyQueueItem, fromCompletion = false) => {
    if (queueTransitionRef.current || scheduleStartingRef.current) return;
    if (!queueReady || recovery || !recoveryChecked) throw new Error("Wait for session recovery and the queue to load.");
    if (item.completedAt || !queueItems.some((entry) => entry.id === item.id && !entry.completedAt)) throw new Error("This task is no longer available. Reopen it in Today to continue.");
    if (activePlan && !(fromCompletion && state.status === "finished" && completion && completion.phase !== "save-error")) throw new Error("Finish or end & save the current session first.");
    if (activePlan?.kind === "pomodoro" && activePlan.phase === "work" && fromCompletion) throw new Error("Take your break before choosing the next task.");
    queueTransitionRef.current = true;
    try {
      if (activePlan?.kind === "pomodoro" && activePlan.phase === "break" && item.kind === "pomodoro") {
        // Keep the completed-cycle count and long-break rhythm when changing tasks.
        startPhase("work", { ...activePlan, queueItemId: item.id, task: item.title, project: item.project, workMinutes: item.focusMinutes });
        setSessionName(item.title);
      } else {
        if (activePlan) await finishWorkSession();
        startPlan(queuePlan(item, settings.pomodoroBreakMinutes), fromCompletion);
      }
      setView("hud");
    } finally { queueTransitionRef.current = false; }
  };

  useEffect(() => {
    if (!activePlan || state.status !== "finished") return;
    const key = `${activePlan.startedAt}:${activePlan.phase}`;
    if (completionKeyRef.current === key) return;
    completionKeyRef.current = key;
    const alreadySaved = savedCycleKeyRef.current === key;
    const complete = async () => {
      if (activePlan.phase === "work") {
        const record: SessionRecord = {
          queueItemId: activePlan.queueItemId,
          workSessionId: activePlan.workSessionId,
          cycleCompleted: true,
          startedAt: activePlan.startedAt,
          endedAt: new Date().toISOString(),
          plannedMinutes: activePlan.workMinutes,
          focusSeconds: Math.round(state.targetMs / 1000),
          pausedSeconds: Math.round(pausedMsRef.current / 1000),
          project: activePlan.project,
          task: activePlan.task,
          sessionKind: activePlan.kind,
        };
        let goalReached = false;
        let todayMinutes = 0;
        try {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const previousToday = sessions.filter((item) => new Date(item.startedAt) >= todayStart).reduce((sum, item) => sum + item.focusSeconds, 0);
          if (!alreadySaved) {
            await saveSession(record);
            savedCycleKeyRef.current = key;
          }
          await refreshSessions(true);
          goalReached = previousToday < settings.dailyGoalMinutes * 60 && previousToday + record.focusSeconds >= settings.dailyGoalMinutes * 60;
          todayMinutes = Math.round((previousToday + record.focusSeconds) / 60);
        } catch (error) {
          setDatabaseError(String(error));
          setCompletion({ phase: "save-error", title: "Session could not be saved", body: "Your focused time is still here. Retry saving before continuing." });
          return;
        }
        const title = activePlan.kind === "pomodoro" ? "Focus cycle completed" : "Deep work session completed";
        const notice = focusCompletionNotice(activePlan.kind, activePlan.workMinutes, goalReached, todayMinutes, settings.motivationalMessages);
        if (!alreadySaved) {
          if (soundSettings.current.sound && soundSettings.current.transitionSound) void playChime(soundSettings.current.volume, "work");
          void notify(notice.title, notice.body, settings.notifications, notice.motivation);
        }
        if (activePlan.kind === "pomodoro") {
          const completedPlan = completeFocusCycle(activePlan);
          const rest = nextBreak(completedPlan);
          setActivePlan(completedPlan);
          if (settings.autoStartBreak) startPhase("break", completedPlan);
          else {
            setCompletion({ phase: "work", title, body: `You focused for ${activePlan.workMinutes} minutes. Start a ${rest.minutes}-minute ${rest.kind === "long" ? "long " : ""}break?` });
            if (activePlan.queueItemId) setView((current) => current === "dashboard" ? current : "hud");
          }
        } else if (activePlan.queueItemId) {
          setCompletion({ phase: "work", title, body: "Choose what to focus on next." });
          setView((current) => current === "dashboard" ? current : "hud");
        } else {
          // A completed standalone countdown needs no decision or blocking popup.
          setActivePlan(null);
          setCompletion(null);
          pausedMsRef.current = 0;
          pauseStartedRef.current = null;
          setState(initialTimerState(settings.defaultMode, settings.defaultDuration));
          showStatus(`${activePlan.workMinutes} minutes focused · Session complete`);
        }
      } else {
        if (activePlan.queueItemId) setView((current) => current === "dashboard" ? current : "hud");
        if (soundSettings.current.sound && soundSettings.current.transitionSound) void playChime(soundSettings.current.volume, "break");
        void notify(activePlan.breakKind === "long" ? "Long break finished" : "Break finished", shouldAutoStartWork(activePlan, settings.autoStartWork) ? "Your next focus cycle is starting." : "Ready for your next focus cycle? Start it when you’re ready.", settings.notifications);
        if (shouldAutoStartWork(activePlan, settings.autoStartWork)) startPhase("work");
        else setCompletion({ phase: "break", title: activePlan.breakKind === "long" ? "Long break finished" : "Break finished", body: `Ready for focus cycle ${activePlan.cycle + 1}?` });
      }
    };
    complete();
  }, [activePlan, refreshSessions, sessions, settings, showStatus, startPhase, state.status, state.targetMs]);

  useEffect(() => {
    if (!activePlan || !isFocusReminderDue(state, activePlan.phase, settings.fiveMinuteWarning)) return;
    const key = `${activePlan.startedAt}:warning`;
    if (warningKeyRef.current !== key && settings.notifications && settings.reminderNotifications) {
      warningKeyRef.current = key;
      void notify("5 minutes remaining", "Your focus interval is almost finished.", true);
    }
  }, [activePlan, settings.fiveMinuteWarning, settings.notifications, settings.reminderNotifications, state]);

  useEffect(() => {
    const idleBehavior = effectiveIdleBehavior(settings);
    if (idleBehavior !== "exclude") idlePausedRef.current = false;
    if (!isTauri() || idleBehavior === "count") return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        if (deferIdleForCapture(captureOpen, captureActivityRef.current, settings.idleMinutes, performance.now())) return;
        const idleSeconds = await invoke<number>("system_idle_seconds");
        if (cancelled) return;
        if (deferIdleForCapture(captureOpen, captureActivityRef.current, settings.idleMinutes, performance.now())) return;
        if (idleSeconds >= settings.idleMinutes * 60 && state.status === "running") {
          idlePausedRef.current = idleBehavior === "exclude";
          handleStartPause();
        } else if (idleBehavior === "exclude" && idleSeconds < 5 && idlePausedRef.current && state.status === "paused") {
          idlePausedRef.current = false;
          handleStartPause();
        }
      } catch (error) { console.warn("Idle detection unavailable", error); }
    }, 15_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [captureOpen, handleStartPause, settings.autoPauseIdle, settings.idleBehavior, settings.idleMinutes, state.status]);

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
    if (settings.clickThrough && !captureOpen && !reminderOpen && !recovery && !completion && view === "hud" && !breakActivitiesOnScreen) {
      setClickThroughNotice(true);
      const timer = window.setTimeout(() => { appWindow.setIgnoreCursorEvents(true).catch(console.error); setClickThroughNotice(false); }, 900);
      return () => window.clearTimeout(timer);
    }
    setClickThroughNotice(false);
    appWindow.setIgnoreCursorEvents(false).catch(console.error);
  }, [settings.clickThrough, captureOpen, reminderOpen, recovery, completion, view, breakActivitiesOnScreen]);

  useEffect(() => {
    if (!appWindow) return;
    let cancelled = false;
    const resize = async () => {
      const compact = settings.displayMode === "compact";
      const hudSize = completion && activePlan?.queueItemId ? [420, 500] as const : showBreakActivities ? [420, 500] as const : (completion || reminderOpen) && (compact || settings.size === "small") ? hudDimensions.medium : compact ? hudDimensions.small : hudDimensions[settings.size];
      const desired = recovery ? [420, 420] as const : view === "hud"
        ? hudSize
        : view === "launcher"
          ? [500, 650] as const
          : [(view === "dashboard" || view === "today" || view === "schedule" || view === "saved") ? 580 : 500, 740] as const;
      const monitor = await currentHudMonitor();
      const workArea = monitor?.workArea.size.toLogical(monitor.scaleFactor);
      const width = workArea ? Math.max(280, Math.min(desired[0], workArea.width - 16)) : desired[0];
      const height = workArea ? Math.max(42, Math.min(desired[1], workArea.height - 16)) : desired[1];
      if (cancelled) return;
      await appWindow.setSize(new LogicalSize(Math.round(width), Math.round(height)));
      if (!cancelled && view === "hud" && settings.position !== "custom") await positionWindow(settings.position);
    };
    resize().catch(console.error);
    return () => { cancelled = true; };
  }, [recovery, completion, reminderOpen, activePlan?.queueItemId, showBreakActivities, settings.displayMode, settings.size, settings.position, view]);

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
    let cancelled = false;
    setRegisteredShortcuts(null);
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
          if (event.shortcut === shortcuts.captureThought) actionsRef.current.captureThought();
          if (event.shortcut === shortcuts.startDeepWork) actionsRef.current.startDeepWork();
          if (event.shortcut === shortcuts.showHide) (await appWindow.isVisible()) ? await appWindow.hide() : await appWindow.show();
        });
        if (!cancelled) {
          setRegisteredShortcuts(shortcuts);
          setShortcutError("");
        }
      } catch (error) {
        if (!cancelled) { setRegisteredShortcuts(null); setShortcutError(String(error)); }
      }
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); unregisterAll().catch(console.error); };
  }, [settings.shortcuts, shortcutRecording, shortcutRetry]);

  useEffect(() => {
    if (!isTauri()) return;
    let removeListener: (() => void) | undefined;
    listen<string>("tray-action", (event) => {
      if (event.payload === "toggle-timer") actionsRef.current.startPause();
      if (event.payload === "start-deep-work") actionsRef.current.startDeepWork();
      if (event.payload === "dashboard") actionsRef.current.dashboard();
      if (event.payload === "disable-click-through") {
        setSettings((previous) => ({ ...previous, clickThrough: false }));
        showStatus("Click-through off");
      }
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
    if (queueTransitionRef.current || state.status === "finished") return;
    setState((previous) => {
      if (previous.mode !== "countdown") return previous;
      const targetMs = adjustedTarget(previous.targetMs, previous.elapsedMs, minutes);
      setActivePlan((plan) => plan ? {
        ...plan,
        ...(plan.phase === "work" ? { workMinutes: Math.round(targetMs / 60_000) } : { activeBreakMinutes: Math.round(targetMs / 60_000) }),
      } : plan);
      return { ...previous, targetMs };
    });
  };

  const skipInterval = async () => {
    if (!activePlan || activePlan.kind !== "pomodoro" || state.status === "finished" || queueTransitionRef.current) return;
    if (activePlan.phase === "break") {
      if (activePlan.queueItemId) {
        setState((previous) => ({ ...previous, elapsedMs: previous.targetMs, status: "finished" }));
      } else startPhase("work");
      return;
    }
    queueTransitionRef.current = true;
    if (state.status === "running") pauseStartedRef.current = performance.now();
    setState((previous) => ({ ...previous, status: "paused" }));
    try {
      await saveSkippedWorkInterval(activePlan, state.elapsedMs,
        pausedMsRef.current + (settings.trackPausedTime && pauseStartedRef.current !== null ? performance.now() - pauseStartedRef.current : 0));
      startPhase("break");
      if (state.elapsedMs > 0) showStatus("Partial focus saved · Break started");
      await refreshSessions();
    } catch (error) { setDatabaseError(String(error)); }
    finally { queueTransitionRef.current = false; }
  };

  const applyFocusAudioTrack = (track: FocusAudioTrack | null) => {
    const nextAudio = track ? {
      track,
      volume: focusAudioVolume,
      pauseWithTimer: activePlan?.focusAudio?.pauseWithTimer ?? true,
    } : null;
    if (activePlan) {
      setActivePlan((previous) => previous ? { ...previous, focusAudio: nextAudio } : previous);
    }
    setStandaloneFocusAudio(nextAudio);
    saveFocusAudioPreference(nextAudio, focusAudioVolume);
    setFocusAudioMuted(false);
    setFocusAudioError("");
  };

  const selectFocusAudioTrack = (track: FocusAudioTrack | null) => {
    if (!track) {
      setFocusAudioPreviewing(false);
      applyFocusAudioTrack(null);
      return;
    }
    const currentTrack = effectiveFocusAudio?.track;
    const isSelected = isSameFocusAudioTrack(currentTrack, track);
    if (state.status !== "running" && isSelected && focusAudioPreviewing) {
      setFocusAudioPreviewing(false);
      return;
    }
    if (state.status !== "running" && isSelected && focusAudioRef.current) focusAudioRef.current.currentTime = 0;
    applyFocusAudioTrack(track);
    setFocusAudioPreviewing(state.status !== "running");
  };

  const setActiveBrowserRecording = (file?: File) => {
    if (!file) return;
    if (!isSupportedRecording(file.name)) {
      setFocusAudioError("Choose an MP3, WAV, OGG, FLAC, M4A, or AAC recording.");
      return;
    }
    selectFocusAudioTrack({ name: file.name, source: URL.createObjectURL(file), temporary: true });
  };

  const chooseActiveRecording = async () => {
    if (!isTauri()) {
      activeAudioFileRef.current?.click();
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Audio recordings", extensions: [...FOCUS_AUDIO_EXTENSIONS] }],
      });
      if (typeof selected !== "string") return;
      setFocusAudioLibraryBusy(true);
      setFocusAudioError("");
      const recording = await importUserAudioRecording(selected, selected.split(/[\\/]/).pop() || "Local recording");
      setUserAudioRecordings((recordings) => [...recordings, recording]);
      selectFocusAudioTrack(toFocusAudioTrack(recording));
    } catch (error) {
      setFocusAudioError(`Unable to add this recording: ${String(error)}`);
    } finally {
      setFocusAudioLibraryBusy(false);
    }
  };

  const renameActiveRecording = async () => {
    const selected = userAudioRecordings.find((recording) => recording.id === effectiveFocusAudio?.track.libraryId);
    if (!selected) return;
    const name = window.prompt("Rename this recording", selected.name);
    if (name === null || name.trim() === selected.name) return;
    try {
      setFocusAudioLibraryBusy(true);
      const recordings = await renameUserAudioRecording(selected.id, name);
      setUserAudioRecordings(recordings);
      const renamed = recordings.find((recording) => recording.id === selected.id);
      if (renamed) applyFocusAudioTrack(toFocusAudioTrack(renamed));
    } catch (error) {
      setFocusAudioError(`Unable to rename this recording: ${String(error)}`);
    } finally {
      setFocusAudioLibraryBusy(false);
    }
  };

  const removeActiveRecording = async (recording: UserAudioRecording) => {
    try {
      setFocusAudioLibraryBusy(true);
      const wasSelected = effectiveFocusAudio?.track.libraryId === recording.id;
      const recordings = await removeUserAudioRecording(recording);
      setUserAudioRecordings(recordings);
      if (wasSelected) selectFocusAudioTrack(null);
    } finally {
      setFocusAudioLibraryBusy(false);
    }
  };

  const changeFocusAudioVolume = (volume: number) => {
    setFocusAudioVolume(volume);
    setActivePlan((previous) => previous?.focusAudio
      ? { ...previous, focusAudio: { ...previous.focusAudio, volume } }
      : previous);
    setStandaloneFocusAudio((previous) => previous
      ? { ...previous, volume }
      : previous);
    saveFocusAudioVolume(volume);
  };

  const toggleAudioPopover = () => {
    setHudPopover((openPopover) => openPopover === "audio" ? null : "audio");
    if (settings.displayMode === "compact" || settings.size === "small") {
      setSettings((previous) => ({ ...previous, displayMode: "full", size: previous.size === "small" ? "medium" : previous.size }));
    }
    if (effectiveFocusAudio && effectiveFocusPhase === "work" && state.status === "running") {
      const audio = focusAudioRef.current;
      if (audio) {
        const requestedSource = audio.src;
        audio.play().then(() => setFocusAudioError("")).catch((error: unknown) => {
          const message = focusAudioPlayError(error);
          if (audio.src !== requestedSource || !message) return;
          setFocusAudioActuallyPlaying(false);
          setFocusAudioError(message);
        });
      }
    }
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

  const autostartError = databaseError.startsWith("Autostart:");
  const snapshotError = databaseError.startsWith("Session recovery unavailable:");
  const reminderUI = reminder && recoveryChecked && !recovery ? <ScheduleReminder reminder={reminder} active={scheduleSessionActive} busy={reminderBusy} error={reminderError} remaining={reminders.length} onRespond={status => void respondSchedule(status)} /> : null;
  const errorNotices = <>
    {scheduleStore.error && <p className="inline-error" role="alert">Schedules unavailable: {scheduleStore.error} <button type="button" onClick={() => void scheduleStore.refresh().catch(() => {})}>Retry</button></p>}
    {scheduleStore.notificationError && <p className="inline-error" role="alert">{scheduleStore.notificationError}</p>}

    {databaseError && <ErrorNotice key={databaseError} title={autostartError ? "Start on login unavailable" : snapshotError ? "Session recovery unavailable" : "History storage needs attention"}
      message={autostartError ? "In Settings → HUD, turn Start on system login off and on to try again."
        : snapshotError ? "Your session recovery copy could not be stored. Check available disk space and app storage permissions, then return to the timer to retry the action."
        : "Check available disk space and app data-folder permissions, then reload history. Reloading does not save an unfinished session; retry the action that failed. For a completed session, use Retry save on the timer."}
      details={databaseError} onDismiss={() => { setDatabaseError(""); setHistoryReloadNotice(""); }} actionLabel={autostartError ? "Open settings" : snapshotError ? "Back to timer" : "Reload history"}
      onAction={async () => {
        if (autostartError) { setView("settings"); return; }
        if (snapshotError) { setView("hud"); return; }
        setHistoryReloadNotice("");
        await initializeDatabase();
        const [records, nextProjects, queue, thoughts] = await Promise.all([getSessions(), getProjects(), getQueue(), getCaptures()]);
        setCaptures(thoughts); setCapturesReady(true);
        setQueueItems(queue);
        setQueueReady(true);
        setSessions(records);
        setProjects(nextProjects);
        setHistoryReloadNotice("History reloaded. Retry any action that failed; no unfinished session was saved by reloading.");
      }} />}
    {historyReloadNotice && databaseError && <p className="history-reload-notice" role="status">{historyReloadNotice}</p>}
    {shortcutError && <ErrorNotice key={shortcutError} title="Shortcuts unavailable"
      message="In Settings → Keyboard shortcuts, change any combination used by another app or assigned twice. You can also free the shortcut in the other app and retry. Timer buttons still work."
      details={shortcutError} onDismiss={() => setShortcutError("")} actionLabel={view === "settings" ? "Retry shortcuts" : "Open shortcut settings"}
      onAction={() => {
        if (view === "settings") setShortcutRetry((value) => value + 1);
        else setView("settings");
      }} />}
  </>;

  if (recovery) return <main className="app-shell size-large" style={shellStyle}><section className="hud"><SessionRecovery snapshot={recovery} busy={recoveryBusy || !recoveryChecked} error={recoveryError} onResume={recoverSession} onDiscard={discardRecovery} /></section></main>;

  const savedThoughts = <SavedThoughtsWorkspace
    onToday={() => setView("today")} onClose={() => setView("hud")} onDragStart={dragStart} notices={errorNotices}
    captures={captures} projects={projects} defaultMinutes={settings.pomodoroWorkMinutes} ready={capturesReady}
    onUpdate={async (capture) => { await saveCapture(capture); setCaptures((previous) => previous.map((item) => item.id === capture.id ? capture : item)); }}
    onDelete={async (id) => { await deleteCapture(id); setCaptures((previous) => previous.filter((item) => item.id !== id)); }}
    onConvert={async (capture, task) => {
      if (!queueReady || queueWriteRef.current) throw new Error("Wait for the task queue to finish loading or saving.");
      queueWriteRef.current = true;
      try {
        await convertCapture(capture.id, task);
        const [queue, thoughts] = await Promise.all([getQueue(), getCaptures()]);
        setQueueItems(queue); setCaptures(thoughts);
      } finally { queueWriteRef.current = false; }
    }}
  />;
  if (view === "saved") return <main className="app-shell app-shell--workspace" style={shellStyle}>{savedThoughts}</main>;
  if (view === "schedule") return <main className="app-shell app-shell--workspace" style={shellStyle}><ScheduleWorkspace
    schedules={scheduleStore.data.schedules} settings={settings} projects={projects} ready={scheduleStore.ready}
    onSave={scheduleStore.save} onDelete={scheduleStore.remove} onToday={() => setView("today")}
    onClose={() => setView("hud")} onDragStart={dragStart} notices={errorNotices} reminder={reminderUI}
  /></main>;
  if (view === "today") return <main className="app-shell app-shell--workspace" style={shellStyle}><TodayQueue
    schedule={<SchedulePreview schedules={scheduleStore.data.schedules} ready={scheduleStore.ready && !scheduleStore.error} onOpen={() => setView("schedule")} />}
    onSavedThoughts={() => setView("saved")} pendingThoughtCount={capturesReady ? thoughtCount : undefined}
    items={queueItems} sessions={sessions} projects={projects} today={today} activeId={activePlan?.queueItemId}
    canStart={!activePlan && recoveryChecked} ready={queueReady} defaultMinutes={settings.pomodoroWorkMinutes}
    onChange={changeQueue} onStart={startQueueTask} onClose={() => setView("hud")} onDragStart={dragStart} notices={errorNotices}
  /></main>;
  if (view === "launcher") return <main className="app-shell app-shell--workspace" style={shellStyle}><SessionLauncher settings={settings} projects={projects} initialTask={sessionName} onToday={() => setView("today")} onStart={startPlan} onClose={() => setView("hud")} onDragStart={dragStart} /></main>;
  if (view === "dashboard") return <main className="app-shell app-shell--workspace" style={shellStyle}><Dashboard
    tab={dashboardTab} onTabChange={setDashboardTab}
    notices={errorNotices}
    onToday={() => setView("today")}
    sessions={sessions}
    goalMinutes={settings.dailyGoalMinutes}
    onDelete={async (id) => { await deleteSession(id); await refreshSessions(); }}
    onUpdate={async (session) => { await updateSession(session); refreshSessions(); }}
    onExport={exportSessions}
    onBackup={async () => { if (!queueReady || !capturesReady) throw new Error("Load the queue and saved thoughts before creating a backup."); await createBackup(settings, sessions, queueItems, captures, await getScheduleData()); }}
    onRestore={async () => {
      if (activePlan) throw new Error("End & save the current session before restoring a backup.");
      const backup = await selectBackup();
      if (!backup || !await confirm(`Replace current history, queued tasks, saved thoughts, schedules, and reminder history with this backup? This is a replacement, not a merge. Data absent from the backup will be removed. The backup contains ${backup.sessions.length} backed-up sessions and ${(backup.queueItems ?? []).length} queue items and ${(backup.captures ?? []).length} saved thoughts, ${(backup.focusSchedules?.schedules ?? []).length} schedules. Backed-up settings will also be restored; this can change autostart, shortcuts, and click-through behavior.`, { title: "Replace saved data and restore settings?", kind: "warning", okLabel: "Replace data and restore settings", cancelLabel: "Cancel" })) return;
      await replaceSessions(backup.sessions, backup.queueItems ?? [], backup.captures ?? [], backup.focusSchedules ?? { schedules: [], occurrences: [] });
      await scheduleStore.refresh();
      setCaptures(backup.captures ?? []); setCapturesReady(true);
      setQueueItems(backup.queueItems ?? []);
      setQueueReady(true);
      setSettings((previous) => ({ ...previous, ...backup.settings, shortcuts: { ...previous.shortcuts, ...backup.settings.shortcuts } }));
      await refreshSessions();
    }}
    onDeleteData={async (categories) => {
      if (activePlan) throw new Error("End & save the current session before deleting saved data.");
      await deleteData(categories);
      if (categories.includes("thoughts")) { setCaptures([]); setCapturesReady(true); }
      if (categories.includes("queue")) { setQueueItems([]); setQueueReady(true); }
      if (categories.includes("history")) setSessions([]);
      if (categories.includes("suggestions")) setProjects([]);
      // Deletion has committed. A reload failure must not invite a second deletion.
      await Promise.all([
        refreshSessions(),
        categories.includes("schedules") ? scheduleStore.refresh().catch(error => setDatabaseError(`Selected data was deleted, but schedules could not reload: ${String(error)}`)) : Promise.resolve(),
      ]);
    }}
    onClose={() => setView("hud")}
    onDragStart={dragStart}
  /></main>;
  if (view === "settings") return <main className="app-shell app-shell--settings" style={shellStyle}><SettingsPanel settings={settings} clickThroughShortcutAvailable={clickThroughShortcutAvailable} onChange={changeSettings} onClose={() => setView("hud")} onDragStart={dragStart} onShortcutRecordingChange={setShortcutRecording} notices={errorNotices} /></main>;

  const captureButton = <button type="button" className="session-capture" title="Save a thought for later" aria-label="Save a thought for later" onClick={() => void openCapture()}><Icon name="capture" /></button>;
  const displayName = activePlan?.task || sessionName;
  const label = activePlan?.phase === "break" ? (activePlan.breakKind === "long" ? "LONG BREAK" : "BREAK") : activePlan ? "DEEP WORK" : state.mode === "stopwatch" ? "DEEP WORK" : "COUNTDOWN";
  const statusLabel = activePlan?.phase === "break" && state.status === "running" ? "RECHARGING" : state.status === "running" ? "WORKING" : state.status === "paused" ? "PAUSED" : state.status === "finished" ? "COMPLETE" : "READY";

  const configuredSize = settings.displayMode === "compact" ? "small" : settings.size;
  const effectiveSize = completion && activePlan?.queueItemId ? "large" : showBreakActivities ? "large" : (completion || reminderOpen) && configuredSize === "small" ? "medium" : configuredSize;
  return <main className={`app-shell size-${effectiveSize} display-${settings.displayMode}${showBreakActivities ? " break-activity-shell" : ""}`} style={shellStyle}>
    <section className={`hud hud--${state.status} ${activePlan?.phase === "break" ? "hud--break" : ""}`}>
      <header className="hud__header" data-tauri-drag-region onMouseDown={dragStart}>
        <button className="brand" onClick={() => !activePlan && setState((previous) => initialTimerState(previous.mode === "stopwatch" ? "countdown" : "stopwatch", settings.defaultDuration))} title={activePlan ? label : "Switch timer mode"}><span className="status-dot" /><span>{label}</span></button>
        <div className="hud__header-actions">
          {activePlan?.phase === "break" && thoughtCount > 0 ? <button type="button" className="status-label capture-review-link" title={`${thoughtCount} thoughts saved · Review`} onClick={() => { setHudPopover(null); setView("saved"); }}>{thoughtCount} saved · Review</button> : <span className={`status-label status-label--${state.status}`}>{statusLabel}</span>}
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
          <button
            className="hud__close"
            type="button"
            title="Quit DeepHUD"
            aria-label="Quit DeepHUD"
            disabled={!appWindow}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void quitApp()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </header>
      <div className="hud__body">
        {showBreakActivities && reminder && <button type="button" className="workspace-nav-button" onClick={() => { setView("schedule"); }}>{reminders.length} scheduled · Review</button>}
        {showBreakActivities && breakActivity.key ? <BreakActivities
          key={breakActivity.key}
          state={state}
          selectedActivity={breakActivity.choice?.activity === "breathing" ? "breathing" : null}
          startedMs={breakActivity.choice?.startedMs ?? state.elapsedMs}
          cycles={breakActivity.choice?.cycles}
          onSelect={(activity, cycles) => {
            setBreakChoice({ breakKey: breakActivity.key!, activity, cycles, startedMs: state.elapsedMs });
            setHudPopover(null);
          }}
        /> : <>
        {activePlan ? <div className="active-intent"><ScrollingName className="active-intent__project" text={activePlan.project || "FOCUS SESSION"} /><div className="session-name-row"><ScrollingName className="active-intent__task" text={displayName || "Deep Work"} />{captureButton}</div></div> : <div className="session-field session-name-row"><label><span className="sr-only">Session name</span><input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={80} placeholder="What are you focusing on?" /></label>{captureButton}</div>}
        <Timer state={state} sessionName={displayName} sessionSummary={sessionProgress(activePlan, state, progressRecords)} endingSoon={isFocusReminderDue(state, activePlan?.phase, settings.fiveMinuteWarning)} />
        {!activePlan && <div className="presets" aria-label="Quick start presets">{[25, 50, 90, 120].map((minutes) => <button key={minutes} onClick={() => startPlan({ kind: "deep-work", workMinutes: minutes, breakMinutes: settings.pomodoroBreakMinutes, phase: "work", project: "", task: sessionName, startedAt: new Date().toISOString(), cycle: 1 })}>{minutes === 120 ? "2 hr" : `${minutes} min`}</button>)}<button onClick={() => setCustomPresetOpen((open) => !open)}>Custom</button></div>}
        {customPresetOpen && !activePlan && <form className="custom-preset" onSubmit={(event) => { event.preventDefault(); startPlan({ kind: "deep-work", workMinutes: Math.max(1, customMinutes), breakMinutes: settings.pomodoroBreakMinutes, phase: "work", project: "", task: sessionName, startedAt: new Date().toISOString(), cycle: 1 }); setCustomPresetOpen(false); }}><input aria-label="Custom duration in minutes" type="number" min="1" max="1440" value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} autoFocus /><span>min</span><button type="submit">Start</button></form>}
        </>}
        {hudPopover === "audio" && <div className="hud-popover hud-popover--audio" role="dialog" aria-label="Focus audio controls">
          <div className="hud-popover__header"><span><i className={focusAudioIsPlaying ? "is-on" : ""} />Focus audio</span><button type="button" onClick={() => setHudPopover(null)} aria-label="Close audio controls">×</button></div>
          <strong className="hud-popover__track">{focusAudioError || effectiveFocusAudio?.track.name || "Silence"}</strong>
          <div className="hud-audio-presets">
            <button type="button" title="Silence" className={!effectiveFocusAudio ? "is-active" : ""} onClick={() => selectFocusAudioTrack(null)}>Silence</button>
            {RECORDED_FOCUS_PRESETS.map((track) => {
              const selected = effectiveFocusAudio?.track.source === track.source;
              return <button type="button" key={track.name} title={track.name} className={`${selected ? "is-active" : ""} ${selected && focusAudioPreviewing ? "is-previewing" : ""}`} onClick={() => selectFocusAudioTrack(track)}>{track.name}</button>;
            })}
            {userAudioRecordings.map((recording) => {
              const track = toFocusAudioTrack(recording);
              const selected = effectiveFocusAudio?.track.libraryId === recording.id;
              return <div className="hud-audio-user" key={recording.id}>
                <button type="button" title={recording.name} className={`hud-audio-user__select ${selected ? "is-active" : ""} ${selected && focusAudioPreviewing ? "is-previewing" : ""}`} onClick={() => selectFocusAudioTrack(track)}>{recording.name}</button>
                <button type="button" className="hud-audio-user__remove" title={`Delete recording: ${recording.name}`} aria-label={`Delete recording: ${recording.name}`} disabled={focusAudioLibraryBusy} onClick={() => setDeletingRecording(recording)}>×</button>
              </div>;
            })}
          </div>
          <label className="hud-audio-volume"><span>Volume</span><input type="range" min="0" max="100" value={focusAudioVolume} disabled={!effectiveFocusAudio} onChange={(event) => changeFocusAudioVolume(Number(event.target.value))} /><output>{focusAudioVolume}%</output></label>
          <div className="hud-popover__actions">
            <button type="button" disabled={!effectiveFocusAudio} onClick={() => setFocusAudioMuted((muted) => !muted)}>{focusAudioMuted ? "Unmute" : "Mute"}</button>
            <button type="button" disabled={!effectiveFocusAudio?.track.libraryId || focusAudioLibraryBusy} onClick={() => void renameActiveRecording()}>Rename</button>
            <button type="button" disabled={focusAudioLibraryBusy} onClick={() => void chooseActiveRecording()}>{focusAudioLibraryBusy ? "Working…" : "Add recording…"}</button>
          </div>
          <input ref={activeAudioFileRef} className="sr-only" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/aac" onChange={(event) => { setActiveBrowserRecording(event.target.files?.[0]); event.target.value = ""; }} />
        </div>}
        {hudPopover === "more" && <div id="hud-more-controls" className="hud-popover hud-popover--more" role="dialog" aria-label="More controls">
          <div className="hud-popover__header"><span>More controls</span><button type="button" onClick={() => setHudPopover(null)} aria-label="Close more controls">×</button></div>
          <div className="hud-panel-icons" role="group" aria-label="Audio and navigation">
            <button type="button" className={`control-audio ${focusAudioIsPlaying ? "is-playing" : ""}`} title="Focus audio" aria-label="Focus audio" onClick={toggleAudioPopover}><Icon name="audio" /></button>
            <button type="button" title="Productivity dashboard" aria-label="Productivity dashboard" onClick={() => { setHudPopover(null); setView("dashboard"); }}><Icon name="chart" /></button>
            <span className="hud-panel-slot"><button type="button" title="Focus schedule" aria-label="Focus schedule" onClick={() => { setHudPopover(null); setView("schedule"); }}><Icon name="calendar" /></button></span>
            <button type="button" title="Saved for later" aria-label={capturesReady ? `Saved for later, ${thoughtCount} unhandled thoughts` : "Saved for later"} onClick={() => { setHudPopover(null); setView("saved"); }}>
              <Icon name="bookmark" />{capturesReady && thoughtCount > 0 && <span className="saved-thoughts-count" aria-hidden="true">{thoughtCount > 99 ? "99+" : thoughtCount}</span>}
            </button>
            <button type="button" title="Settings" aria-label="Settings" onClick={() => { setHudPopover(null); setView("settings"); }}><Icon name="settings" /></button>
          </div>
        </div>}
        <Controls onAdjustTime={activePlan && state.mode === "countdown" ? adjustActiveTime : undefined} onSkip={activePlan?.kind === "pomodoro" && state.mode === "countdown" ? () => { void skipInterval(); setHudPopover(null); } : undefined} status={state.status} activeSession={Boolean(activePlan)} onStartPause={handleStartPause} onReset={cancelOrReset} onToday={() => setView("today")} onNewSession={() => setView("launcher")} onExpand={expandHud} openPopover={hudPopover} onMore={() => setHudPopover((openPopover) => openPopover === "more" ? null : "more")} />
      </div>
      {reminderOpen && reminderUI}
      {captureOpen && <DistractionCaptureInput text={captureDraft.text} busy={captureBusy} error={captureError} onChange={(text) => { captureActivityRef.current = performance.now(); setCaptureDraft((previous) => previous ? { ...previous, text } : previous); }} onSave={() => void commitCapture()} onCancel={closeCapture} />}
      {!captureOpen && (completion && activePlan?.queueItemId && completion.phase !== "save-error" ? <QueueCompletion
        plan={activePlan} item={queueItems.find((item) => item.id === activePlan.queueItemId)} next={nextQueueItem(queueItems, activePlan.queueItemId, today)} sessions={sessions}
        onDone={async () => { await changeQueue(queueItems.map((item) => item.id === activePlan.queueItemId ? { ...item, completedAt: new Date().toISOString() } : item)); }}
        onContinue={async () => { const item = queueItems.find((item) => item.id === activePlan.queueItemId); if (item) await startQueueTask(item, true); }}
        onNext={async () => { const item = nextQueueItem(queueItems, activePlan.queueItemId, localDay()); if (item) await startQueueTask(item, true); }}
        onBreak={() => startPhase("break")} onClose={closeCompletedSession}
      /> : completion && <div className="completion-backdrop"><div className="completion-card"><span>{completion.phase === "save-error" ? "!" : completion.phase === "break" ? "☕" : "✓"}</span><h2>{completion.title}</h2><p>{completion.body}</p><div>{completion.phase === "work" && <button className="primary-action" onClick={() => startPhase("break")}>Start {activePlan && nextBreak(activePlan).kind === "long" ? "long " : ""}break</button>}{completion.phase === "break" && <button className="primary-action" onClick={() => startPhase("work")}>Start focus</button>}{completion.phase === "save-error" && <button className="primary-action" onClick={() => { completionKeyRef.current = ""; setCompletion(null); setActivePlan((plan) => plan ? { ...plan } : null); }}>Retry save</button>}{(completion.phase === "work" || completion.phase === "break") && <button onClick={() => void closeCompletedSession().catch(() => {})}>End session</button>}</div></div></div>)}
      {deletingRecording && <DeletionConfirmation title="Delete this recording from DeepHUD?" confirmLabel="Delete recording" errorMessage="Could not delete this recording."
        description={<><p className="deletion-target">{deletingRecording.name}</p><p>This permanently deletes DeepHUD’s imported copy from your audio library. If selected, focus audio switches to Silence. Your original file is kept and can be imported again.</p></>}
        onCancel={() => setDeletingRecording(null)} onConfirm={() => removeActiveRecording(deletingRecording)} />}
      {statusNotice && <StatusToast key={statusNotice.id} text={statusNotice.text} onDismiss={dismissStatus} />}
      {clickThroughNotice && <div className="notice" role="status">Click-through on · {clickThroughHint(settings.shortcuts.clickThrough, clickThroughShortcutAvailable)}</div>}
      {(shortcutError || databaseError) && <button className="error-notice" onClick={() => setView(databaseError && !autostartError ? "dashboard" : "settings")} title="View error details and recovery actions">{databaseError ? autostartError ? "Start on login unavailable" : snapshotError ? "Session recovery unavailable" : "History storage unavailable" : "Shortcuts unavailable"} · Review</button>}
    </section>
  </main>;
}

async function positionWindow(position: Exclude<HudPosition, "custom">) {
  if (!appWindow) return;
  const monitor = await currentHudMonitor(); if (!monitor) return;
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
  const monitor = await currentHudMonitor();
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
