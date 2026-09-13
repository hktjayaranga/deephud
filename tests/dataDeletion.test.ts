import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { deleteData, ensureProjectTask, getProjects, getSessions, saveSession } from "../src/services/database";
import { DeletionCategory, deletionCategories } from "../src/services/dataDeletion";
import { QUEUE_KEY } from "../src/services/taskQueue";
import { CAPTURES_KEY } from "../src/services/distractions";
import { SCHEDULES_KEY } from "../src/services/schedules";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const keys = { queue: QUEUE_KEY, thoughts: CAPTURES_KEY, schedules: SCHEDULES_KEY };
const session = { startedAt: "2026-09-01T09:00:00Z", endedAt: "2026-09-01T09:25:00Z", plannedMinutes: 25, focusSeconds: 1500, pausedSeconds: 0, project: "Project", task: "Task", sessionKind: "deep-work" as const };

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  await saveSession(session);
  for (const key of Object.values(keys)) localStorage.setItem(key, `saved:${key}`);
  localStorage.setItem("deepwork-hud:settings", "settings kept");
  localStorage.setItem("deepwork-hud:audio", "audio kept");
});

describe("selective data deletion", () => {
  it.each(Array.from({ length: 31 }, (_, index) => index + 1))("preserves every unchecked category for selection mask %i", async mask => {
    const selected = deletionCategories.filter((_, index) => mask & (1 << index)).map(category => category.key);
    const projects = await getProjects();
    await deleteData(selected);
    expect((await getSessions()).length).toBe(selected.includes("history") ? 0 : 1);
    expect(await getProjects()).toEqual(selected.includes("suggestions") ? [] : projects);
    for (const [category, key] of Object.entries(keys)) {
      expect(localStorage.getItem(key)).toBe(selected.includes(category as DeletionCategory) ? null : `saved:${key}`);
    }
    expect(localStorage.getItem("deepwork-hud:settings")).toBe("settings kept");
    expect(localStorage.getItem("deepwork-hud:audio")).toBe("audio kept");
  });

  it("rejects empty and invalid requests without deleting history", async () => {
    await expect(deleteData([])).rejects.toThrow("Select at least one");
    await expect(deleteData(["unknown" as DeletionCategory])).rejects.toThrow("Select at least one");
    expect(await getSessions()).toHaveLength(1);
  });

  it("rolls back when one selected browser storage deletion fails", async () => {
    const remove = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, "removeItem").mockImplementationOnce(remove).mockImplementationOnce(() => { throw new Error("storage failed"); });
    await expect(deleteData(["history", "queue"])).rejects.toThrow("storage failed");
    expect(await getSessions()).toHaveLength(1);
    expect(localStorage.getItem(QUEUE_KEY)).toBe(`saved:${QUEUE_KEY}`);
    expect(await getProjects()).toHaveLength(1);
  });

  it("allows new suggestions after clearing the catalog without resurrecting old history names", async () => {
    await deleteData(["suggestions"]);
    await ensureProjectTask("New project", "New task");
    expect((await getProjects()).map(project => project.name)).toEqual(["New project"]);
    expect((await getSessions())[0].project).toBe("Project");
  });

  it("sends only the selected categories to the desktop command", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await deleteData(["queue", "thoughts"]);
    expect(invoke).toHaveBeenCalledWith("delete_data", { categories: ["queue", "thoughts"] });
  });
});
