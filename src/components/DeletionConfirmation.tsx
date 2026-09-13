import { ReactNode, useEffect, useId, useRef, useState } from "react";

interface Props {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  errorMessage: string;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DeletionConfirmation({ title, description, confirmLabel, errorMessage, confirmDisabled = false, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const descriptionId = useId();
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
    if (pendingRef.current || confirmDisabled) return;
    pendingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onCancel();
    } catch (error) {
      setError(`${errorMessage} ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="completion-card history-confirmation" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) onCancel(); }}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
    <span aria-hidden="true">!</span>
    <h2 id={titleId}>{title}</h2>
    <fieldset className="deletion-description" id={descriptionId} disabled={busy}>{description}</fieldset>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div>
      <button type="button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="danger-action" disabled={busy || confirmDisabled} onClick={() => void confirmDeletion()}>{busy ? "Deleting…" : confirmLabel}</button>
    </div>
  </dialog>;
}
