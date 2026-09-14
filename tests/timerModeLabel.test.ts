import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TimerModeLabel from "../src/components/TimerModeLabel";
import { SessionPlan } from "../src/services/session";
import { initialTimerState, TimerStatus } from "../src/services/timer";

const plan: SessionPlan = { kind: "deep-work", phase: "work", workMinutes: 25, breakMinutes: 5, project: "", task: "", startedAt: "2026-09-14T09:00:00Z", cycle: 1 };

describe("HUD timer mode labels", () => {
  it.each(["stopwatch", "countdown"] as const)("keeps the idle %s label as a button naming the next mode", mode => {
    const onSwitch = vi.fn();
    const html = renderToStaticMarkup(createElement(TimerModeLabel, { state: initialTimerState(mode), plan: null, onSwitch }));
    expect(html).toContain(`<span>${mode.toUpperCase()}</span>`);
    expect(html).toContain('class="brand brand--switch"');
    expect(html).toContain(`title="Switch to ${mode === "stopwatch" ? "Countdown" : "Stopwatch"}"`);
    expect(html).toContain('<button type="button"');
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it.each(["running", "paused", "finished"] as TimerStatus[])("shows non-interactive mode and phase labels when %s", status => {
    const cases: [SessionPlan, string][] = [
      [{ ...plan, kind: "stopwatch" }, "STOPWATCH"],
      [plan, "DEEP WORK"],
      [{ ...plan, kind: "pomodoro" }, "POMODORO"],
      [{ ...plan, kind: "pomodoro", phase: "break", breakKind: "short" }, "BREAK"],
      [{ ...plan, kind: "pomodoro", phase: "break", breakKind: "long" }, "LONG BREAK"],
    ];
    for (const [activePlan, label] of cases) {
      const state = { ...initialTimerState(activePlan.kind === "stopwatch" ? "stopwatch" : "countdown"), status };
      const html = renderToStaticMarkup(createElement(TimerModeLabel, { state, plan: activePlan, onSwitch: vi.fn() }));
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).not.toContain("<button");
      expect(html).not.toContain("brand--switch");
      expect(html).not.toContain("Switch to");
    }
  });

  it("does not offer switching when the timer is running without a session plan", () => {
    const html = renderToStaticMarkup(createElement(TimerModeLabel, { state: { ...initialTimerState("stopwatch"), status: "running" }, plan: null, onSwitch: vi.fn() }));
    expect(html).toContain("STOPWATCH");
    expect(html).not.toContain("<button");
  });
});
