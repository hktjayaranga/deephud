export interface ShortcutKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type ShortcutCapture =
  | { status: "cancelled" }
  | { status: "waiting"; message: string }
  | { status: "invalid"; message: string }
  | { status: "captured"; shortcut: string };

const modifierCodes = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

const supportedNamedCodes = new Set([
  "Backquote", "Backslash", "BracketLeft", "BracketRight", "Pause", "Comma",
  "Equal", "Minus", "Period", "Quote", "Semicolon", "Slash", "Backspace",
  "CapsLock", "Enter", "Space", "Tab", "Delete", "End", "Home", "Insert",
  "PageDown", "PageUp", "PrintScreen", "ScrollLock", "ArrowDown", "ArrowLeft",
  "ArrowRight", "ArrowUp", "NumLock", "NumpadAdd", "NumpadDecimal",
  "NumpadDivide", "NumpadEnter", "NumpadEqual", "NumpadMultiply", "NumpadSubtract",
  "AudioVolumeDown", "AudioVolumeUp", "AudioVolumeMute", "MediaPlay", "MediaPause",
  "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious",
]);

function shortcutKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  return supportedNamedCodes.has(code) ? code : null;
}

export function captureShortcut(event: ShortcutKeyEvent): ShortcutCapture {
  if (event.key === "Escape") return { status: "cancelled" };
  if (modifierCodes.has(event.code)) return { status: "waiting", message: "Add a non-modifier key." };

  const key = shortcutKey(event.code);
  if (!key) return { status: "invalid", message: "That key cannot be used as a global shortcut." };

  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Super" : "",
  ].filter(Boolean);

  if (modifiers.length === 0 && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return { status: "invalid", message: "Include Ctrl, Alt, Shift, or Meta." };
  }

  return { status: "captured", shortcut: [...modifiers, key].join("+") };
}

export function shortcutIdentity(shortcut: string): string {
  return shortcut.replace(/\s+/g, "").toLowerCase();
}

export function displayShortcut(shortcut: string): string {
  return shortcut ? shortcut.split("+").join(" + ") : "Not set";
}
