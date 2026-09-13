// Matches the maximum focus duration accepted by desktop storage and backups.
export const MAX_FOCUS_SECONDS = 365 * 24 * 60 * 60;
export const MAX_FOCUS_MINUTES = MAX_FOCUS_SECONDS / 60;

export function splitFocusedDuration(totalSeconds: number) {
  return { minutes: String(Math.floor(totalSeconds / 60)), seconds: String(totalSeconds % 60) };
}

export function validateFocusedDuration(minutes: string, seconds: string):
  { valid: true; focusSeconds: number } | { valid: false; error: string } {
  const wholeMinutes = Number(minutes);
  const remainingSeconds = Number(seconds);
  if (!minutes.trim() || !Number.isInteger(wholeMinutes) || wholeMinutes < 0 || wholeMinutes > MAX_FOCUS_MINUTES) {
    return { valid: false, error: `Enter whole minutes from 0 to ${MAX_FOCUS_MINUTES}.` };
  }
  if (!seconds.trim() || !Number.isInteger(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > 59) {
    return { valid: false, error: "Enter whole seconds from 0 to 59." };
  }
  const focusSeconds = wholeMinutes * 60 + remainingSeconds;
  if (focusSeconds > MAX_FOCUS_SECONDS) return { valid: false, error: `Focused time cannot exceed ${MAX_FOCUS_MINUTES} minutes.` };
  return { valid: true, focusSeconds };
}
