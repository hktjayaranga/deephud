import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SessionLauncher from "../src/components/SessionLauncher";
import { validateLauncherDuration } from "../src/services/launcherDuration";
import { defaultSettings } from "../src/services/settings";

describe("launcher duration validation", () => {
  it.each(["", " ", "0", "-1", "1.5", "NaN", "Infinity", "not a number", "1441"])("rejects invalid Deep Work duration %j without substituting a duration", (work) => {
    expect(validateLauncherDuration("deep-work", work, "5")).toMatchObject({ valid: false, workError: "Enter a whole number from 1 to 1440 minutes." });
    expect(validateLauncherDuration("deep-work", work, "5")).not.toHaveProperty("workMinutes");
  });

  it.each(["1", "25", "50", "90", "120", "1440"])("starts the exact valid Deep Work duration %s", (work) => {
    expect(validateLauncherDuration("deep-work", work, "5")).toEqual({ valid: true, workMinutes: Number(work) });
  });

  it.each(["", "0", "-1", "0.5", "241", "Infinity"])("rejects invalid interval work duration %j", (work) => {
    expect(validateLauncherDuration("pomodoro", work, "5")).toMatchObject({ valid: false, workError: "Enter a whole number from 1 to 240 minutes." });
  });

  it.each(["", "0", "-1", "1.5", "121", "Infinity"])("rejects invalid break duration %j", (rest) => {
    expect(validateLauncherDuration("pomodoro", "25", rest)).toMatchObject({ valid: false, breakError: "Enter a whole number from 1 to 120 minutes." });
  });

  it.each([["1", "1"], ["240", "120"], ["25", "5"], ["50", "10"], ["90", "20"]])("preserves valid interval work/break durations %s/%s", (work, rest) => {
    expect(validateLauncherDuration("pomodoro", work, rest)).toEqual({ valid: true, workMinutes: Number(work), breakMinutes: Number(rest) });
  });

  it("reports both field errors and clears them when corrected", () => {
    expect(validateLauncherDuration("pomodoro", "0", "121")).toMatchObject({ valid: false, workError: expect.any(String), breakError: expect.any(String) });
    expect(validateLauncherDuration("pomodoro", "25", "5")).toEqual({ valid: true, workMinutes: 25, breakMinutes: 5 });
  });

  it("applies the selected mode's limit and ignores a hidden break draft in Deep Work", () => {
    expect(validateLauncherDuration("deep-work", "1440", "")).toEqual({ valid: true, workMinutes: 1440 });
    expect(validateLauncherDuration("pomodoro", "1440", "5").valid).toBe(false);
  });

  it("renders one submit button and keeps presets from submitting the form", () => {
    const html = renderToStaticMarkup(createElement(SessionLauncher, {
      settings: defaultSettings, projects: [], initialTask: "Review",
      onStart: vi.fn(), onToday: vi.fn(), onClose: vi.fn(), onDragStart: vi.fn(),
    }));
    expect(html).toContain('<form class="workspace__content"');
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('type="submit" class="start-session"');
    expect(html).toContain("<small>90 min</small>");
    expect(html).toMatch(/<button type="button"[^>]*><b>25<\/b>/);
  });
});
