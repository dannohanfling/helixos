"use client";

import { PinToViewport } from "@/components/pin-to-viewport";
import { NAV_GROUPS, navVisible, type NavItem } from "./nav-groups";
const STORAGE_KEY = "helix.nav.collapsed";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

// A tiny external store over localStorage so the server render (all open) and the client agree without an effect.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function getSnapshot(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function getServerSnapshot(): string {
  return "{}";
}
function writeCollapsed(next: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: nothing to persist */
  }
  listeners.forEach((l) => l());
}

export function SideNav({ role, passEnabled, bodyEnabled, recordingsEnabled = false, team = false, badges = {} }: { role: "coach" | "client"; passEnabled: boolean; bodyEnabled: boolean; recordingsEnabled?: boolean; team?: boolean; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const collapsed = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, [raw]);
  const toggle = (label: string) => writeCollapsed({ ...collapsed, [label]: !collapsed[label] });
  // The most specific item wins: on /body/foods that's Nutrition, not Log (/body) as well (a prefix match alone lit both).
  const activeHref = NAV_GROUPS.flatMap((g) => g.items)
    .filter((n) => navVisible(n, { role, passEnabled, bodyEnabled, recordingsEnabled, team }) && isActive(pathname, n.href))
    .reduce<string | null>((best, n) => (!best || n.href.length > best.length ? n.href : best), null);
  return (
    <nav className="space-y-2">
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((n) => navVisible(n, { role, passEnabled, bodyEnabled, recordingsEnabled, team }));
        // A section with nothing this member may see (HumanOS without Body) isn't drawn at all, header included.
        if (!items.length) return null;
        const activeItem = items.find((n) => n.href === activeHref);
        const open = !collapsed[g.label];
        return (
          <div key={g.label}>
            <button
              type="button"
              onClick={() => toggle(g.label)}
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-md px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <span>
                {g.label}
                {!open && activeItem ? <span className="ml-2 normal-case tracking-normal text-ink-2">· {activeItem.label}</span> : null}
              </span>
              <span className={`text-[10px] transition-transform ${open ? "rotate-0" : "-rotate-90"}`} aria-hidden>
                ▾
              </span>
            </button>
            {open ? (
              <div className="flex flex-col gap-0.5">
                {items.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition ${n.href === activeHref ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <span className="w-5 text-center text-base">{n.icon}</span>
                    <span className="flex flex-col leading-tight">
                      {n.label}
                      {n.line ? <span className="text-[11px] font-normal text-ink-3">{n.line}</span> : null}
                    </span>
                    {badges[n.href] ? n.href === "/whats-new" ? <NewDot /> : <DueBadge count={badges[n.href]} /> : null}
                  </Link>
                ))}
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
          <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-ink" : "text-ink-3"}`}>
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
