import type { ReactNode } from "react";
import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { hasLeaderboardFeed } from "@/lib/leaderboard";
import { NAV_GROUPS, navVisible, toolsPhaseOf, withCoachName, withColosseum, withHorizon, withPlatformLinks } from "@/components/nav-groups";
import { chatWidgetProps } from "@/lib/chat";
import { horizonShell } from "@/lib/horizon";
import { oohAccessFor } from "@/lib/office-hours-access";
import { NavGroupCard } from "@/components/nav-group-card";
import { CollapseAllButton } from "@/components/nav-state";
import { ComingSoonItem } from "@/components/coming-soon-item";
import { DueBadge } from "@/components/nav";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { NewDot } from "@/components/nav";
import { WHATS_NEW } from "@/content/whats-new";
import { unseenCount } from "@/lib/engine/whats-new";
import { APP_VERSION } from "@/lib/version";
import { PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { hasVisibleRecordings } from "@/lib/recordings";
import { ReportButton } from "@/components/report-button";
import { coachFirstName } from "@/lib/queries/reports";
import { agentsOnFor } from "@/lib/handoff";

export const metadata = { title: "More" };

export default async function MorePage() {
  const v = await requireViewer({ team: "allow" });
  const due = (await intentionsDueFor(v.workspace.id, v.user.id, v.today)).length;
  const unseen = unseenCount(WHATS_NEW, v.role, v.membership.whatsNewSeen);
  const recordingsEnabled = v.role === "client" && (await hasVisibleRecordings(v.workspace.id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role }));
  const coachFirst = v.role === "client" && !v.switchedInto ? await coachFirstName(v.workspace.id) : null;
  const loyaltyOn = await hasLeaderboardFeed(v.membership.id);
  const { shippedKeys } = await horizonShell(v);
  const oohOn = (await oohAccessFor(v)).open;
  // The Agent inbox (H-727): the same rule as the side menu's, worked out in the layout.
  const agentsOn = v.role === "client" && !v.switchedInto && !v.team ? await agentsOnFor({ workspaceId: v.workspace.id, userId: v.user.id }) : false;
  const chatOn = (await chatWidgetProps(v)) !== null;
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: withCoachName(withColosseum(withHorizon(withPlatformLinks(g.items, v.workspace.platformLinks, v.membership.passCommunityUrl), shippedKeys), v.workspace.colosseumOn), { role: v.role, coachFirst }).filter((n) => navVisible(n, { role: v.role, passEnabled: v.membership.passEnabled, bodyEnabled: v.membership.bodyEnabled, recordingsEnabled, team: Boolean(v.team), colosseumOn: v.workspace.colosseumOn, loyaltyOn, oohOn, chatOn, agentsOn, toolsPhase: toolsPhaseOf({ role: v.role, team: Boolean(v.team), showAllTools: v.membership.showAllTools, toolsPhase: v.membership.toolsPhase }) })) }))
          // A section with nothing this member may see (HumanOS without Body) isn't drawn at all.
          .filter((g) => g.items.length);
  return (
    <>
      <PageHeader title="Everything" />
      <div className="space-y-4">
        <div className="flex justify-end">
          <CollapseAllButton labels={groups.map((g) => g.label)} />
        </div>
        {/* My Helix as a progress line (H-164 §10), on the phone as under the logo on a desktop. */}
        {v.role === "client" && !v.team ? (
          <Link href="/my-helix" className="card block p-3" data-testid="helix-progress">
            <span className="flex items-center justify-between text-sm font-medium">
              <span>🌀 My Helix</span>
              <span className="tabular text-ink-2">{v.membership.helixPct}%</span>
            </span>
            <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, v.membership.helixPct))}%` }} />
            </span>
          </Link>
        ) : null}
        {groups.map((g) => (
          <NavGroupCard key={g.label} label={g.label}>
            {g.items.map((n) =>
              n.comingSoon ? (
                <ComingSoonItem key={n.href} item={n} row />
              ) : n.external ? (
                <a key={n.href} href={n.href} target="_blank" rel="noopener noreferrer" className={ROW} data-testid="more-platform">
                  <span className="w-6 shrink-0 text-center text-lg">{n.icon}</span>
                  <RowText label={n.label} line={<>{n.line} <span aria-label="opens in a new tab">↗</span></>} />
                </a>
              ) : (
                <Link key={n.href} href={n.href} className={ROW}>
                  <span className="w-6 shrink-0 text-center text-lg">{n.icon}</span>
                  {n.href === "/intentions" && due ? (
                    <>
                      <RowText label={n.label} />
                      <DueBadge count={due} />
                    </>
                  ) : n.href === "/whats-new" && unseen ? (
                    <>
                      <RowText label={n.label} />
                      <NewDot />
                    </>
                  ) : (
                    <RowText label={n.label} line={n.line ?? n.hint} />
                  )}
                </Link>
              ),
            )}
          </NavGroupCard>
        ))}
        <div className="card p-2">
          {coachFirst ? <ReportButton coachFirst={coachFirst} variant="row" /> : null}
          <Link href="/settings" className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2">
            <span className="w-6 text-center text-lg">⚙️</span> Settings
          </Link>
          <form action={logoutAction}>
            <SubmitButton className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-surface-2" pendingText="Logging out…">
              <span className="w-6 text-center text-lg">🚪</span> Log out
            </SubmitButton>
          </form>
        </div>
        <Link href="/whats-new" className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3" data-testid="app-version">
          {APP_VERSION} · What&apos;s new
          {unseen ? <NewDot /> : null}
        </Link>
      </div>
    </>
  );
}

/** A menu row: never wider than the screen (Danno, 12 Oct, an iPhone). */
const ROW = "flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2";
/**
 * The label and its grey line: under the label below 480px, on the right from there up; either way it wraps rather than push
 * the card past the screen.
 */
function RowText({ label, line }: { label: string; line?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-3">
      <span className="font-medium">{label}</span>
      {line ? (
        <span className="min-w-0 text-xs text-ink-3 [overflow-wrap:anywhere] min-[480px]:ml-auto min-[480px]:text-right" data-testid="more-line">
          {line}
        </span>
      ) : null}
    </span>
  );
}
