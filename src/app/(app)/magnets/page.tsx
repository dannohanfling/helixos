import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAGNET_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { appUrl } from "@/lib/branded-email";
import { createMagnetAction, deleteMagnetAction } from "@/lib/actions/magnets";
import { MAGNET_TYPE_INFO } from "@/lib/engine/lead-magnet";
import { Badge, Card, Empty, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Lead magnets" };

/**
 * Lead magnets: the thing a reader comments a keyword to receive. Each has one keyword (never shared in a workspace), one
 * public address, and the formats the client chose. The tracked link counts clicks per source and nothing else.
 */
export default async function MagnetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const [magnets, offers, hits] = await Promise.all([
    db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, v.user.id), orderBy: (t, { desc }) => [desc(t.createdAt)] }),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
    db.select({ magnetId: schema.leadMagnetHits.magnetId, n: sql<number>`count(*)` }).from(schema.leadMagnetHits).innerJoin(schema.leadMagnets, and(eq(schema.leadMagnets.id, schema.leadMagnetHits.magnetId), eq(schema.leadMagnets.userId, v.user.id))).groupBy(schema.leadMagnetHits.magnetId),
  ]);
  const hitsOf = new Map(hits.map((h) => [h.magnetId, Number(h.n)]));
  const base = appUrl();
  return (
    <>
      <PageHeader title="Lead magnets" subtitle="What people comment the keyword to get. One keyword each, one tracked link each, in the formats you choose." />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" data-testid="magnet-error" role="alert">
          {sp.error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card title="New lead magnet">
          <form action={createMagnetAction} className="space-y-3" data-testid="new-magnet">
            <Field label="Type" hint="Pick the shape first. The content is scaffolded from it.">
              <select className="field" name="type" defaultValue="checklist">
                {MAGNET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MAGNET_TYPE_INFO[t].label} — {MAGNET_TYPE_INFO[t].shape}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <input className="field" name="title" required />
            </Field>
            <Field label="Promise" hint="What the reader has once they've used it. One line.">
              <input className="field" name="promise" />
            </Field>
            <Field label="Who it's for">
              <input className="field" name="audience" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Keyword" hint="What people comment. Letters and digits; upper case. Never shared between two magnets.">
                <input className="field uppercase" name="keyword" maxLength={24} />
              </Field>
              <Field label="Offer it leads to">
                <select className="field" name="offerId" defaultValue="">
                  <option value="">None yet</option>
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button className="btn btn-primary" type="submit">
              Create
            </button>
          </form>
        </Card>
        <div className="space-y-3">
          {!magnets.length ? <Empty icon="🧲" title="No lead magnets yet" hint="Create one on the left: type first, then the title and the keyword." /> : null}
          {magnets.map((m) => (
            <Card key={m.id}>
              <div className="flex flex-wrap items-start justify-between gap-2" data-testid="magnet-row">
                <div className="min-w-0">
                  <Link href={`/magnets/${m.id}`} className="font-semibold hover:underline">
                    {m.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    <Badge tone="accent">{m.keyword}</Badge>
                    <span>{MAGNET_TYPE_INFO[m.type].label}</span>
                    <span>·</span>
                    <span>{hitsOf.get(m.id) ?? 0} clicks on the tracked link</span>
                    <span>·</span>
                    <span>{m.generatedBy === "claude" ? "drafted by AI" : m.generatedBy === "scaffold" ? "skeleton, fill the blanks" : m.generatedBy}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-ink-3">
                    {base}/g/{m.slug}
                  </p>
                </div>
                <form action={deleteMagnetAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="btn btn-ghost btn-xs" type="submit">
                    Delete
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
