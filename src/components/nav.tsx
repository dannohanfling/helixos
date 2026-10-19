"use client";

import { PinToViewport } from "@/components/pin-to-viewport";
import { navActive, visibleGroups, type NavItem } from "./nav-groups";
import type { PlatformLinks } from "@/lib/platforms";
import { ComingSoonItem } from "./coming-soon-item";
import { useNavState } from "./nav-state";
import { isOpen } from "@/lib/engine/nav-state";
import type { MoreTab } from "@/lib/engine/nav-badges";

import Link from "next/link";
import { usePathname } from "next/navigation";

const isActive = navActive;

/**
 * The desktop menu. Each group folds under its heading (H-333: remembered on the membership through the nav store, shared with
 * the phone's More page); "Collapse all" in the sidebar's foot shuts them all (H-499); the group holding the current page always shows open. As a
 * rail (the sidebar folded), every item is its icon alone with its name as the tooltip and the accessible name, and group
 * headings become thin dividers.
 */
export function SideNav({ role, passEnabled, bodyEnabled, recordingsEnabled = false, team = false, colosseumOn = false, loyaltyOn = false, oohOn = false, chatOn = false, agentsOn = false, coachFirst = null, appLinks = false, hasApp = false, badges = {}, platformLinks = {}, ownCommunity = null, shippedKeys = [] }: { role: "coach" | "client"; passEnabled: boolean; bodyEnabled: boolean; recordingsEnabled?: boolean; team?: boolean; colosseumOn?: boolean; loyaltyOn?: boolean; oohOn?: boolean; /** The coach's chat is on for this person (H-693): the Ask item shows. */ chatOn?: boolean; agentsOn?: boolean; coachFirst?: string | null; /** Get the app (H-655): a store link is set, and whether this member has the app. */ appLinks?: boolean; hasApp?: boolean; badges?: Record<string, number>; platformLinks?: PlatformLinks; ownCommunity?: string | null; /** The horizon's shipped menu keys (H-385): an entry with a menuKey is Coming soon until its key is here. */ shippedKeys?: string[] }) {
  const pathname = usePathname();
  const nav = useNavState();
  const rail = nav.state.rail;
  // A section with nothing this member may see (HumanOS without Body) isn't drawn at all, header included.
  const groups = visibleGroups({ role, passEnabled, bodyEnabled, recordingsEnabled, team, colosseumOn, loyaltyOn, oohOn, chatOn, agentsOn, coachFirst, appLinks, hasApp }, platformLinks, ownCommunity, shippedKeys);
  // The most specific item wins: on /body/foods that's Nutrition, not Log (/body) as well (a prefix match alone lit both).
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((n) => !n.external && !n.comingSoon && isActive(pathname, n.href))
    .reduce<string | null>((best, n) => (!best || n.href.length > best.length ? n.href : best), null);
  const currentGroup = groups.find((g) => g.items.some((n) => n.href === activeHref))?.label ?? null;
  const itemClass = (active: boolean) => `flex items-center rounded-lg text-sm font-medium transition ${rail ? "justify-center px-0 py-2" : "gap-3 px-3 py-1.5"} ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`;
  return (
    <nav className="space-y-2" data-testid="side-nav" data-rail={rail ? "true" : "false"}>
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
                      <span key={n.href} className="flex justify-center py-2 text-base opacity-50" title={`${n.label} (coming soon)`} aria-label={`${n.label}, coming soon`} data-app-off={n.appOffOnly || undefined}>
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
                    <Link key={n.href} href={n.href} className={itemClass(n.href === activeHref)} data-app-off={n.appOffOnly || undefined} title={rail ? n.label : undefined} aria-label={rail ? n.label : undefined} aria-current={n.href === activeHref ? "page" : undefined}>
                      <span className="relative w-5 text-center text-base">
                        {n.icon}
                        {rail && (badges[n.href] || badges[`draft:${n.href}`]) ? <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-accent" aria-hidden /> : null}
                      </span>
                      {rail ? null : (
                        <>
                          <span className="flex flex-col leading-tight">
                            {n.label}
                            {n.line ? <span className="text-[11px] font-normal text-ink-3">{n.line}</span> : null}
                          </span>
                          {badges[n.href] ? n.href === "/whats-new" ? <NewDot /> : <DueBadge count={badges[n.href]} /> : badges[`draft:${n.href}`] ? <DraftDot count={badges[`draft:${n.href}`]!} /> : null}
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

/** The phone's bottom bar. `more` (H-844): the More tab's total of what waits in the menu, or its dot for What's new alone. */
export function BottomNav({ role, more = null }: { role: "coach" | "client"; more?: MoreTab | null }) {
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
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur md:hidden" data-bottom-bar data-testid="bottom-nav">
      {items.map((n) => {
        const active = n.href === "/more" ? moreActive && pathname !== "/today" : isActive(pathname, n.href);
        return (
          <Link key={n.href} href={n.href} className={`flex min-w-0 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-ink" : "text-ink-3"}`} aria-label={n.href === "/more" && more && (more.count || more.dot) ? more.label : undefined}>
            <span className="relative text-lg leading-none">
              {n.icon}
              {n.href === "/more" && more?.count ? (
                <span className="absolute -right-2.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white" aria-hidden data-testid="more-due-count" data-count={more.count}>
                  {more.text}
                </span>
              ) : n.href === "/more" && more?.dot ? (
                <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-accent" aria-hidden data-testid="more-due-dot" />
              ) : null}
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

/** The small amber dot on a menu item that holds one of Claude's drafts waiting for the member (H-184). */
export function DraftDot({ count }: { count: number }) {
  return <span className="ml-auto h-2 w-2 rounded-full border border-accent-ink bg-accent" aria-label={`Claude's draft${count === 1 ? "" : "s"} waiting`} title={`${count} of Claude's draft${count === 1 ? "" : "s"} waiting`} data-testid="draft-dot" />;
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
