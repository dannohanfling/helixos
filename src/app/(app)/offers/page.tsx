import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createOfferAction } from "@/lib/actions/offers";
import { Badge, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { scoreOffer } from "@/lib/engine/offer-score";

export const metadata = { title: "Offers" };

export default async function OffersPage() {
  const v = await requireViewer();
  const list = await db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id), orderBy: desc(schema.offers.createdAt) });
  const comps = list.length ? await db.query.offerComponents.findMany({ where: inArray(schema.offerComponents.offerId, list.map((o) => o.id)) }) : [];
  return (
    <>
      <PageHeader
        title="Offers"
        subtitle="One clear promise, a named method, a stack worth 5x the price."
        action={
          <Disclosure summary={<span className="btn btn-primary btn-sm">+ New offer</span>}>
            <form action={createOfferAction} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Name">
                <input className="field" name="name" required placeholder="90-Day Reset" autoFocus />
              </Field>
              <Field label="Price ($)">
                <input className="field tabular" name="price" type="number" min={0} placeholder="1500" />
              </Field>
              <div className="flex items-end">
                <button className="btn btn-primary" type="submit">
                  Open the wizard
                </button>
              </div>
            </form>
          </Disclosure>
        }
      />
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
                      {o.container} · {o.price ? `$${o.price.toLocaleString()}` : "no price yet"}
                    </div>
                  </div>
                  <Badge tone={o.status === "live" ? "good" : "neutral"}>{o.status}</Badge>
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
