import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nextScheduledSession, dueOccurrences, FocusSchedule, getScheduleData, pendingReminders, reconcileOccurrences, releaseDeferredReminders, respondToReminder, saveSchedule, ScheduleData, schedulePlan, SCHEDULES_KEY, validateSchedule, validateScheduleData } from "../src/services/schedules";
import { replaceSessions, resetDatabase } from "../src/services/database";
import { validateBackup } from "../src/services/dataTransfer";
import { defaultSettings } from "../src/services/settings";
import ScheduleReminder from "../src/components/schedules/ScheduleReminder";
const schedule = (overrides: Partial<FocusSchedule> = {}): FocusSchedule => ({ id: "writing", title: "Writing", project: "Personal", weekdays: [1,2,3,4,5], time: "09:00", kind: "pomodoro", workMinutes: 50, breakMinutes: 10, longBreakMinutes: 25, cyclesBeforeLongBreak: 3, enabled: true, updatedAt: "2026-01-01T00:00:00Z", ...overrides });
const at = (hour = 9, minute = 0) => new Date(2026, 8, 14, hour, minute); // Monday
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("local recurring focus times", () => {
  it("only fires selected weekdays, within the 15 minute catch-up window", () => {
    expect(dueOccurrences([schedule()], at(8,59))).toHaveLength(0);
    expect(dueOccurrences([schedule()], at(9,15))).toHaveLength(1);
    expect(dueOccurrences([schedule()], at(9,16))).toHaveLength(0);
    expect(dueOccurrences([schedule()], new Date(2026,8,13,9))).toHaveLength(0);
    expect(dueOccurrences([schedule({ enabled: false })], at())).toHaveLength(0);
    expect(dueOccurrences([schedule({ updatedAt: at(9,1).toISOString() })], at(9,2))).toHaveLength(0);
  });
  it("catches a recent reminder across midnight and month boundaries", () => {
    const s = schedule({ weekdays: [1], time: "23:55" });
    expect(dueOccurrences([s], new Date(2026,8,1,0,5))[0].id).toBe("writing:2026-08-31");
  });
  it("does not duplicate due reminders after sleep, restart, dismissal or a backwards clock change", () => {
    const initial = reconcileOccurrences({ schedules: [schedule()], occurrences: [] }, at(9,10));
    expect(initial.occurrences).toHaveLength(1);
    const dismissed = { ...initial, occurrences: initial.occurrences.map(o => ({ ...o, status: "dismissed" as const })) };
    expect(reconcileOccurrences(JSON.parse(JSON.stringify(dismissed)), at(9,5)).occurrences).toEqual(dismissed.occurrences);
    expect(reconcileOccurrences(initial, at(10)).occurrences[0].status).toBe("expired");
  });
  it("uses local weekdays and recalculates after a timezone change", () => {
    vi.stubEnv("TZ", "Asia/Colombo");
    expect(dueOccurrences([schedule()], new Date("2026-09-14T03:30:00Z"))).toHaveLength(1);
    vi.stubEnv("TZ", "UTC");
    expect(dueOccurrences([schedule()], new Date("2026-09-14T03:30:00Z"))).toHaveLength(0);
    expect(dueOccurrences([schedule()], new Date("2026-09-14T09:00:00Z"))).toHaveLength(1);
  });
  it("skips nonexistent DST times and sends only at the first repeated hour", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(dueOccurrences([schedule({ weekdays: [0], time: "02:30" })], new Date("2026-03-08T07:30:00Z"))).toHaveLength(0);
    const s = schedule({ weekdays: [0], time: "01:30" });
    expect(dueOccurrences([s], new Date("2026-11-01T05:30:00Z"))).toHaveLength(1);
    expect(dueOccurrences([s], new Date("2026-11-01T06:30:00Z"))).toHaveLength(0);
  });
});
describe("reminder lifecycle and persistence", () => {
  it("queues simultaneous reminders, defers only until no session is active, and preserves session settings", () => {
    const data = reconcileOccurrences({ schedules: [schedule(), schedule({ id: "another" })], occurrences: [] }, at());
    data.occurrences[0].status = "deferred";
    expect(pendingReminders(data, true)).toHaveLength(1);
    expect(pendingReminders(data, false)).toHaveLength(2);
    expect(schedulePlan(schedule())).toMatchObject({ task: "Writing", project: "Personal", workMinutes: 50, breakMinutes: 10, longBreakMinutes: 25, cyclesBeforeLongBreak: 3, cycle: 1, phase: "work" });
  });
  it("saves, restarts, defers, releases once, and rejects duplicate starts", async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(8));
    await saveSchedule(schedule());
    vi.setSystemTime(at());
    let data = await getScheduleData();
    const id = data.occurrences[0].id;
    await respondToReminder(id, "deferred");
    vi.setSystemTime(at(10));
    data = await getScheduleData();
    expect(data.occurrences[0].status).toBe("deferred");
    await releaseDeferredReminders();
    await releaseDeferredReminders();
    expect((await getScheduleData()).occurrences).toHaveLength(1);
    await respondToReminder(id, "started");
    await expect(respondToReminder(id, "started")).rejects.toThrow(/already handled/);
    expect((await getScheduleData()).occurrences[0].status).toBe("started");
  });
  it("keeps the next recurrence enabled after dismissal and expires pending reminders on edits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(8));
    await saveSchedule(schedule()); vi.setSystemTime(at());
    const data = await getScheduleData();
    await respondToReminder(data.occurrences[0].id, "dismissed");
    expect((await getScheduleData()).schedules[0].enabled).toBe(true);
    vi.setSystemTime(new Date(2026,8,15,9));
    expect(pendingReminders(await getScheduleData(), false)).toHaveLength(1);
    await saveSchedule(schedule({ enabled: false }));
    expect(pendingReminders(await getScheduleData(), false)).toHaveLength(0);
  });
  it("reports storage failures without pretending a reminder was handled", async () => {
    vi.useFakeTimers(); vi.setSystemTime(at());
    const data = reconcileOccurrences({ schedules: [schedule()], occurrences: [] }, at());
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(data));
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Disk full"); });
    await expect(respondToReminder(data.occurrences[0].id, "started")).rejects.toThrow("Disk full");
    expect(JSON.parse(localStorage.getItem(SCHEDULES_KEY)!).occurrences[0].status).toBe("pending");
  });
  it("offers defer instead of start while a session is active", () => {
    const reminder = dueOccurrences([schedule()], at())[0];
    const props = { reminder, busy: false, error: "", remaining: 2, onRespond: () => {} };
    const busy = renderToStaticMarkup(createElement(ScheduleReminder, { ...props, active: true }));
    expect(busy).toContain("Remind after session"); expect(busy).not.toContain(">Start<");
    expect(busy).toContain("1 more reminder");
    expect(renderToStaticMarkup(createElement(ScheduleReminder, { ...props, active: false }))).toContain(">Start<");
  });
});
describe("schedule validation and backups", () => {
  it("rejects invalid weekdays, times, durations, duplicate IDs and interval settings", () => {
    for (const change of [{ weekdays: [] }, { weekdays: [1,1] }, { time: "24:00" }, { workMinutes: 0 }, { longBreakMinutes: 5 }]) expect(() => validateSchedule(schedule(change))).toThrow();
    expect(() => validateScheduleData({ schedules: [schedule(), schedule()], occurrences: [] })).toThrow(/Duplicate/);
  });
  it("accepts all older backup versions and restores schedules with occurrence state atomically", async () => {
    const base = { application: "DeepHUD", settings: defaultSettings, exportedAt: at().toISOString(), sessions: [] };
    for (const schemaVersion of [1,2,3]) expect(validateBackup({ ...base, schemaVersion, queueItems: [], captures: [] }, at().getTime()).focusSchedules).toEqual({ schedules: [], occurrences: [] });
    const focusSchedules: ScheduleData = reconcileOccurrences({ schedules: [schedule()], occurrences: [] }, at());
    focusSchedules.occurrences[0].status = "dismissed";
    const restored = validateBackup({ ...base, schemaVersion: 4, queueItems: [], captures: [], focusSchedules }, at().getTime());
    await replaceSessions([], [], [], restored.focusSchedules);
    expect(JSON.parse(localStorage.getItem(SCHEDULES_KEY)!)).toEqual(focusSchedules);
    await expect(replaceSessions([], [], [], { ...focusSchedules, schedules: [schedule({ workMinutes: -1 })] })).rejects.toThrow();
    expect(JSON.parse(localStorage.getItem(SCHEDULES_KEY)!)).toEqual(focusSchedules);
    await resetDatabase(); expect(localStorage.getItem(SCHEDULES_KEY)).toBeNull();
  });
});


describe("upcoming schedule preview", () => {
  it("selects the nearest enabled session regardless of input order", () => {
    const next = nextScheduledSession([schedule({ time: "11:00" }), schedule({ id: "off", time: "09:30", enabled: false }), schedule({ id: "next", time: "10:00" })], at(9));
    expect(next?.schedule.id).toBe("next");
    expect(next?.dueAt).toEqual(at(10));
    expect(nextScheduledSession([], at())).toBeNull();
    expect(nextScheduledSession([schedule({ enabled: false })], at())).toBeNull();
  });
  it("rolls a passed weekly time into the next week", () => {
    expect(nextScheduledSession([schedule({ weekdays: [1] })], at(9))?.dueAt).toEqual(new Date(2026, 8, 21, 9));
  });
  it("skips a nonexistent spring-forward time until the following selected day", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(nextScheduledSession([schedule({ weekdays: [0], time: "02:30" })], new Date(2026, 2, 8, 0))?.dueAt).toEqual(new Date(2026, 2, 15, 2, 30));
  });
});
