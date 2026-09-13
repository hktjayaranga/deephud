import { FocusSchedule, nextScheduledSession } from "../../services/schedules";

export default function SchedulePreview({ schedules, ready, onOpen }: {
  schedules: FocusSchedule[];
  ready: boolean;
  onOpen: () => void;
}) {
  // The schedule store refreshes every ten seconds and when the window gains focus.
  const next = ready ? nextScheduledSession(schedules) : null;
  return <section className="schedule-preview" aria-label="Next scheduled session">
    <div className="section-title"><h2>Next scheduled session</h2><button type="button" className="workspace-nav-button" onClick={onOpen}>Schedule</button></div>
    {!ready ? <p>Open Schedule to check upcoming sessions.</p> : next ? <>
      <p>{next.schedule.title}</p>
      <small><time dateTime={next.dueAt.toISOString()}>{next.dueAt.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> · {next.schedule.workMinutes} min{next.schedule.project && ` · ${next.schedule.project}`}</small>
    </> : <p>No upcoming sessions. Set a regular time to focus.</p>}
  </section>;
}
