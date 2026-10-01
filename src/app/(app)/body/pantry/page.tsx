import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { HumanosHeader } from "@/components/body/humanos-header";
import { addDays, formatDate } from "@/lib/dates";
import { PANTRY_LOCATIONS } from "@/lib/engine/body-pantry";
import { loggableUnits, unitGroup } from "@/lib/engine/body-units";
import { pantryView, requireBodyEnabled } from "@/lib/queries/body";
import { addYieldAction, deletePantryItemAction, savePantryItemAction, setFoodParAction, usePantryAction } from "@/lib/actions/body";

export const metadata = { title: "HumanOS · Pantry" };

const big = "field py-2 text-base sm:py-1 sm:text-sm";

/** "today", "tomorrow", "in 2 days", "3 days past". */
function dueWords(days: number | null): string {
  if (days == null) return "";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} past`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export default async function PantryPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const p = await pantryView(v.workspace.id, v.user.id, v.today);
  if (!p) redirect("/body");
  const massFoods = p.foods.filter((f) => unitGroup(f.unit) === "weight");

  return (
    <>
      <HumanosHeader title="Pantry" subtitle="What's on the shelf, what to use soon, what to buy, and what your foods cook down to." action={<Link href="/body/foods" className="btn btn-ghost btn-sm">← Nutrition</Link>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      {p.soon.length ? (
        <section className="card mb-4 border-l-4 border-l-humanos p-4" data-testid="pantry-soon">
          <p className="text-sm font-semibold text-humanos-ink">⏳ Use soon</p>
          <ul className="mt-1 text-sm">
            {p.soon.map((it) => (
              <li key={it.id} className={it.days < 0 ? "text-danger" : ""}>
                {it.food?.name ?? "A food"} · {it.qty} {it.unit} {it.state} · {dueWords(it.days)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="On the shelf" id="shelf">
          {p.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="pantry-items">
                <thead className="hidden text-left text-xs text-ink-3 sm:table-header-group">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Food</th>
                    <th className="py-1 pr-2 text-right font-medium">How much</th>
                    <th className="hidden py-1 pr-2 font-medium sm:table-cell">Where</th>
                    <th className="py-1 pr-2 font-medium">Use by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {/* A phone stacks each item into two lines (the name, then how much, use by and the buttons); wider screens keep the table. */}
                  {p.items.map((it) => (
                    <tr key={it.id} className="flex flex-wrap items-center gap-x-3 border-t py-1.5 sm:table-row sm:py-0" data-testid="pantry-item" data-food={it.food?.name ?? ""} data-qty={it.qty}>
                      <td className="block basis-full sm:table-cell sm:py-1.5 sm:pr-2">
                        {it.food?.name ?? <span className="text-ink-3">a food since removed</span>}
                        <span className="text-xs text-ink-3"> · {it.state}</span>
                      </td>
                      <td className="block tabular whitespace-nowrap sm:table-cell sm:py-1.5 sm:pr-2 sm:text-right">
                        {it.qty} {it.unit}
                      </td>
                      <td className="hidden text-xs text-ink-3 sm:table-cell sm:py-1.5 sm:pr-2">{it.location}</td>
                      <td className={`block text-xs whitespace-nowrap sm:table-cell sm:py-1.5 sm:pr-2 ${it.days != null && it.days <= 2 ? "font-semibold text-humanos-ink" : "text-ink-3"}`}>{it.useBy ? `${formatDate(it.useBy)} (${dueWords(it.days)})` : "—"}</td>
                      <td className="ml-auto block sm:table-cell sm:py-1.5 sm:text-right">
                        <div className="flex items-center justify-end gap-1">
                          <form action={usePantryAction} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={it.id} />
                            <span className="w-16 shrink-0">
                              <input name="qty" type="number" step="any" min={0} inputMode="decimal" className="field py-0.5 text-xs tabular" placeholder={String(it.qty)} aria-label={`Used from ${it.food?.name ?? "item"}`} data-testid="pantry-use-qty" />
                            </span>
                            <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="pantry-use">
                              Used
                            </SubmitButton>
                          </form>
                          <form action={deletePantryItemAction}>
                            <input type="hidden" name="id" value={it.id} />
                            <ConfirmDelete what={`${it.qty} ${it.unit} ${it.food?.name ?? "of this item"}`} undo="Add it again any time." label="✕" title="Remove" className="btn btn-ghost btn-xs" testId="pantry-remove" />
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-2" data-testid="pantry-empty">
              Nothing on the shelf yet. Logging a meal takes its foods off the shelf, soonest use-by first.
            </p>
          )}
          <Disclosure summary={<span className="btn btn-soft btn-sm">＋ Add to the shelf</span>} className="mt-3" open={!p.items.length}>
            {p.foods.length ? (
              <form action={savePantryItemAction} className="flex flex-wrap items-end gap-2" data-testid="pantry-add">
                <label className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <span className="label">Food</span>
                  <select name="foodId" className={big} required defaultValue="">
                    <option value="" disabled>
                      Pick a food…
                    </option>
                    {p.foods.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} (per {f.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-20">
                  <span className="label">How much</span>
                  <input name="qty" type="number" step="any" min={0} inputMode="decimal" className={big} required data-testid="pantry-qty" />
                </label>
                <label className="w-24">
                  <span className="label">Unit</span>
                  <input name="unit" className={big} placeholder="the food's" maxLength={30} list="pantry-units" data-testid="pantry-unit" />
                  <datalist id="pantry-units">
                    {[...new Set(p.foods.flatMap((f) => loggableUnits(f.unit)))].map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span className="label">State</span>
                  <select name="state" className={big} defaultValue="raw">
                    <option value="raw">raw</option>
                    <option value="cooked">cooked</option>
                  </select>
                </label>
                <label>
                  <span className="label">Where</span>
                  <select name="location" className={big} defaultValue="fridge">
                    {PANTRY_LOCATIONS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-36">
                  <span className="label">Bought</span>
                  <input name="boughtOn" type="date" className={big} defaultValue={v.today} max={v.today} />
                </label>
                <label className="w-36">
                  <span className="label">Use by</span>
                  <input name="useBy" type="date" className={big} min={addDays(v.today, -365)} data-testid="pantry-use-by" />
                </label>
                <SubmitButton className="btn btn-humanos btn-sm" pendingText="Adding…" data-testid="pantry-save">
                  Add
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-ink-2">
                Add a food first, under <Link href="/body/foods#foods" className="underline">Nutrition</Link>.
              </p>
            )}
          </Disclosure>
        </Card>

        <div className="space-y-4">
          <Card title="To buy" id="shopping" action={<Link href="/body/shopping" className="text-xs text-ink-2 hover:underline" data-testid="pantry-shopping-link">Shopping list →</Link>}>
            {p.gaps.length ? (
              <ul className="space-y-1 text-sm" data-testid="pantry-gaps">
                {p.gaps.map((g) => (
                  <li key={g.foodId} className="flex justify-between gap-2" data-testid="pantry-gap" data-food={g.name}>
                    <span>{g.name}</span>
                    <span className="tabular text-ink-2">
                      {g.short} {g.unit} <span className="text-xs text-ink-3">({g.onHand} of {g.par} on hand)</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2" data-testid="pantry-gaps-none">
                {p.foods.some((f) => f.par) ? "Everything with a par level is stocked." : "Give a food a par level below and it shows here when the shelf runs low."}
              </p>
            )}
            <Disclosure summary={<span className="text-xs text-ink-3 underline">Par levels</span>} className="mt-3">
              <p className="mb-2 text-xs text-ink-3">Keep at least this much on hand, in the food&apos;s unit. Blank clears it.</p>
              <div className="space-y-1.5" data-testid="pantry-pars">
                {p.foods.map((f) => (
                  <form key={f.id} action={setFoodParAction} className="flex items-center gap-2 text-sm" data-testid="pantry-par" data-food={f.name}>
                    <input type="hidden" name="foodId" value={f.id} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <input name="par" type="number" step="any" min={0} inputMode="decimal" className="field w-20 py-0.5 text-sm tabular" defaultValue={f.par ?? ""} placeholder="none" aria-label={`Par for ${f.name}`} />
                    <span className="w-10 text-xs text-ink-3">{f.unit}</span>
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">
                      Save
                    </SubmitButton>
                  </form>
                ))}
              </div>
            </Disclosure>
          </Card>

          <Card title="Cooked yields" id="yields">
            <p className="mb-2 text-sm text-ink-2">
              Foods are counted <b>cooked</b> unless a food says raw. Weigh a food raw and cooked and its yield is learned from the median; a figure you enter on the food wins.
            </p>
            {massFoods.length ? (
              <ul className="divide-y text-sm" data-testid="pantry-yields">
                {p.yields
                  .filter((y) => unitGroup(y.food.unit) === "weight")
                  .map((y) => (
                    <li key={y.food.id} className="py-2" data-testid="pantry-yield" data-food={y.food.name} data-factor={y.factor ?? ""}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {y.food.name} <span className="text-xs text-ink-3">per {y.food.unit}, {y.food.basis}</span>
                        </span>
                        <span className="tabular text-ink-2" data-testid="pantry-yield-text">
                          {y.factor != null ? `${Math.round(y.factor * 100)}% ${y.source === "entered" ? "(entered)" : `(from ${y.weighings.length} weighing${y.weighings.length === 1 ? "" : "s"})`}` : "no yield yet"}
                        </span>
                      </div>
                      {y.weighings.length ? <p className="text-xs text-ink-3">{y.weighings.map((w) => `${w.raw} → ${w.cooked} ${w.unit} (${formatDate(w.date)})`).join(" · ")}</p> : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No foods counted by weight yet.</p>
            )}
            {massFoods.length ? (
              <Disclosure summary={<span className="btn btn-soft btn-sm">＋ Add a weighing</span>} className="mt-3">
                <form action={addYieldAction} className="flex flex-wrap items-end gap-2" data-testid="pantry-weigh">
                  <label className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <span className="label">Food</span>
                    <select name="foodId" className={big} required defaultValue="">
                      <option value="" disabled>
                        Pick a food…
                      </option>
                      {massFoods.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="w-24">
                    <span className="label">Raw</span>
                    <input name="raw" type="number" step="any" min={0} inputMode="decimal" className={big} required data-testid="pantry-weigh-raw" />
                  </label>
                  <label className="w-24">
                    <span className="label">Cooked</span>
                    <input name="cooked" type="number" step="any" min={0} inputMode="decimal" className={big} required data-testid="pantry-weigh-cooked" />
                  </label>
                  <label className="w-20">
                    <span className="label">Unit</span>
                    <select name="unit" className={big} defaultValue="oz">
                      {["oz", "g", "lb", "kg"].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid="pantry-weigh-save">
                    Save
                  </SubmitButton>
                </form>
              </Disclosure>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
