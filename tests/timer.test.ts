import { describe, expect, it } from "vitest";
import { displayMs, formatMs, initialTimerState } from "../src/services/timer";
import { adjustedTarget, advanceElapsed, hasFinished } from "../src/services/timerMath";

describe("timer formatting and modes", () => {
  it("formats durations with stable hour and minute boundaries", () => {
    expect(formatMs(0)).toBe("00:00");
    expect(formatMs(65_000)).toBe("01:05");
    expect(formatMs(3_661_000)).toBe("01:01:01");
  });

  it("counts down from the configured target", () => {
    const timer = { ...initialTimerState("countdown", 25), elapsedMs: 5 * 60_000 };
    expect(displayMs(timer)).toBe(20 * 60_000);
  });
});

describe("reliable monotonic timer math", () => {
  it("accounts for delayed ticks and ignores clock reversal", () => {
    expect(advanceElapsed(1_000, 100, 5_100)).toBe(6_000);
    expect(advanceElapsed(1_000, 5_100, 4_000)).toBe(1_000);
  });

  it("adjusts countdowns without moving the target behind elapsed time", () => {
    expect(adjustedTarget(30 * 60_000, 28 * 60_000, -5)).toBe(29 * 60_000);
    expect(adjustedTarget(30 * 60_000, 5 * 60_000, 5)).toBe(35 * 60_000);
    expect(hasFinished(35 * 60_000, 35 * 60_000)).toBe(true);
  });
});
