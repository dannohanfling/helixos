import { NavProgress } from "@/components/nav-progress";
import { PinToViewport } from "@/components/pin-to-viewport";
import { AppLogo } from "@/components/brand-logo";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { DeletedNotice } from "./deleted-notice";
import type { Viewer } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { TIER_ICONS, tierProgress } from "@/lib/engine/tiers";
import { BottomNav, SideNav } from "./nav";
import { SubmitButton } from "@/components/submit-button";
import { APP_VERSION } from "@/lib/version";
import { SwitchBanner } from "@/components/switch-banner";
import { ChatWidget } from "@/components/chat-widget";
import { ReportButton } from "@/components/report-button";
import type { ChatWidgetProps } from "@/lib/chat";

export function AppShell({ viewer, chat = null, points, streak, badges = {}, recordingsEnabled = false, coachFirst = null, children }: { viewer: Viewer; chat?: ChatWidgetProps | null; points: number; streak: number; badges?: Record<string, number>; recordingsEnabled?: boolean; coachFirst?: string | null; children: ReactNode }) {
  const tier = tierProgress(points);
  return (
    <div className="min-h-screen md:flex" data-app-shell>
      {/* The logo and the account block (with Log out) stay fixed; only the nav list scrolls, so Log out is never below the fold. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-surface py-4 md:flex md:sticky md:top-0 md:h-screen">
        <Link href="/today" className="mb-5 flex items-center gap-2.5 px-5">
          <AppLogo size={40} />
          <div className="leading-tight">
            <div className="text-sm font-bold">HelixOS</div>
            <div className="text-[11px] text-ink-3">{viewer.workspace.name}</div>
          </div>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <SideNav role={viewer.role} passEnabled={viewer.membership.passEnabled} bodyEnabled={viewer.membership.bodyEnabled} recordingsEnabled={recordingsEnabled} badges={badges} />
        </div>
        <div className="mt-3 space-y-3 border-t px-5 pt-3">
          {coachFirst && !viewer.switchedInto ? <ReportButton coachFirst={coachFirst} /> : null}
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
              <SubmitButton className="text-xs text-ink-3 hover:text-ink" data-testid="logout-sidebar" pendingText="Logging out…">
                Log out
              </SubmitButton>
            </form>
          </div>
          {/* The version this deploy is (rev 193), from the build's own commit; it opens What's new. */}
          <Link href="/whats-new" className="block pb-1 text-[11px] text-ink-3 hover:text-ink" data-testid="app-version">
            {APP_VERSION}
          </Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {viewer.switchedInto ? <SwitchBanner sw={viewer.switchedInto} /> : null}
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
            <form action={logoutAction}>
              <SubmitButton className="text-ink-3 hover:text-ink" aria-label="Log out" data-testid="logout-header" pendingText="Logging out…">
                Log out
              </SubmitButton>
            </form>
          </div>
        </header>
        </PinToViewport>
        <NavProgress />
        <main className="mx-auto w-full max-w-5xl px-4 2xl:max-w-6xl pb-24 pt-5 sm:px-6 md:pb-10 md:pt-8">
          {/* After a delete: the one line saying what went, on the list the person was sent back to. */}
          <Suspense fallback={null}>
            <DeletedNotice />
          </Suspense>
          {viewer.switchedInto?.mode === "view" ? (
            // Viewing (rev 216): every form control on the page is disabled; the server refuses any write that gets through.
            <fieldset disabled className="m-0 min-w-0 border-0 p-0" data-testid="switch-view-lock">
              {children}
            </fieldset>
          ) : (
            children
          )}
        </main>
      </div>
      <BottomNav role={viewer.role} badges={badges} />
      {/* The coach's assistant (rev 241): null while switched into a client, or when the workspace hasn't set it up. */}
      {chat ? <ChatWidget {...chat} /> : null}
    </div>
  );
}
