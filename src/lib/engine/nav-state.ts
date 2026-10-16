/**
 * The menu as a member leaves it (H-333): which groups are collapsed and whether the desktop sidebar is a slim rail. Kept on the
 * membership so a phone and a desktop agree. Pure: the store and the action read and write through these.
 */
export type NavState = { collapsed: Record<string, boolean>; rail: boolean };

export const EMPTY_NAV: NavState = { collapsed: {}, rail: false };

/** Whatever the column holds, as a sound state: unknown shapes fall back to everything open, the full sidebar. */
export function navStateOf(raw: unknown): NavState {
  if (!raw || typeof raw !== "object") return EMPTY_NAV;
  const o = raw as { collapsed?: unknown; rail?: unknown };
  const collapsed: Record<string, boolean> = {};
  if (o.collapsed && typeof o.collapsed === "object") for (const [k, v] of Object.entries(o.collapsed as Record<string, unknown>)) if (v === true && k.length <= 40) collapsed[k] = true;
  return { collapsed, rail: o.rail === true };
}

/** A group shows open when it isn't collapsed, and always when it holds the current page, so the member can see where they are. */
export const isOpen = (state: NavState, label: string, currentLabel: string | null): boolean => label === currentLabel || !state.collapsed[label];

export const allCollapsed = (state: NavState, labels: string[]): boolean => labels.length > 0 && labels.every((l) => Boolean(state.collapsed[l]));

export function toggleGroup(state: NavState, label: string): NavState {
  const collapsed = { ...state.collapsed };
  if (collapsed[label]) delete collapsed[label];
  else collapsed[label] = true;
  return { ...state, collapsed };
}

/** "Collapse all" shuts every group named; once they are all shut the same control reads "Expand all" and opens them. */
export function toggleAll(state: NavState, labels: string[]): NavState {
  return allCollapsed(state, labels) ? { ...state, collapsed: {} } : { ...state, collapsed: Object.fromEntries(labels.map((l) => [l, true])) };
}

export const RAIL_KEY = "[";

/** The rail shortcut never fires while the member is typing. */
export function isTypingIn(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable === true;
}
