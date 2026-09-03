import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, readTextFile, remove, stat, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FOCUS_AUDIO_PREFERENCE_KEY, RECORDED_FOCUS_PRESETS, importUserAudioRecording, isSupportedRecording, loadFocusAudioPreference, removeUserAudioRecording, renameUserAudioRecording, resolveFocusAudio, saveFocusAudioPreference, saveFocusAudioVolume, toFocusAudioTrack } from "../src/services/focusAudio";

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("focus audio recordings", () => {
  beforeEach(() => {
    localStorage.removeItem(FOCUS_AUDIO_PREFERENCE_KEY);
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue();
    vi.mocked(remove).mockResolvedValue();
    vi.mocked(writeFile).mockResolvedValue();
    vi.mocked(writeTextFile).mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts the supported local recording formats case-insensitively", () => {
    expect(isSupportedRecording("rain.WAV")).toBe(true);
    expect(isSupportedRecording("cafe ambience.mp3")).toBe(true);
    expect(isSupportedRecording("forest.flac")).toBe(true);
  });

  it("rejects files that are not audio recordings", () => {
    expect(isSupportedRecording("notes.txt")).toBe(false);
    expect(isSupportedRecording("track.mp3.exe")).toBe(false);
  });

  it("defaults to silence and remembers a recorded preset and volume", () => {
    expect(loadFocusAudioPreference()).toEqual({ track: null, volume: 45 });
    saveFocusAudioPreference({ track: RECORDED_FOCUS_PRESETS[1], volume: 38, pauseWithTimer: true });
    expect(loadFocusAudioPreference()).toEqual({ track: RECORDED_FOCUS_PRESETS[1], volume: 38 });
    saveFocusAudioVolume(61);
    expect(loadFocusAudioPreference()).toEqual({ track: RECORDED_FOCUS_PRESETS[1], volume: 61 });
  });

  it("does not persist temporary browser object URLs", () => {
    saveFocusAudioPreference({ track: { name: "local.wav", source: "blob:temporary", temporary: true }, volume: 50, pauseWithTimer: true });
    expect(loadFocusAudioPreference()).toEqual({ track: null, volume: 50 });
  });

  it("keeps the preference independent of the focus-session type", () => {
    saveFocusAudioPreference({ track: RECORDED_FOCUS_PRESETS[0], volume: 42, pauseWithTimer: true });
    const deepWorkPreference = loadFocusAudioPreference();
    const intervalPreference = loadFocusAudioPreference();
    const standaloneTimerPreference = loadFocusAudioPreference();
    expect(intervalPreference).toEqual(deepWorkPreference);
    expect(standaloneTimerPreference).toEqual(deepWorkPreference);
  });

  it("converts bundled recordings to blob URLs for packaged WebKit playback", async () => {
    const recording = new Blob(["recording"], { type: "audio/ogg" });
    const fetchRecording = vi.fn().mockResolvedValue(new Response(recording, { status: 200 }));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bundled-recording");
    vi.stubGlobal("fetch", fetchRecording);

    await expect(resolveFocusAudio(RECORDED_FOCUS_PRESETS[0])).resolves.toEqual({
      url: "blob:bundled-recording",
      revoke: true,
    });
    expect(fetchRecording).toHaveBeenCalledWith("/audio/rain.ogg");
    expect(createObjectURL).toHaveBeenCalledWith(recording);
  });

  it("keeps browser-selected object URLs without fetching them", async () => {
    const fetchRecording = vi.fn();
    vi.stubGlobal("fetch", fetchRecording);

    await expect(resolveFocusAudio({ name: "local.ogg", source: "blob:local-recording", temporary: true })).resolves.toEqual({
      url: "blob:local-recording",
      revoke: true,
    });
    expect(fetchRecording).not.toHaveBeenCalled();
  });

  it("loads a desktop-selected MP3 as a typed blob instead of an asset URL", async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    vi.mocked(readFile).mockResolvedValue(bytes);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-mp3");

    await expect(resolveFocusAudio({ name: "Focus Mix.MP3", path: "/music/Focus Mix.MP3" })).resolves.toEqual({
      url: "blob:local-mp3",
      revoke: true,
    });
    expect(readFile).toHaveBeenCalledWith("/music/Focus Mix.MP3");
    expect(createObjectURL).toHaveBeenCalledOnce();
    const recording = createObjectURL.mock.calls[0][0] as Blob;
    expect(recording.type).toBe("audio/mpeg");
    await expect(recording.arrayBuffer()).resolves.toEqual(bytes.buffer);
  });

  it("copies an imported recording into app data and records it in the local manifest", async () => {
    const id = "12345678-1234-4234-9234-123456789abc";
    const bytes = new Uint8Array([0x49, 0x44, 0x33]);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: bytes.byteLength });
    vi.mocked(exists).mockResolvedValue(false);
    vi.mocked(readFile).mockResolvedValue(bytes);

    const recording = await importUserAudioRecording("/music/focus.MP3", "focus.MP3");

    expect(recording).toMatchObject({ id, name: "focus.MP3", extension: "mp3" });
    expect(writeFile).toHaveBeenCalledWith(`focus-audio/${id}.mp3`, bytes, { baseDir: BaseDirectory.AppData });
    expect(writeTextFile).toHaveBeenCalledWith(
      "focus-audio/library.json",
      expect.stringContaining(`"id": "${id}"`),
      { baseDir: BaseDirectory.AppData },
    );
    const track = toFocusAudioTrack(recording);
    expect(track).toEqual({ name: "focus.MP3", libraryId: id, libraryPath: `focus-audio/${id}.mp3` });
    saveFocusAudioPreference({ track, volume: 52, pauseWithTimer: true });
    expect(loadFocusAudioPreference()).toEqual({ track, volume: 52 });
  });

  it("plays a saved library recording from app data through a typed blob URL", async () => {
    const id = "12345678-1234-4234-9234-123456789abc";
    const bytes = new Uint8Array([0x49, 0x44, 0x33]);
    vi.mocked(readFile).mockResolvedValue(bytes);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved-mp3");

    await expect(resolveFocusAudio({ name: "Focus", libraryId: id, libraryPath: `focus-audio/${id}.mp3` })).resolves.toEqual({
      url: "blob:saved-mp3",
      revoke: true,
    });
    expect(readFile).toHaveBeenCalledWith(`focus-audio/${id}.mp3`, { baseDir: BaseDirectory.AppData });
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("audio/mpeg");
  });

  it("renames and removes only user-library metadata and files", async () => {
    const recording = { id: "12345678-1234-4234-9234-123456789abc", name: "Old name", extension: "mp3" as const, createdAt: "2026-09-03T00:00:00.000Z" };
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify([recording]));

    const renamed = await renameUserAudioRecording(recording.id, "New name");
    expect(renamed[0].name).toBe("New name");
    expect(remove).not.toHaveBeenCalled();

    const remaining = await removeUserAudioRecording(recording);
    expect(remaining).toEqual([]);
    expect(remove).toHaveBeenCalledWith(`focus-audio/${recording.id}.mp3`, { baseDir: BaseDirectory.AppData });
  });
});
