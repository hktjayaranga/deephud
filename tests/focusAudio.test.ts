import { beforeEach, describe, expect, it } from "vitest";
import { FOCUS_AUDIO_PREFERENCE_KEY, RECORDED_FOCUS_PRESETS, isSupportedRecording, loadFocusAudioPreference, saveFocusAudioPreference, saveFocusAudioVolume } from "../src/services/focusAudio";

describe("focus audio recordings", () => {
  beforeEach(() => localStorage.removeItem(FOCUS_AUDIO_PREFERENCE_KEY));

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
});
