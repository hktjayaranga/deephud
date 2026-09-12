import { MonthlyInsights, insightDuration } from "../../services/insights";

export default function MonthlySummary({ insights }: { insights: MonthlyInsights }) {
  const { comparison } = insights;
  const difference = comparison.differenceSeconds;
  const change = comparison.percent === null
    ? comparison.previousSeconds === 0 && insights.focusSeconds === 0 ? "No change" : "No previous focus time"
    : difference === 0 ? "No change" : `${difference > 0 ? "+" : "−"}${Math.abs(comparison.percent).toLocaleString([], { maximumFractionDigits: 1 })}%`;
  const date = (value: Date) => value.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const time = (value: Date) => value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const range = (start: Date, end: Date) => `${date(start)} – ${date(end)} ${time(end)}`;
  return <section className="dashboard-section" aria-labelledby="monthly-summary-title">
    <div className="section-title"><h2 id="monthly-summary-title">Monthly summary</h2></div>
    <div className="stat-grid">
      <div className="stat"><span>Focused time</span><b>{insightDuration(insights.focusSeconds)}</b></div>
      <div className="stat"><span>Completed sessions</span><b>{insights.completedSessions}</b></div>
      <div className="stat"><span>Active days</span><b>{insights.activeDays}</b></div>
      <div className="stat"><span>Focus time change</span><b className="insight-change">{change}</b></div>
    </div>
    <p className="insight-note">Totals include saved intervals started within the period. One completed session is one finished focus block. {insights.otherSessions} partial or untimed {insights.otherSessions === 1 ? "session also contributes" : "sessions also contribute"} to focused time.</p>
    <p className="insight-note">{comparison.ongoing ? <>Month to date, compared through the same local day and time in the previous month (or its end if shorter).<br />{range(comparison.currentStart, comparison.currentEnd)} versus {range(comparison.previousStart, comparison.previousEnd)}.</> : <>Full month compared with {comparison.previousStart.toLocaleDateString([], { month: "long", year: "numeric" })}.</>}<br />Previous: {insightDuration(comparison.previousSeconds)} · {difference === 0 ? "No difference" : `${insightDuration(Math.abs(difference))} ${difference > 0 ? "more" : "less"} focus time`}.</p>
  </section>;
}
