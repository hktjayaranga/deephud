import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CAPTURES_KEY, DistractionCapture, captureTask, convertCapture, deferIdleForCapture, deleteCapture, getCaptures, pendingCaptures, saveCapture, validateCaptures } from "../src/services/distractions";
import { getQueue, localDay, saveQueue } from "../src/services/taskQueue";
import { getSessions, replaceSessions, resetDatabase } from "../src/services/database";
import { defaultSettings, validateSettings } from "../src/services/settings";
import { validateBackup } from "../src/services/dataTransfer";
import { RECOVERY_KEY, SessionSnapshot, loadSessionSnapshot, saveSessionSnapshot } from "../src/services/sessionRecovery";
import DistractionCaptureInput from "../src/components/DistractionCapture";
import CaptureReview from "../src/components/CaptureReview";
import Dashboard, { DashboardTab } from "../src/components/Dashboard";
import { QueueEditor } from "../src/components/TodayQueue";

const thought = (patch: Partial<DistractionCapture> = {}): DistractionCapture => ({ id: "thought-a", text: "Reply to the university email", createdAt: "2026-09-12T09:00:00Z", workSessionId: "focus-a", queueItemId: "task-a", handledAt: null, convertedQueueItemId: null, ...patch });
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("capture persistence", () => {
  it("saves thoughts and original session links once across concurrent retries", async () => {
    await Promise.all([saveCapture(thought()), saveCapture(thought()), saveCapture(thought({ id: "thought-b" }))]);
    expect(await getCaptures()).toHaveLength(2);
    expect((await getCaptures())[0]).toEqual(thought());
    await saveCapture(thought({ text: "Email sent", handledAt: "2026-09-12T10:00:00Z", workSessionId: "changed" }));
    expect((await getCaptures())[0].workSessionId).toBe("focus-a");
    expect(pendingCaptures(await getCaptures())).toHaveLength(1);
    await saveCapture(thought());
    expect(pendingCaptures(await getCaptures())).toHaveLength(2);
  });
  it.each([{ text: "  " }, { text: "a".repeat(501) }, { text: "a\0b" }, { id: "" }, { createdAt: "bad" }, { createdAt: "2026-02-30T10:00:00Z" }, { handledAt: "yesterday" }, { queueItemId: 42 }])("rejects invalid input without overwriting thoughts: %j", async (patch) => {
    await saveCapture(thought());
    await expect(saveCapture(thought(patch as Partial<DistractionCapture>))).rejects.toThrow();
    expect(await getCaptures()).toEqual([thought()]);
  });
  it("reports corrupted storage instead of replacing it with an empty list", async () => {
    localStorage.setItem(CAPTURES_KEY, "broken");
    await expect(getCaptures()).rejects.toThrow();
    await expect(saveCapture(thought())).rejects.toThrow();
    expect(localStorage.getItem(CAPTURES_KEY)).toBe("broken");
    expect(() => validateCaptures([thought(), thought()])).toThrow();
  });
  it("lets the same draft retry after disk failure", async () => {
    const draft = thought();
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("Disk full"); });
    await expect(saveCapture(draft)).rejects.toThrow("Disk full");
    expect(draft.text).toBe(thought().text);
    await saveCapture(draft);
    expect(await getCaptures()).toEqual([thought()]);
  });
  it.each(["running", "paused"] as const)("leaves a %s timer checkpoint and focus history unchanged", async (status) => {
    const snapshot: SessionSnapshot = { version: 1, savedAt: 10000, pausedMs: 100, warningShown: false, plan: { workSessionId: "focus-a", queueItemId: "task-a", kind: "pomodoro", workMinutes: 25, breakMinutes: 5, task: "Code", project: "DeepHUD", phase: "work", startedAt: "2026-09-12T08:00:00Z", cycle: 1 }, timer: { mode: "countdown", status, targetMs: 1500000, elapsedMs: 10000 } };
    saveSessionSnapshot(snapshot);
    const before = localStorage.getItem(RECOVERY_KEY);
    await saveCapture(thought());
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(before);
    expect(loadSessionSnapshot()?.timer).toEqual(snapshot.timer);
    expect(await getSessions()).toEqual([]);
  });
});

describe("conversion to Today", () => {
  it("atomically converts once even with simultaneous clicks and retries", async () => {
    await saveCapture(thought());
    const first = captureTask(thought().text, 25);
    const duplicate = captureTask(thought().text, 50);
    const ids = await Promise.all([convertCapture("thought-a", first), convertCapture("thought-a", duplicate)]);
    expect(ids).toEqual([first.id, first.id]);
    expect(await getQueue()).toHaveLength(1);
    expect((await getQueue())[0]).toMatchObject({ title: thought().text, scheduledDate: localDay(), estimatedSessions: 1, focusMinutes: 25 });
    expect(pendingCaptures(await getCaptures())).toHaveLength(0);
    expect((await getCaptures())[0].convertedQueueItemId).toBe(first.id);
    // Retrying after a user removes the task must not silently recreate it.
    await saveQueue([]);
    expect(await convertCapture("thought-a", duplicate)).toBe(first.id);
    expect(await getQueue()).toEqual([]);
  });
  it("rolls back the task if saving the capture link fails", async () => {
    await saveCapture(thought());
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => { if (key === CAPTURES_KEY) throw new Error("Disk full"); original(key, value); });
    await expect(convertCapture("thought-a", captureTask("Email", 25))).rejects.toThrow();
    expect(await getQueue()).toEqual([]);
    expect((await getCaptures())[0].convertedQueueItemId).toBeNull();
  });
  it("keeps the task and history when deleting a thought", async () => {
    await saveCapture(thought());
    await convertCapture("thought-a", captureTask("Email", 25));
    await deleteCapture("thought-a");
    expect(await getCaptures()).toEqual([]);
    expect(await getQueue()).toHaveLength(1);
    expect(await getSessions()).toEqual([]);
  });
});

describe("backups and shortcut compatibility", () => {
  const base = { application: "DeepHUD", exportedAt: "2026-09-12T10:00:00Z", settings: defaultSettings, sessions: [], queueItems: [] };
  it("round-trips v3 captures and accepts v1/v2 backups with no thoughts", async () => {
    const restored = validateBackup({ ...base, schemaVersion: 3, captures: [thought()] }, Date.parse("2026-09-12T11:00:00Z"));
    await replaceSessions(restored.sessions, restored.queueItems, restored.captures);
    expect(await getCaptures()).toEqual([thought()]);
    for (const schemaVersion of [1, 2]) expect(validateBackup({ ...base, schemaVersion }).captures).toEqual([]);
    expect(() => validateBackup({ ...base, schemaVersion: 3 })).toThrow();
    await resetDatabase();
    expect(await getCaptures()).toEqual([]);
  });
  it("validates all restored data before modifying history or thoughts", async () => {
    await saveCapture(thought());
    await expect(replaceSessions([], [], [thought({ text: "" })])).rejects.toThrow();
    expect(await getCaptures()).toEqual([thought()]);
  });
  it("adds the default capture shortcut to older settings and accepts a custom shortcut", () => {
    const old = { ...defaultSettings, shortcuts: { ...defaultSettings.shortcuts, captureThought: undefined } };
    expect(validateSettings(old).shortcuts.captureThought).toBe("Ctrl+Alt+N");
    expect(validateSettings({ ...old, shortcuts: { ...old.shortcuts, captureThought: "Ctrl+Shift+F8" } }).shortcuts.captureThought).toBe("Ctrl+Shift+F8");
    expect(validateSettings({ ...old, shortcuts: { ...old.shortcuts, captureThought: "" } }).shortcuts.captureThought).toBe("");
  });
  it("defers idle handling while capturing and for one idle threshold after input", () => {
    expect(deferIdleForCapture(true, 0, 5, 600000)).toBe(true);
    expect(deferIdleForCapture(false, 300000, 5, 310000)).toBe(true);
    expect(deferIdleForCapture(false, 300000, 5, 600000)).toBe(false);
    expect(deferIdleForCapture(false, -Infinity, 5, 100)).toBe(false);
  });
});

describe("capture and review UI", () => {
  it("shows the original draft and retry guidance after a save failure", () => {
    const html = renderToStaticMarkup(createElement(DistractionCaptureInput, { text: thought().text, busy: false, error: "Disk full. Your thought is still here.", onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() }));
    expect(html).toContain(`value="${thought().text}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cancel</button>");
    expect(html).toContain("Save</button>");
    expect(html).not.toContain("Pause");
  });
  it("offers review actions without starting work and pre-fills the existing task editor", () => {
    const html = renderToStaticMarkup(createElement(CaptureReview, { captures: [thought()], projects: [], defaultMinutes: 25, ready: true, onUpdate: vi.fn(), onDelete: vi.fn(), onConvert: vi.fn() }));
    expect(html).toContain("Mark handled</button>");
    expect(html).toContain("Add to Today</button>");
    expect(html).toContain("Keep for later</button>");
    const editor = renderToStaticMarkup(createElement(QueueEditor, { item: null, initialTitle: thought().text, today: localDay(), projects: [], defaultMinutes: 25, busy: false, onSave: vi.fn(), onCancel: vi.fn() }));
    expect(editor).toContain(`value="${thought().text}"`);
    expect(editor).toContain("Estimated sessions");
    expect(editor).toContain("Add task</button>");
  });
});


describe("dashboard saved thoughts tab", () => {
  const renderDashboard = (tab: DashboardTab, count: number) => renderToStaticMarkup(createElement(Dashboard, {
    tab, onTabChange: vi.fn(), pendingThoughtCount: count,
    savedThoughts: createElement(CaptureReview, { captures: [thought()], projects: [], defaultMinutes: 25, ready: true, onUpdate: vi.fn(), onDelete: vi.fn(), onConvert: vi.fn() }),
    sessions: [], goalMinutes: 240, onDelete: vi.fn(), onUpdate: vi.fn(), onExport: vi.fn(), onBackup: vi.fn(), onRestore: vi.fn(), onResetDatabase: vi.fn(), onToday: vi.fn(), onClose: vi.fn(), onDragStart: vi.fn(),
  }));
  it("shows the unhandled badge without opening review on Overview", () => {
    const html = renderDashboard("overview", 3);
    expect(html).toContain('aria-label="3 unhandled thoughts">3</span>');
    expect(html).toContain("Saved for later");
    expect(html).not.toContain("Mark handled</button>");
  });
  it("renders the existing review inside Dashboard without an extra workspace header", () => {
    const html = renderDashboard("saved", 1);
    expect(html).toContain('class="is-active" aria-current="page">Saved for later');
    expect(html).toContain("Mark handled</button>");
    expect(html).toContain("Add to Today</button>");
    expect(html).toContain("Keep for later</button>");
    expect(html.match(/class="workspace__header"/g)).toHaveLength(1);
    expect(html).not.toContain("Today&#x27;s goal");
  });
});
