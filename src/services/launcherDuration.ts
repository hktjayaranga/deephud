export type LauncherDurationValidation =
  | { valid: true; workMinutes: number; breakMinutes?: number }
  | { valid: false; workError?: string; breakError?: string };

export function validateLauncherDuration(kind: "deep-work" | "pomodoro", work: string, rest: string): LauncherDurationValidation {
  const workMinutes = Number(work);
  const breakMinutes = Number(rest);
  const maximum = kind === "deep-work" ? 1440 : 240;
  const workError = !work.trim() || !Number.isInteger(workMinutes) || workMinutes < 1 || workMinutes > maximum
    ? `Enter a whole number from 1 to ${maximum} minutes.` : undefined;
  const breakError = kind === "pomodoro" && (!rest.trim() || !Number.isInteger(breakMinutes) || breakMinutes < 1 || breakMinutes > 120)
    ? "Enter a whole number from 1 to 120 minutes." : undefined;
  if (workError || breakError) return { valid: false, workError, breakError };
  return { valid: true, workMinutes, ...(kind === "pomodoro" ? { breakMinutes } : {}) };
}
