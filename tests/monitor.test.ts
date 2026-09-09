import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { currentHudMonitor } from "../src/services/monitor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("UI-thread monitor query", () => {
  it("preserves work-area offsets and DPI conversions used by resize and snapping", async () => {
    vi.mocked(invoke).mockResolvedValue({ name: "External", scaleFactor: 2, position: { x: -2560, y: 0 }, size: { width: 2560, height: 1440 }, workArea: { position: { x: -2560, y: 48 }, size: { width: 2560, height: 1392 } } });
    const monitor = (await currentHudMonitor())!;
    expect(invoke).toHaveBeenCalledWith("hud_current_monitor");
    expect(monitor.workArea.position.toLogical(monitor.scaleFactor)).toMatchObject({ x: -1280, y: 24 });
    expect(monitor.workArea.size.toLogical(monitor.scaleFactor)).toMatchObject({ width: 1280, height: 696 });
    expect(monitor.size.toLogical(2)).toMatchObject({ width: 1280, height: 720 });
  });
  it("handles unavailable monitors and propagates native errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Window unavailable"));
    expect(await currentHudMonitor()).toBeNull();
    await expect(currentHudMonitor()).rejects.toThrow("Window unavailable");
  });
});
