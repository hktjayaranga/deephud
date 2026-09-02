import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_AUDIO_PREFERENCE_KEY, RECORDED_FOCUS_PRESETS, isSupportedRecording, loadFocusAudioPreference, resolveFocusAudio, saveFocusAudioPreference, saveFocusAudioVolume } from "../src/services/focusAudio";

describe("focus audio recordings", () => {
  beforeEach(() => localStorage.removeItem(FOCUS_AUDIO_PREFERENCE_KEY));
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
});
