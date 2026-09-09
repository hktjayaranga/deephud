import { describe, expect, it } from "vitest";
import { BreakActivityChoice, breakActivityState, breathingElapsed, breathingProgress, breathingRunProgress, parseBreathingCycles } from "../src/services/breakActivities";
import { SessionPlan, transitionSessionPhase } from "../src/services/session";
import { TimerState } from "../src/services/timer";

const plan: SessionPlan = { kind: "pomodoro", workSessionId: "session", phase: "break", startedAt: "2026-09-09T10:00:00Z", cycle: 1, workMinutes: 25, breakMinutes: 5, task: "Task", project: "Project" };
const timer: TimerState = { mode: "countdown", status: "running", elapsedMs: 0, targetMs: 300_000 };
const choice = (activity: "none" | "breathing"): BreakActivityChoice => ({ breakKey: breakActivityState(plan, timer, null).key!, activity, startedMs: 5000 });

describe("optional break activities", () => {
  it("offers a chooser for short and long breaks, including a recovered running break", () => {
    for (const breakKind of ["short", "long"] as const) {
      expect(breakActivityState({ ...plan, breakKind }, { ...timer, elapsedMs: 42_000 }, null)).toMatchObject({ visible: true, choice: null });
    }
  });
  it("keeps normal breaks dismissed through ticks, pauses, resumes and time adjustments", () => {
    for (const status of ["running", "paused"] as const) {
      expect(breakActivityState(plan, { ...timer, status, elapsedMs: 40_000, targetMs: 600_000 }, choice("none"))).toMatchObject({ visible: false });
    }
  });
  it("keeps a selected activity through pause and does not change timer or session data", () => {
    const frozenPlan = Object.freeze({ ...plan });
    const frozenTimer = Object.freeze({ ...timer, status: "paused" as const, elapsedMs: 6000 });
    expect(breakActivityState(frozenPlan, frozenTimer, choice("breathing"))).toMatchObject({ visible: true, choice: { activity: "breathing", startedMs: 5000 } });
    expect(frozenTimer).toEqual({ ...timer, status: "paused", elapsedMs: 6000 });
    expect(frozenPlan).toEqual(plan);
  });
  it("closes on completion, cancellation and work phases", () => {
    for (const selected of [null, choice("breathing"), choice("none")]) {
      expect(breakActivityState(plan, { ...timer, status: "finished" }, selected).visible).toBe(false);
      expect(breakActivityState(null, timer, selected).visible).toBe(false);
      expect(breakActivityState({ ...plan, phase: "work" }, timer, selected).visible).toBe(false);
      expect(breakActivityState(plan, { ...timer, status: "idle" }, selected).visible).toBe(false);
    }
  });
  it("offers a fresh choice on the next break after either selection", () => {
    const work = transitionSessionPhase(plan, "work", "2026-09-09T10:05:00Z");
    const next = transitionSessionPhase(work, "break", "2026-09-09T10:30:00Z");
    for (const selected of [choice("breathing"), choice("none")]) {
      expect(breakActivityState(next, timer, selected)).toMatchObject({ visible: true, choice: null });
    }
  });
});

describe("breathing clock", () => {
  it("counts 4 to 1 on each edge and never displays zero", () => {
    for (let stage = 0; stage < 4; stage++) {
      for (let second = 0; second < 4; second++) {
        for (const offset of [0, 999]) expect(breathingProgress(stage * 4000 + second * 1000 + offset)).toMatchObject({ stage, count: 4 - second });
      }
    }
    expect([0, 4000, 8000, 12000, 16000].map(ms => breathingProgress(ms).label)).toEqual(["Inhale", "Hold", "Exhale", "Hold", "Inhale"]);
    expect(breathingProgress(16000)).toEqual(breathingProgress(0));
    expect(breathingProgress(36000)).toEqual(breathingProgress(4000));
  });
  it("starts at inhale 4 when selected partway into the break", () => {
    expect(breathingProgress(breathingElapsed({ ...timer, elapsedMs: 5500 }, 5500))).toMatchObject({ count: 4, stage: 0, progress: 0 });
  });
  it("freezes while paused and resumes from the same elapsed time", () => {
    const paused = { ...timer, status: "paused" as const, elapsedMs: 7500 };
    expect(breathingElapsed(paused, 5000, 60_000)).toBe(2500);
    expect(breathingElapsed({ ...paused, status: "running" }, 5000, 100)).toBe(2600);
  });
  it("bounds interpolation after throttling and never exceeds the break duration", () => {
    expect(breathingElapsed(timer, 0, 60_000)).toBe(200);
    expect(breathingElapsed({ ...timer, elapsedMs: 299_950 }, 0, 100)).toBe(300_000);
    expect(breathingElapsed({ ...timer, status: "finished", elapsedMs: 300_000 }, 0, 100)).toBe(300_000);
    expect(breathingElapsed(timer, 5000)).toBe(0);
  });
});

describe("limited breathing sessions", () => {
  it("validates custom cycle counts", () => {
    for (const input of ["", "0", "-1", "2.5", "abc", "Infinity", "1000", "1e2"]) expect(parseBreathingCycles(input)).toBeNull();
    expect(parseBreathingCycles("1")).toBe(1);
    expect(parseBreathingCycles("999")).toBe(999);
  });
  it("completes presets precisely after their last hold", () => {
    for (const cycles of [3, 5, 10]) {
      const end = cycles * 16000;
      expect(breathingRunProgress(end - 1, cycles)).toMatchObject({ complete: false, cycle: cycles });
      expect(breathingRunProgress(end, cycles)).toMatchObject({ complete: true, cycle: cycles });
      expect(breathingProgress(breathingRunProgress(end + 200, cycles).animationMs)).toMatchObject({ stage: 3, count: 1 });
    }
  });
  it("advances cycle numbers and leaves unlimited sessions running", () => {
    expect(breathingRunProgress(15999, 5).cycle).toBe(1);
    expect(breathingRunProgress(16000, 5).cycle).toBe(2);
    expect(breathingRunProgress(160000, null)).toMatchObject({ complete: false, cycle: 11 });
  });
  it("returns directly to the normal timer at the selected cycle limit", () => {
    const selected = { ...choice("breathing"), cycles: 3 };
    const end = selected.startedMs + 48000;
    expect(breakActivityState(plan, { ...timer, elapsedMs: end - 1 }, selected).visible).toBe(true);
    for (const status of ["running", "paused"] as const) {
      const current = Object.freeze({ ...timer, elapsedMs: end, status });
      expect(breakActivityState(plan, current, selected).visible).toBe(false);
      expect(current.elapsedMs).toBe(end);
      expect(current.targetMs).toBe(timer.targetMs);
      expect(current.status).toBe(status);
    }
    expect(breakActivityState(plan, { ...timer, elapsedMs: end + 1000, targetMs: 600000 }, selected).visible).toBe(false);
    expect(breakActivityState(plan, { ...timer, elapsedMs: end }, { ...selected, cycles: null }).visible).toBe(true);
    const next = transitionSessionPhase(plan, "break", "2026-09-09T11:00:00Z");
    expect(breakActivityState(next, timer, selected)).toMatchObject({ visible: true, choice: null });
  });
  it("does not complete from paused wall time and stops when the break ends first", () => {
    const paused = { ...timer, elapsedMs: 47000, status: "paused" as const };
    expect(breathingRunProgress(breathingElapsed(paused, 0, 60000), 3).complete).toBe(false);
    const finished = { ...timer, targetMs: 30000, elapsedMs: 30000, status: "finished" as const };
    expect(breathingRunProgress(breathingElapsed(finished, 0), 3).complete).toBe(false);
    expect(breakActivityState(plan, finished, { ...choice("breathing"), cycles: 3 }).visible).toBe(false);
  });
});
