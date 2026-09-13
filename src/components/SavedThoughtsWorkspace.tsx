import { ComponentProps, ReactNode } from "react";
import { pendingCaptures } from "../services/distractions";
import CaptureReview from "./CaptureReview";

type Props = ComponentProps<typeof CaptureReview> & {
  onToday: () => void;
  onClose: () => void;
  onDragStart: () => void;
  notices?: ReactNode;
};

export default function SavedThoughtsWorkspace({ onToday, onClose, onDragStart, notices, ...reviewProps }: Props) {
  return <section className="workspace saved-thoughts-workspace">
    <header className="workspace__header" data-tauri-drag-region onMouseDown={onDragStart}>
      <div><span className="eyebrow">REVIEW AT YOUR PACE</span><h1>Saved for later</h1></div>
      <button type="button" className="workspace-nav-button" onClick={onToday}>Today</button>
      <button type="button" className="icon-button" onClick={onClose} title="Back to timer" aria-label="Back to timer">←</button>
    </header>
    <div className="workspace__content">
      {notices}
      {reviewProps.ready && <p className="queue-hint">To review · {pendingCaptures(reviewProps.captures).length}</p>}
      <CaptureReview {...reviewProps} />
    </div>
  </section>;
}
