"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string; coachOnly?: boolean };

export const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: "☀️" },
  { href: "/tasks", label: "Tasks", icon: "✅" },
  { href: "/content", label: "Content", icon: "✍️" },
  { href: "/conversations", label: "DMs", icon: "💬" },
  { href: "/pathway", label: "Pathway", icon: "🛣️" },
  { href: "/numbers", label: "Numbers", icon: "📊" },
  { href: "/rewards", label: "Rewards", icon: "🏆" },
  { href: "/coach", label: "Coach", icon: "🧑‍🏫", coachOnly: true },
];

export function SideNav({ role }: { role: "coach" | "client" }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((n) => !n.coachOnly || role === "coach").map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <span className="w-5 text-center text-base">{n.icon}</span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ role }: { role: "coach" | "client" }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.coachOnly || role === "coach").filter((n) => ["/today", "/tasks", "/content", "/conversations", "/pathway"].includes(n.href) || (role === "coach" && n.href === "/coach"));
  const shown = items.slice(0, 5);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-surface/95 backdrop-blur md:hidden" style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
      {shown.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
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
