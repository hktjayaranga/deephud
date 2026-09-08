import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => native);

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("motivational message rotation", () => {
  it("uses each message once per round and avoids repeats at the boundary", async () => {
    const { nextMotivationalMessage, motivationalMessages } = await import("../src/services/motivation");
    for (const situation of ["start", "complete", "goal"] as const) {
      const count = motivationalMessages[situation].length;
      const firstRound = Array.from({ length: count }, () => nextMotivationalMessage(situation));
      expect(new Set(firstRound).size).toBe(count);
      const secondRound = Array.from({ length: count }, () => nextMotivationalMessage(situation));
      expect(secondRound[0]).not.toBe(firstRound[count - 1]);
      expect(new Set(secondRound).size).toBe(count);
    }
  });

  it("remembers used messages after a module reload", async () => {
    const first = await import("../src/services/motivation");
    const seen = Array.from({ length: 5 }, () => first.nextMotivationalMessage("start"));
    vi.resetModules();
    const reloaded = await import("../src/services/motivation");
    for (let i = 0; i < reloaded.motivationalMessages.start.length - 5; i++) {
      expect(seen).not.toContain(reloaded.nextMotivationalMessage("start"));
    }
  });

  it("recovers from malformed storage", async () => {
    localStorage.setItem("deephud:motivation:v1:start", "{invalid");
    const { nextMotivationalMessage, motivationalMessages } = await import("../src/services/motivation");
    expect(motivationalMessages.start).toContain(nextMotivationalMessage("start"));
  });

  it("keeps rotating in memory when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    const { nextMotivationalMessage, motivationalMessages } = await import("../src/services/motivation");
    const messages = Array.from({ length: motivationalMessages.start.length }, () => nextMotivationalMessage("start"));
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("motivational notifications", () => {
  it("keeps the title and time details and adds encouragement only when requested", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    native.isPermissionGranted.mockResolvedValue(true);
    const { notify } = await import("../src/services/notifications");
    await notify("Focus cycle completed", "25 minutes focused.", true, "complete");
    expect(native.sendNotification).toHaveBeenCalledWith({ title: "Focus cycle completed", body: expect.stringMatching(/^25 minutes focused\. .+/) });
    await notify("Timer paused", "Your focus session is waiting for you.", true);
    expect(native.sendNotification).toHaveBeenLastCalledWith({ title: "Timer paused", body: "Your focus session is waiting for you." });
  });

  it("does not consume messages when notifications are disabled or permission is denied", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    native.isPermissionGranted.mockResolvedValue(false);
    native.requestPermission.mockResolvedValue("denied");
    const { notify } = await import("../src/services/notifications");
    await notify("Start", "Focus now.", false, "start");
    await notify("Start", "Focus now.", true, "start");
    expect(native.sendNotification).not.toHaveBeenCalled();
    expect(localStorage.getItem("deephud:motivation:v1:start")).toBeNull();
  });
});
