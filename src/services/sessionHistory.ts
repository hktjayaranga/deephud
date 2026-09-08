import { SessionRecord } from "./database";

export interface WorkSession {
  key: string;
  startedAt: string;
  endedAt: string;
  focusSeconds: number;
  elapsedSeconds: number;
  completedCycles: number;
  cycles: SessionRecord[];
  tasks: { project: string; task: string; cycles: SessionRecord[] }[];
}

/** Group only explicit identities: proximity cannot prove that legacy cycles belong together. */
export function groupSessions(records: SessionRecord[]): WorkSession[] {
  const groups = new Map<string, SessionRecord[]>();
  records.forEach((record, index) => {
    const key = record.workSessionId ? `work:${record.workSessionId}` : `record:${record.id ?? index}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  return [...groups].map(([key, records]) => {
    const cycles = [...records].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const startedAt = cycles[0].startedAt;
    const endedAt = new Date(Math.max(...cycles.map((cycle) => Math.max(Date.parse(cycle.endedAt), Date.parse(cycle.workSessionEndedAt ?? cycle.endedAt))))).toISOString();
    const focusSeconds = cycles.reduce((sum, cycle) => sum + cycle.focusSeconds, 0);
    const tasks: WorkSession["tasks"] = [];
    cycles.forEach((cycle) => {
      const previous = tasks[tasks.length - 1];
      if (previous && previous.project === cycle.project && previous.task === cycle.task) previous.cycles.push(cycle);
      else tasks.push({ project: cycle.project, task: cycle.task, cycles: [cycle] });
    });
    return { key, startedAt, endedAt, focusSeconds, elapsedSeconds: Math.max(focusSeconds, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)), completedCycles: cycles.filter((cycle) => cycle.sessionKind === "pomodoro" && (cycle.cycleCompleted ?? (cycle.plannedMinutes > 0 && cycle.focusSeconds >= cycle.plannedMinutes * 60))).length, cycles, tasks };
  }).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
