import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Timer from "../src/components/Timer";
import { focusCompletionNotice, isFocusReminderDue } from "../src/services/notificationPolicy";
import { defaultSettings, validateSettings, loadSettings, saveSettings } from "../src/services/settings";
import { initialTimerState } from "../src/services/timer";

describe("notification policy", () => {
  it("combines cycle completion and goal into one notice with one motivational category", () => {
    const notice = focusCompletionNotice("pomodoro", 25, true, 240, true);
    expect(notice.title).toContain("Focus cycle completed · Daily goal reached");
    expect(notice.body).toBe("25 minutes focused. 240 minutes focused today.");
    expect(notice.motivation).toBe("goal");
  });

  it("keeps timer details when motivation is disabled", () => {
    const notice = focusCompletionNotice("deep-work", 50, false, 50, false);
    expect(notice.title).toContain("Deep work session completed");
    expect(notice.title).not.toContain("Daily goal");
    expect(notice.body).toBe("50 minutes focused.");
    expect(notice.motivation).toBeUndefined();
    expect(focusCompletionNotice("pomodoro", 25, false, 25, true).motivation).toBe("complete");
  });

  it("shows a warning only in the final five minutes of a running focus countdown", () => {
    const state = { ...initialTimerState("countdown", 25), status: "running" as const, elapsedMs: 20 * 60_000 };
    expect(isFocusReminderDue(state, "work", true)).toBe(true);
    expect(isFocusReminderDue({ ...state, elapsedMs: state.elapsedMs - 1 }, "work", true)).toBe(false);
    expect(isFocusReminderDue({ ...state, elapsedMs: state.targetMs }, "work", true)).toBe(false);
    expect(isFocusReminderDue({ ...state, mode: "stopwatch" }, "work", true)).toBe(false);
    expect(isFocusReminderDue({ ...state, status: "paused" }, "work", true)).toBe(false);
    expect(isFocusReminderDue(state, "break", true)).toBe(false);
    expect(isFocusReminderDue(state, undefined, true)).toBe(false);
    expect(isFocusReminderDue(state, "work", false)).toBe(false);
    expect(isFocusReminderDue({ ...state, targetMs: 300_000, elapsedMs: 0 }, "work", true)).toBe(false);
  });

  it("renders a subtle accessible timer indication without changing the displayed time", () => {
    const state = { ...initialTimerState("countdown", 25), elapsedMs: 20 * 60_000 };
    const render = (endingSoon: boolean) => renderToStaticMarkup(createElement(Timer, { state, sessionName: "Research", endingSoon }));
    expect(render(true)).toContain("timer--ending-soon");
    expect(render(true)).toContain("Five minutes or less remaining");
    expect(render(false)).not.toContain("timer--ending-soon");
    expect(render(true)).toContain("05:00");
    expect(render(false)).toContain("05:00");
  });
});

describe("alert preferences", () => {
  it("restores legacy settings and backups with safe defaults for new toggles", () => {
    const legacy: Record<string, unknown> = { ...defaultSettings, notifications: false, sound: false };
    delete legacy.motivationalMessages;
    delete legacy.reminderNotifications;
    const restored = validateSettings(legacy);
    expect(restored.motivationalMessages).toBe(true);
    expect(restored.reminderNotifications).toBe(false);
    expect(restored.notifications).toBe(false);
    expect(restored.sound).toBe(false);
  });

  it("persists independent toggles and rejects invalid types", () => {
    saveSettings({ ...defaultSettings, motivationalMessages: false, reminderNotifications: true, sound: false });
    expect(loadSettings()).toMatchObject({ motivationalMessages: false, reminderNotifications: true, sound: false, notifications: true });
    expect(() => validateSettings({ ...defaultSettings, motivationalMessages: "yes" })).toThrow(/motivationalMessages/);
    expect(() => validateSettings({ ...defaultSettings, reminderNotifications: null })).toThrow(/reminderNotifications/);
  });
});
