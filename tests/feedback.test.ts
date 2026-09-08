import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HistoryList } from "../src/components/Dashboard";
import ErrorNotice from "../src/components/ErrorNotice";
import { groupSessions } from "../src/services/sessionHistory";

describe("history empty states", () => {
  it("keeps first-use guidance when history is empty without filters", () => {
    const markup = renderToStaticMarkup(createElement(HistoryList, { sessions: [], onDelete: vi.fn() }));
    expect(markup).toContain("No focus sessions yet");
    expect(markup).not.toContain("Clear filters");
  });

  it("offers clearing filters when the filtered list is empty", () => {
    const markup = renderToStaticMarkup(createElement(HistoryList, { sessions: [], onDelete: vi.fn(), onClearFilters: vi.fn() }));
    expect(markup).toContain("No matching sessions");
    expect(markup).toContain("Clear filters</button>");
    expect(markup).not.toContain("No focus sessions yet");
  });

  it("continues showing matching records and deletion controls with filters active", () => {
    const sessions = groupSessions([{ id: 1, startedAt: "2026-09-08T09:00:00Z", endedAt: "2026-09-08T09:25:00Z", focusSeconds: 1500, pausedSeconds: 0, plannedMinutes: 25, project: "DeepHUD", task: "Review", sessionKind: "deep-work" }]);
    const markup = renderToStaticMarkup(createElement(HistoryList, { sessions, onDelete: vi.fn(), onClearFilters: vi.fn() }));
    expect(markup).toContain("Review");
    expect(markup).toContain('aria-label="Delete interval"');
    expect(markup).not.toContain("No matching sessions");
    expect(markup).not.toContain("Clear filters");
  });
});

describe("error guidance", () => {
  it("provides a recovery action and safely renders technical details without invoking actions", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const markup = renderToStaticMarkup(createElement(ErrorNotice, {
      title: "History storage needs attention", message: "Check disk space, then reload history.",
      details: "Cannot open <history>", actionLabel: "Reload history", onAction, onDismiss,
    }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Reload history</button>");
    expect(markup).toContain("Dismiss</button>");
    expect(markup).toContain("Cannot open &lt;history&gt;");
    expect(onAction).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
