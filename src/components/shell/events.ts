// Tiny cross-component signals for the shell (palette, quick add, shortcut help), without a state library.
export const OPEN_PALETTE = "crm:open-palette";
export const OPEN_QUICK_ADD = "crm:open-quick-add";
export const OPEN_SHORTCUTS = "crm:open-shortcuts";

export const emit = (name: string) => window.dispatchEvent(new CustomEvent(name));

/** True while the user is typing in a field: single-key shortcuts must not fire then. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}
