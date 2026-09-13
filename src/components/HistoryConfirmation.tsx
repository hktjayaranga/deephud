import { useEffect, useRef, useState } from "react";

interface Props {
  reset: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function HistoryConfirmation({ reset, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const confirmDeletion = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onCancel();
    } catch {
      setError("Unable to delete history. Please try again.");
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="completion-card history-confirmation" aria-labelledby="history-confirmation-title" aria-describedby="history-confirmation-description" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) onCancel(); }}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
    <span aria-hidden="true">!</span>
    <h2 id="history-confirmation-title">{reset ? "Delete all history?" : "Delete this history entry?"}</h2>
    <p id="history-confirmation-description">{reset
      ? "This permanently deletes all focus sessions, task queue items, saved thoughts, focus schedules and reminders, and saved project/task suggestions. Your settings and audio recordings will be kept. This cannot be undone."
      : "This permanently deletes the selected focus interval from your history. Other intervals will be kept. This cannot be undone."}</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div>
      <button type="button" autoFocus disabled={busy} onClick={onCancel}>No, keep</button>
      <button type="button" className="danger-action" disabled={busy} onClick={() => void confirmDeletion()}>{busy ? "Deleting…" : "Yes, delete"}</button>
    </div>
  </dialog>;
}
