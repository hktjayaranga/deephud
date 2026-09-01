import { describe, expect, it, vi } from "vitest";
import { calculateStats, formatDuration } from "../src/components/Dashboard";
import { SessionRecord } from "../src/services/database";

describe("productivity statistics", () => {
  it("calculates daily totals, averages, goals, and projects from sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T16:00:00"));
    const sessions: SessionRecord[] = [
      record("2026-08-31T09:00:00", 5_400, "MyDrive", "Kafka"),
      record("2026-08-31T13:00:00", 3_000, "MyDrive", "Testing"),
      record("2026-08-30T09:00:00", 1_800, "University", "Data Mining"),
    ];
    const stats = calculateStats(sessions, 240);
    expect(stats.todaySeconds).toBe(8_400);
    expect(stats.today).toHaveLength(2);
    expect(stats.longest).toBe(5_400);
    expect(stats.average).toBe(4_200);
    expect(stats.projects[0].name).toBe("MyDrive");
    expect(stats.streak).toBe(2);
    expect(formatDuration(8_400)).toBe("2h 20m");
    vi.useRealTimers();
  });
});

function record(startedAt: string, focusSeconds: number, project: string, task: string): SessionRecord {
  return { startedAt, endedAt: new Date(new Date(startedAt).getTime() + focusSeconds * 1000).toISOString(), plannedMinutes: focusSeconds / 60, focusSeconds, pausedSeconds: 0, project, task, sessionKind: "deep-work" };
}
