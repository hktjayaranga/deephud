import { MonthlyInsights, insightDuration } from "../../services/insights";

export default function HourlyFocusChart({ insights }: { insights: MonthlyInsights }) {
  const max = Math.max(1, ...insights.hours.map((hour) => hour.focusSeconds));
  return <section className="dashboard-section" aria-labelledby="hourly-focus-title"><div className="section-title"><h2 id="hourly-focus-title">Focus time by session start hour</h2></div>
    <div className="insight-card">
      <p className="insight-note">Local time · Each interval’s full focus duration is assigned to the hour it started. This is not an exact record of when every focused minute occurred.</p>
      <div className="hourly-focus" role="list" aria-label="Focused time by start hour, in local time">{insights.hours.map((hour) => <div role="listitem" aria-label={`${String(hour.hour).padStart(2, "0")}:00, ${insightDuration(hour.focusSeconds)} focused, ${hour.sessions} sessions`} className="hourly-focus__column" key={hour.hour} title={`${String(hour.hour).padStart(2, "0")}:00: ${insightDuration(hour.focusSeconds)} focused, ${hour.sessions} sessions`}>
        <span className="hourly-focus__value">{insightDuration(hour.focusSeconds)}</span>
        <div className="hourly-focus__track" aria-hidden="true"><i style={{ height: `${hour.focusSeconds / max * 100}%` }} /></div>
        <span className="hourly-focus__label">{String(hour.hour).padStart(2, "0")}</span>
      </div>)}</div>
      {!insights.focusSeconds && <p className="insight-note">No saved focus time for this month yet.</p>}
    </div>
  </section>;
}
