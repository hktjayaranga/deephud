import type { SessionRecord } from "./database";
import { localDay } from "./taskQueue";

export interface InsightTotals {
  focusSeconds: number;
  completedSessions: number;
  otherSessions: number;
}
export interface FocusDay extends InsightTotals { date: string; day: number; future: boolean }
export interface MonthlyInsights extends InsightTotals {
  month: string;
  label: string;
  activeDays: number;
  firstWeekday: number;
  days: FocusDay[];
  projects: { name: string; focusSeconds: number }[];
  hours: { hour: number; focusSeconds: number; sessions: number }[];
  comparison: {
    previousSeconds: number;
    differenceSeconds: number;
    percent: number | null;
    currentStart: Date;
    currentEnd: Date;
    previousStart: Date;
    previousEnd: Date;
    ongoing: boolean;
  };
}
export const monthKey = (date = new Date()) => localDay(date).slice(0, 7);
export function monthStart(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2000) throw new Error("Invalid insights month");
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1);
}
export function shiftMonth(month: string, offset: number) {
  const start = monthStart(month);
  start.setMonth(start.getMonth() + offset);
  return monthKey(start);
}
export function isCompletedFocus(session: SessionRecord) {
  return session.cycleCompleted ?? (session.sessionKind !== "stopwatch" && session.plannedMinutes > 0 && session.focusSeconds >= session.plannedMinutes * 60);
}

/** Attribute each saved interval to its LOCAL start date/hour, consistently with History. */
export function calculateMonthlyInsights(sessions: SessionRecord[], month: string, now = new Date()): MonthlyInsights {
  const start = monthStart(month);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const ongoing = month === monthKey(now);
  const currentEnd = new Date(Math.max(start.getTime(), Math.min(end.getTime(), now.getTime())));
  let previousEnd = start;
  if (ongoing) {
    const previousDays = new Date(start.getFullYear(), start.getMonth(), 0).getDate();
    previousEnd = now.getDate() > previousDays ? start : new Date(previousStart.getFullYear(), previousStart.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  }
  const days: FocusDay[] = Array.from({ length: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), index + 1);
    return { date: localDay(date), day: index + 1, future: localDay(date) > localDay(now), focusSeconds: 0, completedSessions: 0, otherSessions: 0 };
  });
  const projects = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, focusSeconds: 0, sessions: 0 }));
  let previousSeconds = 0;
  let focusSeconds = 0;
  let completedSessions = 0;
  let otherSessions = 0;
  for (const session of sessions) {
    const date = new Date(session.startedAt);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(session.focusSeconds) || session.focusSeconds < 0) continue;
    if (date >= previousStart && date < previousEnd && date <= now) previousSeconds += session.focusSeconds;
    if (date < start || date >= currentEnd) continue;
    const completed = isCompletedFocus(session);
    const day = days[date.getDate() - 1];
    day.focusSeconds += session.focusSeconds;
    if (completed) { completedSessions++; day.completedSessions++; }
    else { otherSessions++; day.otherSessions++; }
    focusSeconds += session.focusSeconds;
    const name = session.project.trim() || "Unassigned";
    projects.set(name, (projects.get(name) ?? 0) + session.focusSeconds);
    hours[date.getHours()].focusSeconds += session.focusSeconds;
    hours[date.getHours()].sessions++;
  }
  return {
    month, label: start.toLocaleDateString([], { month: "long", year: "numeric" }),
    focusSeconds, completedSessions, otherSessions, activeDays: days.filter((day) => day.focusSeconds > 0).length,
    firstWeekday: (start.getDay() + 6) % 7,
    days, projects: [...projects].map(([name, focusSeconds]) => ({ name, focusSeconds })).sort((a, b) => b.focusSeconds - a.focusSeconds || a.name.localeCompare(b.name)), hours,
    comparison: { currentStart: start, currentEnd, previousStart, previousEnd, ongoing, previousSeconds, differenceSeconds: focusSeconds - previousSeconds, percent: previousSeconds > 0 ? (focusSeconds - previousSeconds) / previousSeconds * 100 : null },
  };
}

export function insightDuration(seconds: number) {
  if (seconds > 0 && seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}
