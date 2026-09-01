import { TimerState, displayMs, formatMs } from "../services/timer";

interface TimerProps {
  state: TimerState;
  sessionName: string;
}

export default function Timer({ state, sessionName }: TimerProps) {
  const progress = state.mode === "countdown"
    ? Math.min(100, (state.elapsedMs / state.targetMs) * 100)
    : (state.elapsedMs % (60 * 60 * 1000)) / (60 * 60 * 10);

  return (
    <div className="timer">
      {sessionName && <div className="timer__session" title={sessionName}>{sessionName}</div>}
      <div className="timer__clock">{formatMs(displayMs(state))}</div>
      <div className="timer__progress" aria-label={`${Math.round(progress)}% complete`}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
