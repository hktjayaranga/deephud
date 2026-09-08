import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Timer from "../src/components/Timer";
import { sessionProgress } from "../src/services/sessionProgress";
import { SessionPlan } from "../src/services/session";
import { SessionRecord } from "../src/services/database";
import { TimerState } from "../src/services/timer";

const plan: SessionPlan = { kind: "pomodoro", workSessionId: "research", phase: "work", cycle: 3, workMinutes: 25, breakMinutes: 5, startedAt: "2026-09-08T10:00:00Z", project: "Research", task: "Read paper" };
const timer: TimerState = { mode: "countdown", status: "running", targetMs: 1500_000, elapsedMs: 600_000 };
const cycle = (startedAt: string, focusSeconds = 1500): SessionRecord => ({ startedAt, endedAt: "2026-09-08T10:25:00Z", focusSeconds, pausedSeconds: 600, plannedMinutes: 25, workSessionId: "research", sessionKind: "pomodoro", project: "Research", task: "Read paper", cycleCompleted: true });
const records = [cycle("2026-09-08T09:00:00Z"), cycle("2026-09-08T09:30:00Z")];

describe("whole session progress", () => {
  it("shows one hour after two 25-minute cycles plus ten focused minutes", () => {
    expect(sessionProgress(plan, timer, records)).toBe("Cycle 3 · 1h focused");
  });
  it("does not add break time or pause duration", () => {
    expect(sessionProgress({ ...plan, phase: "break", breakKind: "long" }, timer, records)).toBe("Cycle 3 · 50m focused");
    expect(sessionProgress(plan, { ...timer, status: "paused" }, records)).toBe("Cycle 3 · 1h focused");
  });
  it("does not double-count the current interval after it is saved or recovered", () => {
    const finished = { ...timer, status: "finished" as const, elapsedMs: timer.targetMs };
    expect(sessionProgress(plan, finished, records)).toBe("Cycle 3 · 1h 15m focused");
    expect(sessionProgress(plan, finished, [...records, cycle(plan.startedAt)])).toBe("Cycle 3 · 1h 15m focused");
  });
  it("uses actual recorded durations and excludes unrelated sessions with the same task", () => {
    expect(sessionProgress(plan, timer, [cycle(records[0].startedAt, 600), { ...records[1], workSessionId: "another-session" }])).toBe("Cycle 3 · 20m focused");
  });
  it("hides progress for standalone timers and avoids rounding up interval minutes", () => {
    expect(sessionProgress({ ...plan, kind: "stopwatch" }, { ...timer, mode: "stopwatch", elapsedMs: 59_900 }, [])).toBeUndefined();
    expect(sessionProgress({ ...plan, kind: "deep-work" }, timer, records)).toBeUndefined();
    expect(sessionProgress(plan, { ...timer, elapsedMs: 59_900 }, [])).toBe("Cycle 3 · 0m focused");
    expect(sessionProgress(null, timer, records)).toBeUndefined();
  });
  it("adds an accessible summary while keeping the interval countdown unchanged", () => {
    const markup = renderToStaticMarkup(createElement(Timer, { state: timer, sessionName: plan.task, sessionSummary: sessionProgress(plan, timer, records) }));
    expect(markup).toContain("Cycle 3 · 1h focused");
    expect(markup).toContain("15:00");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("aria-describedby=");
    const idle = renderToStaticMarkup(createElement(Timer, { state: timer, sessionName: "" }));
    expect(idle).not.toContain("timer__summary");
    expect(idle).not.toContain("tabindex");
  });
});
