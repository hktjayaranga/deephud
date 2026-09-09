import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Monitor } from "@tauri-apps/api/window";

type SerializedMonitor = {
  name: string | null;
  size: { width: number; height: number };
  position: { x: number; y: number };
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};

/** Queries GTK on the native UI thread, then restores the API's DPI helpers. */
export async function currentHudMonitor(): Promise<Monitor | null> {
  const monitor = await invoke<SerializedMonitor | null>("hud_current_monitor");
  if (!monitor) return null;
  return {
    ...monitor,
    position: new PhysicalPosition(monitor.position),
    size: new PhysicalSize(monitor.size),
    workArea: {
      position: new PhysicalPosition(monitor.workArea.position),
      size: new PhysicalSize(monitor.workArea.size),
    },
  };
}
