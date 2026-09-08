/** Original encouragement, stored locally; no network or attributed quotations needed. */
export const motivationalMessages = {
  start: [
    "One small step now is progress.",
    "Give this moment your attention.",
    "Begin with the next manageable step.",
    "You don't need to finish everything to make progress.",
    "A little focus can move things forward.",
    "Make room for one thing that matters.",
    "Start where you are, with what you have.",
    "Let the next small action be enough to begin.",
    "Progress starts with showing up.",
    "One task, one step, one fresh start.",
    "Your next step doesn't have to be perfect.",
    "Settle in and take it one moment at a time.",
  ],
  complete: [
    "Another focused step forward. Enjoy your break.",
    "You gave this work your time and attention.",
    "Small steps add up. Take a breath.",
    "A little further than when you began.",
    "Your effort counts, even when progress feels quiet.",
    "Let yourself pause and appreciate the effort.",
    "That time was an investment in what matters to you.",
    "A focused stretch deserves a moment of rest.",
    "You showed up for the next step.",
    "Take a breath before choosing what comes next.",
    "Steady effort makes room for progress.",
    "Give yourself credit for the time you put in.",
  ],
  goal: [
    "You made time for what matters today.",
    "Your small steps added up today.",
    "Take a moment to appreciate your effort.",
    "Today's focus is worth celebrating.",
    "You followed through on time for yourself.",
    "Let this be a moment of satisfaction.",
    "You gave your priorities room today.",
    "Your steady attention brought you here.",
    "Enjoy the progress you've made today.",
    "You kept making room for the next step.",
    "The effort behind this milestone counts.",
    "You can feel good about the time you invested.",
  ],
} as const;

export type MotivationSituation = keyof typeof motivationalMessages;
const STORAGE_KEY = "deephud:motivation:v1:";
const memory = new Map<MotivationSituation, string[]>();

/** Exhaust each situation's pool before repeating, including across app restarts. */
export function nextMotivationalMessage(situation: MotivationSituation): string {
  const pool: readonly string[] = motivationalMessages[situation];
  let used = memory.get(situation) ?? [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY + situation) ?? "null");
    if (Array.isArray(stored)) used = stored.filter((item): item is string => typeof item === "string" && pool.includes(item));
  } catch { /* Keep the in-memory rotation if storage is unavailable or malformed. */ }
  let available = pool.filter((message) => !used.includes(message));
  if (!available.length) {
    // A fresh round must not begin with the last message from the previous round.
    available = pool.filter((message) => message !== used[used.length - 1]);
    used = [];
  }
  const message = available[Math.floor(Math.random() * available.length)];
  used = [...used, message];
  memory.set(situation, used);
  try { localStorage.setItem(STORAGE_KEY + situation, JSON.stringify(used)); }
  catch { /* Notifications still work when local storage cannot be written. */ }
  return message;
}
