import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionRecord } from "../src/services/database";
import { calculateMonthlyInsights, insightDuration, monthKey, shiftMonth } from "../src/services/insights";
import { filterHistoryRecords } from "../src/components/Dashboard";
import { groupSessions } from "../src/services/sessionHistory";
import FocusCalendar from "../src/components/insights/FocusCalendar";
import MonthlySummary from "../src/components/insights/MonthlySummary";
import ProjectComparison from "../src/components/insights/ProjectComparison";
import HourlyFocusChart from "../src/components/insights/HourlyFocusChart";

function record(start: string, seconds = 1500, patch: Partial<SessionRecord> = {}): SessionRecord {
  return { startedAt: new Date(start).toISOString(), endedAt: new Date(new Date(start).getTime() + seconds * 1000).toISOString(), plannedMinutes: 25, focusSeconds: seconds, pausedSeconds: 0, project: "DeepHUD", task: "Implement insights", sessionKind: "pomodoro", cycleCompleted: true, ...patch };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("monthly insight aggregation", () => {
  it("includes partial focus without counting it as a completed session", () => {
    const result = calculateMonthlyInsights([
      record("2026-09-01T09:00:00", 1500),
      record("2026-09-01T10:00:00", 300, { cycleCompleted: false, project: "" }),
      record("2026-09-03T14:00:00", 1200, { cycleCompleted: false, sessionKind: "stopwatch", project: "Research" }),
      record("2026-08-31T09:00:00", 1500),
    ], "2026-09", new Date("2026-10-02T12:00:00"));
    expect(result.focusSeconds).toBe(3000);
    expect(result.completedSessions).toBe(1);
    expect(result.otherSessions).toBe(2);
    expect(result.activeDays).toBe(2);
    expect(result.days[0]).toMatchObject({ focusSeconds: 1800, completedSessions: 1, otherSessions: 1 });
    expect(result.projects).toEqual([{ name: "DeepHUD", focusSeconds: 1500 }, { name: "Research", focusSeconds: 1200 }, { name: "Unassigned", focusSeconds: 300 }]);
    expect(result.hours[14]).toMatchObject({ focusSeconds: 1200, sessions: 1 });
    expect(result.days.reduce((sum, day) => sum + day.focusSeconds, 0)).toBe(result.focusSeconds);
    expect(result.hours.reduce((sum, hour) => sum + hour.focusSeconds, 0)).toBe(result.focusSeconds);
    expect(result.projects.reduce((sum, project) => sum + project.focusSeconds, 0)).toBe(result.focusSeconds);
  });
  it("infers legacy completed countdowns and respects explicit incomplete flags", () => {
    const result = calculateMonthlyInsights([
      record("2026-09-01T09:00:00", 1500, { cycleCompleted: undefined }),
      record("2026-09-01T10:00:00", 1500, { cycleCompleted: false }),
      record("2026-09-01T11:00:00", 300, { cycleCompleted: undefined }),
      record("2026-09-01T12:00:00", 3600, { cycleCompleted: undefined, plannedMinutes: 0, sessionKind: "stopwatch" }),
    ], "2026-09", new Date("2026-09-12T12:00:00"));
    expect(result.completedSessions).toBe(1);
    expect(result.otherSessions).toBe(3);
  });
  it("uses full calendar months for historical comparisons", () => {
    const result = calculateMonthlyInsights([record("2026-08-31T09:00:00", 1200), record("2026-09-30T10:00:00", 1800), record("2026-10-01T10:00:00", 900)], "2026-09", new Date("2026-11-04T12:00:00"));
    expect(result.focusSeconds).toBe(1800);
    expect(result.comparison).toMatchObject({ ongoing: false, previousSeconds: 1200, differenceSeconds: 600, percent: 50 });
  });
  it("compares the current month through the same local day and time", () => {
    const result = calculateMonthlyInsights([
      record("2026-09-12T08:00:00", 1800), record("2026-09-12T14:00:00", 600),
      record("2026-08-12T08:00:00", 900), record("2026-08-12T14:00:00", 3600), record("2026-08-20T09:00:00", 3600),
    ], "2026-09", new Date("2026-09-12T12:30:00"));
    expect(result.focusSeconds).toBe(1800);
    expect(result.comparison.previousEnd).toEqual(new Date("2026-08-12T12:30:00"));
    expect(result.comparison.previousSeconds).toBe(900);
    expect(result.comparison.percent).toBe(100);
    expect(result.days[12].future).toBe(true);
  });
  it("clamps to the previous month's end without overflowing shorter months", () => {
    const result = calculateMonthlyInsights([record("2024-02-29T23:00:00", 900)], "2024-03", new Date("2024-03-31T10:00:00"));
    expect(result.comparison.previousEnd).toEqual(new Date("2024-03-01T00:00:00"));
    expect(result.comparison.previousSeconds).toBe(900);
    const sameDay = calculateMonthlyInsights([], "2024-03", new Date("2024-03-29T10:00:00"));
    expect(sameDay.comparison.previousEnd).toEqual(new Date("2024-02-29T10:00:00"));
  });
  it("handles empty months and zero comparison baselines without Infinity", () => {
    const empty = calculateMonthlyInsights([], "2026-09", new Date("2026-09-12T12:00:00"));
    expect(empty.comparison.percent).toBeNull();
    expect(empty.activeDays).toBe(0);
    expect(empty.days).toHaveLength(30);
    expect(empty.hours).toHaveLength(24);
    expect(empty.projects).toEqual([]);
    const first = calculateMonthlyInsights([record("2026-09-01T09:00:00")], "2026-09", new Date("2026-09-12T12:00:00"));
    expect(first.comparison.percent).toBeNull();
    expect(first.comparison.differenceSeconds).toBe(1500);
  });
  it("handles leap years, Monday calendar alignment, and year navigation", () => {
    expect(calculateMonthlyInsights([], "2024-02").days).toHaveLength(29);
    expect(calculateMonthlyInsights([], "2025-02").days).toHaveLength(28);
    expect(calculateMonthlyInsights([], "2026-09").firstWeekday).toBe(1);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(() => calculateMonthlyInsights([], "2026-13")).toThrow();
  });
  it("assigns spanning intervals to their start day and hour, not guessed work segments", () => {
    const result = calculateMonthlyInsights([record("2026-09-30T23:30:00", 3600, { endedAt: new Date("2026-10-01T01:30:00").toISOString(), pausedSeconds: 3600 })], "2026-09", new Date("2026-10-02T10:00:00"));
    expect(result.days[29].focusSeconds).toBe(3600);
    expect(result.hours[23].focusSeconds).toBe(3600);
    expect(result.hours[0].focusSeconds).toBe(0);
  });
  it("uses local month boundaries when UTC dates differ", () => {
    vi.stubEnv("TZ", "Asia/Colombo");
    expect(monthKey(new Date("2026-08-31T20:00:00Z"))).toBe("2026-09");
    const result = calculateMonthlyInsights([record("2026-08-31T20:00:00Z", 600), record("2026-09-30T20:00:00Z", 600)], "2026-09", new Date("2026-10-03T00:00:00Z"));
    expect(result.focusSeconds).toBe(600);
    expect(result.days[0].focusSeconds).toBe(600);
    expect(result.hours[1].focusSeconds).toBe(600);
  });
  it("keeps DST calendar dates and combines repeated start hours", () => {
    vi.stubEnv("TZ", "America/New_York");
    const result = calculateMonthlyInsights([record("2026-11-01T05:15:00Z", 600), record("2026-11-01T06:15:00Z", 900)], "2026-11", new Date("2026-12-01T12:00:00Z"));
    expect(result.days[0].focusSeconds).toBe(1500);
    expect(result.hours[1].focusSeconds).toBe(1500);
    expect(result.days).toHaveLength(30);
    const spring = calculateMonthlyInsights([], "2026-03", new Date("2026-03-09T16:30:00Z"));
    expect(spring.comparison.previousEnd.getHours()).toBe(12);
    expect(spring.comparison.previousEnd.getDate()).toBe(9);
  });
});

describe("calendar drill-down and accessible chart values", () => {
  it("filters intervals before grouping so other days in a work session stay out of History", () => {
    const records = [record("2026-09-01T23:00:00", 900, { workSessionId: "same" }), record("2026-09-02T01:00:00", 1200, { workSessionId: "same" })];
    const filtered = groupSessions(filterHistoryRecords(records, "", "", "2026-09-02"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].cycles).toHaveLength(1);
    expect(filtered[0].focusSeconds).toBe(1200);
  });
  it("renders numeric calendar values, complete day labels, and disabled future dates", () => {
    const insights = calculateMonthlyInsights([record("2026-09-01T09:00:00", 1500)], "2026-09", new Date("2026-09-12T12:00:00"));
    const html = renderToStaticMarkup(createElement(FocusCalendar, { insights, onSelectDay: vi.fn() }));
    expect(html).toContain("25m focused, 1 completed sessions");
    expect(html).toContain("Open History.");
    expect(html).toContain("2026-09-13: future day");
    expect(html).toContain('disabled=""');
    expect(html).toContain("25m</small>");
  });
  it("clearly labels hourly attribution and includes all 24 numeric values", () => {
    const insights = calculateMonthlyInsights([], "2026-09", new Date("2026-09-12T12:00:00"));
    const html = renderToStaticMarkup(createElement(HourlyFocusChart, { insights }));
    expect(html).toContain("Focus time by session start hour");
    expect(html.match(/role="listitem"/g)).toHaveLength(24);
    expect(html).toContain("not an exact record");
    expect(html).toContain("No saved focus time");
  });
  it("explains a zero baseline and shows Unassigned project time", () => {
    const insights = calculateMonthlyInsights([record("2026-09-01T09:00:00", 30, { project: " " })], "2026-09", new Date("2026-09-12T12:00:00"));
    expect(insightDuration(30)).toBe("30s");
    const html = renderToStaticMarkup(createElement(MonthlySummary, { insights }));
    expect(html).toContain("No previous focus time");
    expect(html).toContain("same local day and time");
    expect(html).not.toContain("Infinity");
    expect(renderToStaticMarkup(createElement(ProjectComparison, { insights }))).toContain("Unassigned");
  });
});
