import { useRef, useState } from "react";

interface Props {
  title: string;
  message: string;
  details: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
  onDismiss: () => void;
}

export default function ErrorNotice({ title, message, details, actionLabel, onAction, onDismiss }: Props) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const act = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult("");
    try { await onAction(); }
    catch { setResult("Still unavailable. Check the details below and try again."); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="error-help" aria-label={title}>
    <div role="alert"><strong>{title}</strong><p>{message}</p></div>
    <button type="button" disabled={busy} onClick={() => void act()}>{busy ? "Trying…" : actionLabel}</button>
    <button type="button" disabled={busy} onClick={onDismiss}>Dismiss</button>
    {result && <p role="status">{result}</p>}
    <details><summary>Technical details</summary><pre>{details}</pre></details>
  </section>;
}
