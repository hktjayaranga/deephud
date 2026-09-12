import { useEffect, useRef } from "react";

interface Props {
  text: string;
  busy: boolean;
  error: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}
export default function DistractionCapture({ text, busy, error, onChange, onSave, onCancel }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy]);
  return <form className="hud-popover distraction-capture" role="dialog" aria-labelledby="capture-title" aria-busy={busy}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); } }}
    onSubmit={(event) => { event.preventDefault(); if (text.trim() && !busy) onSave(); }}>
    <div className="hud-popover__header"><span id="capture-title">Save for later</span></div>
    <label className="sr-only" htmlFor="capture-text">Thought to save for later</label>
    <input ref={input} id="capture-text" value={text} maxLength={500} placeholder="What’s on your mind?" disabled={busy} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="hud-popover__actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Save"}</button></div>
  </form>;
}
