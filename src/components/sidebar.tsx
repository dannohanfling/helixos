"use client";

import type { ReactNode } from "react";
import { useNavState } from "./nav-state";

/**
 * The desktop sidebar (H-333): the full column, or a slim rail of icons after the fold button (or "["). The parts that have no
 * place on a rail carry `rail-hide`; the rail's own small parts carry `rail-only` (globals.css shows one set or the other). The
 * page beside it takes the width the rail gives back.
 */
export function Sidebar({ children }: { children: ReactNode }) {
  const nav = useNavState();
  const rail = nav.state.rail;
  return (
    <aside className={`hidden shrink-0 flex-col border-r bg-surface py-4 md:flex md:sticky md:top-0 md:h-screen ${rail ? "w-14" : "w-60"}`} data-rail={rail ? "true" : "false"} data-testid="sidebar">
      <button
        type="button"
        onClick={() => nav.setRail(!rail)}
        className={`mb-2 flex h-9 items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink ${rail ? "mx-auto w-9 justify-center" : "ml-auto mr-3 px-2 text-xs"}`}
        aria-pressed={rail}
        aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar to icons"}
        title={rail ? "Expand the sidebar ( [ )" : "Collapse the sidebar ( [ )"}
        data-testid="nav-rail-toggle"
      >
        <span aria-hidden>{rail ? "»" : "«"}</span>
        {rail ? null : <span className="ml-1">Collapse</span>}
      </button>
      {children}
    </aside>
  );
}
