import { readFile } from "@tauri-apps/plugin-fs";
import { FocusAudioPlan, FocusAudioTrack } from "./session";

export const FOCUS_AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac"] as const;
export const RECORDED_FOCUS_PRESETS: FocusAudioTrack[] = [
  { name: "Heavy rain", source: "/audio/rain.ogg" },
  { name: "Forest", source: "/audio/forest.ogg" },
  { name: "Calm waterfall", source: "/audio/waterfall.ogg" },
];
export const FOCUS_AUDIO_PREFERENCE_KEY = "deephud:focus-audio:v1";

export interface FocusAudioPreference {
  track: FocusAudioTrack | null;
  volume: number;
}

const defaultPreference: FocusAudioPreference = { track: null, volume: 45 };

function persistedTrack(value: unknown): FocusAudioTrack | null {
  if (!value || typeof value !== "object") return null;
  const track = value as Record<string, unknown>;
  if (typeof track.name !== "string" || track.name.length > 255 || /[\r\n\0]/.test(track.name)) return null;
  if (typeof track.path === "string" && track.path.length <= 4096 && !/[\r\n\0]/.test(track.path)) return { name: track.name, path: track.path };
  const preset = RECORDED_FOCUS_PRESETS.find((item) => item.source === track.source);
  return preset ?? null;
}

export function loadFocusAudioPreference(): FocusAudioPreference {
  try {
    const value = JSON.parse(localStorage.getItem(FOCUS_AUDIO_PREFERENCE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!value) return defaultPreference;
    const volume = typeof value.volume === "number" && Number.isInteger(value.volume)
      ? Math.max(0, Math.min(100, value.volume))
      : defaultPreference.volume;
    return { track: persistedTrack(value.track), volume };
  } catch {
    return defaultPreference;
  }
}

export function saveFocusAudioPreference(audio: FocusAudioPlan | null, volume = audio?.volume ?? defaultPreference.volume) {
  // Browser object URLs expire when the page closes and must never be persisted.
  const track = audio?.track.temporary ? null : audio?.track ?? null;
  localStorage.setItem(FOCUS_AUDIO_PREFERENCE_KEY, JSON.stringify({ track, volume: Math.max(0, Math.min(100, Math.round(volume))) }));
}

export function saveFocusAudioVolume(volume: number) {
  const current = loadFocusAudioPreference();
  localStorage.setItem(FOCUS_AUDIO_PREFERENCE_KEY, JSON.stringify({ ...current, volume: Math.max(0, Math.min(100, Math.round(volume))) }));
}

const mimeTypes: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

const extensionOf = (name: string) => name.split(".").pop()?.toLocaleLowerCase() ?? "";

export function isSupportedRecording(name: string) {
  return FOCUS_AUDIO_EXTENSIONS.includes(extensionOf(name) as typeof FOCUS_AUDIO_EXTENSIONS[number]);
}

export async function resolveFocusAudio(track: FocusAudioTrack): Promise<{ url: string; revoke: boolean }> {
  if (track.source) return { url: track.source, revoke: Boolean(track.temporary) };
  if (!track.path) throw new Error("This recording is no longer available. Choose it again.");
  const bytes = await readFile(track.path);
  const type = mimeTypes[extensionOf(track.name)] ?? "audio/mpeg";
  return { url: URL.createObjectURL(new Blob([bytes], { type })), revoke: true };
}
