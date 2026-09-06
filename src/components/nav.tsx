"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

export type NavItem = { href: string; label: string; icon: string; coachOnly?: boolean; passOnly?: boolean; hint?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/today", label: "Today", icon: "☀️" },
      { href: "/tasks", label: "Tasks", icon: "✅" },
      { href: "/content", label: "Content", icon: "✍️", hint: "post + repurpose" },
      { href: "/conversations", label: "DMs", icon: "💬" },
      { href: "/groups", label: "Groups", icon: "🎯", hint: "top 3" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/webinars", label: "Webinars", icon: "🎤", hint: "wizard" },
      { href: "/offers", label: "Offers", icon: "🎁", hint: "wizard" },
      { href: "/pathway", label: "Pathway", icon: "🛣️" },
      { href: "/courses", label: "Courses", icon: "📚" },
      { href: "/doctrine", label: "Doctrine", icon: "🏛️", hint: "principles" },
      { href: "/proof", label: "Proof Bank", icon: "🏆" },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/clients", label: "Clients", icon: "🤝", hint: "your clients" },
      { href: "/community", label: "Community Pass", icon: "🎟️", passOnly: true, hint: "Elite" },
      { href: "/numbers", label: "Numbers", icon: "📊" },
      { href: "/rewards", label: "Rewards", icon: "🏆" },
      { href: "/coach", label: "Coach", icon: "🧑‍🏫", coachOnly: true },
      { href: "/integrations", label: "Integrations", icon: "🔌", coachOnly: true },
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const STORAGE_KEY = "helix.nav.collapsed";

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

export function SideNav({ role }: { role: "coach" | "client" }) {
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
  return (
    <nav className="space-y-2">
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((n) => !n.coachOnly || role === "coach");
        const activeItem = items.find((n) => isActive(pathname, n.href));
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
                    className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition ${isActive(pathname, n.href) ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <span className="w-5 text-center text-base">{n.icon}</span>
                    {n.label}
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

export function BottomNav({ role }: { role: "coach" | "client" }) {
  const pathname = usePathname();
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
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-surface/95 backdrop-blur md:hidden">
      {items.map((n) => {
        const active = n.href === "/more" ? moreActive && pathname !== "/today" : isActive(pathname, n.href);
        return (
          <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-ink" : "text-ink-3"}`}>
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
