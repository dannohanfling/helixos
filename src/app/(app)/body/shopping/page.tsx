import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { boughtAction, pushInstacartAction, setPlanAction } from "@/lib/actions/body";
import { formatDate } from "@/lib/dates";
import { listSummary } from "@/lib/engine/body-shopping";
import { INSTACART_OPEN, INSTACART_SOON, INSTACART_SOON_LINE } from "@/lib/instacart";
import { requireBodyEnabled, shoppingView } from "@/lib/queries/body";

export const metadata = { title: "HumanOS · Shopping list" };

type Sp = { skip?: string; pushed?: string; error?: string };

/**
 * The shopping list (rev 231; rev 237 phase 10): this week's saved meals × times, minus the shelf, plus staples below par, by
 * store section. Push to Instacart creates a shopping-list page and shows its link; the member picks the store, reviews and
 * pays in Instacart. HelixOS never places or pays for an order.
 */
export default async function ShoppingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const skip = new Set((sp.skip ?? "").split(",").filter(Boolean));
  const s = await shoppingView(v.workspace.id, v.user.id, v.today, skip);
  if (!s) redirect("/body");
  const pushed = sp.pushed ? s.orders.find((o) => o.id === sp.pushed) : null;
  const skipParam = [...skip].join(",");
  const toggleSkip = (foodId: string) => {
    const next = new Set(skip);
    if (next.has(foodId)) next.delete(foodId);
    else next.add(foodId);
    return `/body/shopping${next.size ? `?skip=${[...next].join(",")}` : ""}`;
  };

  return (
    <>
      <HumanosHeader
        title="Shopping list"
        subtitle={`Week of ${formatDate(s.monday, { month: "short", day: "numeric" })}: what this week's meals need, less what's on the shelf, plus staples below par.`}
        action={
          <Link href="/body/pantry" className="btn btn-ghost btn-sm">
            ← Pantry
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      {pushed?.link ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="shopping-pushed">
          Sent {pushed.lines.length} line{pushed.lines.length === 1 ? "" : "s"} to Instacart.{" "}
          <a href={pushed.link} target="_blank" rel="noreferrer noopener" className="font-medium underline" data-testid="shopping-link">
            Open the list in Instacart
          </a>{" "}
          to pick the store, review, add to cart and pay there. HelixOS placed nothing.
        </p>
      ) : null}

      <Card className="mb-4" title="This week's meals">
        {s.meals.length ? (
          <>
            {s.planned.length ? (
              <ul className="mb-3 divide-y text-sm" data-testid="plan-lines">
                {s.planned.map((p) => (
                  <li key={p.meal.id} className="flex items-center justify-between gap-2 py-1.5" data-testid="plan-line" data-meal={p.meal.name} data-times={p.times}>
                    <span>
                      {p.meal.name} <span className="text-ink-3">× {p.times}</span>
                    </span>
                    <form action={setPlanAction}>
                      <input type="hidden" name="mealId" value={p.meal.id} />
                      <input type="hidden" name="times" value="0" />
                      <SubmitButton className="text-ink-3 hover:text-danger" pendingText="…" aria-label={`Take ${p.meal.name} off the plan`} data-testid="plan-remove">
                        ✕
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-ink-3" data-testid="plan-empty">
                Nothing planned yet. Pick a saved meal and how many times you&apos;ll eat it this week.
              </p>
            )}
            <form action={setPlanAction} className="flex flex-wrap items-end gap-2" data-testid="plan-form">
              <label className="min-w-0 flex-1">
                <span className="label">Saved meal</span>
                <select name="mealId" className="field py-2 text-base sm:py-1 sm:text-sm" required defaultValue="" data-testid="plan-meal">
                  <option value="" disabled>
                    Pick a meal…
                  </option>
                  {s.meals.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-24">
                <span className="label">Times</span>
                <input name="times" type="number" min={1} max={21} defaultValue={3} className="field py-2 text-base tabular sm:py-1 sm:text-sm" data-testid="plan-times" />
              </label>
              <SubmitButton className="btn btn-humanos btn-sm" pendingText="Adding…" data-testid="plan-add">
                Plan it
              </SubmitButton>
            </form>
          </>
        ) : (
          <p className="text-sm text-ink-2">
            Save a meal first, under <Link href="/body/foods#meals" className="underline">Nutrition</Link>; staples below par still show below.
          </p>
        )}
      </Card>

      <Card className="mb-4" title="To buy" action={<span className="text-xs text-ink-3" data-testid="shopping-summary" data-lines={s.list.lines.length}>{listSummary(s.list)}</span>}>
        {s.list.sections.length ? (
          <div className="space-y-3" data-testid="shopping-list">
            {s.list.sections.map((sec) => (
              <section key={sec.section} data-testid="shopping-section" data-section={sec.section}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">{sec.label}</h3>
                <ul className="divide-y text-sm">
                  {sec.lines.map((l) => (
                    <li key={l.foodId} className="py-1.5" data-testid="shopping-line" data-food={l.name} data-to-buy={l.toBuy} data-why={l.why}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span>
                          <span className="font-medium">{l.name}</span>{" "}
                          <span className="tabular text-ink-2">
                            {l.toBuy} {l.unit}
                          </span>
                        </span>
                        <Link href={toggleSkip(l.foodId)} className="text-xs text-ink-3 hover:underline" aria-label={`Leave ${l.name} off this time`} data-testid="shopping-skip">
                          skip
                        </Link>
                      </div>
                      <p className="text-[11px] text-ink-3">{l.why === "par" ? `below par (${l.onHand} of ${l.par} on hand)` : l.why === "both" ? `the plan needs ${l.needed}, par ${l.par}; ${l.onHand} on hand` : `the plan needs ${l.needed}; ${l.onHand} on hand`}</p>
                      <form action={boughtAction} className="mt-1 flex items-center gap-1">
                        <input type="hidden" name="foodId" value={l.foodId} />
                        <span className="w-24">
                          <input name="qty" type="number" step="any" min={0} defaultValue={l.toBuy} className="field py-1 text-sm tabular" aria-label={`${l.name} bought, in ${l.unit}`} />
                        </span>
                        <span className="text-xs text-ink-3">{l.unit}</span>
                        <SubmitButton className="btn btn-soft btn-sm" pendingText="…" data-testid="shopping-bought">
                          Bought
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3" data-testid="shopping-empty">
            Nothing to buy: the plan is covered by the shelf and nothing is below par.
          </p>
        )}
        {skip.size ? (
          <p className="mt-2 text-xs text-ink-3">
            {skip.size} line{skip.size === 1 ? "" : "s"} skipped this time.{" "}
            <Link href="/body/shopping" className="underline">
              Show all
            </Link>
          </p>
        ) : null}
        {s.list.lines.length && !INSTACART_OPEN ? (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="instacart-soon">
            <button type="button" className="btn btn-soft btn-sm" disabled aria-disabled="true" data-testid="instacart-push">
              {INSTACART_SOON}
            </button>
            <span className="text-[11px] text-ink-3">{INSTACART_SOON_LINE}</span>
          </div>
        ) : s.list.lines.length ? (
          <form action={pushInstacartAction} className="mt-4 flex flex-wrap items-center gap-2" data-testid="instacart-form">
            <input type="hidden" name="skip" value={skipParam} />
            <SubmitButton className="btn btn-humanos btn-sm" pendingText="Sending…" data-testid="instacart-push">
              Push to Instacart
            </SubmitButton>
            <span className="text-[11px] text-ink-3">Makes an Instacart shopping-list page from these lines and gives you its link. You pick the store, review and pay in Instacart. HelixOS never places or pays for an order.</span>
          </form>
        ) : null}
      </Card>

      {s.orders.length ? (
        <Card className="mb-8" title="Pushed before">
          <ul className="divide-y text-sm" data-testid="shopping-orders">
            {s.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="shopping-order" data-status={o.status}>
                <span>
                  {formatDate(o.createdAt.slice(0, 10), { month: "short", day: "numeric" })} · {o.lines.length} line{o.lines.length === 1 ? "" : "s"}
                  {o.status === "failed" ? <span className="text-warn"> · didn&apos;t send</span> : null}
                </span>
                {o.link ? (
                  <a href={o.link} target="_blank" rel="noreferrer noopener" className="text-xs underline">
                    Open in Instacart
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
