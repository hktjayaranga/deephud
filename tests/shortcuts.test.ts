import { describe, expect, it } from "vitest";
import { captureShortcut, displayShortcut, shortcutIdentity } from "../src/services/shortcuts";

const keyEvent = (patch: Partial<Parameters<typeof captureShortcut>[0]> = {}) => ({
  key: "r",
  code: "KeyR",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...patch,
});

describe("shortcut recording", () => {
  it("captures supported combinations in canonical modifier order", () => {
    expect(captureShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toEqual({
      status: "captured",
      shortcut: "Ctrl+Alt+R",
    });
  });

  it("waits after modifier-only input and rejects unsafe bare letters", () => {
    expect(captureShortcut(keyEvent({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toMatchObject({ status: "waiting" });
    expect(captureShortcut(keyEvent())).toMatchObject({ status: "invalid" });
  });

  it("allows bare function keys and cancels with Escape", () => {
    expect(captureShortcut(keyEvent({ key: "F8", code: "F8" }))).toEqual({ status: "captured", shortcut: "F8" });
    expect(captureShortcut(keyEvent({ key: "Escape", code: "Escape" }))).toEqual({ status: "cancelled" });
  });

  it("normalizes identities and formats shortcuts for display", () => {
    expect(shortcutIdentity(" Ctrl + ALT + R ")).toBe("ctrl+alt+r");
    expect(displayShortcut("Ctrl+Alt+Space")).toBe("Ctrl + Alt + Space");
    expect(displayShortcut("")).toBe("Not set");
  });
});
