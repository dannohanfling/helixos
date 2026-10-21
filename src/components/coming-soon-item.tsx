"use client";

import { useState } from "react";
import type { NavItem } from "@/components/nav-groups";

/**
 * A menu item for a page on its way (rev 816): greyed, at least 44px tall, a "Coming soon" pill, and no link or route. Tapping
 * or hovering shows its subtitle and nothing else; screen readers hear it as disabled. `row` is the More page's shape.
 */
export function ComingSoonItem({ item, row = false }: { item: NavItem; row?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      title={item.line}
      className={`group flex min-h-11 w-full min-w-0 cursor-default items-center gap-3 rounded-lg text-left text-ink-3 ${row ? "px-2 py-2.5 text-sm" : "px-3 py-1.5 text-sm font-medium"}`}
      data-testid="nav-coming-soon"
      data-href={item.href}
      data-app-off={item.appOffOnly || undefined}
    >
      <span className={`shrink-0 text-center opacity-60 grayscale ${row ? "w-6 text-lg" : "w-5 text-base"}`} aria-hidden>
        {item.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{item.label}</span>
          <span className="badge shrink-0 text-[10px]">Coming soon</span>
        </span>
        <span className={`text-[11px] font-normal [overflow-wrap:anywhere] ${open ? "block" : "hidden group-hover:block group-focus-visible:block"}`} data-testid="nav-coming-soon-line">
          {item.line}
        </span>
      </span>
    </button>
  );
}
