import { Suspense } from "react";
import { requireViewer } from "@/lib/auth";
import { PageHeader, Tabs } from "@/components/ui";
import { HorizonBoard } from "@/components/horizon-board";
import { ReportButton } from "@/components/report-button";
import { horizonFor } from "@/lib/horizon";
import { coachFirstName } from "@/lib/queries/reports";

export const metadata = { title: "On the horizon" };

/**
 * On the horizon (H-385): the second tab of What's new. What is live now, what is being built, what is next and what we are
 * exploring, each in member language, with Want this on the last two. A team member and a switched coach see the board and
 * cannot vote (the vote is the member's own).
 */
export default async function HorizonPage({ searchParams }: { searchParams: Promise<{ item?: string; tab?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const sp = await searchParams;
  const { items } = await horizonFor(v);
  const coachFirst = v.role === "client" && !v.switchedInto ? await coachFirstName(v.workspace.id) : null;
  const canVote = v.role === "client" && !v.switchedInto && !v.team;
  const board = items.map((i) => ({ id: i.id, title: i.title, line: i.line, area: i.area, status: i.status, fromFeedback: i.fromFeedback, wanted: i.wanted, votable: i.votable }));
  return (
    <>
      <PageHeader title="What's new" subtitle="What's coming, and a say in what comes next." />
      <Tabs items={[{ key: "shipped", label: "Shipped", href: "/whats-new" }, { key: "horizon", label: "On the horizon", href: "/whats-new/horizon" }]} current="horizon" />
      <Suspense fallback={null}>
        <HorizonBoard items={board} canVote={canVote} highlight={sp.item ?? null} />
      </Suspense>
      <footer className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4 text-sm text-ink-2" data-testid="horizon-footer">
        <span>Got an idea that isn&apos;t here?</span>
        {coachFirst ? <ReportButton coachFirst={coachFirst} variant="row" className="btn btn-soft btn-sm" /> : <span>Tell your coach.</span>}
      </footer>
    </>
  );
}
