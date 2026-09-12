import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { MotivationSituation, nextMotivationalMessage } from "./motivation";

const inTauri = () => "__TAURI_INTERNALS__" in window;

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
