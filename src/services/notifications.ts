import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { MotivationSituation, nextMotivationalMessage } from "./motivation";

const inTauri = () => "__TAURI_INTERNALS__" in window;

let audioContext: AudioContext | null = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

export async function unlockAudio() {
  const context = getAudioContext();
  if (context.state === "suspended") await context.resume();
}

export async function notify(title: string, body: string, enabled: boolean, motivation?: MotivationSituation) {
  if (!enabled) return;
  const notificationBody = () => motivation ? `${body} ${nextMotivationalMessage(motivation)}` : body;
  try {
    if (inTauri()) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body: notificationBody() });
    } else if ("Notification" in window) {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission === "granted") new Notification(title, { body: notificationBody() });
    }
  } catch (error) {
    console.warn("Unable to send notification", error);
  }
}

export async function playChime(volume: number, tone: "work" | "break" = "work") {
  const level = Math.max(0, Math.min(1, volume / 100)) * 0.16;
  if (level === 0) return;

  try {
    const context = getAudioContext();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") {
      console.warn("Completion sound is blocked until the user interacts with the app.");
      return;
    }

    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    gain.connect(context.destination);
    const frequencies = tone === "work" ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      oscillator.connect(gain);
      oscillator.start(now + index * 0.16);
      oscillator.stop(now + 0.35 + index * 0.16);
    });
  } catch (error) {
    console.warn("Unable to play completion sound", error);
  }
}
