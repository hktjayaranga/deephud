export const deletionCategories = [
  { key: "history", label: "Focus history", detail: "All focus intervals, across all dates and filters. Focus totals and queued-task session progress reset." },
  { key: "queue", label: "Queued tasks", detail: "All queued tasks, including completed and earlier tasks. Saved focus history is kept unless selected above." },
  { key: "thoughts", label: "Saved thoughts", detail: "All saved thoughts, including handled thoughts. Tasks created from them are kept unless selected above." },
  { key: "schedules", label: "Schedules and reminders", detail: "All recurring schedules, pending reminders, and reminder history." },
  { key: "suggestions", label: "Project and task suggestions", detail: "Saved autocomplete suggestions. Project and task names in your history and queue are kept. New sessions can add suggestions again." },
] as const;

export type DeletionCategory = typeof deletionCategories[number]["key"];
export function validateDeletionCategories(value: readonly DeletionCategory[]): DeletionCategory[] {
  if (!Array.isArray(value) || !value.length || value.some(key => !deletionCategories.some(category => category.key === key))) {
    throw new Error("Select at least one valid data category to delete.");
  }
  return [...new Set(value)];
}
