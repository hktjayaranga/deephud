import { useState } from "react";
import DeletionConfirmation from "./DeletionConfirmation";
import { DeletionCategory, deletionCategories } from "../services/dataDeletion";

export default function DeleteDataDialog({ onConfirm, onCancel }: {
  onConfirm: (categories: DeletionCategory[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<DeletionCategory[]>([]);
  return <DeletionConfirmation
    title="Choose what to delete"
    confirmLabel={selected.length ? `Delete selected categories (${selected.length})` : "Select a category to continue"}
    confirmDisabled={!selected.length}
    errorMessage="Could not delete the selected data."
    description={<>
      <p>Tick only the categories you want to permanently delete. Each selection includes all dates, regardless of history filters.</p>
      <div className="deletion-options">{deletionCategories.map(category => <label key={category.key}>
        <input type="checkbox" checked={selected.includes(category.key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, category.key] : previous.filter(key => key !== category.key))} />
        <span><b>{category.label}</b><small>{category.detail}</small></span>
      </label>)}</div>
      <p role="status">{selected.length ? `Will delete: ${deletionCategories.filter(category => selected.includes(category.key)).map(category => category.label).join(", ")}.` : "Nothing selected. No data will be deleted."}</p>
      <p>Unchecked categories, settings, and audio recordings are kept. This cannot be undone. Create a backup first if needed.</p>
    </>}
    onConfirm={() => onConfirm(selected)} onCancel={onCancel}
  />;
}
