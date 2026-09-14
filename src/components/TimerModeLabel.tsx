import { SessionPlan } from "../services/session";
import { TimerState } from "../services/timer";

interface Props {
  state: TimerState;
  plan: SessionPlan | null;
  onSwitch: () => void;
}

export default function TimerModeLabel({ state, plan, onSwitch }: Props) {
  const label = plan?.phase === "break"
    ? plan.breakKind === "long" ? "LONG BREAK" : "BREAK"
    : plan?.kind === "pomodoro" ? "POMODORO"
    : plan?.kind === "stopwatch" || (!plan && state.mode === "stopwatch") ? "STOPWATCH"
    : plan ? "DEEP WORK" : "COUNTDOWN";
  const content = <><span className="status-dot" aria-hidden="true" /><span>{label}</span></>;

  if (!plan && state.status === "idle") {
    const action = state.mode === "stopwatch" ? "Switch to Countdown" : "Switch to Stopwatch";
    return <button type="button" className="brand brand--switch" title={action} aria-label={`${label}. ${action}`} onClick={onSwitch}>{content}</button>;
  }
  return <div className="brand" title={label} aria-label={label}>{content}</div>;
}
