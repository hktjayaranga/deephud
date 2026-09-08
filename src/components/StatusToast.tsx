import { useEffect, useState } from "react";

interface Props {
  text: string;
  onDismiss: () => void;
}

/** Keep the message mounted during its exit so both dismissal paths animate. */
export default function StatusToast({ text, onDismiss }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setLeaving(true), 3500);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timeout = window.setTimeout(onDismiss, 240);
    return () => window.clearTimeout(timeout);
  }, [leaving, onDismiss]);

  return <div className={`status-toast${leaving ? " status-toast--leaving" : ""}`}>
    <span className="status-toast__icon" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none"><path d="m10 3 1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8L10 3Z" /></svg>
    </span>
    <span className="status-toast__text" role="status" aria-live="polite" aria-atomic="true" title={text}>{text}</span>
    <button className="status-toast__close" type="button" aria-label="Dismiss notification" title="Dismiss notification" disabled={leaving} onClick={() => setLeaving(true)}>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg>
    </button>
    <span className="status-toast__lifetime" aria-hidden="true" />
  </div>;
}
