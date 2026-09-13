import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EditSession } from "../src/components/Dashboard";
import { MAX_FOCUS_SECONDS, splitFocusedDuration, validateFocusedDuration } from "../src/services/focusedDuration";

 describe("history editor focused duration", () => {
  it.each([0, 1, 29, 30, 59, 60, 90, 119, 3599, 3600, 3661, MAX_FOCUS_SECONDS])("round-trips %i seconds without rounding or minimum-minute clamping", total => {
    const fields = splitFocusedDuration(total);
    expect(validateFocusedDuration(fields.minutes, fields.seconds)).toEqual({ valid: true, focusSeconds: total });
  });

  it("saves exactly the displayed combination when either field changes", () => {
    expect(splitFocusedDuration(90)).toEqual({ minutes: "1", seconds: "30" });
    expect(validateFocusedDuration("1", "30")).toEqual({ valid: true, focusSeconds: 90 });
    expect(validateFocusedDuration("2", "30")).toEqual({ valid: true, focusSeconds: 150 });
    expect(validateFocusedDuration("2", "0")).toEqual({ valid: true, focusSeconds: 120 });
  });

  it.each([["", "30"], ["1", ""], ["-1", "0"], ["0", "-1"], ["1.5", "0"], ["0", "1.5"], ["0", "60"], ["NaN", "0"], ["Infinity", "0"], ["525600", "1"]])("rejects invalid minutes=%s seconds=%s", (minutes, seconds) => {
    expect(validateFocusedDuration(minutes, seconds).valid).toBe(false);
  });

  it("renders the exact 90-second duration in accessible minutes and seconds fields", () => {
    const onSave = vi.fn();
    const html = renderToStaticMarkup(createElement(EditSession, { session: {
      id: 1, startedAt: "2026-09-01T09:00:00Z", endedAt: "2026-09-01T09:01:30Z", plannedMinutes: 25,
      focusSeconds: 90, pausedSeconds: 0, project: "Project", task: "Task", sessionKind: "deep-work",
    }, onSave, onCancel: vi.fn() }));
    expect(html).toMatch(/aria-label="Focused minutes"[^>]*value="1"/);
    expect(html).toMatch(/aria-label="Focused seconds"[^>]*value="30"/);
    expect(onSave).not.toHaveBeenCalled();
  });
});
