"use client";

import { PinToViewport } from "@/components/pin-to-viewport";
import { NAV_GROUPS, navVisible, withHorizon, withPlatformLinks, type NavItem } from "./nav-groups";
import type { PlatformLinks } from "@/lib/platforms";
import { ComingSoonItem } from "./coming-soon-item";
import { CollapseAllButton, useNavState } from "./nav-state";
import { isOpen } from "@/lib/engine/nav-state";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The desktop menu. Each group folds under its heading (H-333: remembered on the membership through the nav store, shared with
 * the phone's More page); "Collapse all" at the top shuts them all; the group holding the current page always shows open. As a
 * rail (the sidebar folded), every item is its icon alone with its name as the tooltip and the accessible name, and group
 * headings become thin dividers.
 */
export function SideNav({ role, passEnabled, bodyEnabled, recordingsEnabled = false, team = false, colosseumOn = false, loyaltyOn = false, oohOn = false, badges = {}, platformLinks = {}, ownCommunity = null, shippedKeys = [] }: { role: "coach" | "client"; passEnabled: boolean; bodyEnabled: boolean; recordingsEnabled?: boolean; team?: boolean; colosseumOn?: boolean; loyaltyOn?: boolean; oohOn?: boolean; badges?: Record<string, number>; platformLinks?: PlatformLinks; ownCommunity?: string | null; /** The horizon's shipped menu keys (H-385): an entry with a menuKey is Coming soon until its key is here. */ shippedKeys?: string[] }) {
  const pathname = usePathname();
  const nav = useNavState();
  const rail = nav.state.rail;
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: withHorizon(withPlatformLinks(g.items, platformLinks, ownCommunity), shippedKeys).filter((n) => navVisible(n, { role, passEnabled, bodyEnabled, recordingsEnabled, team, colosseumOn, loyaltyOn, oohOn })) }))
    // A section with nothing this member may see (HumanOS without Body) isn't drawn at all, header included.
    .filter((g) => g.items.length);
  // The most specific item wins: on /body/foods that's Nutrition, not Log (/body) as well (a prefix match alone lit both).
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((n) => !n.external && !n.comingSoon && isActive(pathname, n.href))
    .reduce<string | null>((best, n) => (!best || n.href.length > best.length ? n.href : best), null);
  const currentGroup = groups.find((g) => g.items.some((n) => n.href === activeHref))?.label ?? null;
  const labels = groups.map((g) => g.label);
  const itemClass = (active: boolean) => `flex items-center rounded-lg text-sm font-medium transition ${rail ? "justify-center px-0 py-2" : "gap-3 px-3 py-1.5"} ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`;
  return (
    <nav className="space-y-2" data-testid="side-nav" data-rail={rail ? "true" : "false"}>
      {rail ? null : (
        <div className="flex justify-end">
          <CollapseAllButton labels={labels} />
        </div>
      )}
      {groups.map((g) => {
        const activeItem = g.items.find((n) => n.href === activeHref);
        const open = rail || isOpen(nav.state, g.label, currentGroup);
        return (
          <div key={g.label} data-testid="nav-group" data-group={g.label} data-open={open}>
            {rail ? (
              <div role="separator" aria-label={g.label} title={g.label} className="mx-2 my-1 border-t border-line" />
            ) : (
              <button
                type="button"
                onClick={() => nav.toggle(g.label)}
                aria-expanded={open}
                className="flex min-h-9 w-full items-center justify-between rounded-md px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3 hover:bg-surface-2 hover:text-ink"
                data-testid="nav-group-toggle"
              >
                <span>
                  {g.label}
                  {!open && activeItem ? <span className="ml-2 normal-case tracking-normal text-ink-2">· {activeItem.label}</span> : null}
                </span>
                <span className={`text-[10px] transition-transform ${open ? "rotate-0" : "-rotate-90"}`} aria-hidden>
                  ▾
                </span>
              </button>
            )}
            {open ? (
              <div className="flex flex-col gap-0.5">
                {g.items.map((n) =>
                  n.comingSoon ? (
                    rail ? (
                      <span key={n.href} className="flex justify-center py-2 text-base opacity-50" title={`${n.label} (coming soon)`} aria-label={`${n.label}, coming soon`}>
                        {n.icon}
                      </span>
                    ) : (
                      <ComingSoonItem key={n.href} item={n} />
                    )
                  ) : n.external ? (
                    // An outbound platform (Danno, 7 Oct): a new tab, the ↗ mark, never the active page.
                    <a key={n.href} href={n.href} target="_blank" rel="noopener noreferrer" className={itemClass(false)} title={rail ? `${n.label} (opens in a new tab)` : undefined} aria-label={rail ? `${n.label}, opens in a new tab` : undefined} data-testid="nav-platform">
                      <span className="w-5 text-center text-base">{n.icon}</span>
                      {rail ? null : (
                        <>
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            {n.label}
                            {n.line ? <span className="text-[11px] font-normal text-ink-3">{n.line}</span> : null}
                          </span>
                          <span aria-label="opens in a new tab" className="text-xs text-ink-3">↗</span>
                        </>
                      )}
                    </a>
                  ) : (
                    <Link key={n.href} href={n.href} className={itemClass(n.href === activeHref)} title={rail ? n.label : undefined} aria-label={rail ? n.label : undefined} aria-current={n.href === activeHref ? "page" : undefined}>
                      <span className="relative w-5 text-center text-base">
                        {n.icon}
                        {rail && badges[n.href] ? <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent" aria-hidden /> : null}
                      </span>
                      {rail ? null : (
                        <>
                          <span className="flex flex-col leading-tight">
                            {n.label}
                            {n.line ? <span className="text-[11px] font-normal text-ink-3">{n.line}</span> : null}
                          </span>
                          {badges[n.href] ? n.href === "/whats-new" ? <NewDot /> : <DueBadge count={badges[n.href]} /> : null}
                        </>
                      )}
                    </Link>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function BottomNav({ role, badges = {} }: { role: "coach" | "client"; badges?: Record<string, number> }) {
  const pathname = usePathname();
  // The same five for a team member: Today is their team home, and the other four are theirs to work in.
  const items: NavItem[] = [
    { href: "/today", label: "Today", icon: "☀️" },
    { href: "/tasks", label: "Tasks", icon: "✅" },
    { href: "/content", label: "Content", icon: "✍️" },
    { href: "/conversations", label: "DMs", icon: "💬" },
    { href: "/more", label: "More", icon: "☰" },
  ];
  void role;
  const moreActive = !items.slice(0, 4).some((n) => isActive(pathname, n.href));
  return (
    <PinToViewport edge="bottom">
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-surface/95 backdrop-blur md:hidden" data-bottom-bar data-testid="bottom-nav">
      {items.map((n) => {
        const active = n.href === "/more" ? moreActive && pathname !== "/today" : isActive(pathname, n.href);
        return (
          <Link key={n.href} href={n.href} className={`flex min-w-0 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-ink" : "text-ink-3"}`}>
            <span className="relative text-lg leading-none">
              {n.icon}
              {n.href === "/more" && Object.values(badges).some(Boolean) ? <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-accent" aria-label="Something is due" data-testid="more-due-dot" /> : null}
            </span>
            {n.label}
          </Link>
        );
      })}
    </nav>
    </PinToViewport>
  );
}

/** A small dot beside What's new while there's an entry this member hasn't opened the page since (rev 193). */
export function NewDot() {
  return <span className="ml-auto h-2 w-2 rounded-full bg-accent" aria-label="New" data-testid="whats-new-dot" />;
}

/** A small dot with a count beside a menu item while something there is due (rev 157: Intentions). */
export function DueBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center gap-1 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent" aria-label={`${count} due`} data-testid="due-badge">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      {count}
    </span>
  );
}
