import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, readTextFile, remove, stat, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FocusAudioPlan, FocusAudioTrack } from "./session";

export const FOCUS_AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac"] as const;
export const RECORDED_FOCUS_PRESETS: FocusAudioTrack[] = [
  { name: "Heavy rain", source: "/audio/rain.ogg" },
  { name: "Forest", source: "/audio/forest.ogg" },
  { name: "Calm waterfall", source: "/audio/waterfall.ogg" },
];
export const FOCUS_AUDIO_PREFERENCE_KEY = "deephud:focus-audio:v1";
export const MAX_USER_AUDIO_RECORDINGS = 100;
export const MAX_USER_AUDIO_BYTES = 250 * 1024 * 1024;
const AUDIO_LIBRARY_DIRECTORY = "focus-audio";
const AUDIO_LIBRARY_MANIFEST = `${AUDIO_LIBRARY_DIRECTORY}/library.json`;

export interface UserAudioRecording {
  id: string;
  name: string;
  extension: typeof FOCUS_AUDIO_EXTENSIONS[number];
  createdAt: string;
}

export interface FocusAudioPreference {
  track: FocusAudioTrack | null;
  volume: number;
}

const defaultPreference: FocusAudioPreference = { track: null, volume: 45 };

const recordingMimeTypes: Record<typeof FOCUS_AUDIO_EXTENSIONS[number], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

const libraryFileName = (recording: Pick<UserAudioRecording, "id" | "extension">) => `${recording.id}.${recording.extension}`;
const libraryPath = (recording: Pick<UserAudioRecording, "id" | "extension">) => `${AUDIO_LIBRARY_DIRECTORY}/${libraryFileName(recording)}`;
const validLibraryId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validDisplayName = (value: string) => value.length > 0 && value.length <= 255 && !/[\r\n\0]/.test(value);

function validateUserAudioRecording(value: unknown): UserAudioRecording | null {
  if (!value || typeof value !== "object") return null;
  const recording = value as Record<string, unknown>;
  if (typeof recording.id !== "string" || !validLibraryId(recording.id)) return null;
  if (typeof recording.name !== "string" || !validDisplayName(recording.name)) return null;
  if (typeof recording.extension !== "string" || !FOCUS_AUDIO_EXTENSIONS.includes(recording.extension as UserAudioRecording["extension"])) return null;
  if (typeof recording.createdAt !== "string" || !Number.isFinite(Date.parse(recording.createdAt))) return null;
  return recording as unknown as UserAudioRecording;
}

function parseUserAudioManifest(value: unknown): UserAudioRecording[] {
  if (!Array.isArray(value)) throw new Error("The local audio library manifest is invalid.");
  const recordings = value.map(validateUserAudioRecording).filter((item): item is UserAudioRecording => Boolean(item));
  if (recordings.length !== value.length || recordings.length > MAX_USER_AUDIO_RECORDINGS) throw new Error("The local audio library manifest is invalid.");
  if (new Set(recordings.map((recording) => recording.id)).size !== recordings.length) throw new Error("The local audio library contains duplicate recordings.");
  return recordings;
}

async function writeUserAudioManifest(recordings: UserAudioRecording[]) {
  await mkdir(AUDIO_LIBRARY_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(AUDIO_LIBRARY_MANIFEST, JSON.stringify(recordings, null, 2), { baseDir: BaseDirectory.AppData });
}

function persistedTrack(value: unknown): FocusAudioTrack | null {
  if (!value || typeof value !== "object") return null;
  const track = value as Record<string, unknown>;
  if (typeof track.name !== "string" || track.name.length > 255 || /[\r\n\0]/.test(track.name)) return null;
  if (typeof track.libraryId === "string" && validLibraryId(track.libraryId) && typeof track.libraryPath === "string") {
    const match = new RegExp(`^${AUDIO_LIBRARY_DIRECTORY}/(${track.libraryId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\.(${FOCUS_AUDIO_EXTENSIONS.join("|")})$`, "i").exec(track.libraryPath);
    if (match) return { name: track.name, libraryId: track.libraryId, libraryPath: track.libraryPath };
  }
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

const extensionOf = (name: string) => name.split(".").pop()?.toLocaleLowerCase() ?? "";

export function isSupportedRecording(name: string) {
  return FOCUS_AUDIO_EXTENSIONS.includes(extensionOf(name) as typeof FOCUS_AUDIO_EXTENSIONS[number]);
}

export function toFocusAudioTrack(recording: UserAudioRecording): FocusAudioTrack {
  return { name: recording.name, libraryId: recording.id, libraryPath: libraryPath(recording) };
}

export async function loadUserAudioLibrary(): Promise<UserAudioRecording[]> {
  await mkdir(AUDIO_LIBRARY_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  if (!await exists(AUDIO_LIBRARY_MANIFEST, { baseDir: BaseDirectory.AppData })) return [];
  return parseUserAudioManifest(JSON.parse(await readTextFile(AUDIO_LIBRARY_MANIFEST, { baseDir: BaseDirectory.AppData })));
}

export async function importUserAudioRecording(sourcePath: string, name: string): Promise<UserAudioRecording> {
  const extension = extensionOf(name) as UserAudioRecording["extension"];
  if (!FOCUS_AUDIO_EXTENSIONS.includes(extension)) throw new Error("Choose an MP3, WAV, OGG, FLAC, M4A, or AAC recording.");
  const normalizedName = name.trim();
  if (!validDisplayName(normalizedName)) throw new Error("The recording name must be between 1 and 255 characters.");
  const source = await stat(sourcePath);
  if (!source.isFile || source.size <= 0) throw new Error("The selected recording is empty or is not a file.");
  if (source.size > MAX_USER_AUDIO_BYTES) throw new Error("Choose a recording no larger than 250 MB.");
  const recordings = await loadUserAudioLibrary();
  if (recordings.length >= MAX_USER_AUDIO_RECORDINGS) throw new Error(`The local audio library is limited to ${MAX_USER_AUDIO_RECORDINGS} recordings.`);

  const recording: UserAudioRecording = { id: crypto.randomUUID(), name: normalizedName, extension, createdAt: new Date().toISOString() };
  const destination = libraryPath(recording);
  const bytes = await readFile(sourcePath);
  await writeFile(destination, bytes, { baseDir: BaseDirectory.AppData });
  try {
    await writeUserAudioManifest([...recordings, recording]);
  } catch (error) {
    await remove(destination, { baseDir: BaseDirectory.AppData }).catch(() => undefined);
    throw error;
  }
  return recording;
}

export async function renameUserAudioRecording(id: string, name: string): Promise<UserAudioRecording[]> {
  const normalizedName = name.trim();
  if (!validDisplayName(normalizedName)) throw new Error("The recording name must be between 1 and 255 characters.");
  const recordings = await loadUserAudioLibrary();
  if (!recordings.some((recording) => recording.id === id)) throw new Error("This recording is no longer in the local library.");
  const renamed = recordings.map((recording) => recording.id === id ? { ...recording, name: normalizedName } : recording);
  await writeUserAudioManifest(renamed);
  return renamed;
}

export async function removeUserAudioRecording(recording: UserAudioRecording): Promise<UserAudioRecording[]> {
  const recordings = await loadUserAudioLibrary();
  if (!recordings.some((item) => item.id === recording.id)) return recordings;
  const remaining = recordings.filter((item) => item.id !== recording.id);
  await writeUserAudioManifest(remaining);
  try {
    const path = libraryPath(recording);
    if (await exists(path, { baseDir: BaseDirectory.AppData })) await remove(path, { baseDir: BaseDirectory.AppData });
  } catch (error) {
    await writeUserAudioManifest(recordings);
    throw error;
  }
  return remaining;
}

export async function resolveFocusAudio(track: FocusAudioTrack): Promise<{ url: string; revoke: boolean }> {
  if (track.source) {
    if (track.temporary) return { url: track.source, revoke: true };
    // WebKitGTK's media pipeline cannot consume Tauri's production custom
    // protocol directly. Fetch bundled recordings through the webview and
    // expose them to HTMLMediaElement through its supported blob protocol.
    const response = await fetch(track.source);
    if (!response.ok) throw new Error(`Bundled recording could not be loaded (${response.status}).`);
    return { url: URL.createObjectURL(await response.blob()), revoke: true };
  }
  if (track.libraryPath) {
    const extension = extensionOf(track.libraryPath) as typeof FOCUS_AUDIO_EXTENSIONS[number];
    const bytes = await readFile(track.libraryPath, { baseDir: BaseDirectory.AppData });
    const recording = new Blob([bytes], { type: recordingMimeTypes[extension] ?? "application/octet-stream" });
    return { url: URL.createObjectURL(recording), revoke: true };
  }
  if (!track.path) throw new Error("This recording is no longer available. Choose it again.");
  // HTMLMediaElement playback through Tauri's custom asset protocol is not
  // reliable on WebKitGTK (notably for MP3 files). Read a dialog-approved file
  // and give the media element a standard, correctly typed blob URL instead.
  const extension = extensionOf(track.name) as typeof FOCUS_AUDIO_EXTENSIONS[number];
  const bytes = await readFile(track.path);
  const recording = new Blob([bytes], { type: recordingMimeTypes[extension] ?? "application/octet-stream" });
  return { url: URL.createObjectURL(recording), revoke: true };
}
