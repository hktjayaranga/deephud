import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "../src/components/SettingsPanel";
import { IdleBehavior, Settings, defaultSettings, effectiveIdleBehavior, idleBehaviorSettings, loadSettings, saveSettings } from "../src/services/settings";
import { validateBackup } from "../src/services/dataTransfer";

beforeEach(() => localStorage.clear());

function renderSettings(settings: Settings) {
  return renderToStaticMarkup(createElement(SettingsPanel, {
    settings, onChange: vi.fn(), onClose: vi.fn(), onDragStart: vi.fn(), onShortcutRecordingChange: vi.fn(),
  }));
}

describe("unified idle settings", () => {
  it.each([
    [false, "pause", "count"], [false, "exclude", "count"], [false, "count", "count"],
    [true, "pause", "pause"], [true, "exclude", "exclude"], [true, "count", "count"],
  ] as [boolean, IdleBehavior, IdleBehavior][])("preserves legacy enabled=%s, behavior=%s as %s", (autoPauseIdle, idleBehavior, expected) => {
    const settings = { ...defaultSettings, autoPauseIdle, idleBehavior };
    saveSettings(settings);
    expect(effectiveIdleBehavior(loadSettings())).toBe(expected);
    const backup = validateBackup({
      application: "DeepHUD", schemaVersion: 1, exportedAt: "2026-09-13T09:00:00Z", settings, sessions: [],
    }, Date.parse("2026-09-13T10:00:00Z"));
    expect(effectiveIdleBehavior(backup.settings)).toBe(expected);
    const html = renderSettings(settings);
    expect(html).toContain(`<option value="${expected}" selected="">`);
    expect(html).not.toContain("Pause when computer is idle");
    expect(html).not.toContain("Exclude idle time");
  });

  it.each(["count", "pause", "exclude"] as const)("persists selecting %s with a consistent enable flag", (behavior) => {
    const settings = { ...defaultSettings, ...idleBehaviorSettings(behavior) };
    saveSettings(settings);
    expect(loadSettings().autoPauseIdle).toBe(behavior !== "count");
    expect(effectiveIdleBehavior(loadSettings())).toBe(behavior);
  });

  it("disables the threshold for Keep counting and explains manual versus automatic resume", () => {
    expect(renderSettings(defaultSettings)).toMatch(/aria-label="Idle threshold in minutes" disabled=""/);
    const manual = renderSettings({ ...defaultSettings, ...idleBehaviorSettings("pause") });
    expect(manual).toContain("Use Resume when you are ready.");
    expect(manual).not.toMatch(/aria-label="Idle threshold in minutes" disabled/);
    const automatic = renderSettings({ ...defaultSettings, ...idleBehaviorSettings("exclude") });
    expect(automatic).toContain("Resume automatically when keyboard or mouse activity returns.");
    expect(automatic).toContain("Time before the pause remains counted.");
  });
});
