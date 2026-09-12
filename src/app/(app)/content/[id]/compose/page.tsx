import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { composerContext } from "@/lib/queries/compose";
import { ladderForItem, staleScheduledFor } from "@/lib/queries/ladders";
import { CHANNEL_SPECS } from "@/lib/engine/repurpose";
import { Composer, type StaleNotice } from "@/components/composer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Edit post" };

export default async function EditComposePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pushed?: string; ghl?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const { pushed, ghl } = await searchParams;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const [c, variants, ladder] = await Promise.all([composerContext(v), db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, id) }), ladderForItem(id, v.user.id)]);
  // The seam: this post came from a ladder, and a scheduled channel version still carries text older than the ladder's.
  const staleRows = ladder ? await staleScheduledFor(ladder) : [];
  const stale: StaleNotice | undefined = ladder && staleRows.length ? { ladderId: ladder.id, back: `/content/${item.id}/compose`, channels: staleRows.map((s) => ({ key: `ch:${s.channel}`, label: CHANNEL_SPECS.find((x) => x.key === s.channel)?.label ?? s.channel, inGhl: s.inGhl })) } : undefined;
  // A ladder's Threads chain is 6–8 posts; the composer schedules one post per target, so the chain is shown and copied, never scheduled.
  const copyOnly = ladder && (ladder.threadsChain?.length ?? 0) > 1 ? { "ch:threads": "A Threads chain posts as separate posts. Copy them out, or schedule the other channels here." } : undefined;
  const overrides: Record<string, { body: string; subject?: string }> = {};
  const selected: string[] = [];
  for (const x of variants) {
    const key = x.groupId ? `grp:${x.groupId}` : `ch:${x.channel}`;
    selected.push(key);
    overrides[key] = { body: x.body, subject: x.subject ?? undefined };
  }
  return (
    <>
      <PageHeader title={`Redistribute: ${item.title}`} subtitle={<Link href={`/content/${item.id}`} className="hover:underline">← Back to the post</Link>} />
      {pushed ? (
        <p className="mb-4 rounded-xl border bg-good-soft p-3 text-sm" data-testid="pushed-notice" role="status">
          {pushed} scheduled {pushed === "1" ? "post now carries" : "posts now carry"} the ladder&apos;s current text{Number(ghl) > 0 ? `; ${ghl} edited in GoHighLevel under the same id` : ""}.
        </p>
      ) : null}
      <Composer {...c} initial={{ id: item.id, title: item.title, hook: item.hook ?? "", body: item.body ?? "", cta: item.cta ?? "", hasCta: item.hasCta, mediaUrl: item.mediaUrl ?? "", mediaAttachmentId: item.mediaAttachmentId, contentType: item.contentType, overrides, selected }} stale={stale} copyOnly={copyOnly} />
    </>
  );
}
