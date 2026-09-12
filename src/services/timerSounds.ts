import durations from "./timerSoundDurations.json";

export type TimerSound = "countdown" | "work" | "break" | "preview";
export type SoundPlaybackResult = { status: "ended" | "cancelled" | "muted" } | { status: "error"; message: string };
const kinds: TimerSound[] = ["countdown", "work", "break", "preview"];
const players = new Map<TimerSound, HTMLAudioElement>();
const active = new Map<TimerSound, () => void>();
const asset = (name: string) => `/audio/timer/${name}.wav`;

function player(kind: TimerSound) {
  let audio = players.get(kind);
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.loop = false;
    players.set(kind, audio);
  }
  return audio;
}

/** Prime reusable media elements in the user's gesture for later timer alerts.
 * Alerts use the normal media output, not Web Audio's separate output context.
 */
export async function unlockAudio() {
  await Promise.all(kinds.map(async (kind) => {
    if (active.has(kind)) return;
    const audio = player(kind);
    // Don't interrupt an already primed or used player on another gesture.
    if (audio.src) return;
    audio.src = asset("silence");
    audio.volume = 0;
    try {
      await audio.play();
      if (!active.has(kind)) audio.pause();
    } catch {
      // A preview or timer start retries playback and reports its own error.
    }
  }));
}

export function stopTimerSounds(kind?: TimerSound) {
  for (const key of kind ? [kind] : kinds) active.get(key)?.();
}

/** Kept explicit so late callbacks skip elapsed ticks instead of replaying them. */
export function countdownOffsets(remainingMs: number): number[] {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return [];
  return [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    .map((second) => remainingMs / 1000 - second)
    .filter((offset) => offset >= 0);
}

function play(
  kind: TimerSound,
  volume: number,
  clip: string,
  duration: number,
  onPlaying?: () => void,
  remainingMs?: number,
): Promise<SoundPlaybackResult> {
  stopTimerSounds(kind);
  const level = Math.max(0, Math.min(100, volume)) / 100;
  if (!Number.isFinite(level) || level === 0) return Promise.resolve({ status: "muted" });
  if (remainingMs !== undefined && (!Number.isFinite(remainingMs) || remainingMs <= 0)) return Promise.resolve({ status: "cancelled" });
  // Use a wall-clock deadline so a late callback after sleep cannot replay old ticks.
  const deadline = remainingMs === undefined ? undefined : Date.now() + remainingMs;
  return new Promise((resolve) => {
    let audio: HTMLAudioElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let started = false;
    const finish = (result: SoundPlaybackResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      if (active.get(kind) === cancel) active.delete(kind);
      if (audio) {
        audio.removeEventListener("loadedmetadata", alignCountdown);
        audio.removeEventListener("playing", playing);
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("error", failed);
        audio.pause();
      }
      resolve(result);
    };
    const cancel = () => finish({ status: "cancelled" });
    const failed = () => finish({ status: "error", message: "DeepHUD could not play the sound. Try the preview again or restart DeepHUD." });
    const ended = () => finish({ status: "ended" });
    const alignCountdown = () => {
      if (!audio || deadline === undefined || settled) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { cancel(); return; }
      try { audio.currentTime = Math.max(0, duration - remaining / 1000); }
      catch { failed(); }
    };
    const playing = () => {
      if (settled || started) return;
      started = true;
      clearTimeout(watchdog);
      if (deadline !== undefined) {
        alignCountdown();
        if (settled) return;
      }
      onPlaying?.();
      watchdog = setTimeout(() => finish({ status: "error", message: "Sound playback stalled. Try the preview again." }), (deadline === undefined ? duration * 1000 : Math.max(0, deadline - Date.now())) + 5000);
    };
    const begin = () => {
      if (settled) return;
      if (deadline !== undefined && deadline <= Date.now()) { cancel(); return; }
      try {
        audio = player(kind);
        audio.pause();
        audio.volume = level;
        audio.muted = false;
        audio.addEventListener("loadedmetadata", alignCountdown);
        audio.addEventListener("playing", playing);
        audio.addEventListener("ended", ended);
        audio.addEventListener("error", failed);
        // Reload the file to rebuild the media pipeline using the current output.
        audio.src = asset(clip);
        audio.load();
        watchdog = setTimeout(() => finish({ status: "error", message: "Sound playback did not start. Try the preview again." }), 5000);
        void audio.play().catch((error: unknown) => {
          if (settled) return;
          const name = error instanceof Error ? error.name : "";
          finish({ status: "error", message: name === "NotAllowedError" ? "Sound playback was blocked. Click a preview to enable audio." : "DeepHUD could not start sound playback. Try again or restart DeepHUD." });
        });
      } catch { failed(); }
    };
    active.set(kind, cancel);
    const wait = remainingMs === undefined ? 0 : Math.max(0, remainingMs - duration * 1000);
    if (wait > 0) timer = setTimeout(begin, wait);
    else begin(); // Keep preview playback inside its click gesture.
  });
}

export function scheduleCountdown(volume: number, remainingMs: number) {
  // The ten ticks are one continuous media clip: background rendering cannot
  // interrupt the one-second spacing, and late starts seek to the current second.
  return play("countdown", volume, "countdown", 10, undefined, remainingMs);
}

export function playChime(volume: number, tone: "work" | "break" = "work") {
  return play(tone, volume, tone, durations[tone]);
}

export function previewTimerSound(volume: number, tone: "tick" | "work" | "break", onPlaying?: () => void) {
  return play("preview", volume, tone === "tick" ? "preview" : tone, tone === "tick" ? durations.preview : durations[tone], onPlaying);
}
