import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getSessions } from "../src/services/database";
import { SessionPlan } from "../src/services/session";
import { saveSkippedWorkInterval } from "../src/services/skipInterval";
import { groupSessions } from "../src/services/sessionHistory";
import { queueProgress } from "../src/services/taskQueue";

const plan: SessionPlan = {
  kind: "pomodoro", phase: "work", workMinutes: 25, breakMinutes: 5,
  project: "DeepHUD", task: "Review", startedAt: "2026-09-13T09:00:00.000Z",
  cycle: 1, completedFocusCycles: 0, workSessionId: "work-session",
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("skipped work persistence", () => {
  it.each([undefined, "queued-task"])("saves partial focus with queue ID %s without completing a cycle", async (queueItemId) => {
    await saveSkippedWorkInterval({ ...plan, queueItemId }, 300_000, 45_000);
    const sessions = await getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      workSessionId: plan.workSessionId, startedAt: plan.startedAt,
      project: "DeepHUD", task: "Review", sessionKind: "pomodoro",
      plannedMinutes: 25, focusSeconds: 300, pausedSeconds: 45, cycleCompleted: false,
    });
    expect(sessions[0].queueItemId).toBe(queueItemId);
    expect(groupSessions(sessions)[0]).toMatchObject({ focusSeconds: 300, completedCycles: 0 });
    if (queueItemId) expect(queueProgress(queueItemId, sessions)).toEqual({ focusSeconds: 300, completedSessions: 0 });
  });

  it("rejects a failed save and allows retry without duplicate history", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("Disk full"); });
    await expect(saveSkippedWorkInterval(plan, 300_000, 0)).rejects.toThrow("Disk full");
    expect(await getSessions()).toHaveLength(0);
    await saveSkippedWorkInterval(plan, 300_000, 0);
    await saveSkippedWorkInterval(plan, 300_000, 0);
    expect(await getSessions()).toHaveLength(1);
  });

  it("does not create records for zero work or skipped breaks", async () => {
    await saveSkippedWorkInterval(plan, 0, 0);
    await saveSkippedWorkInterval({ ...plan, phase: "break" }, 120_000, 0);
    expect(await getSessions()).toHaveLength(0);
  });

  it("preserves a positive sub-second interval", async () => {
    await saveSkippedWorkInterval(plan, 200, 0);
    expect((await getSessions())[0].focusSeconds).toBe(1);
  });
});
