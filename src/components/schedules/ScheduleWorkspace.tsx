import { ComponentProps, ReactNode } from "react";
import SchedulePanel from "./SchedulePanel";

type Props = ComponentProps<typeof SchedulePanel> & {
  onToday: () => void;
  onClose: () => void;
  onDragStart: () => void;
  notices?: ReactNode;
  reminder?: ReactNode;
};

export default function ScheduleWorkspace({ onToday, onClose, onDragStart, notices, reminder, ...panelProps }: Props) {
  return <section className="workspace schedule-workspace">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">PLAN YOUR FOCUS</span><h1>Schedule</h1></div>
      <button type="button" className="workspace-nav-button" onClick={onToday}>Today</button>
      <button type="button" className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <div className="workspace__content">
      {notices}
      {reminder}
      <SchedulePanel {...panelProps} />
    </div>
  </section>;
}
