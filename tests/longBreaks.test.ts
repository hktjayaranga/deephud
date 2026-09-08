import { beforeEach, describe, expect, it } from "vitest";
import { SessionPlan, completeFocusCycle, nextBreak, transitionSessionPhase } from "../src/services/session";
import { defaultSettings, loadSettings, saveSettings, validateSettings } from "../src/services/settings";
import { SessionSnapshot, loadSessionSnapshot, saveSessionSnapshot, reconcileSessionSnapshot } from "../src/services/sessionRecovery";
import { SessionRecord } from "../src/services/database";

const plan = (): SessionPlan => ({ kind: "pomodoro", workSessionId: "test-session", phase: "work", workMinutes: 25, breakMinutes: 5, longBreakMinutes: 20, cyclesBeforeLongBreak: 4, completedFocusCycles: 0, cycle: 1, startedAt: "2026-09-08T09:00:00Z", project: "Research", task: "Read paper" });
let clock = 0;
const advance = (value: SessionPlan, phase: "work" | "break") => transitionSessionPhase(value, phase, new Date(Date.parse("2026-09-08T09:00:00Z") + ++clock * 1800_000).toISOString());
const checkpoint = (value: SessionPlan): SessionSnapshot => ({ version: 1, plan: value, savedAt: Date.parse("2026-09-08T12:00:00Z"), timer: { mode: "countdown", status: "running", elapsedMs: 60_000, targetMs: (value.phase === "work" ? value.workMinutes : value.activeBreakMinutes ?? value.breakMinutes) * 60_000 }, pausedMs: 0, warningShown: false });
const record = (value: SessionPlan): SessionRecord => ({ startedAt: value.startedAt, endedAt: "2026-09-08T12:00:00Z", plannedMinutes: 25, focusSeconds: 1500, pausedSeconds: 0, project: value.project, task: value.task, workSessionId: value.workSessionId, sessionKind: "pomodoro", cycleCompleted: true });

beforeEach(() => { clock = 0; localStorage.clear(); });

describe("long break scheduling", () => {
  it("schedules short, short, short, long and repeats after four more completions", () => {
    let current = plan();
    for (let completed = 1; completed <= 8; completed++) {
      current = completeFocusCycle(current);
      expect(current.completedFocusCycles).toBe(completed);
      const expected = completed % 4 === 0 ? "long" : "short";
      expect(nextBreak(current).kind).toBe(expected);
      current = advance(current, "break");
      expect(current.breakKind).toBe(expected);
      expect(current.activeBreakMinutes).toBe(expected === "long" ? 20 : 5);
      current = advance(current, "work");
    }
  });

  it("does not count skipped work, skipped breaks, or unfinished intervals", () => {
    let current = plan();
    for (let skipped = 0; skipped < 4; skipped++) {
      current = advance(advance(current, "break"), "work");
    }
    expect(current.cycle).toBe(5);
    expect(current.completedFocusCycles).toBe(0);
    expect(nextBreak(current).kind).toBe("short");
    current = completeFocusCycle(current);
    current = advance(advance(current, "break"), "work");
    expect(current.completedFocusCycles).toBe(1);
  });

  it("does not offer repeated long breaks when work is skipped after a long break", () => {
    let current = { ...plan(), completedFocusCycles: 4 };
    const long = advance(current, "break");
    expect(long.breakKind).toBe("long");
    expect(nextBreak(advance(long, "work")).kind).toBe("short");
  });

  it("counts a completed interval only once across retries", () => {
    const completed = completeFocusCycle(plan());
    expect(completeFocusCycle(completed)).toEqual(completed);
    expect(completeFocusCycle(advance(completed, "break")).completedFocusCycles).toBe(1);
    expect(completeFocusCycle({ ...plan(), kind: "deep-work" }).completedFocusCycles).toBe(0);
  });

  it("uses custom cadence and duration and keeps adjusted breaks separate from defaults", () => {
    const current = completeFocusCycle({ ...plan(), cyclesBeforeLongBreak: 1, longBreakMinutes: 35 });
    const rest = advance(current, "break");
    expect(rest.activeBreakMinutes).toBe(35);
    const next = advance({ ...rest, activeBreakMinutes: 40 }, "work");
    expect(next.longBreakMinutes).toBe(35);
    expect(next.breakMinutes).toBe(5);
    expect(nextBreak({ ...current, breakMinutes: 40 }).minutes).toBe(41);
  });
});

describe("long break persistence and recovery", () => {
  it("preserves counters and long break time through a restart", () => {
    const rest = advance({ ...plan(), completedFocusCycles: 4, lastCompletedFocusStartedAt: plan().startedAt }, "break");
    saveSessionSnapshot(checkpoint(rest));
    const restored = loadSessionSnapshot()!;
    expect(restored.plan).toMatchObject({ breakKind: "long", activeBreakMinutes: 20, completedFocusCycles: 4, longBreakAtCount: 4, cyclesBeforeLongBreak: 4 });
    expect(restored.timer.targetMs).toBe(1200_000);
    expect(nextBreak(advance(restored.plan, "work")).kind).toBe("short");
  });

  it("counts exactly once whether a crash happens before or after updating the completion counter", () => {
    const before = { ...plan(), completedFocusCycles: 3 };
    const saved = record(before);
    const recoveredBefore = reconcileSessionSnapshot(checkpoint(before), [saved])!;
    expect(nextBreak(completeFocusCycle(recoveredBefore.plan)).kind).toBe("long");
    const after = completeFocusCycle(before);
    const recoveredAfter = reconcileSessionSnapshot(checkpoint(after), [saved])!;
    expect(completeFocusCycle(recoveredAfter.plan).completedFocusCycles).toBe(4);
  });

  it("rebuilds legacy counters from completed history rather than the cycle number", () => {
    const legacy = { ...plan(), completedFocusCycles: undefined, cycle: 8 };
    const older = record({ ...legacy, startedAt: "2026-09-08T08:00:00Z" });
    const partial = { ...older, startedAt: "2026-09-08T08:30:00Z", cycleCompleted: false };
    const recovered = reconcileSessionSnapshot(checkpoint(legacy), [older, partial, record(legacy)])!;
    expect(completeFocusCycle(recovered.plan).completedFocusCycles).toBe(2);
  });

  it("adds compatible settings defaults and validates custom choices", () => {
    const legacy: Record<string, unknown> = { ...defaultSettings };
    delete legacy.longBreakMinutes; delete legacy.cyclesBeforeLongBreak;
    expect(validateSettings(legacy)).toMatchObject({ longBreakMinutes: 20, cyclesBeforeLongBreak: 4 });
    saveSettings({ ...defaultSettings, longBreakMinutes: 30, cyclesBeforeLongBreak: 3 });
    expect(loadSettings()).toMatchObject({ longBreakMinutes: 30, cyclesBeforeLongBreak: 3 });
    expect(() => validateSettings({ ...defaultSettings, cyclesBeforeLongBreak: 0 })).toThrow();
    expect(() => validateSettings({ ...defaultSettings, longBreakMinutes: 241 })).toThrow();
  });
});
