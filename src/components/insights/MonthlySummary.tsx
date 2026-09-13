import { MonthlyInsights, insightDuration } from "../../services/insights";

export default function MonthlySummary({ insights }: { insights: MonthlyInsights }) {
  const { comparison } = insights;
  const difference = comparison.differenceSeconds;
  const change = comparison.percent === null
    ? comparison.previousSeconds === 0 && insights.focusSeconds === 0 ? "No change" : "No previous focus time"
    : difference === 0 ? "No change" : `${difference > 0 ? "+" : "−"}${Math.abs(comparison.percent).toLocaleString([], { maximumFractionDigits: 1 })}%`;
  return <section className="dashboard-section" aria-labelledby="monthly-summary-title">
    <div className="section-title"><h2 id="monthly-summary-title">Monthly summary</h2></div>
    <div className="stat-grid">
      <div className="stat"><span>Focused time</span><b>{insightDuration(insights.focusSeconds)}</b></div>
      <div className="stat"><span>Completed sessions</span><b>{insights.completedSessions}</b></div>
      <div className="stat"><span>Active days</span><b>{insights.activeDays}</b></div>
      <div className="stat"><span>Focus time change</span><b className="insight-change">{change}</b></div>
    </div>
  </section>;
}
