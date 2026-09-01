import { describe, expect, it } from "vitest";
import { sessionsToCsv, validateBackup } from "../src/services/dataTransfer";
import { SessionRecord } from "../src/services/database";
import { defaultSettings } from "../src/services/settings";

const session: SessionRecord = {
  startedAt: "2026-08-31T09:00:00.000Z",
  endedAt: "2026-08-31T09:25:00.000Z",
  plannedMinutes: 25,
  focusSeconds: 1500,
  pausedSeconds: 0,
  project: "DeepHUD",
  task: "Security tests",
  sessionKind: "pomodoro",
};

const backup = (overrides: Record<string, unknown> = {}) => ({
  application: "DeepHUD",
  schemaVersion: 1,
  exportedAt: "2026-08-31T10:00:00.000Z",
  settings: defaultSettings,
  sessions: [session],
  ...overrides,
});

describe("CSV export hardening", () => {
  it.each(["=WEBSERVICE(\"https://example.test\")", "+cmd", "-2+3", "@SUM(A1)", "   =1+1", "\tformula", "\rformula"])("neutralizes formula-like text: %j", (task) => {
    const csv = sessionsToCsv([{ ...session, task }]);
    expect(csv.split("\n")[1]).toContain("'");
    expect(csv).not.toContain(`,${task},`);
  });
});

describe("backup validation", () => {
  it("accepts and normalizes a valid legacy backup", () => {
    const restored = validateBackup(backup({ application: "DeepWork HUD" }), Date.parse("2026-09-01T00:00:00.000Z"));
    expect(restored.application).toBe("DeepHUD");
    expect(restored.sessions).toEqual([session]);
  });

  it("rejects malformed settings", () => {
    expect(() => validateBackup(backup({ settings: { ...defaultSettings, opacity: 1000 } }), Date.parse("2026-09-01T00:00:00.000Z"))).toThrow(/opacity/);
  });

  it("rejects invalid session bounds and date ranges", () => {
    expect(() => validateBackup(backup({ sessions: [{ ...session, task: "x".repeat(501) }] }), Date.parse("2026-09-01T00:00:00.000Z"))).toThrow(/task/);
    expect(() => validateBackup(backup({ sessions: [{ ...session, endedAt: "2026-08-30T09:00:00.000Z" }] }), Date.parse("2026-09-01T00:00:00.000Z"))).toThrow(/before/);
    expect(() => validateBackup(backup({ sessions: [{ ...session, focusSeconds: -1 }] }), Date.parse("2026-09-01T00:00:00.000Z"))).toThrow(/focusSeconds/);
  });
});
