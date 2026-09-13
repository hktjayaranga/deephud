export type Theme = "dark" | "light" | "system";
export type Accent = "mint" | "blue" | "violet" | "amber" | "custom";
export type ShortcutAction = "startPause" | "reset" | "showHide" | "clickThrough" | "startDeepWork" | "captureThought";
export type IdleBehavior = "pause" | "exclude" | "count";

/** Preserve the effective behavior of older settings and backups. */
export function effectiveIdleBehavior(settings: Pick<Settings, "autoPauseIdle" | "idleBehavior">): IdleBehavior {
  return settings.autoPauseIdle ? settings.idleBehavior : "count";
}

export function idleBehaviorSettings(idleBehavior: IdleBehavior): Pick<Settings, "autoPauseIdle" | "idleBehavior"> {
  return { autoPauseIdle: idleBehavior !== "count", idleBehavior };
}
export type HudSize = "small" | "medium" | "large";
export type HudPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom";

export interface Settings {
  theme: Theme;
  accent: Accent;
  customAccent: string;
  opacity: number;
  size: HudSize;
  position: HudPosition;
  cornerSnapping: boolean;
  displayMode: "compact" | "full";
  alwaysOnTop: boolean;
  clickThrough: boolean;
  startOnLogin: boolean;
  closeToTray: boolean;
  defaultMode: "stopwatch" | "countdown";
  defaultDuration: number;
  pomodoroWorkMinutes: number;
  pomodoroBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  autoStartBreak: boolean;
  autoStartWork: boolean;
  notifications: boolean;
  motivationalMessages: boolean;
  reminderNotifications: boolean;
  fiveMinuteWarning: boolean;
  sound: boolean;
  countdownSound: boolean;
  transitionSound: boolean;
  volume: number;
  trackPausedTime: boolean;
  autoPauseIdle: boolean;
  idleMinutes: number;
  idleBehavior: IdleBehavior;
  dailyGoalMinutes: number;
  shortcuts: Record<ShortcutAction, string>;
}

export const defaultSettings: Settings = {
  theme: "system",
  accent: "mint",
  customAccent: "#67e6a3",
  opacity: 88,
  size: "medium",
  position: "top-right",
  cornerSnapping: true,
  displayMode: "full",
  alwaysOnTop: true,
  clickThrough: false,
  startOnLogin: false,
  closeToTray: true,
  defaultMode: "stopwatch",
  defaultDuration: 90,
  pomodoroWorkMinutes: 50,
  pomodoroBreakMinutes: 10,
  longBreakMinutes: 20,
  cyclesBeforeLongBreak: 4,
  autoStartBreak: false,
  autoStartWork: false,
  notifications: true,
  motivationalMessages: true,
  reminderNotifications: false,
  fiveMinuteWarning: true,
  sound: true,
  countdownSound: true,
  transitionSound: true,
  volume: 55,
  trackPausedTime: true,
  autoPauseIdle: false,
  idleMinutes: 5,
  idleBehavior: "pause",
  dailyGoalMinutes: 240,
  shortcuts: {
    startPause: "Ctrl+Alt+Space",
    reset: "Ctrl+Alt+R",
    showHide: "Ctrl+Alt+H",
    clickThrough: "Ctrl+Alt+C",
    startDeepWork: "Ctrl+Alt+S",
    captureThought: "Ctrl+Alt+N",
  },
};

export const SETTINGS_KEY = "deepwork-hud:settings:v1";
const LEGACY_KEY = "deepwork-hud:settings:v2";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`Invalid setting: ${name}`);
  return value as T;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`Invalid setting: ${name}`);
  return value as number;
}

function booleanSetting(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid setting: ${name}`);
  return value;
}

/** Strict runtime validation for untrusted persisted or backup settings. */
export function validateSettings(value: unknown): Settings {
  if (!isRecord(value) || !isRecord(value.shortcuts)) throw new Error("Backup contains invalid settings");
  const shortcuts = value.shortcuts;
  const shortcut = (action: ShortcutAction) => {
    const candidate = shortcuts[action];
    if (typeof candidate !== "string" || candidate.length > 100 || /[\r\n\0]/.test(candidate)) throw new Error(`Invalid shortcut: ${action}`);
    return candidate;
  };

  return {
    theme: oneOf(value.theme, ["dark", "light", "system"], "theme"),
    accent: oneOf(value.accent, ["mint", "blue", "violet", "amber", "custom"], "accent"),
    customAccent: typeof value.customAccent === "string" && /^#[0-9a-f]{6}$/i.test(value.customAccent) ? value.customAccent : (() => { throw new Error("Invalid setting: customAccent"); })(),
    opacity: boundedInteger(value.opacity, 45, 100, "opacity"),
    size: oneOf(value.size, ["small", "medium", "large"], "size"),
    position: oneOf(value.position, ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "custom"], "position"),
    cornerSnapping: booleanSetting(value.cornerSnapping, "cornerSnapping"),
    displayMode: oneOf(value.displayMode, ["compact", "full"], "displayMode"),
    alwaysOnTop: booleanSetting(value.alwaysOnTop, "alwaysOnTop"),
    clickThrough: booleanSetting(value.clickThrough, "clickThrough"),
    startOnLogin: booleanSetting(value.startOnLogin, "startOnLogin"),
    closeToTray: booleanSetting(value.closeToTray, "closeToTray"),
    defaultMode: oneOf(value.defaultMode, ["stopwatch", "countdown"], "defaultMode"),
    defaultDuration: boundedInteger(value.defaultDuration, 1, 1440, "defaultDuration"),
    pomodoroWorkMinutes: boundedInteger(value.pomodoroWorkMinutes, 1, 240, "pomodoroWorkMinutes"),
    pomodoroBreakMinutes: boundedInteger(value.pomodoroBreakMinutes, 1, 120, "pomodoroBreakMinutes"),
    longBreakMinutes: value.longBreakMinutes === undefined ? defaultSettings.longBreakMinutes : boundedInteger(value.longBreakMinutes, 1, 240, "longBreakMinutes"),
    cyclesBeforeLongBreak: value.cyclesBeforeLongBreak === undefined ? defaultSettings.cyclesBeforeLongBreak : boundedInteger(value.cyclesBeforeLongBreak, 1, 12, "cyclesBeforeLongBreak"),
    autoStartBreak: booleanSetting(value.autoStartBreak, "autoStartBreak"),
    autoStartWork: booleanSetting(value.autoStartWork, "autoStartWork"),
    notifications: booleanSetting(value.notifications, "notifications"),
    motivationalMessages: value.motivationalMessages === undefined ? defaultSettings.motivationalMessages : booleanSetting(value.motivationalMessages, "motivationalMessages"),
    reminderNotifications: value.reminderNotifications === undefined ? defaultSettings.reminderNotifications : booleanSetting(value.reminderNotifications, "reminderNotifications"),
    fiveMinuteWarning: booleanSetting(value.fiveMinuteWarning, "fiveMinuteWarning"),
    sound: booleanSetting(value.sound, "sound"),
    countdownSound: value.countdownSound === undefined ? defaultSettings.countdownSound : booleanSetting(value.countdownSound, "countdownSound"),
    transitionSound: value.transitionSound === undefined ? defaultSettings.transitionSound : booleanSetting(value.transitionSound, "transitionSound"),
    volume: boundedInteger(value.volume, 0, 100, "volume"),
    trackPausedTime: booleanSetting(value.trackPausedTime, "trackPausedTime"),
    autoPauseIdle: booleanSetting(value.autoPauseIdle, "autoPauseIdle"),
    idleMinutes: boundedInteger(value.idleMinutes, 1, 60, "idleMinutes"),
    idleBehavior: oneOf(value.idleBehavior, ["pause", "exclude", "count"], "idleBehavior"),
    dailyGoalMinutes: boundedInteger(value.dailyGoalMinutes, 15, 1440, "dailyGoalMinutes"),
    shortcuts: {
      startPause: shortcut("startPause"),
      reset: shortcut("reset"),
      showHide: shortcut("showHide"),
      clickThrough: shortcut("clickThrough"),
      startDeepWork: shortcut("startDeepWork"),
      captureThought: shortcuts.captureThought === undefined ? defaultSettings.shortcuts.captureThought : shortcut("captureThought"),
    },
  };
}

export function loadSettings(): Settings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? "{}");
    if (!isRecord(stored)) return defaultSettings;
    const shortcuts = isRecord(stored.shortcuts) ? stored.shortcuts : {};
    return validateSettings({ ...defaultSettings, ...stored, shortcuts: { ...defaultSettings.shortcuts, ...shortcuts } });
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
