import { ScheduleOccurrence } from "../../services/schedules";
export default function ScheduleReminder({ reminder, active, busy, error, remaining, onRespond }: {
  reminder: ScheduleOccurrence; active: boolean; busy: boolean; error: string; remaining: number;
  onRespond: (status: "started" | "dismissed" | "deferred") => void;
}) {
  return <section className="schedule-reminder" role="dialog" aria-labelledby="schedule-reminder-title">
    <h2 id="schedule-reminder-title">Time for {reminder.schedule.title}</h2>
    <p>{reminder.schedule.workMinutes} minutes{reminder.schedule.project ? ` · ${reminder.schedule.project}` : ""}</p>
    {active && <p>You already have a session open.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="schedule-actions"><button type="button" disabled={busy} onClick={() => onRespond("dismissed")}>Dismiss</button><button type="button" disabled={busy} onClick={() => onRespond(active ? "deferred" : "started")}>{active ? "Remind after session" : "Start"}</button></div>
    {remaining > 1 && <small>{remaining - 1} more {remaining === 2 ? "reminder" : "reminders"}</small>}
  </section>;
}
