import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { NAV_GROUPS, navVisible } from "@/components/nav-groups";
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

export const metadata = { title: "More" };

export default async function MorePage() {
  const v = await requireViewer({ team: "allow" });
  const due = (await intentionsDueFor(v.workspace.id, v.user.id, v.today)).length;
  const unseen = unseenCount(WHATS_NEW, v.role, v.membership.whatsNewSeen);
  const recordingsEnabled = v.role === "client" && (await hasVisibleRecordings(v.workspace.id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role }));
  const coachFirst = v.role === "client" && !v.switchedInto ? await coachFirstName(v.workspace.id) : null;
  return (
    <>
      <PageHeader title="Everything" />
      <div className="space-y-4">
        {NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => navVisible(n, { role: v.role, passEnabled: v.membership.passEnabled, bodyEnabled: v.membership.bodyEnabled, recordingsEnabled, team: Boolean(v.team) })) }))
          // A section with nothing this member may see (HumanOS without Body) isn't drawn at all.
          .filter((g) => g.items.length)
          .map((g) => (
          <div key={g.label} className="card p-2">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{g.label}</div>
            {g.items.map((n) =>
              n.external ? (
                <a key={n.href} href={n.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2" data-testid="more-platform">
                  <span className="w-6 text-center text-lg">{n.icon}</span>
                  <span className="font-medium">{n.label}</span>
                  <span className="ml-auto text-xs text-ink-3">
                    {n.line} <span aria-label="opens in a new tab">↗</span>
                  </span>
                </a>
              ) : (
                <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2">
                  <span className="w-6 text-center text-lg">{n.icon}</span>
                  <span className="font-medium">{n.label}</span>
                  {n.href === "/intentions" && due ? <DueBadge count={due} /> : n.href === "/whats-new" && unseen ? <NewDot /> : n.line ?? n.hint ? <span className="ml-auto text-xs text-ink-3">{n.line ?? n.hint}</span> : null}
                </Link>
              ),
            )}
          </div>
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
        <Link href="/whats-new" className="block text-center text-[11px] text-ink-3" data-testid="app-version">
          {APP_VERSION}
        </Link>
      </div>
    </>
  );
}
