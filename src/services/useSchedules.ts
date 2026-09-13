import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { deleteSchedule, FocusSchedule, getScheduleData, saveSchedule, ScheduleData } from "./schedules";

export function useSchedules(onOpen: () => void) {
  const [data, setData] = useState<ScheduleData>({ schedules: [], occurrences: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const openRef = useRef(onOpen); openRef.current = onOpen;
  const generation = useRef(0);
  const notified = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const next = await getScheduleData();
    if (version === generation.current) { setData(next); setReady(true); setError(""); }
    return next;
  }, []);
  useEffect(() => {
    let stopped = false;
    const update = () => { void refresh().then(next => {
      if (stopped || "__TAURI_INTERNALS__" in window || !("Notification" in window) || Notification.permission !== "granted") return;
      for (const o of next.occurrences.filter(o => o.status === "pending")) {
        if (notified.current.has(o.id)) continue;
        notified.current.add(o.id);
        const n = new Notification(`Time for ${o.schedule.title}`, { body: `${o.schedule.workMinutes} minutes · Open DeepHUD to start or dismiss`, tag: o.id });
        n.onclick = () => { window.focus(); openRef.current(); n.close(); };
      }
    }).catch(e => { if (!stopped) setError(String(e)); }); };
    update();
    const timer = window.setInterval(update, 10_000);
    window.addEventListener("focus", update);
    const listeners = "__TAURI_INTERNALS__" in window ? [
      listen("schedule-reminders-changed", update),
      listen("schedule-open", () => { update(); openRef.current(); }),
      listen<string>("schedule-notification-error", e => setNotificationError(`System notification unavailable: ${e.payload}. Reminders remain available in DeepHUD.`)),
      listen<string>("schedule-storage-error", e => setError(e.payload)),
    ].map(p => p.catch(e => { if (!stopped) setError(String(e)); return () => {}; })) : [];
    return () => { stopped = true; generation.current++; window.clearInterval(timer); window.removeEventListener("focus", update); listeners.forEach(p => { void p.then(unlisten => unlisten()).catch(() => {}); }); };
  }, [refresh]);
  return { data, ready, error, notificationError, refresh,
    save: async (s: FocusSchedule) => {
      if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && "Notification" in window && Notification.permission === "default") {
        try { if (await Notification.requestPermission() !== "granted") setNotificationError("System notifications are blocked. Reminders remain available inside DeepHUD."); } catch { setNotificationError("System notifications are unavailable. Reminders remain available inside DeepHUD."); }
      }
      await saveSchedule(s); await refresh();
    },
    remove: async (id: string) => { await deleteSchedule(id); await refresh(); },
  };
}
