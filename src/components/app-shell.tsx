import { NavProgress } from "@/components/nav-progress";
import { PinToViewport } from "@/components/pin-to-viewport";
import { AppLogo } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { TIER_ICONS, tierProgress } from "@/lib/engine/tiers";
import { BottomNav, SideNav } from "./nav";

export function AppShell({ viewer, points, streak, children }: { viewer: Viewer; points: number; streak: number; children: ReactNode }) {
  const tier = tierProgress(points);
  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-surface px-3 py-4 md:flex md:sticky md:top-0 md:h-screen">
        <Link href="/today" className="mb-5 flex items-center gap-2.5 px-2">
          <AppLogo size={40} />
          <div className="leading-tight">
            <div className="text-sm font-bold">HelixOS</div>
            <div className="text-[11px] text-ink-3">{viewer.workspace.name}</div>
          </div>
        </Link>
        <SideNav role={viewer.role} passEnabled={viewer.membership.passEnabled} />
        <div className="mt-auto space-y-3 px-2">
          <div className="rounded-xl bg-surface-2 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {TIER_ICONS[tier.current.name] ?? "🏅"} {tier.current.name}
              </span>
              <span className="tabular text-ink-2">{points.toLocaleString()} pts</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent" style={{ width: `${tier.pct}%` }} />
            </div>
            {tier.next ? <div className="mt-1.5 text-ink-3">{tier.toNext.toLocaleString()} to {tier.next.name}</div> : <div className="mt-1.5 text-ink-3">Top of the mountain.</div>}
          </div>
          <div className="flex items-center justify-between">
            <Link href="/settings" className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
              <span className="text-lg">{viewer.user.avatarEmoji}</span>
              <span className="max-w-[9rem] truncate">{viewer.user.name}</span>
            </Link>
            <form action={logoutAction}>
              <button className="text-xs text-ink-3 hover:text-ink" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <PinToViewport edge="top">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/today" className="flex items-center gap-2 text-sm font-bold">
            <AppLogo size={40} />
            HelixOS
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <span className="badge badge-accent">🔥 {streak}</span>
            <span className="badge">{points.toLocaleString()} pts</span>
            <Link href="/settings" className="text-lg" aria-label="Settings">
              {viewer.user.avatarEmoji}
            </Link>
          </div>
        </header>
        </PinToViewport>
        <NavProgress />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6 md:pb-10 md:pt-8">{children}</main>
      </div>
      <BottomNav role={viewer.role} />
    </div>
  );
}
