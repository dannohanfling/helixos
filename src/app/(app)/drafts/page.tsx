import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { pendingDrafts } from "@/lib/claude-drafts";
import { AREA_WORDS } from "@/lib/engine/claude-drafts";
import { formatDateTime } from "@/lib/dates";
import { Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Drafts waiting" };

/**
 * Drafts waiting (H-184): every one of Claude's drafts waiting for the member's Approve, Edit or Discard, newest first, each a
 * link to the page it sits on. The webinar wizard's drafts are here too. Nothing is approved from this list.
 */
export default async function DraftsPage() {
  const v = await requireViewer();
  const me = { workspaceId: v.workspace.id, userId: v.user.id };
  const [mine, webinarDrafts] = await Promise.all([
    pendingDrafts(me),
    db.query.webinarDrafts.findMany({ where: and(eq(schema.webinarDrafts.workspaceId, me.workspaceId), eq(schema.webinarDrafts.userId, me.userId), eq(schema.webinarDrafts.status, "pending")), orderBy: desc(schema.webinarDrafts.createdAt) }),
  ]);
  const offerIds = mine.filter((d) => d.area === "offer" && d.targetId).map((d) => d.targetId!);
  const webinarIds = [...new Set(webinarDrafts.map((d) => d.webinarId))];
  const [offers, webinars] = await Promise.all([
    offerIds.length ? db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, me.workspaceId), eq(schema.offers.userId, me.userId), inArray(schema.offers.id, offerIds)), columns: { id: true, name: true } }) : Promise.resolve([]),
    webinarIds.length ? db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, me.workspaceId), eq(schema.webinars.userId, me.userId), inArray(schema.webinars.id, webinarIds)), columns: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  const rows = [
    ...mine.map((d) => {
      const name = d.area === "offer" ? (d.targetId ? offers.find((o) => o.id === d.targetId)?.name : `A new offer: ${String(d.fields.name ?? "untitled")}`) : null;
      const href = d.area === "offer" ? (d.targetId ? `/offers/${d.targetId}` : "/offers") : AREA_WORDS[d.area].menu;
      return { id: d.id, area: AREA_WORDS[d.area].one, name: name ?? AREA_WORDS[d.area].one, href, by: d.byLabel, at: d.createdAt };
    }),
    ...webinarDrafts.map((d) => ({ id: d.id, area: "Webinar", name: `${webinars.find((w) => w.id === d.webinarId)?.title ?? "A webinar"}: ${d.step}`, href: `/webinars/${d.webinarId}?step=${d.step}`, by: d.byLabel, at: d.createdAt })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <PageHeader title="Drafts waiting" subtitle="Claude's drafts, waiting for you. Open one to approve, edit or discard it; nothing changes until you do." />
      {rows.length ? (
        <ul className="space-y-2" data-testid="drafts-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-accent bg-accent-soft/40 p-3 text-sm hover:underline" data-testid="drafts-row">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">{r.area}</span>
                <span className="min-w-0 flex-1 break-words font-medium">{r.name}</span>
                <span className="text-xs text-ink-3">
                  {r.by} · {formatDateTime(r.at, v.tz)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="✨" title="No drafts waiting" hint="When Claude drafts an offer or a webinar step for you through the connector, it waits here until you approve, edit or discard it." action={<Link className="btn btn-soft btn-sm" href="/today">Back to Today</Link>} />
      )}
    </>
  );
}
