import { beforeEach, describe, expect, it } from "vitest";
import { getSessions, saveSession } from "../src/services/database";
import { advanceElapsed, hasFinished } from "../src/services/timerMath";

describe("timer → session → local repository", () => {
  beforeEach(() => localStorage.clear());

  it("stores a completed focus interval and reads it back", async () => {
    const elapsed = advanceElapsed(0, 1_000, 1_501_000);
    expect(hasFinished(elapsed, 1_500_000)).toBe(true);
    await saveSession({ startedAt: "2026-08-31T09:00:00.000Z", endedAt: "2026-08-31T09:25:00.000Z", plannedMinutes: 25, focusSeconds: elapsed / 1000, pausedSeconds: 0, project: "DeepHUD", task: "Integration tests", sessionKind: "pomodoro" });
    const sessions = await getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ project: "DeepHUD", focusSeconds: 1500, sessionKind: "pomodoro" });
  });
});
