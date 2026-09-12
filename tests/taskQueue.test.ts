import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyQueueItem, getQueue, localDay, moveQueueItem, nextQueueItem, normalizeQueue, orderedQueue, queuePlan, queueProgress, saveQueue, validateQueue } from "../src/services/taskQueue";
import { SessionRecord, getSessions, replaceSessions, resetDatabase, saveSession } from "../src/services/database";
import { validateBackup } from "../src/services/dataTransfer";
import { defaultSettings } from "../src/services/settings";
import { SessionSnapshot, loadSessionSnapshot, reconcileSessionSnapshot, saveSessionSnapshot } from "../src/services/sessionRecovery";
import { completeFocusCycle, nextBreak, shouldAutoStartWork, transitionSessionPhase } from "../src/services/session";
import QueueCompletion from "../src/components/QueueCompletion";
import TodayQueue from "../src/components/TodayQueue";

const day = "2026-09-12";
const item = (id = "task-a", overrides: Partial<DailyQueueItem> = {}): DailyQueueItem => ({ id, scheduledDate: day, title: `Task ${id}`, project: "DeepHUD", position: 0, estimatedSessions: 3, focusMinutes: 25, kind: "pomodoro", completedAt: null, ...overrides });
const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({ queueItemId: "task-a", workSessionId: "work-a", startedAt: "2026-09-12T09:00:00Z", endedAt: "2026-09-12T09:25:00Z", plannedMinutes: 25, focusSeconds: 1500, pausedSeconds: 0, project: "DeepHUD", task: "Old title", sessionKind: "pomodoro", cycleCompleted: true, ...overrides });
beforeEach(() => localStorage.clear());

describe("daily task queue repository and progress", () => {
  it("persists ordered tasks and estimates across reload, including completion and reopen", async () => {
    const tasks = [item(), item("task-b", { position: 1, focusMinutes: 50 }), item("yesterday", { scheduledDate: "2026-09-11" })];
    await saveQueue(moveQueueItem(tasks, "task-b", -1));
    expect(orderedQueue(await getQueue(), day).map((task) => task.id)).toEqual(["task-b", "task-a"]);
    await saveQueue((await getQueue()).map((task) => task.id === "task-b" ? { ...task, completedAt: "2026-09-12T10:00:00Z" } : task));
    expect(nextQueueItem(await getQueue(), undefined, day)?.id).toBe("task-a");
    await saveQueue((await getQueue()).map((task) => ({ ...task, completedAt: null })));
    expect(nextQueueItem(await getQueue(), undefined, day)?.focusMinutes).toBe(50);
  });

  it("keeps other days and completed tasks out of reorder and next-task selection", () => {
    const tasks = [item(), item("done", { position: 1, completedAt: "2026-09-12T10:00:00Z" }), item("b", { position: 2 }), item("past", { scheduledDate: "2026-09-11" }), item("future", { scheduledDate: "2026-09-13" })];
    const moved = moveQueueItem(tasks, "b", -1);
    expect(nextQueueItem(moved, "task-a", day)?.id).toBe("b");
    expect(moveQueueItem(tasks, "task-a", -1)).toEqual(tasks);
    expect(moveQueueItem(tasks, "b", 1)).toEqual(tasks);
    expect(nextQueueItem(tasks, "b", "2026-09-14")).toBeUndefined();
    expect(moved.find((task) => task.id === "past")).toEqual(tasks[3]);
  });

  it("appends carried tasks and normalizes positions after deletion", async () => {
    await saveQueue(normalizeQueue([item("b", { position: 8 }), item("a", { position: 5000 })]));
    expect((await getQueue()).map((task) => [task.id, task.position])).toEqual([["b", 0], ["a", 1]]);
    const date = new Date(2026, 8, 12, 23, 59);
    expect(localDay(date)).toBe(day);
    date.setMinutes(date.getMinutes() + 2);
    expect(localDay(date)).toBe("2026-09-13");
  });

  it("counts completed work once, retains partial time, and keeps progress after rename or carry", async () => {
    await saveSession(record());
    await saveSession(record());
    await saveSession(record({ startedAt: "2026-09-12T09:30:00Z", endedAt: "2026-09-12T09:35:00Z", focusSeconds: 300, cycleCompleted: false }));
    expect(await getSessions()).toHaveLength(2);
    expect(queueProgress("task-a", await getSessions())).toEqual({ completedSessions: 1, focusSeconds: 1800 });
    await saveQueue([item("task-a", { title: "Renamed", scheduledDate: "2026-09-13", estimatedSessions: 1 })]);
    expect((await getQueue())[0].completedAt).toBeNull();
    expect(queueProgress("task-a", await getSessions()).completedSessions).toBe(1);
    await saveQueue([]);
    expect(await getSessions()).toHaveLength(2);
  });

  it.each([
    { title: "  " }, { estimatedSessions: 0 }, { estimatedSessions: 1.5 }, { focusMinutes: 241 },
    { position: -1 }, { scheduledDate: "2026-02-30" }, { kind: "stopwatch" }, { completedAt: "bad" }, { id: "" },
  ])("rejects invalid queue data before replacing stored tasks: %j", async (patch) => {
    await saveQueue([item()]);
    await expect(saveQueue([item("new", patch as Partial<DailyQueueItem>)])).rejects.toThrow();
    expect((await getQueue())[0].id).toBe("task-a");
  });
  it("rejects duplicate IDs and corrupt storage rather than silently erasing tasks", () => {
    expect(() => validateQueue([item(), item()])).toThrow();
  });
});

describe("queue backups and recovery", () => {
  it("round-trips v2 queue items and session links and still reads v1 backups", async () => {
    const raw = { application: "DeepHUD", schemaVersion: 2, exportedAt: "2026-09-12T10:00:00Z", settings: defaultSettings, sessions: [record()], queueItems: [item()] };
    const backup = validateBackup(raw, Date.parse("2026-09-12T11:00:00Z"));
    await replaceSessions(backup.sessions, backup.queueItems);
    expect(await getQueue()).toEqual([item()]);
    expect((await getSessions())[0].queueItemId).toBe("task-a");
    const legacy = validateBackup({ ...raw, schemaVersion: 1, queueItems: undefined }, Date.parse("2026-09-12T11:00:00Z"));
    expect(legacy.queueItems).toEqual([]);
    expect(() => validateBackup({ ...raw, schemaVersion: "2" })).toThrow();
    await resetDatabase();
    expect(await getQueue()).toEqual([]);
    expect(await getSessions()).toEqual([]);
  });
  it("does not replace history if restored queue data is invalid", async () => {
    await saveSession(record());
    await expect(replaceSessions([], [item("bad", { estimatedSessions: -1 })])).rejects.toThrow();
    expect(await getSessions()).toHaveLength(1);
  });
  it.each(["pomodoro", "deep-work"] as const)("recovers a saved %s completion decision without counting twice", async (kind) => {
    const plan = { ...queuePlan(item("task-a", { kind }), 5), workSessionId: "work-a", startedAt: record().startedAt };
    const snapshot: SessionSnapshot = { version: 1, savedAt: Date.parse(record().endedAt), plan, timer: { mode: "countdown", status: "running", targetMs: 1500000, elapsedMs: 1499000 }, pausedMs: 0, warningShown: false };
    saveSessionSnapshot(snapshot);
    expect(loadSessionSnapshot()?.plan.queueItemId).toBe("task-a");
    await saveSession(record({ sessionKind: kind }));
    const restored = reconcileSessionSnapshot(loadSessionSnapshot()!, await getSessions());
    expect(restored?.timer.status).toBe("finished");
    await saveSession(record({ sessionKind: kind }));
    expect(queueProgress("task-a", await getSessions()).completedSessions).toBe(1);
    expect(reconcileSessionSnapshot(snapshot, [record({ workSessionEndedAt: record().endedAt })])).toBeNull();
  });
});

describe("queue completion choices", () => {
  const markup = (phase: "work" | "break", kind: "pomodoro" | "deep-work" = "pomodoro", done = false) => renderToStaticMarkup(createElement(QueueCompletion, {
    plan: { ...queuePlan(item("task-a", { kind }), 5), phase }, item: item("task-a", { completedAt: done ? "2026-09-12T10:00:00Z" : null }), next: item("b"), sessions: [record()], onDone: vi.fn(), onContinue: vi.fn(), onNext: vi.fn(), onBreak: vi.fn(), onClose: vi.fn(),
  }));
  it("offers a Pomodoro break before switching and offers the next task after the break", () => {
    const work = markup("work");
    expect(work).toContain("Start 5-min break");
    expect(work).not.toContain("Switch to next task</button>");
    expect(work).not.toContain("Continue this task</button>");
    const rest = markup("break");
    expect(rest).toContain("Continue this task</button>");
    expect(rest).toContain("Switch to next task</button>");
    expect(rest).toContain("Mark task done</button>");
  });
  it("offers the next task immediately after Deep Work and does not continue a done task", () => {
    expect(markup("work", "deep-work")).toContain("Switch to next task</button>");
    expect(markup("break", "pomodoro", true)).not.toContain("Continue this task</button>");
  });
  it("requires a choice for queued work even with auto-start enabled", () => {
    const queued = queuePlan(item(), 5);
    expect(shouldAutoStartWork(queued, true)).toBe(false);
    expect(shouldAutoStartWork(queued, false)).toBe(false);
    expect(shouldAutoStartWork({ ...queued, queueItemId: undefined }, true)).toBe(true);
  });
  it("preserves long break counters when continuing on a different task", () => {
    let plan = { ...queuePlan(item(), 5), completedFocusCycles: 3, cyclesBeforeLongBreak: 4, longBreakMinutes: 20 };
    plan = completeFocusCycle(plan) as typeof plan;
    expect(nextBreak(plan).kind).toBe("long");
    const rest = transitionSessionPhase(plan, "break");
    const switched = transitionSessionPhase({ ...rest, queueItemId: "b", task: "Task b" }, "work");
    expect(switched.completedFocusCycles).toBe(4);
    expect(switched.longBreakAtCount).toBe(4);
    expect(nextBreak(completeFocusCycle(switched)).kind).toBe("short");
  });
  it("shows active-session guidance and disables starting queued tasks while a session is open", () => {
    const html = renderToStaticMarkup(createElement(TodayQueue, { items: [item()], sessions: [], projects: [], today: day, canStart: false, ready: true, activeId: "task-a", defaultMinutes: 25, onChange: vi.fn(), onStart: vi.fn(), onClose: vi.fn(), onDragStart: vi.fn() }));
    expect(html).toContain("before starting another task");
    expect(html).toMatch(/disabled="">Active<\/button>/);
    expect(html).toContain("0 / 3 sessions");
  });
});
