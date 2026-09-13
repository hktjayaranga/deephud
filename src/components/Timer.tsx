import { useId } from "react";
import { TimerState, displayMs, formatMs } from "../services/timer";

interface TimerProps {
  state: TimerState;
  sessionName: string;
  endingSoon?: boolean;
  sessionSummary?: string;
}

export default function Timer({ state, sessionName, endingSoon = false, sessionSummary }: TimerProps) {
  const summaryId = useId();
  const displayedMs = displayMs(state);
  const progress = state.mode === "countdown"
    ? Math.min(100, (state.elapsedMs / state.targetMs) * 100)
    : null;

  return (
    <div className={`timer${endingSoon ? " timer--ending-soon" : ""}`} title={endingSoon ? "Five minutes or less remaining" : undefined} tabIndex={sessionSummary ? 0 : undefined} aria-describedby={sessionSummary ? summaryId : undefined}>
      {endingSoon && <span className="sr-only">Five minutes or less remaining</span>}
      {sessionName && <div className="timer__session" title={sessionName}>{sessionName}</div>}
      <div className={`timer__clock ${displayedMs >= 60 * 60 * 1000 ? "timer__clock--hours" : ""}`}>{formatMs(displayedMs)}</div>
      {sessionSummary && <div className="timer__summary" id={summaryId}>{sessionSummary}</div>}
      {progress !== null && <div className="timer__progress" role="progressbar" aria-label="Timer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>}
    </div>
  );
}
