/**
 * The menu as a member leaves it (H-333): which groups are collapsed and whether the desktop sidebar is a slim rail. Kept on the
 * membership so a phone and a desktop agree. Pure: the store and the action read and write through these.
 */
/** `collapsed`: true for a group the member shut, false for one they opened that starts shut (DEFAULT_CLOSED); absent, its default. */
export type NavState = { collapsed: Record<string, boolean>; rail: boolean };

/**
 * The client's groups that start shut until opened (H-164 §10): only Daily, and the sections that were always open, start open.
 * A coach's or a team member's menu has none (`NONE_CLOSED`): every group starts open, as it always did.
 */
export const DEFAULT_CLOSED: readonly string[] = ["My business", "Get leads", "My bot", "Learn"];
export const NONE_CLOSED: readonly string[] = [];

export const EMPTY_NAV: NavState = { collapsed: {}, rail: false };

/** Whatever the column holds, as a sound state: unknown shapes fall back to everything open, the full sidebar. */
export function navStateOf(raw: unknown): NavState {
  if (!raw || typeof raw !== "object") return EMPTY_NAV;
  const o = raw as { collapsed?: unknown; rail?: unknown };
  const collapsed: Record<string, boolean> = {};
  if (o.collapsed && typeof o.collapsed === "object") for (const [k, v] of Object.entries(o.collapsed as Record<string, unknown>)) if (typeof v === "boolean" && k.length <= 40 && (v || DEFAULT_CLOSED.includes(k))) collapsed[k] = v;
  return { collapsed, rail: o.rail === true };
}

/** A group shows open when it isn't collapsed, and always when it holds the current page, so the member can see where they are. */
const shut = (state: NavState, label: string, closed: readonly string[] = DEFAULT_CLOSED): boolean => state.collapsed[label] ?? closed.includes(label);
export const isOpen = (state: NavState, label: string, currentLabel: string | null, closed: readonly string[] = DEFAULT_CLOSED): boolean => label === currentLabel || !shut(state, label, closed);

export const allCollapsed = (state: NavState, labels: string[], closed: readonly string[] = DEFAULT_CLOSED): boolean => labels.length > 0 && labels.every((l) => shut(state, l, closed));

/** Opening or shutting one group; a group back at its default is forgotten, so the stored state stays small. */
export function toggleGroup(state: NavState, label: string, closed: readonly string[] = DEFAULT_CLOSED): NavState {
  const collapsed = { ...state.collapsed };
  const next = !shut(state, label, closed);
  if (next === closed.includes(label)) delete collapsed[label];
  else collapsed[label] = next;
  return { ...state, collapsed };
}

/** "Collapse all" shuts every group named; once they are all shut the same control reads "Expand all" and opens them. */
export function toggleAll(state: NavState, labels: string[], closed: readonly string[] = DEFAULT_CLOSED): NavState {
  return allCollapsed(state, labels, closed)
    ? { ...state, collapsed: Object.fromEntries(labels.filter((l) => closed.includes(l)).map((l) => [l, false])) }
    : { ...state, collapsed: Object.fromEntries(labels.map((l) => [l, true])) };
}

export const RAIL_KEY = "[";

/** The rail shortcut never fires while the member is typing. */
export function isTypingIn(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable === true;
}
