export function advanceElapsed(elapsedMs: number, previousSample: number, currentSample: number): number {
  const delta = currentSample - previousSample;
  if (!Number.isFinite(delta) || delta <= 0) return elapsedMs;
  return elapsedMs + delta;
}

export function adjustedTarget(targetMs: number, elapsedMs: number, adjustmentMinutes: number): number {
  return Math.max(elapsedMs + 60_000, targetMs + adjustmentMinutes * 60_000);
}

export function hasFinished(elapsedMs: number, targetMs: number) {
  return elapsedMs >= targetMs;
}
