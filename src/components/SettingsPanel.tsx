import { useEffect, useRef, useState } from "react";
import { Accent, HudPosition, HudSize, Settings, ShortcutAction, Theme } from "../services/settings";
import { previewTimerSound, stopTimerSounds } from "../services/timerSounds";
import { captureShortcut, displayShortcut, shortcutIdentity } from "../services/shortcuts";

interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onDragStart: () => void;
  onShortcutRecordingChange: (recording: boolean) => void;
  notices?: React.ReactNode;
}

const positions: { value: HudPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "custom", label: "Custom / dragged" },
];

const shortcutLabels: Record<ShortcutAction, string> = {
  startPause: "Start / Pause",
  reset: "Reset",
  showHide: "Show / Hide HUD",
  clickThrough: "Toggle click-through",
  startDeepWork: "Start Deep Work",
};

export default function SettingsPanel({ settings, onChange, onClose, onDragStart, onShortcutRecordingChange, notices }: SettingsPanelProps) {
  const [previewTone, setPreviewTone] = useState<"tick" | "work" | "break" | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const previewRequest = useRef(0);
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutAction | null>(null);
  const [shortcutMessage, setShortcutMessage] = useState<{ action: ShortcutAction; text: string } | null>(null);

  useEffect(() => () => onShortcutRecordingChange(false), [onShortcutRecordingChange]);
  useEffect(() => {
    setPreviewTone(null);
    setPreviewMessage("");
    return () => {
      previewRequest.current++;
      stopTimerSounds("preview");
    };
  }, [settings.sound, settings.countdownSound, settings.transitionSound, settings.volume]);

  const previewSound = async (tone: "tick" | "work" | "break") => {
    const request = ++previewRequest.current;
    setPreviewTone(tone);
    setPreviewMessage("Starting sound…");
    const result = await previewTimerSound(settings.volume, tone, () => {
      if (request === previewRequest.current) setPreviewMessage(tone === "tick" ? "Playing three soft clock taps…" : "Playing gentle chime…");
    });
    if (request !== previewRequest.current) return;
    setPreviewTone(null);
    setPreviewMessage(result.status === "error" ? result.message : result.status === "ended" ? "" : "Preview stopped.");
  };

  const startShortcutRecording = (action: ShortcutAction) => {
    setRecordingShortcut(action);
    setShortcutMessage(null);
    onShortcutRecordingChange(true);
  };

  const stopShortcutRecording = () => {
    setRecordingShortcut(null);
    setShortcutMessage(null);
    onShortcutRecordingChange(false);
  };

  const saveRecordedShortcut = (action: ShortcutAction, shortcut: string) => {
    const identity = shortcutIdentity(shortcut);
    const duplicate = (Object.entries(settings.shortcuts) as [ShortcutAction, string][])
      .find(([otherAction, value]) => otherAction !== action && shortcutIdentity(value) === identity);
    if (duplicate) {
      setShortcutMessage({ action, text: `Already used by ${shortcutLabels[duplicate[0]]}. Choose another.` });
      return;
    }
    onChange({ shortcuts: { ...settings.shortcuts, [action]: shortcut } });
    stopShortcutRecording();
  };

  const clearShortcut = (action: ShortcutAction) => {
    onChange({ shortcuts: { ...settings.shortcuts, [action]: "" } });
    if (recordingShortcut === action) stopShortcutRecording();
  };

  return (
    <section className="settings" aria-label="Settings">
      <header className="settings__header" data-tauri-drag-region onMouseDown={onDragStart}>
        <div>
          <span className="eyebrow">DEEPHUD</span>
          <h1>Settings</h1>
        </div>
        <button className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
      </header>

      <div className="settings__content">
        {notices}
        <SettingsGroup title="Appearance">
          <SettingRow label="Theme">
            <Segmented values={["dark", "light", "system"] as Theme[]} value={settings.theme} onChange={(theme) => onChange({ theme })} />
          </SettingRow>
          <SettingRow label="Accent">
            <div className="accents">
              {(["mint", "blue", "violet", "amber"] as Accent[]).map((accent) => (
                <button key={accent} className={`accent accent--${accent} ${settings.accent === accent ? "is-active" : ""}`} onClick={() => onChange({ accent })} aria-label={`${accent} accent`} />
              ))}
              <label className={`accent accent--custom ${settings.accent === "custom" ? "is-active" : ""}`} style={{ background: settings.customAccent }} title="Custom accent"><input type="color" value={settings.customAccent} onChange={(event) => onChange({ accent: "custom", customAccent: event.target.value })} /></label>
            </div>
          </SettingRow>
          <SettingRow label="Opacity" value={`${settings.opacity}%`} stacked>
            <input className="range" type="range" min="45" max="100" value={settings.opacity} onChange={(event) => onChange({ opacity: Number(event.target.value) })} />
          </SettingRow>
          <SettingRow label="HUD size">
            <Segmented values={["small", "medium", "large"] as HudSize[]} value={settings.size} onChange={(size) => onChange({ size })} />
          </SettingRow>
          <SettingRow label="Display mode">
            <Segmented values={["compact", "full"] as Settings["displayMode"][]} value={settings.displayMode} onChange={(displayMode) => onChange({ displayMode })} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="HUD">
          <SettingRow label="Position">
            <select value={settings.position} onChange={(event) => onChange({ position: event.target.value as HudPosition })}>
              {positions.map((position) => <option key={position.value} value={position.value}>{position.label}</option>)}
            </select>
          </SettingRow>
          <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(alwaysOnTop) => onChange({ alwaysOnTop })} />
          <Toggle label="Corner snapping" hint="Snap near a screen corner after dragging" checked={settings.cornerSnapping} onChange={(cornerSnapping) => onChange({ cornerSnapping })} />
          <Toggle label="Click-through mode" hint="Toggle back with Ctrl + Alt + C" checked={settings.clickThrough} onChange={(clickThrough) => onChange({ clickThrough })} />
          <Toggle label="Start on system login" checked={settings.startOnLogin} onChange={(startOnLogin) => onChange({ startOnLogin })} />
          <Toggle label="Close to system tray" hint="Use the tray menu to quit completely" checked={settings.closeToTray} onChange={(closeToTray) => onChange({ closeToTray })} />
        </SettingsGroup>

        <SettingsGroup title="Timer">
          <SettingRow label="Default mode">
            <select value={settings.defaultMode} onChange={(event) => onChange({ defaultMode: event.target.value as Settings["defaultMode"] })}>
              <option value="stopwatch">Stopwatch</option>
              <option value="countdown">Countdown</option>
            </select>
          </SettingRow>
          <SettingRow label="Default duration" value="minutes">
            <input className="number-input" type="number" min="1" max="1440" value={settings.defaultDuration} onChange={(event) => onChange({ defaultDuration: Math.max(1, Number(event.target.value)) })} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Focus intervals">
          <SettingRow label="Long break" value="minutes"><input aria-label="Long-break duration" className="number-input" type="number" min="1" max="240" value={settings.longBreakMinutes} onChange={(event) => onChange({ longBreakMinutes: Math.max(1, Math.min(240, Math.round(Number(event.target.value)))) })} /></SettingRow>
          <SettingRow label="Cycles before a long break" value="completed cycles"><input aria-label="Cycles before a long break" className="number-input" type="number" min="1" max="12" value={settings.cyclesBeforeLongBreak} onChange={(event) => onChange({ cyclesBeforeLongBreak: Math.max(1, Math.min(12, Math.round(Number(event.target.value)))) })} /></SettingRow>
          <p className="long-break-hint">Applies to new sessions. Skipped cycles do not count. Long breaks are always at least one minute longer than the short break.</p>
          <Toggle label="Auto-start breaks" checked={settings.autoStartBreak} onChange={(autoStartBreak) => onChange({ autoStartBreak })} />
          <Toggle label="Auto-start focus" checked={settings.autoStartWork} onChange={(autoStartWork) => onChange({ autoStartWork })} />
        </SettingsGroup>

        <SettingsGroup title="Alerts">
          <Toggle label="Desktop notifications" hint="Focus completion, break finished, and daily goals" checked={settings.notifications} onChange={(notifications) => onChange({ notifications })} />
          <Toggle label="Motivational messages" hint="Short encouragement in completion and goal notifications" checked={settings.motivationalMessages} onChange={(motivationalMessages) => onChange({ motivationalMessages })} />
          <Toggle label="Reminder notifications" hint="Also send the five-minute warning to your desktop; requires desktop notifications and the warning below" checked={settings.reminderNotifications} onChange={(reminderNotifications) => onChange({ reminderNotifications })} />
          <Toggle label="Five-minute warning" hint="Subtle indication on the focus timer" checked={settings.fiveMinuteWarning} onChange={(fiveMinuteWarning) => onChange({ fiveMinuteWarning })} />
        </SettingsGroup>

        <SettingsGroup title="Timer sounds">
          <Toggle label="Timer sounds" hint="Audio alerts for focus and break timers" checked={settings.sound} onChange={(sound) => onChange({ sound })} />
          <Toggle label="10-second countdown" hint="Warm clock taps before focus and breaks finish" checked={settings.countdownSound} disabled={!settings.sound} onChange={(countdownSound) => onChange({ countdownSound })} />
          <Toggle label="Start/end chimes" hint="Gentle rising chime for breaks; falling chime to return to focus" checked={settings.transitionSound} disabled={!settings.sound} onChange={(transitionSound) => onChange({ transitionSound })} />
          <SettingRow label="Volume" value={`${settings.volume}%`} stacked>
            <input aria-label="Timer sound volume" className="range" type="range" min="0" max="100" value={settings.volume} disabled={!settings.sound} onChange={(event) => onChange({ volume: Number(event.target.value) })} />
          </SettingRow>
          <SettingRow label="Preview sounds" stacked>
            <div className="segmented sound-previews">
              <button type="button" aria-pressed={previewTone === "tick"} disabled={!settings.sound || !settings.countdownSound || settings.volume === 0} onClick={() => { void previewSound("tick"); }}>{previewTone === "tick" ? "Playing…" : "▶ Tick"}</button>
              <button type="button" aria-pressed={previewTone === "work"} disabled={!settings.sound || !settings.transitionSound || settings.volume === 0} onClick={() => { void previewSound("work"); }}>{previewTone === "work" ? "Playing…" : "▶ Break alert"}</button>
              <button type="button" aria-pressed={previewTone === "break"} disabled={!settings.sound || !settings.transitionSound || settings.volume === 0} onClick={() => { void previewSound("break"); }}>{previewTone === "break" ? "Playing…" : "▶ Focus alert"}</button>
            </div>
          </SettingRow>
          <p className="sound-preview-status" role="status">{!settings.sound ? "Turn on Timer sounds to enable previews." : settings.volume === 0 ? "Increase the volume to hear previews." : !settings.countdownSound && !settings.transitionSound ? "Enable countdown ticks or chimes to preview them." : previewMessage || "Preview a sound at the selected volume."}</p>
        </SettingsGroup>

        <SettingsGroup title="Focus policy">
          <Toggle label="Track paused time" hint="Record interruptions separately from focused time" checked={settings.trackPausedTime} onChange={(trackPausedTime) => onChange({ trackPausedTime })} />
          <Toggle label="Pause when computer is idle" hint={`Pause after ${settings.idleMinutes} minutes without input`} checked={settings.autoPauseIdle} onChange={(autoPauseIdle) => onChange({ autoPauseIdle })} />
          <SettingRow label="When idle">
            <select value={settings.idleBehavior} onChange={(event) => onChange({ idleBehavior: event.target.value as Settings["idleBehavior"] })}>
              <option value="pause">Pause and wait</option>
              <option value="exclude">Exclude idle time</option>
              <option value="count">Keep counting</option>
            </select>
          </SettingRow>
          <SettingRow label="Idle threshold" value="minutes">
            <input className="number-input" type="number" min="1" max="60" value={settings.idleMinutes} onChange={(event) => onChange({ idleMinutes: Math.max(1, Number(event.target.value)) })} />
          </SettingRow>
          <SettingRow label="Daily focus goal" value="minutes">
            <input className="number-input" type="number" min="15" max="1440" step="15" value={settings.dailyGoalMinutes} onChange={(event) => onChange({ dailyGoalMinutes: Math.max(15, Number(event.target.value)) })} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Keyboard shortcuts">
          {(Object.entries(shortcutLabels) as [ShortcutAction, string][]).map(([action, label]) => (
            <Shortcut
              key={action}
              label={label}
              value={settings.shortcuts[action]}
              recording={recordingShortcut === action}
              message={shortcutMessage?.action === action ? shortcutMessage.text : ""}
              onStart={() => startShortcutRecording(action)}
              onCancel={stopShortcutRecording}
              onSave={(shortcut) => saveRecordedShortcut(action, shortcut)}
              onClear={() => clearShortcut(action)}
              onMessage={(text) => setShortcutMessage({ action, text })}
            />
          ))}
        </SettingsGroup>

        <p className="privacy-note"><span aria-hidden="true">🔒</span><strong>Private by design · Data stays on your device</strong></p>
        <footer className="developer-credit" aria-label="Product information">
          <strong>DeepHUD v1.0.0</strong>
          <span>© 2026 Thilina Jayaranga</span>
        </footer>
      </div>
    </section>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="settings-group"><h2>{title}</h2><div className="settings-card">{children}</div></div>;
}

function SettingRow({ label, value, stacked, children }: { label: string; value?: string; stacked?: boolean; children: React.ReactNode }) {
  return <div className={`setting-row ${stacked ? "setting-row--stacked" : ""}`}><div className="setting-label"><span>{label}</span>{value && <small>{value}</small>}</div>{children}</div>;
}

function Segmented<T extends string>({ values, value, onChange }: { values: T[]; value: T; onChange: (value: T) => void }) {
  return <div className="segmented">{values.map((item) => <button type="button" key={item} className={value === item ? "is-active" : ""} aria-pressed={value === item} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><input type="checkbox" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function Shortcut({ label, value, recording, message, onStart, onCancel, onSave, onClear, onMessage }: {
  label: string;
  value: string;
  recording: boolean;
  message: string;
  onStart: () => void;
  onCancel: () => void;
  onSave: (shortcut: string) => void;
  onClear: () => void;
  onMessage: (message: string) => void;
}) {
  const recorderRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (recording) recorderRef.current?.focus(); }, [recording]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const result = captureShortcut(event.nativeEvent);
    if (result.status === "cancelled") onCancel();
    else if (result.status === "captured") onSave(result.shortcut);
    else onMessage(result.message);
  };

  return <div className={`shortcut ${recording ? "is-recording" : ""}`}>
    <div className="shortcut__main">
      <span className="shortcut__name">{label}</span>
      {recording ? (
        <button ref={recorderRef} type="button" className="shortcut__recorder" onKeyDown={handleKeyDown} onClick={() => recorderRef.current?.focus()}>
          <span aria-hidden="true" /> Press shortcut… <small>Esc to cancel</small>
        </button>
      ) : (
        <div className="shortcut__control">
          <kbd className={!value ? "is-empty" : ""}>{displayShortcut(value)}</kbd>
          <button type="button" onClick={onStart}>{value ? "Change" : "Record"}</button>
          {value && <button type="button" className="shortcut__clear" onClick={onClear}>Clear</button>}
        </div>
      )}
    </div>
    {recording && message && <span className="shortcut__message" role="alert">{message}</span>}
  </div>;
}
