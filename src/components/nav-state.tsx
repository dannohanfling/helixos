"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveNavStateAction } from "@/lib/actions/nav";
import { DEFAULT_CLOSED, EMPTY_NAV, RAIL_KEY, allCollapsed, isTypingIn, toggleAll, toggleGroup, type NavState } from "@/lib/engine/nav-state";

type Store = {
  state: NavState;
  /** The groups that start shut for this menu (H-164 §10): the client's four; none on a coach's or a team member's. */
  closed: readonly string[];
  toggle: (label: string) => void;
  toggleAll: (labels: string[]) => void;
  allCollapsed: (labels: string[]) => boolean;
  setRail: (on: boolean) => void;
};

const Ctx = createContext<Store | null>(null);

/**
 * The menu's state for this session (H-333), seeded from the membership on the server so the first paint is already right, and
 * saved back a moment after each change. The sidebar, the phone's More page and the rail all read the one store.
 */
export function NavStateProvider({ initial, persist = true, closed = DEFAULT_CLOSED, children }: { initial: NavState; persist?: boolean; closed?: readonly string[]; children: ReactNode }) {
  const [state, setState] = useState<NavState>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(
    (next: NavState) => {
      if (!persist) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNavStateAction(next).catch(() => undefined), 300);
    },
    [persist],
  );
  const apply = useCallback(
    (f: (s: NavState) => NavState) =>
      setState((s) => {
        const next = f(s);
        save(next);
        return next;
      }),
    [save],
  );
  const store = useMemo<Store>(
    () => ({
      state,
      closed,
      toggle: (label) => apply((s) => toggleGroup(s, label, closed)),
      toggleAll: (labels) => apply((s) => toggleAll(s, labels, closed)),
      allCollapsed: (labels) => allCollapsed(state, labels, closed),
      setRail: (on) => apply((s) => ({ ...s, rail: on })),
    }),
    [state, apply, closed],
  );
  // "[" folds the sidebar to the rail and back, on a desktop, never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== RAIL_KEY || e.metaKey || e.ctrlKey || e.altKey || isTypingIn(document.activeElement)) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      e.preventDefault();
      apply((s) => ({ ...s, rail: !s.rail }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNavState(): Store {
  const s = useContext(Ctx);
  return (
    s ?? {
      state: EMPTY_NAV,
      closed: DEFAULT_CLOSED,
      toggle: () => undefined,
      toggleAll: () => undefined,
      allCollapsed: () => false,
      setRail: () => undefined,
    }
  );
}

/** "Collapse all" / "Expand all", one control at the top of a menu. */
export function CollapseAllButton({ labels, className = "" }: { labels: string[]; className?: string }) {
  const nav = useNavState();
  const all = nav.allCollapsed(labels);
  return (
    <button type="button" onClick={() => nav.toggleAll(labels)} className={`min-h-11 rounded-md px-3 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink ${className}`} data-testid="nav-collapse-all" aria-pressed={all}>
      {all ? "Expand all" : "Collapse all"}
    </button>
  );
}
