import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { pendingDrafts } from "@/lib/claude-drafts";
import { AREA_WORDS } from "@/lib/engine/claude-drafts";
import { formatDateTime } from "@/lib/dates";
import { sectionByKey } from "@/lib/engine/essence";
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
  const idsOf = (area: string) => mine.filter((d) => d.area === area && d.targetId).map((d) => d.targetId!);
  const [offerIds, magnetIds, postIds] = [idsOf("offer"), idsOf("magnet"), idsOf("content")];
  const webinarIds = [...new Set(webinarDrafts.map((d) => d.webinarId))];
  const [offers, magnets, posts, webinars] = await Promise.all([
    offerIds.length ? db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, me.workspaceId), eq(schema.offers.userId, me.userId), inArray(schema.offers.id, offerIds)), columns: { id: true, name: true } }) : Promise.resolve([]),
    magnetIds.length ? db.query.leadMagnets.findMany({ where: and(eq(schema.leadMagnets.workspaceId, me.workspaceId), eq(schema.leadMagnets.userId, me.userId), inArray(schema.leadMagnets.id, magnetIds)), columns: { id: true, title: true } }) : Promise.resolve([]),
    postIds.length ? db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, me.workspaceId), eq(schema.contentItems.userId, me.userId), inArray(schema.contentItems.id, postIds)), columns: { id: true, title: true } }) : Promise.resolve([]),
    webinarIds.length ? db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, me.workspaceId), eq(schema.webinars.userId, me.userId), inArray(schema.webinars.id, webinarIds)), columns: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  // Each draft by what the member knows it as, linking to the page it sits on.
  const place = (d: (typeof mine)[number]): { name: string; href: string } => {
    const t = d.targetId;
    const fresh = (what: string, title: unknown) => `A new ${what}: ${String(title ?? "untitled")}`;
    switch (d.area) {
      case "offer":
        return t ? { name: offers.find((o) => o.id === t)?.name ?? "An offer", href: `/offers/${t}` } : { name: fresh("offer", d.fields.name), href: "/offers" };
      case "magnet":
        return t ? { name: magnets.find((m) => m.id === t)?.title ?? "A lead magnet", href: `/magnets/${t}` } : { name: fresh("lead magnet", d.fields.title), href: "/magnets" };
      case "content":
        return t ? { name: posts.find((p) => p.id === t)?.title ?? "A post", href: `/content/${t}` } : { name: fresh("post", d.fields.title), href: "/content" };
      case "bot_profile":
        return { name: "What your bot says about your business", href: "/settings#your-bot" };
      case "essence":
        return { name: sectionByKey(t ?? "")?.title ?? "Your Essence", href: `/essence?step=${t ?? ""}` };
      default:
        return { name: AREA_WORDS[d.area].one, href: AREA_WORDS[d.area].menu };
    }
  };
  const rows = [
    ...mine.map((d) => ({ id: d.id, area: AREA_WORDS[d.area].one, ...place(d), by: d.byLabel, at: d.createdAt })),
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
        <Empty icon="✨" title="No drafts waiting" hint="When Claude drafts something for you through the connector, an offer, a section of your Essence, a lead magnet, a post or a webinar step, it waits here until you approve, edit or discard it." action={<Link className="btn btn-soft btn-sm" href="/today">Back to Today</Link>} />
      )}
    </>
  );
}
