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
import { NavStateProvider } from "./nav-state";
import { Sidebar, SidebarFoot } from "./sidebar";
import { toolsPhaseOf, visibleGroups } from "./nav-groups";
import { navStateOf, DEFAULT_CLOSED, NONE_CLOSED } from "@/lib/engine/nav-state";
import { moreTab } from "@/lib/engine/nav-badges";
import { LegalFooter } from "./legal-footer";
import { SubmitButton } from "@/components/submit-button";
import { APP_VERSION } from "@/lib/version";
import { SwitchBanner } from "@/components/switch-banner";
import { TeamBanner } from "@/components/team-banner";
import { ReportButton } from "@/components/report-button";
import { MemberAvatar } from "@/components/member-avatar";
import { StreakPill } from "@/components/streak-flame/streak-pill";
import type { FlameState } from "@/lib/engine/streak-flame";

export function AppShell({ viewer, chatOn = false, points, flame = null, flameAfterWelcome = false, badges = {}, recordingsEnabled = false, loyaltyOn = false, oohOn = false, agentsOn = false, coachFirst = null, appLinks = false, hasApp = false, choices = 1, shippedKeys = [], children }: { viewer: Viewer; /** The coach's chat is set up for this person (H-693): its menu item shows; the chat itself is on /ask only. */ chatOn?: boolean; points: number; /** The streak flame (H-558): null for a team member, whose streak is the owner's. */ flame?: FlameState | null; /** The surge waits for the daily welcome or the first arrival to close. */ flameAfterWelcome?: boolean; badges?: Record<string, number>; recordingsEnabled?: boolean; loyaltyOn?: boolean; /** Office Hours by level (H-470): the account has it today. */ oohOn?: boolean; /** The Agent inbox in the menu (H-727). */ agentsOn?: boolean; coachFirst?: string | null; /** Get the app (H-655): a store link is set, and whether this member has the app. */ appLinks?: boolean; hasApp?: boolean; /** How many HelixOS the signed-in person may be in (own memberships and teams): more than one shows the way to switch. */ choices?: number; /** The horizon's shipped menu keys (H-385), for the menu's Coming soon entries. */ shippedKeys?: string[]; children: ReactNode }) {
  const tier = tierProgress(points, viewer.membership.rankKeptLevel);
  const team = Boolean(viewer.team);
  // Whose name and emoji the account block shows: the HelixOS's own member (a switched coach sees the client's, as they see it),
  // except a team member, who is shown as themself.
  const who = team ? viewer.actor : viewer.user;
  // Tools open as a client reaches them (H-164 §12): the highest phase whose pages show, or null for every page.
  const toolsPhase = toolsPhaseOf({ role: viewer.role, team, showAllTools: viewer.membership.showAllTools, toolsPhase: viewer.membership.toolsPhase });
  const groups = visibleGroups({ role: viewer.role, passEnabled: viewer.membership.passEnabled, bodyEnabled: viewer.membership.bodyEnabled, recordingsEnabled, team, colosseumOn: viewer.workspace.colosseumOn, loyaltyOn, oohOn, chatOn, agentsOn, coachFirst, appLinks, hasApp, toolsPhase }, viewer.workspace.platformLinks, viewer.membership.passCommunityUrl, shippedKeys);
  // The More tab's total (H-844): every count on an item this person's menu shows, the same numbers as the sidebar and More.
  const more = moreTab(badges, groups.flatMap((g) => g.items.filter((n) => !n.external && !n.comingSoon).map((n) => n.href)));
  return (
    <NavStateProvider initial={navStateOf(viewer.membership.navState)} persist={!viewer.switchedInto && !viewer.team} closed={viewer.role === "client" && !team ? DEFAULT_CLOSED : NONE_CLOSED}>
    <div className="min-h-[100dvh] md:flex" data-app-shell>
      {/* The logo and the account block (with Log out) stay fixed; only the nav list scrolls, so Log out is never below the fold.
          H-333: the whole column folds to a rail of icons (Sidebar); what has no place on the rail carries rail-hide. */}
      <Sidebar>
        <Link href="/today" className="rail-hide mb-5 flex items-center gap-2.5 px-5">
          <AppLogo size={40} />
          <div className="leading-tight">
            <div className="text-sm font-bold">HelixOS</div>
            <div className="text-[11px] text-ink-3">{viewer.workspace.name}</div>
          </div>
        </Link>
        {/* My Helix as a progress line under the logo (H-164 §10), in place of its menu item. Not for the coach or a team member. */}
        {viewer.role === "client" && !team ? (
          <Link href="/my-helix" className="rail-hide -mt-2 mb-4 block px-5" data-testid="helix-progress" title="My Helix: your progress at a glance">
            <span className="flex items-center justify-between text-[11px] text-ink-3">
              <span>🌀 My Helix</span>
              <span className="tabular">{viewer.membership.helixPct}%</span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, viewer.membership.helixPct))}%` }} />
            </span>
          </Link>
        ) : null}
        <Link href="/today" className="rail-only mx-auto mb-3" aria-label="HelixOS, Today" title="Today">
          <AppLogo size={40} />
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 [aside[data-rail=true]_&]:px-1">
          <SideNav role={viewer.role} passEnabled={viewer.membership.passEnabled} bodyEnabled={viewer.membership.bodyEnabled} recordingsEnabled={recordingsEnabled} team={team} colosseumOn={viewer.workspace.colosseumOn} loyaltyOn={loyaltyOn} oohOn={oohOn} chatOn={chatOn} agentsOn={agentsOn} coachFirst={coachFirst} appLinks={appLinks} hasApp={hasApp} toolsPhase={toolsPhase} badges={badges} platformLinks={viewer.workspace.platformLinks} ownCommunity={viewer.membership.passCommunityUrl} shippedKeys={shippedKeys} />
        </div>
        {/* The sidebar's controls (H-499): fold and Collapse all, at the bottom left, open or folded. */}
        <SidebarFoot labels={groups.map((g) => g.label)} />
        {/* The rail's foot: Settings and Log out as icons, with their names for the pointer and the screen reader. */}
        <div className="rail-only mt-1 flex flex-col items-center gap-1">
          {flame ? <StreakPill state={flame} place="rail" afterWelcome={flameAfterWelcome} /> : null}
          <Link href="/settings" className="flex h-11 w-11 items-center justify-center rounded-md text-base hover:bg-surface-2" aria-label="Settings" title="Settings" data-testid="rail-settings">
            ⚙️
          </Link>
          <form action={logoutAction}>
            <SubmitButton className="flex h-11 w-11 items-center justify-center rounded-md text-base hover:bg-surface-2" aria-label="Log out" title="Log out" data-testid="rail-logout" pendingText="…">
              🚪
            </SubmitButton>
          </form>
        </div>
        <div className="rail-hide mt-2 space-y-3 px-5">
          {coachFirst && !viewer.switchedInto && !team ? <ReportButton coachFirst={coachFirst} /> : null}
          {team ? (
            // A team member's own block (Danno, 6 Oct): whose HelixOS this is, and the way to another when they have one. No tier
            // or points: those are the owner's.
            <div className="rounded-xl bg-surface-2 p-3 text-xs" data-testid="team-block">
              <div className="font-semibold">On {viewer.team!.ownerName}&apos;s team</div>
              <div className="mt-1 text-ink-3">Signed in as {viewer.actor.name}</div>
              {choices > 1 ? (
                <Link href="/choose" className="mt-2 inline-block font-medium text-ink-2 hover:text-ink" data-testid="team-switch-sidebar">
                  Switch HelixOS →
                </Link>
              ) : null}
            </div>
          ) : (
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
          )}
          {!team && choices > 1 ? (
            <Link href="/choose" className="btn btn-ghost btn-sm min-h-11! w-full" data-testid="choose-link">
              Switch HelixOS →
            </Link>
          ) : null}
          {/* Settings as its own item (friction walk G1, 7 Oct: the only way in was the name under it). */}
          <div className="flex items-center justify-between gap-2">
            <Link href="/settings" className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink" data-testid="nav-settings">
              <span className="text-base">⚙️</span> Settings
            </Link>
            {/* The streak flame (H-558), on the account rows, where it never squeezes the name. */}
            {flame ? <StreakPill state={flame} place="side" afterWelcome={flameAfterWelcome} /> : null}
          </div>
          <div className="flex items-center justify-between">
            <Link href="/settings" className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
              {team ? <span className="text-lg">{who.avatarEmoji}</span> : <MemberAvatar membershipId={viewer.membership.id} hasPhoto={Boolean(viewer.membership.headshotDisplayUrl)} emoji={who.avatarEmoji} size={28} version={viewer.membership.headshotUpdatedAt} name={who.name} />}
              <span className="max-w-[9rem] truncate">{who.name}</span>
            </Link>
            <form action={logoutAction}>
              <SubmitButton className="text-xs text-ink-3 hover:text-ink" data-testid="logout-sidebar" pendingText="Logging out…">
                Log out
              </SubmitButton>
            </form>
          </div>
          {/* The version this deploy is (rev 193), from the build's own commit; it opens What's new. */}
          <Link href="/whats-new" className="flex items-center gap-1.5 pb-1 text-[11px] text-ink-3 hover:text-ink" data-testid="app-version" title="What's new">
            {APP_VERSION}
            {/* What's new lives only behind the version line (H-164 §10): its dot moves here from the menu. */}
            {badges["/whats-new"] ? <span className="h-2 w-2 rounded-full bg-accent" aria-label="Something new" data-testid="whats-new-dot" /> : null}
          </Link>
        </div>
      </Sidebar>
      <div className="min-w-0 flex-1">
        {viewer.switchedInto ? <SwitchBanner sw={viewer.switchedInto} /> : null}
        {viewer.team ? <TeamBanner team={viewer.team} choices={choices} /> : null}
        <PinToViewport edge="top">
        {/* Fits a 360px phone (Danno, 12 Oct): the name hides below 400px, points go compact ("12.3K pts"), and nothing in
            the row may push it wider than the screen. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-bg/90 py-2.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur min-[400px]:gap-3 min-[400px]:pl-[max(1rem,env(safe-area-inset-left))] min-[400px]:pr-[max(1rem,env(safe-area-inset-right))] md:hidden" data-testid="mobile-header">
          <Link href="/today" className="flex shrink-0 items-center gap-2 text-sm font-bold" aria-label="HelixOS, Today">
            <AppLogo size={40} />
            <span className="hidden min-[400px]:inline">HelixOS</span>
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs min-[400px]:gap-2">
            {team ? null : (
              <>
                {flame ? <StreakPill state={flame} place="bar" afterWelcome={flameAfterWelcome} /> : null}
                <span className="badge shrink-0" title={`${points.toLocaleString()} points`}>
                  {compactPoints(points)} pts
                </span>
              </>
            )}
            <Link href="/settings" className="-mx-2 flex h-11 w-11 shrink-0 items-center justify-center text-lg" aria-label="Settings" data-testid="header-avatar">
              {team ? who.avatarEmoji : <MemberAvatar membershipId={viewer.membership.id} hasPhoto={Boolean(viewer.membership.headshotDisplayUrl)} emoji={who.avatarEmoji} size={28} version={viewer.membership.headshotUpdatedAt} name={who.name} />}
            </Link>
            <form action={logoutAction} className="shrink-0">
              <SubmitButton className="flex min-h-11 items-center px-1 text-ink-3 hover:text-ink" aria-label="Log out" data-testid="logout-header" pendingText="Logging out…">
                Log out
              </SubmitButton>
            </form>
          </div>
        </header>
        </PinToViewport>
        <NavProgress />
        {/* A page that carries data-page-wide (the Coach view, rev 844) gets the wider content width; every other page keeps its own. */}
        <main className="mx-auto w-full max-w-5xl px-4 2xl:max-w-6xl has-[[data-page-wide]]:max-w-7xl 2xl:has-[[data-page-wide]]:max-w-[96rem] pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 md:pb-10 md:pt-8">
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
          <LegalFooter />
        </main>
      </div>
      <BottomNav role={viewer.role} more={more} />
    </div>
    </NavStateProvider>
  );
}

/** "980", "12.3K", "1.2M": the phone header's points, full in its title. */
function compactPoints(n: number): string {
  return n < 10000 ? n.toLocaleString() : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
