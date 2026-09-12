import { MonthlyInsights, insightDuration } from "../../services/insights";

export default function FocusCalendar({ insights, onSelectDay }: { insights: MonthlyInsights; onSelectDay: (date: string) => void }) {
  const max = Math.max(1, ...insights.days.map((day) => day.focusSeconds));
  return <section className="dashboard-section" aria-labelledby="focus-calendar-title">
    <div className="section-title"><h2 id="focus-calendar-title">Daily focus</h2><span>Choose a day to open History</span></div>
    <div className="insight-card">
      <div className="focus-calendar" role="group" aria-label={`Focus calendar for ${insights.label}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="focus-calendar__weekday" key={day}>{day}</span>)}
        {Array.from({ length: insights.firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {insights.days.map((day) => {
          const level = day.focusSeconds === 0 ? 0 : Math.max(1, Math.ceil(day.focusSeconds / max * 4));
          const details = `${day.date}: ${insightDuration(day.focusSeconds)} focused, ${day.completedSessions} completed sessions, ${day.otherSessions} partial or untimed sessions`;
          return <button type="button" className={`focus-calendar__day heat-${level}`} key={day.date} disabled={day.future} title={day.future ? `${day.date}: future day` : `${details}. Open History.`} aria-label={day.future ? `${day.date}: future day` : `${details}. Open History.`} onClick={() => onSelectDay(day.date)}><b>{day.day}</b><small>{day.future ? "—" : insightDuration(day.focusSeconds)}</small></button>;
        })}
      </div>
      <div className="heatmap-legend"><span>Less focus</span>{[0, 1, 2, 3, 4].map((level) => <i className={`heat-${level}`} key={level} aria-hidden="true" />)}<span>More focus</span></div>
      <p className="insight-note">Intensity is relative to this month’s busiest day. All focused time is assigned to the saved interval’s local start date.</p>
    </div>
  </section>;
}
