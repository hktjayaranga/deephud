import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SessionRecovery from "../src/components/SessionRecovery";
import { RECOVERY_KEY, SessionSnapshot, clearSessionSnapshot, loadSessionSnapshot, reconcileSessionSnapshot, resumeSessionSnapshot, saveSessionSnapshot, savedRecoveryCycle } from "../src/services/sessionRecovery";
import { SessionRecord, getSessions, resetDatabase, saveSession } from "../src/services/database";
import { groupSessions } from "../src/services/sessionHistory";

const savedAt = Date.parse("2026-09-08T10:15:00Z");
const snapshot = (): SessionSnapshot => ({
  version: 1, savedAt, pausedMs: 120_000, warningShown: false,
  plan: { workSessionId: "research-day-2", kind: "pomodoro", workMinutes: 25, breakMinutes: 5, phase: "work", project: "Research", task: "Read paper", startedAt: "2026-09-08T10:00:00Z", cycle: 3, focusAudio: null },
  timer: { mode: "countdown", status: "running", elapsedMs: 15 * 60_000, targetMs: 25 * 60_000 },
});
const completed = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 3, workSessionId: "research-day-2", startedAt: "2026-09-08T10:00:00Z", endedAt: "2026-09-08T10:25:00Z", plannedMinutes: 25, focusSeconds: 1500, pausedSeconds: 120, project: "Research", task: "Read paper", sessionKind: "pomodoro", cycleCompleted: true, ...overrides,
});

beforeEach(() => localStorage.clear());

describe("session checkpoint persistence", () => {
  it("round-trips timer, task, cycle, phase and warning state", () => {
    const saved = { ...snapshot(), warningShown: true };
    saveSessionSnapshot(saved);
    expect(loadSessionSnapshot()).toEqual(saved);
    clearSessionSnapshot();
    expect(loadSessionSnapshot()).toBeNull();
  });

  it("rejects corrupt, unsupported, and impossible snapshots", () => {
    for (const value of ["invalid JSON", JSON.stringify({ ...snapshot(), version: 2 }), JSON.stringify({ ...snapshot(), timer: { ...snapshot().timer, elapsedMs: -1 } }), JSON.stringify({ ...snapshot(), plan: { ...snapshot().plan, cycle: 0 } }), JSON.stringify({ ...snapshot(), timer: { ...snapshot().timer, mode: "stopwatch" } })]) {
      localStorage.setItem(RECOVERY_KEY, value);
      expect(loadSessionSnapshot()).toBeNull();
    }
  });

  it("preserves durable audio and drops expired browser audio", () => {
    const saved = snapshot();
    saved.plan.focusAudio = { track: { name: "Rain", libraryId: "rain", libraryPath: "audio/rain.ogg" }, volume: 35, pauseWithTimer: true };
    saveSessionSnapshot(saved);
    expect(loadSessionSnapshot()?.plan.focusAudio).toEqual(saved.plan.focusAudio);
    saved.plan.focusAudio.track = { name: "Temporary", source: "blob:expired", temporary: true };
    saveSessionSnapshot(saved);
    expect(loadSessionSnapshot()?.plan.focusAudio).toBeNull();
    expect(localStorage.getItem(RECOVERY_KEY)).not.toContain("blob:expired");
  });
});

describe("recovery time accounting", () => {
  it("resumes cycle 3 with ten minutes left, excluding all time away by default", () => {
    const restored = resumeSessionSnapshot(snapshot(), false, savedAt + 3600_000);
    expect(restored.plan.cycle).toBe(3);
    expect(restored.plan.workSessionId).toBe("research-day-2");
    expect(restored.timer.targetMs - restored.timer.elapsedMs).toBe(600_000);
    expect(restored.timer.status).toBe("running");
    expect(restored.pausedMs).toBe(3720_000);
  });

  it("includes time away only by choice and caps it at one completed interval", () => {
    const restored = resumeSessionSnapshot(snapshot(), true, savedAt + 3600_000);
    expect(restored.timer).toMatchObject({ elapsedMs: 1500_000, status: "finished" });
    expect(restored.plan.phase).toBe("work");
    expect(restored.plan.cycle).toBe(3);
    expect(restored.pausedMs).toBe(3120_000);
    expect(resumeSessionSnapshot(snapshot(), true, savedAt + 180_000).timer.elapsedMs).toBe(1080_000);
  });

  it("does not count time away from a paused or finished timer even if requested", () => {
    for (const status of ["paused", "finished"] as const) {
      const saved = snapshot(); saved.timer.status = status;
      const restored = resumeSessionSnapshot(saved, true, savedAt + 3600_000);
      expect(restored.timer.elapsedMs).toBe(saved.timer.elapsedMs);
    }
  });

  it("supports stopwatch and break recovery without inventing focus cycles", () => {
    const saved = snapshot(); saved.plan.kind = "stopwatch"; saved.timer.mode = "stopwatch";
    expect(resumeSessionSnapshot(saved, true, savedAt + 3600_000).timer.elapsedMs).toBe(4500_000);
    saved.plan = { ...saved.plan, kind: "pomodoro", phase: "break" };
    saved.timer = { mode: "countdown", status: "running", targetMs: 300_000, elapsedMs: 120_000 };
    const restored = resumeSessionSnapshot(saved, true, savedAt + 3600_000);
    expect(restored.plan.phase).toBe("break");
    expect(restored.timer).toMatchObject({ elapsedMs: 300_000, status: "finished" });
    expect(restored.plan.cycle).toBe(3);
  });

  it("handles clock rollback and honors paused-time tracking preference", () => {
    expect(resumeSessionSnapshot(snapshot(), true, savedAt - 3600_000).timer.elapsedMs).toBe(900_000);
    expect(resumeSessionSnapshot(snapshot(), false, savedAt + 3600_000, false).pausedMs).toBe(120_000);
  });
});

describe("crash reconciliation with saved history", () => {
  it("recognizes a cycle committed after the last checkpoint", () => {
    const reconciled = reconcileSessionSnapshot(snapshot(), [completed()]);
    expect(reconciled?.timer).toMatchObject({ status: "finished", elapsedMs: 1500_000 });
    expect(savedRecoveryCycle(snapshot(), [completed()])?.id).toBe(3);
    expect(savedRecoveryCycle(snapshot(), [completed({ workSessionId: "other" })])).toBeUndefined();
  });

  it("does not resurrect ended sessions or completed standalone countdowns", () => {
    expect(reconcileSessionSnapshot(snapshot(), [completed({ workSessionEndedAt: "2026-09-08T10:30:00Z" })])).toBeNull();
    const saved = snapshot(); saved.plan.kind = "deep-work";
    expect(reconcileSessionSnapshot(saved, [completed({ sessionKind: "deep-work" })])).toBeNull();
    expect(reconcileSessionSnapshot(snapshot(), [completed({ cycleCompleted: false })])).toBeNull();
  });

  it("keeps earlier completed cycles in the same group when recovering the current one", async () => {
    await resetDatabase();
    await saveSession(completed({ startedAt: "2026-09-08T09:00:00Z", endedAt: "2026-09-08T09:25:00Z" }));
    await saveSession(completed({ startedAt: "2026-09-08T09:30:00Z", endedAt: "2026-09-08T09:55:00Z" }));
    saveSessionSnapshot(snapshot());
    const history = await getSessions();
    const pending = reconcileSessionSnapshot(loadSessionSnapshot()!, history)!;
    expect(pending.timer.status).toBe("running");
    const restored = resumeSessionSnapshot(pending, false, savedAt + 3600_000);
    expect(restored.plan.cycle).toBe(3);
    expect(groupSessions(history)).toHaveLength(1);
    expect(groupSessions(history)[0].focusSeconds).toBe(3000);
    // Simulate committing cycle 3 then crashing before the checkpoint is replaced.
    await saveSession(completed());
    const afterCrash = await getSessions();
    expect(savedRecoveryCycle(pending, afterCrash)).toBeDefined();
    expect(reconcileSessionSnapshot(pending, afterCrash)?.timer.status).toBe("finished");
    expect(groupSessions(afterCrash)[0].completedCycles).toBe(3);
  });
});

it("offers a recovery dialog with time away unchecked by default", () => {
  const markup = renderToStaticMarkup(createElement(SessionRecovery, { snapshot: snapshot(), busy: false, error: "", onResume: () => {}, onDiscard: () => {} }));
  expect(markup).toContain('role="dialog"');
  expect(markup).toContain("Read paper");
  expect(markup).toContain("Cycle 3");
  expect(markup).toContain("Resume with 10:00 remaining");
  expect(markup).not.toContain('checked=""');
});
