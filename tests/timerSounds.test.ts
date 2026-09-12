import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let sounds: typeof import("../src/services/timerSounds");
let countdownOffsets: typeof sounds.countdownOffsets;
let playChime: typeof sounds.playChime;
let previewTimerSound: typeof sounds.previewTimerSound;
let scheduleCountdown: typeof sounds.scheduleCountdown;
let stopTimerSounds: typeof sounds.stopTimerSounds;
let unlockAudio: typeof sounds.unlockAudio;

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = "";
  preload = "";
  loop = false;
  volume = 1;
  muted = false;
  currentTime = 0;
  pause = vi.fn();
  load = vi.fn(() => { this.currentTime = 0; });
  play = vi.fn(() => Promise.resolve());
  constructor() { super(); FakeAudio.instances.push(this); }
  emit(name: string) { this.dispatchEvent(new Event(name)); }
}
vi.stubGlobal("Audio", FakeAudio);
const clip = (name: string) => FakeAudio.instances.find((audio) => audio.src.endsWith(`/${name}.wav`))!;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  vi.resetModules();
  FakeAudio.instances = [];
  sounds = await import("../src/services/timerSounds");
  ({ countdownOffsets, playChime, previewTimerSound, scheduleCountdown, stopTimerSounds, unlockAudio } = sounds);
  // Initialize reusable players independently for every test.
  const preview = previewTimerSound(55, "tick");
  const countdown = scheduleCountdown(55, 10_000);
  stopTimerSounds();
  await Promise.all([preview, countdown]);
  for (const audio of FakeAudio.instances) {
    audio.play.mockClear();
    audio.pause.mockClear();
    audio.load.mockClear();
  }
});
afterEach(() => {
  stopTimerSounds();
  for (const audio of FakeAudio.instances) {
    audio.play.mockReset().mockResolvedValue(undefined);
    audio.load.mockClear();
    audio.pause.mockClear();
  }
  vi.useRealTimers();
});

describe("timer sound media playback", () => {
  it("waits for real playing and ended events in a preview", async () => {
    const onPlaying = vi.fn();
    let settled = false;
    const pending = previewTimerSound(55, "tick", onPlaying).then((result) => { settled = true; return result; });
    const audio = clip("preview");
    expect(audio.volume).toBe(.55);
    expect(audio.play).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(onPlaying).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    audio.emit("playing");
    expect(onPlaying).toHaveBeenCalledOnce();
    audio.emit("ended");
    expect(await pending).toEqual({ status: "ended" });
  });
  it("reloads the media pipeline for each preview after connecting a device", async () => {
    const first = previewTimerSound(55, "work");
    const audio = clip("work");
    audio.emit("ended");
    await first;
    const second = previewTimerSound(55, "work");
    expect(audio.load).toHaveBeenCalledTimes(2);
    audio.emit("ended");
    await second;
  });
  it("schedules one continuous clip at the last ten seconds", async () => {
    const pending = scheduleCountdown(55, 60_000);
    await vi.advanceTimersByTimeAsync(49_999);
    expect(FakeAudio.instances.filter((audio) => audio.src.endsWith('/countdown.wav') && audio.play.mock.calls.length)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const audio = clip("countdown");
    audio.emit("loadedmetadata");
    expect(audio.currentTime).toBe(0);
    audio.emit("playing");
    audio.emit("ended");
    expect(await pending).toEqual({ status: "ended" });
  });
  it("seeks past elapsed ticks when loading is delayed", async () => {
    const pending = scheduleCountdown(55, 3400);
    const audio = clip("countdown");
    await vi.advanceTimersByTimeAsync(200);
    audio.emit("loadedmetadata");
    expect(audio.currentTime).toBeCloseTo(6.8);
    audio.emit("playing");
    stopTimerSounds("countdown");
    expect(await pending).toEqual({ status: "cancelled" });
  });
  it("does not replay an expired countdown after sleep", async () => {
    const pending = scheduleCountdown(55, 60_000);
    vi.setSystemTime(200_000);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await pending).toEqual({ status: "cancelled" });
    expect(clip("countdown").play).not.toHaveBeenCalled();
  });
  it("cancels pending countdowns immediately on pause/reset", async () => {
    const pending = scheduleCountdown(55, 60_000);
    stopTimerSounds();
    expect(await pending).toEqual({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clip("countdown").play).not.toHaveBeenCalled();
  });
  it("keeps a running countdown intact during previews", async () => {
    const pending = scheduleCountdown(55, 10_000);
    const audio = clip("countdown");
    const pauses = audio.pause.mock.calls.length;
    const preview = previewTimerSound(55, "tick");
    stopTimerSounds("preview");
    expect(await preview).toEqual({ status: "cancelled" });
    expect(audio.pause.mock.calls.length).toBe(pauses);
    audio.emit("ended");
    await pending;
  });
  it("reports rejected playback and media errors", async () => {
    clip("preview").play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    expect(await previewTimerSound(55, "tick")).toMatchObject({ status: "error", message: expect.stringContaining("blocked") });
    const pending = previewTimerSound(55, "tick");
    clip("preview").emit("error");
    expect(await pending).toMatchObject({ status: "error" });
  });
  it("times out stalled startup without claiming playback finished", async () => {
    clip("preview").play.mockImplementationOnce(() => new Promise(() => {}));
    const pending = previewTimerSound(55, "tick");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ status: "error", message: expect.stringContaining("did not start") });
  });
  it("ignores a stale play rejection after the next preview starts", async () => {
    let reject!: (error: Error) => void;
    clip("preview").play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const first = previewTimerSound(55, "tick");
    const next = previewTimerSound(55, "work");
    reject(new Error("Old source aborted"));
    expect(await first).toEqual({ status: "cancelled" });
    clip("work").emit("ended");
    expect(await next).toEqual({ status: "ended" });
  });
  it("allows the full desktop alarm to finish", async () => {
    let settled = false;
    const pending = previewTimerSound(55, "break").then((result) => { settled = true; return result; });
    const audio = clip("break");
    audio.emit("playing");
    await vi.advanceTimersByTimeAsync(6100);
    expect(settled).toBe(false);
    audio.emit("ended");
    expect(await pending).toEqual({ status: "ended" });
  });
  it("keeps zero volume silent", async () => {
    expect(await playChime(0)).toEqual({ status: "muted" });
    expect(await scheduleCountdown(0, 5000)).toEqual({ status: "muted" });
    expect(FakeAudio.instances.every((audio) => !audio.play.mock.calls.length)).toBe(true);
  });
  it("does not prime over an active countdown", async () => {
    const pending = scheduleCountdown(55, 10_000);
    const audio = clip("countdown");
    await unlockAudio();
    expect(audio.volume).toBe(.55);
    expect(audio.src).toContain("countdown.wav");
    audio.emit("ended");
    await pending;
  });
  it("skips past countdown seconds", () => {
    expect(countdownOffsets(60_000)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(countdownOffsets(0)).toEqual([]);
  });
});
