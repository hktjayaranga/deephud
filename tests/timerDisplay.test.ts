import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Timer from "../src/components/Timer";
import { TimerState } from "../src/services/timer";

const renderTimer = (state: TimerState) => renderToStaticMarkup(createElement(Timer, { state, sessionName: "Focus task" }));

describe("timer progress display", () => {
  it.each([
    [0, "00:00"],
    [3_599_000, "59:59"],
    [3_600_000, "01:00:00"],
    [3_601_000, "01:00:01"],
    [7_200_000, "02:00:00"],
  ] as const)("shows elapsed stopwatch time at %s ms without suggesting a completion target", (elapsedMs, clock) => {
    const html = renderTimer({ mode: "stopwatch", status: "running", elapsedMs, targetMs: 0 });
    expect(html).toContain(`>${clock}</div>`);
    expect(html).toContain("Focus task");
    expect(html).not.toContain("timer__progress");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
  });

  it.each(["idle", "paused"] as const)("omits stopwatch progress while %s", (status) => {
    expect(renderTimer({ mode: "stopwatch", status, elapsedMs: 0, targetMs: 1_500_000 })).not.toContain("timer__progress");
  });

  it.each([
    [0, "25:00", 0],
    [750_000, "12:30", 50],
    [1_500_000, "00:00", 100],
  ] as const)("retains countdown time and accessible progress at %s ms", (elapsedMs, clock, percent) => {
    const html = renderTimer({ mode: "countdown", status: percent === 100 ? "finished" : "running", elapsedMs, targetMs: 1_500_000 });
    expect(html).toContain(`>${clock}</div>`);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(`aria-valuenow="${percent}"`);
    expect(html).toContain(`width:${percent}%`);
  });
});
