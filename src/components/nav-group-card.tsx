"use client";

import type { ReactNode } from "react";
import { useNavState } from "./nav-state";
import { isOpen } from "@/lib/engine/nav-state";

/** One group on the phone's More page (H-333): a real 44px button for the heading that folds and unfolds its rows, remembered per member. */
export function NavGroupCard({ label, current = false, children }: { label: string; current?: boolean; children: ReactNode }) {
  const nav = useNavState();
  const open = isOpen(nav.state, label, current ? label : null);
  return (
    <div className="card p-2" data-testid="more-group" data-open={open}>
      <button type="button" onClick={() => nav.toggle(label)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-2 hover:bg-surface-2" data-testid="more-group-toggle">
        <span>{label}</span>
        <span className={`text-xs transition-transform ${open ? "rotate-0" : "-rotate-90"}`} aria-hidden>
          ▾
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}
