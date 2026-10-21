import { formatPrice } from "@/lib/engine/offer-score";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createOfferAction } from "@/lib/actions/offers";
import { Badge, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { scoreOffer } from "@/lib/engine/offer-score";
import { SubmitButton } from "@/components/submit-button";
import { MoneyInput } from "@/components/money-input";
import { ClaudeDraftCard, DRAFT_NOTES } from "@/components/claude-draft-card";
import { pendingDrafts, redLinesFor } from "@/lib/claude-drafts";
import { rowsFor } from "@/lib/engine/claude-drafts";

export const metadata = { title: "Offers" };

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string; draftNote?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const list = await db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id), orderBy: desc(schema.offers.createdAt) });
  // Claude's drafts (H-184): new offers waiting on this page, and an amber mark on each offer with a draft waiting on its own page.
  const me = { workspaceId: v.workspace.id, userId: v.user.id };
  const waiting = await pendingDrafts(me, "offer");
  const fresh = waiting.filter((d) => !d.targetId);
  const reds = await Promise.all(fresh.map((d) => redLinesFor(me, d)));
  const drafted = new Set(waiting.map((d) => d.targetId).filter(Boolean));
  const comps = list.length ? await db.query.offerComponents.findMany({ where: inArray(schema.offerComponents.offerId, list.map((o) => o.id)) }) : [];
  return (
    <>
      <PageHeader
        title="Offers"
        subtitle="One clear promise, a named method, a stack worth 5x the price."
        action={
          <Disclosure open={Boolean(sp.error)} summary={<span className="btn btn-primary btn-sm">+ New offer</span>}>
            <form action={createOfferAction} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
              {sp.error ? (
                <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm sm:col-span-3" role="alert" data-testid="offer-error">
                  {sp.error}
                </p>
              ) : null}
              <Field label="Name">
                <input className="field" name="name" required placeholder="90-Day Reset" autoFocus />
              </Field>
              <Field label="Price ($)">
                <MoneyInput name="price" placeholder="1500" />
              </Field>
              <div className="flex items-end">
                <SubmitButton className="btn btn-primary" pendingText="Opening…">
                  Open the wizard
                </SubmitButton>
              </div>
            </form>
          </Disclosure>
        }
      />
      {sp.draftNote ? (
        <p className="mb-4 rounded-lg bg-surface-2 p-3 text-sm" role="status" data-testid="claude-draft-note">{DRAFT_NOTES[sp.draftNote] ?? sp.draftNote}</p>
      ) : null}
      {fresh.length ? (
        <div className="mb-4 space-y-3" data-testid="claude-new-offers">
          {fresh.map((d, i) => (
            <ClaudeDraftCard key={d.id} draft={d} title={`A new offer: ${String(d.fields.name ?? "untitled")}`} rows={rowsFor("offer", null, d.fields)} red={reds[i] ?? []} tz={v.tz} editHref={null} back="/offers" open="/offers" />
          ))}
        </div>
      ) : null}
      {list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((o) => {
            const r = scoreOffer(o, comps.filter((c) => c.offerId === o.id));
            return (
              <Link key={o.id} href={`/offers/${o.id}`} className="card block p-4 transition hover:border-ink">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{o.name}</div>
                    <div className="text-xs text-ink-3">
                      {o.container || "container not chosen"} · {o.price ? formatPrice(o.price, o.currency) : "no price yet"}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    {drafted.has(o.id) ? <span className="rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink" data-testid="offer-has-draft">Claude&apos;s draft</span> : null}
                    <Badge tone={o.status === "live" ? "good" : "neutral"}>{o.status}</Badge>
                  </span>
                </div>
                {o.promise ? <p className="mt-2 text-sm text-ink-2">{o.promise}</p> : null}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1">
                    <Progress value={r.score} tone={r.verdict === "ready" ? "good" : r.verdict === "needs_work" ? "accent" : "warn"} height={6} />
                  </div>
                  <span className="text-xs tabular text-ink-2">{r.score}% · {r.multiple ? `${r.multiple.toFixed(1)}x` : "—"}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty icon="🎁" title="No offers yet" hint="Create one. The wizard walks you from avatar to stack and scores it as you go." />
      )}
    </>
  );
}
