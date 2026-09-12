import { beforeEach, describe, expect, it } from "vitest";
import { SETTINGS_KEY, defaultSettings, loadSettings, saveSettings } from "../src/services/settings";

describe("settings persistence", () => {
  beforeEach(() => localStorage.clear());

  it("loads production defaults", () => {
    expect(loadSettings()).toEqual(defaultSettings);
  });

  it("round-trips custom settings and preserves nested shortcut defaults", () => {
    saveSettings({ ...defaultSettings, opacity: 72, shortcuts: { ...defaultSettings.shortcuts, reset: "Ctrl+Shift+R" } });
    expect(loadSettings().opacity).toBe(72);
    expect(loadSettings().shortcuts.reset).toBe("Ctrl+Shift+R");
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    delete stored.shortcuts.showHide;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    expect(loadSettings().shortcuts.showHide).toBe(defaultSettings.shortcuts.showHide);
  });

  it("falls back safely when persisted settings are malformed", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, opacity: "invisible", clickThrough: "yes" }));
    expect(loadSettings()).toEqual(defaultSettings);
  });
});

it("preserves timer sound preferences across reloads", () => {
  saveSettings({ ...defaultSettings, sound: false, countdownSound: false, transitionSound: true, volume: 23 });
  expect(loadSettings()).toMatchObject({ sound: false, countdownSound: false, transitionSound: true, volume: 23 });
});

it("migrates older sound settings without unmuting the user", () => {
  const { countdownSound, transitionSound, ...legacy } = defaultSettings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...legacy, sound: false }));
  expect(loadSettings()).toMatchObject({ sound: false, countdownSound: true, transitionSound: true });
});
