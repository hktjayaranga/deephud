import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function notify(title: string, body: string, enabled: boolean) {
  if (!enabled) return;
  try {
    if (inTauri()) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } else if ("Notification" in window) {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission === "granted") new Notification(title, { body });
    }
  } catch (error) {
    console.warn("Unable to send notification", error);
  }
}

export function playChime(volume: number, tone: "work" | "break" = "work") {
  try {
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume / 100)) * 0.16, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
    gain.connect(context.destination);
    const frequencies = tone === "work" ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.16);
      oscillator.stop(context.currentTime + 0.35 + index * 0.16);
    });
    window.setTimeout(() => context.close(), 1200);
  } catch (error) {
    console.warn("Unable to play completion sound", error);
  }
}
