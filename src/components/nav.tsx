"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/webinars", label: "Webinars", icon: "🎤", hint: "wizard" },
      { href: "/offers", label: "Offers", icon: "🎁", hint: "wizard" },
      { href: "/pathway", label: "Pathway", icon: "🛣️" },
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
    ],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SideNav({ role }: { role: "coach" | "client" }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-3">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{g.label}</div>
          <div className="flex flex-col gap-0.5">
            {g.items
              .filter((n) => !n.coachOnly || role === "coach")
              .map((n) => (
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
        </div>
      ))}
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
