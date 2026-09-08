import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryList, calculateStats } from "../src/components/Dashboard";
import { SessionRecord, getSessions, replaceSessions } from "../src/services/database";
import { groupSessions } from "../src/services/sessionHistory";
import { validateBackup } from "../src/services/dataTransfer";
import { defaultSettings } from "../src/services/settings";

function cycle(id: number, start: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { id, startedAt: start, endedAt: new Date(Date.parse(start) + 1500_000).toISOString(), focusSeconds: 1500, plannedMinutes: 25, pausedSeconds: 0, project: "Research", task: "Read paper", sessionKind: "pomodoro", workSessionId: "work-1", cycleCompleted: true, ...overrides };
}

describe("work session history", () => {
  it("groups cycles across breaks and pauses, preserving chronological details and explicit end", () => {
    const records = [cycle(2, "2026-09-07T10:00:00Z", { workSessionEndedAt: "2026-09-07T10:40:00Z" }), cycle(1, "2026-09-07T09:00:00Z")];
    const [group] = groupSessions(records);
    expect(group.focusSeconds).toBe(3000);
    expect(group.elapsedSeconds).toBe(6000);
    expect(group.completedCycles).toBe(2);
    expect(group.cycles.map((item) => item.id)).toEqual([1, 2]);
    expect(groupSessions(records)).toHaveLength(1);
  });

  it("keeps new sessions and unidentified legacy intervals separate", () => {
    expect(groupSessions([cycle(1, "2026-09-07T09:00:00Z"), cycle(2, "2026-09-07T09:30:00Z", { workSessionId: "work-2" }), cycle(3, "2026-09-07T10:00:00Z", { workSessionId: undefined }), cycle(4, "2026-09-07T10:30:00Z", { workSessionId: null })])).toHaveLength(4);
  });

  it("separates task changes and excludes partial cycles from the completion count", () => {
    const [group] = groupSessions([cycle(1, "2026-09-07T09:00:00Z"), cycle(2, "2026-09-07T09:30:00Z", { task: "Take notes", cycleCompleted: false, focusSeconds: 600 })]);
    expect(group.tasks.map((task) => task.task)).toEqual(["Read paper", "Take notes"]);
    expect(group.completedCycles).toBe(1);
    expect(group.focusSeconds).toBe(2100);
    const markup = renderToStaticMarkup(createElement(HistoryList, { sessions: [group], onDelete: () => {} }));
    expect(markup).toContain("<details");
    expect(markup).toContain("35m focused");
    expect(markup).toContain("1 cycle completed");
    expect(markup).toContain("Take notes");
    expect(markup).toContain("Ended early");
  });

  it("counts grouped sessions while keeping daily focus totals based on intervals", () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const stats = calculateStats([cycle(1, today.toISOString()), cycle(2, new Date(today.getTime() + 1800_000).toISOString())], 120);
    expect(stats.todaySeconds).toBe(3000);
    expect(stats.todaySessionCount).toBe(1);
    expect(stats.longest).toBe(3000);
    expect(stats.average).toBe(3000);
  });

  it("preserves grouping through backup validation and database replacement", async () => {
    const records = [cycle(1, "2026-09-07T09:00:00Z", { workSessionEndedAt: "2026-09-07T10:00:00Z" }), cycle(2, "2026-09-07T09:30:00Z")];
    const backup = validateBackup({ application: "DeepHUD", schemaVersion: 1, exportedAt: "2026-09-08T00:00:00Z", settings: defaultSettings, sessions: records }, Date.parse("2026-09-08T12:00:00Z"));
    await replaceSessions(backup.sessions);
    const restored = await getSessions();
    expect(groupSessions(restored)).toHaveLength(1);
    expect(restored[0].workSessionEndedAt).toBe(records[0].workSessionEndedAt);
    expect(restored[0].cycleCompleted).toBe(true);
  });
});
