import DeletionConfirmation from "./DeletionConfirmation";

interface Props {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function HistoryConfirmation({ onConfirm, onCancel }: Props) {
  return <DeletionConfirmation
    title="Delete this focus interval?"
    confirmLabel="Delete interval"
    errorMessage="Could not delete this focus interval."
    description={<p>This permanently deletes only the selected focus interval. Focus totals and any linked task’s session progress will be recalculated. Other intervals and the task itself are kept. This cannot be undone.</p>}
    onConfirm={onConfirm} onCancel={onCancel}
  />;
}
