import { TimerStatus } from "../services/timer";

interface ControlsProps {
  status: TimerStatus;
  activeSession: boolean;
  onStartPause: () => void;
  onReset: () => void;
  onToday: () => void;
  onNewSession: () => void;
  onExpand: () => void;
  openPopover?: "audio" | "more" | null;
  onMore?: () => void;
}

type IconName = "play" | "pause" | "reset" | "close" | "expand" | "audio" | "more" | "target" | "chart" | "settings" | "minus" | "plus" | "skip";

export function Icon({ name }: { name: IconName }) {
  if (name === "play") return <svg viewBox="0 0 24 24"><path className="fill" d="m8 5 11 7-11 7Z" /></svg>;
  if (name === "pause") return <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>;
  if (name === "reset") return <svg viewBox="0 0 24 24"><path d="M4 4v6h6M5.5 15a7 7 0 1 0 .6-7.1L4 10" /></svg>;
  if (name === "close") return <svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>;
  if (name === "expand") return <svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>;
  if (name === "audio") return <svg viewBox="0 0 24 24"><path d="M4 14v-4a8 8 0 0 1 16 0v4"/><path d="M6 13H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2Zm12 0h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2Z"/></svg>;
  if (name === "more") return <svg viewBox="0 0 24 24"><circle className="fill" cx="5" cy="12" r="1.6"/><circle className="fill" cx="12" cy="12" r="1.6"/><circle className="fill" cx="19" cy="12" r="1.6"/></svg>;
  if (name === "target") return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/></svg>;
  if (name === "chart") return <svg viewBox="0 0 24 24"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>;
  if (name === "minus") return <svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>;
  if (name === "plus") return <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>;
  if (name === "skip") return <svg viewBox="0 0 24 24"><path d="m5 5 10 7-10 7ZM19 5v14"/></svg>;
  if (name === "settings") return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>;
  return null;
}

export default function Controls({ status, activeSession, onStartPause, onReset, onToday, onNewSession, onExpand, openPopover = null, onMore }: ControlsProps) {
  const primaryLabel = status === "running" ? "Pause" : "Start";
  const resetLabel = activeSession ? "End & save session" : "Reset";
  return <div className="controls">
    <button className="controls__primary" onClick={onStartPause} title={primaryLabel} aria-label={primaryLabel}><Icon name={status === "running" ? "pause" : "play"} /></button>
    <button className="control-reset" onClick={onReset} title={resetLabel} aria-label={resetLabel}><Icon name={activeSession ? "close" : "reset"} /></button>
    <button className="control-focus" onClick={onNewSession} disabled={activeSession} title={activeSession ? "End & save the current session before starting a new focus session" : "Start focus session"} aria-label="Start focus session"><Icon name="target" /></button>
    <button className="control-queue" onClick={onToday} title="Today’s task queue" aria-label="Today’s task queue"><svg viewBox="0 0 24 24"><path d="m3 6 2 2 3-4M11 6h10M3 13h4M11 13h10M3 20h4M11 20h10" /></svg></button>
    <button className={`control-more ${openPopover === "more" ? "is-active" : ""}`} onClick={onMore} title="More controls" aria-label="More controls" aria-expanded={openPopover === "more"} aria-controls="hud-more-controls"><Icon name="more" /></button>
    <button className="control-expand" onClick={onExpand} title="Expand HUD" aria-label="Expand HUD and show all controls"><Icon name="expand" /></button>
  </div>;
}
