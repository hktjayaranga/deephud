import { MonthlyInsights, insightDuration } from "../../services/insights";

export default function ProjectComparison({ insights }: { insights: MonthlyInsights }) {
  const max = Math.max(1, ...insights.projects.map((project) => project.focusSeconds));
  return <section className="dashboard-section" aria-labelledby="monthly-projects-title"><div className="section-title"><h2 id="monthly-projects-title">Project comparison</h2><span>{insights.label}</span></div>
    <div className="insight-card">{insights.projects.length ? <ul className="project-comparison">{insights.projects.map((project) => <li key={project.name}>
      <div><b>{project.name}</b><span>{insightDuration(project.focusSeconds)} · {insights.focusSeconds ? Math.round(project.focusSeconds / insights.focusSeconds * 100) : 0}%</span></div>
      <div className="insight-bar" aria-hidden="true"><i style={{ width: `${project.focusSeconds / max * 100}%` }} /></div>
    </li>)}</ul> : <p className="insight-note">No saved focus time for this month yet.</p>}</div>
  </section>;
}
