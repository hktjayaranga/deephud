import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import Dashboard, { filterHistoryRecords } from "../src/components/Dashboard";
import { SessionRecord } from "../src/services/database";
import { exportSessions } from "../src/services/dataTransfer";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(), readTextFile: vi.fn(), stat: vi.fn() }));

function record(id: number, day: string, project: string, task: string): SessionRecord {
  return {
    id, startedAt: new Date(`${day}T09:00:00`).toISOString(),
    endedAt: new Date(`${day}T09:25:00`).toISOString(),
    project, task, workSessionId: "shared-session", sessionKind: "pomodoro",
    plannedMinutes: 25, focusSeconds: 1500, pausedSeconds: 0,
  };
}
const records = [
  record(1, "2026-09-12", "DeepHUD", "Review export"),
  record(2, "2026-09-13", "DeepHUD", "Review export"),
  record(3, "2026-09-13", "Other", "Review export"),
  record(4, "2026-09-13", "DeepHUD", "Write notes"),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(save).mockResolvedValue("/tmp/history-export");
  vi.mocked(writeTextFile).mockResolvedValue();
});
afterEach(() => vi.unstubAllGlobals());

describe("history export scope", () => {
  it.each(["csv", "json"] as const)("exports only matching intervals to %s, then all history independently", async (format) => {
    const filtered = filterHistoryRecords(records, " review ", "DeepHUD", "2026-09-13");
    expect(filtered.map((item) => item.id)).toEqual([2]);
    await exportSessions(format, filtered);
    const filteredContent = vi.mocked(writeTextFile).mock.calls[0][1];
    if (format === "json") expect(JSON.parse(filteredContent)).toEqual([records[1]]);
    else {
      expect(filteredContent.split("\n")).toHaveLength(2);
      expect(filteredContent).toContain(records[1].startedAt);
      expect(filteredContent).not.toContain("Other");
      expect(filteredContent).not.toContain("Write notes");
    }
    await exportSessions(format, records);
    const allContent = vi.mocked(writeTextFile).mock.calls[1][1];
    if (format === "json") expect(JSON.parse(allContent)).toEqual(records);
    else expect(allContent.split("\n")).toHaveLength(records.length + 1);
  });

  it("returns all records without filters and none for a nonmatching filter", () => {
    expect(filterHistoryRecords(records)).toEqual(records);
    expect(filterHistoryRecords(records, "missing task")).toEqual([]);
  });

  it("does not write a file when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    await exportSessions("csv", records);
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});

function renderHistory(sessions: SessionRecord[]) {
  return renderToStaticMarkup(createElement(Dashboard, {
    tab: "history", onTabChange: vi.fn(), sessions, goalMinutes: 240,
    onDelete: vi.fn(), onUpdate: vi.fn(), onExport: vi.fn(), onBackup: vi.fn(),
    onRestore: vi.fn(), onResetDatabase: vi.fn(), onToday: vi.fn(), onClose: vi.fn(), onDragStart: vi.fn(),
  }));
}

describe("history export controls", () => {
  it("labels both scopes with interval counts rather than grouped-session counts", () => {
    const html = renderHistory(records);
    expect(html).toContain("Export filtered results (4 records)");
    expect(html).toContain("Export all history (4 records)");
    expect(html).toContain("Each record is one focus interval");
    expect(html).toContain("Export format");
    expect(html).toContain('value="csv"');
    expect(html).toContain('value="json"');
  });

  it("disables both exports for empty history", () => {
    const html = renderHistory([]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export filtered results \(0 records\)/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Export all history \(0 records\)/);
  });
});
