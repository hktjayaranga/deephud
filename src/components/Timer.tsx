import { TimerState, displayMs, formatMs } from "../services/timer";

interface TimerProps {
  state: TimerState;
  sessionName: string;
}

export default function Timer({ state, sessionName }: TimerProps) {
  const displayedMs = displayMs(state);
  const progress = state.mode === "countdown"
    ? Math.min(100, (state.elapsedMs / state.targetMs) * 100)
    : (state.elapsedMs % (60 * 60 * 1000)) / (60 * 60 * 10);

  return (
    <div className="timer">
      {sessionName && <div className="timer__session" title={sessionName}>{sessionName}</div>}
      <div className={`timer__clock ${displayedMs >= 60 * 60 * 1000 ? "timer__clock--hours" : ""}`}>{formatMs(displayedMs)}</div>
      <div className="timer__progress" role="progressbar" aria-label="Timer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
