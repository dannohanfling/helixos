"use client";

import type { ReactNode } from "react";
import { CollapseAllButton, useNavState } from "./nav-state";

/**
 * The desktop sidebar (H-333): the full column, or a slim rail of icons after the fold button (or "["). The parts that have no
 * place on a rail carry `rail-hide`; the rail's own small parts carry `rail-only` (globals.css shows one set or the other). The
 * page beside it takes the width the rail gives back. Its controls live in the foot (H-499), see SidebarFoot.
 */
export function Sidebar({ children }: { children: ReactNode }) {
  const nav = useNavState();
  const rail = nav.state.rail;
  return (
    <aside className={`hidden shrink-0 flex-col border-r bg-surface py-4 md:flex md:sticky md:top-0 md:h-screen ${rail ? "w-14" : "w-60"}`} data-rail={rail ? "true" : "false"} data-testid="sidebar">
      {children}
    </aside>
  );
}

/**
 * The sidebar's controls (H-499), one row at the bottom left, above Settings and the member row: the fold button first, so it
 * sits on the same spot open or folded (6 px from the edge either way), then "Collapse all" / "Expand all" while it is open.
 * Both are 44 px tall. The list above scrolls on its own; this row never scrolls away.
 */
export function SidebarFoot({ labels }: { labels: string[] }) {
  const nav = useNavState();
  const rail = nav.state.rail;
  return (
    <div className={`mt-3 flex items-center gap-1 border-t pt-2 ${rail ? "justify-center px-1" : "px-1.5"}`} data-testid="sidebar-foot">
      <button
        type="button"
        onClick={() => nav.setRail(!rail)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-base text-ink-3 hover:bg-surface-2 hover:text-ink"
        aria-pressed={rail}
        aria-label={rail ? "Expand menu" : "Collapse menu"}
        title={rail ? "Expand menu ( [ )" : "Collapse menu ( [ )"}
        data-testid="nav-rail-toggle"
      >
        <span aria-hidden>{rail ? "»" : "«"}</span>
      </button>
      {rail ? null : <CollapseAllButton labels={labels} className="px-2" />}
    </div>
  );
}
