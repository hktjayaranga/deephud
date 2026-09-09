import { useEffect, useRef, useState } from "react";
import { BreakActivityId, breakActivities, breathingElapsed, breathingProgress, breathingStages, breathingRunProgress, parseBreathingCycles, BREATHING_CYCLE_MS } from "../services/breakActivities";
import { TimerState, displayMs, formatMs } from "../services/timer";
import "./BreakActivities.css";

interface Props {
  state: TimerState;
  selectedActivity: BreakActivityId | null;
  startedMs: number;
  cycles?: number | null;
  onSelect: (activity: BreakActivityId | "none", cycles?: number | null) => void;
}

function BreathingExercise({ state, startedMs, cycles }: Pick<Props, "state" | "startedMs"> & { cycles: number | null }) {
  const [phase, setPhase] = useState(() => breathingProgress(breathingRunProgress(breathingElapsed(state, startedMs), cycles).animationMs));
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const sampledAt = performance.now();
    const track = path.current;
    const marker = dot.current;
    const length = track?.getTotalLength() ?? 0;
    let frame = 0;
    const draw = () => {
      const run = breathingRunProgress(breathingElapsed(state, startedMs, performance.now() - sampledAt), cycles);
      const next = breathingProgress(run.animationMs);
      // React updates the text once per second; the SVG dot moves every frame.
      setPhase(previous => previous.stage === next.stage && previous.count === next.count ? previous : next);
      if (track && marker) {
        const point = track.getPointAtLength(next.progress * length);
        marker.setAttribute("cx", String(point.x));
        marker.setAttribute("cy", String(point.y));
      }
      if (state.status === "running" && !run.complete) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [state.elapsedMs, state.status, state.targetMs, startedMs, cycles]);

  return <div className="breathing-exercise">
    <svg viewBox="0 0 320 280" role="img" aria-label={`${phase.label}, ${phase.count}`}>
      <path ref={path} className="breathing-exercise__track" d="M78 45 H242 Q250 45 250 53 V217 Q250 225 242 225 H78 Q70 225 70 217 V53 Q70 45 78 45 Z" />
      {breathingStages.map((label, index) => <text key={index} x={[160, 285, 160, 35][index]} y={[24, 140, 257, 140][index]} className={`breathing-exercise__label${phase.stage === index ? " is-active" : ""}`}>{label}</text>)}
      <text x="160" y="160" className="breathing-exercise__count">{phase.count}</text>
      {state.status === "paused" && <text x="160" y="185" className="breathing-exercise__label">Paused</text>}
      <circle ref={dot} className="breathing-exercise__dot" cx="78" cy="45" r="8" />
    </svg>
    <span className="sr-only" role="status">{state.status === "paused" ? "Paused" : `${phase.label}${phase.stage === 1 ? " after inhale" : phase.stage === 3 ? " after exhale" : ""}`}</span>
  </div>;
}

function CycleSelector({ state, onStart }: { state: TimerState; onStart: (cycles: number | null) => void }) {
  const [option, setOption] = useState("5");
  const [custom, setCustom] = useState("5");
  const cycles = option === "until" ? null : parseBreathingCycles(option === "custom" ? custom : option);
  const valid = option === "until" || cycles !== null;
  return <form className="breathing-setup" onSubmit={event => { event.preventDefault(); if (valid) onStart(cycles); }}>
    <p>One cycle is 16 seconds: inhale, hold, exhale, hold.</p>
    <fieldset>
      <legend>How many cycles?</legend>
      {[["3", "3 cycles — 48 seconds"], ["5", "5 cycles — 1 minute 20 seconds"], ["10", "10 cycles — 2 minutes 40 seconds"], ["custom", "Custom"], ["until", "Until break ends"]].map(([value, label]) =>
        <label key={value}><input type="radio" name="breathing-cycles" value={value} checked={option === value} onChange={() => setOption(value)} />{label}</label>
      )}
    </fieldset>
    {option === "custom" && <label className="breathing-setup__custom">Number of cycles
      <input type="number" min="1" max="999" step="1" required value={custom} onChange={event => setCustom(event.target.value)} aria-describedby="breathing-custom-help" aria-invalid={!valid} />
      <span id="breathing-custom-help">{valid ? `${formatMs(cycles! * BREATHING_CYCLE_MS)} of breathing` : "Enter a whole number from 1 to 999."}</span>
    </label>}
    <p>{cycles !== null && cycles * BREATHING_CYCLE_MS > displayMs(state) ? "Your break will end before all selected cycles finish." : state.status === "paused" ? "Your break is paused. Resume it to advance the exercise." : "Your break timer keeps running during the exercise."}</p>
    <button className="break-activities__skip breathing-setup__start" type="submit" disabled={!valid}>Start breathing</button>
  </form>;
}

export default function BreakActivities({ state, selectedActivity, startedMs, cycles, onSelect }: Props) {
  const run = selectedActivity === "breathing" && cycles !== undefined ? breathingRunProgress(breathingElapsed(state, startedMs), cycles) : null;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selectedActivity, cycles]);
  return <section key={run ? "exercise" : "selection"} className={`break-activities${run ? " break-activities--running" : ""}`} aria-label="Break activities">
    <div className="break-activities__remaining">{formatMs(displayMs(state))} remaining in your break</div>
    <h2 ref={heading} tabIndex={-1}>{selectedActivity ? "Breathing exercise" : "Choose a break activity"}</h2>
    {selectedActivity === "breathing" ? <>
      {cycles === undefined ? <CycleSelector state={state} onStart={count => onSelect("breathing", count)} /> : <>
        <p className="breathing-cycle-progress">Cycle {run?.cycle}{cycles === null ? " · Until break ends" : ` of ${cycles}`}</p>
        <BreathingExercise key={startedMs} state={state} startedMs={startedMs} cycles={cycles} />
      </>}
      {cycles === undefined && <button type="button" className="break-activities__skip" onClick={() => onSelect("none")}>Back to normal break</button>}
    </> : <>
      <p>Try an activity, or enjoy a break on your own.</p>
      <div className="break-activities__choices">
        {breakActivities.map(activity => <button key={activity.id} type="button" onClick={() => onSelect(activity.id)}><strong>{activity.title}</strong><span>{activity.description}</span></button>)}
      </div>
      <button type="button" className="break-activities__skip" onClick={() => onSelect("none")}>Just take a break</button>
      <p>Your break timer {state.status === "paused" ? "is paused" : "keeps running"}.</p>
    </>}
  </section>;
}
