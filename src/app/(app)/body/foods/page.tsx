import Link from "next/link";
import { FOOD_SECTIONS } from "@/db/schema";
import { SECTION_LABEL } from "@/lib/engine/body-shopping";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { fmtMacro } from "@/lib/engine/body";
import { bodyLibrary, bodySettingsFor, requireBodyEnabled } from "@/lib/queries/body";
import { archiveFoodAction, archiveMealAction, saveFoodAction, saveMealAction } from "@/lib/actions/body";
import type * as schema from "@/db/schema";
import { UnitPicker } from "@/components/body/unit-inputs";
import { unitGroup } from "@/lib/engine/body-units";

export const metadata = { title: "HumanOS · Nutrition" };

const MEAL_ROWS = 6;

function FoodFields({ food, preferred, tags }: { food?: schema.BodyFood; preferred: "oz" | "g"; tags: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-8">
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Name</span>
        <input name="name" className="field py-1 text-sm" defaultValue={food?.name} required maxLength={80} />
      </label>
      <div className="col-span-2 sm:col-span-2">
        <span className="label">Per</span>
        <UnitPicker value={food?.unit} preferred={preferred} />
      </div>
      {(["cal", "p", "f", "c"] as const).map((k) => (
        <label key={k}>
          <span className="label">{k === "cal" ? "Cal" : k.toUpperCase()}</span>
          <input name={k} type="number" step="any" min={0} className="field py-1 text-sm tabular" defaultValue={food?.[k] ?? ""} required />
        </label>
      ))}
      <label>
        <span className="label">Sodium (mg)</span>
        <input name="sodium" type="number" step="any" min={0} className="field py-1 text-sm tabular" defaultValue={food?.sodium || ""} placeholder="0" />
      </label>
      <label className="col-span-2 sm:col-span-3">
        <span className="label">Tag (for caps, e.g. cheese)</span>
        <input name="capTag" className="field py-1 text-sm" defaultValue={food?.capTag ?? ""} maxLength={30} list="body-cap-tags" placeholder="none" />
      </label>
      <label className="col-span-2">
        <span className="label">Store section</span>
        <select name="section" className="field py-1 text-sm" defaultValue={food?.section ?? ""} data-testid="food-section">
          <option value="">other</option>
          {FOOD_SECTIONS.filter((x) => x !== "other").map((x) => (
            <option key={x} value={x}>
              {SECTION_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2">
        <span className="label">Nutrition is per</span>
        <select name="basis" className="field py-1 text-sm" defaultValue={food?.basis ?? "cooked"} data-testid="food-basis">
          <option value="cooked">cooked weight</option>
          <option value="raw">raw weight</option>
        </select>
      </label>
      <label>
        <span className="label">Par (on hand)</span>
        <input name="par" type="number" step="any" min={0} className="field py-1 text-sm tabular" defaultValue={food?.par ?? ""} placeholder="none" />
      </label>
      <label>
        <span className="label">Cooked yield %</span>
        <input name="yieldPct" type="number" step="any" min={10} max={150} className="field py-1 text-sm tabular" defaultValue={food?.cookedYield != null ? Math.round(food.cookedYield * 100) : ""} placeholder="weighings" />
      </label>
      {tags.length ? (
        <datalist id="body-cap-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

export default async function BodyFoodsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const { foods, meals } = await bodyLibrary(v.workspace.id, v.user.id);
  const capTags = settings.caps.map((c) => c.tag);

  return (
    <>
      <HumanosHeader title="Nutrition" subtitle="Your foods per unit, and saved meals you log in one tap." action={<span className="flex gap-2"><Link href="/body/pantry" className="btn btn-ghost btn-sm" data-testid="pantry-link">Pantry →</Link><Link href="/body" className="btn btn-ghost btn-sm">← Log</Link></span>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      <Card className="mb-4" title={`Foods · ${foods.length}`} id="foods">
        <Disclosure summary={<span className="btn btn-soft btn-sm">＋ New food</span>} className="mb-3" open={!foods.length}>
          <form action={saveFoodAction} className="space-y-2" data-testid="body-new-food">
            <FoodFields preferred={settings.foodUnit} tags={capTags} />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
              Save food
            </SubmitButton>
          </form>
        </Disclosure>
        {foods.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="body-food-table">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="py-1 pr-2">Food</th>
                  <th className="py-1 pr-2">Per</th>
                  <th className="py-1 pr-2 text-right">Cal</th>
                  <th className="py-1 pr-2 text-right">P</th>
                  <th className="py-1 pr-2 text-right">F</th>
                  <th className="py-1 pr-2 text-right">C</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {foods.map((f) => (
                  <tr key={f.id} className="align-top">
                    <td className="py-1.5 pr-2">
                      <details>
                        <summary className="cursor-pointer">
                          {f.name}
                          {f.capTag ? <span className="ml-1 text-xs text-ink-3">({f.capTag} cap)</span> : null}
                        </summary>
                        <form action={saveFoodAction} className="mt-2 space-y-2">
                          <input type="hidden" name="id" value={f.id} />
                          <FoodFields food={f} preferred={settings.foodUnit} tags={capTags} />
                                                    <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
                            Save
                          </SubmitButton>
                        </form>
                      </details>
                    </td>
                    <td className="py-1.5 pr-2 text-ink-2">{f.unit}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{fmtMacro("cal", f.cal)}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{fmtMacro("p", f.p)}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{fmtMacro("f", f.f)}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{fmtMacro("c", f.c)}</td>
                    <td className="py-1.5 text-right">
                      <form action={archiveFoodAction}>
                        <input type="hidden" name="id" value={f.id} />
                        <ConfirmDelete what={`"${f.name}"`} verb="Remove" label="✕" title="Remove" className="btn btn-ghost btn-xs" undo="Meals and days that use it keep working." />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-2">No foods yet.</p>
        )}
      </Card>
      <Card title={`Saved meals · ${meals.length}`} id="meals">
        {meals.length ? (
          <ul className="divide-y rounded-lg border" data-testid="body-meal-list">
            {meals.map((m) => (
              <li key={m.id} className="p-2.5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-ink-3">{m.lines.map((l) => `${l.qty} ${l.food.unit} ${l.food.name.toLowerCase()}`).join(" + ")}</div>
                    <div className="tabular text-xs text-ink-2">
                      = {fmtMacro("cal", m.totals.cal)} cal · {fmtMacro("p", m.totals.p)} P · {fmtMacro("f", m.totals.f)} F · {fmtMacro("c", m.totals.c)} C{m.slot ? ` · usually ${m.slot}` : ""}
                    </div>
                  </div>
                  <form action={archiveMealAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <ConfirmDelete what={`the meal "${m.name}"`} verb="Remove" label="Remove" undo="Days you already logged keep it." />
                  </form>
                </div>
                <Disclosure summary={<span className="text-xs text-ink-3 underline">Edit</span>}>
                  <MealForm meal={m} foods={foods} slots={settings.mealSlots} />
                </Disclosure>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No saved meals yet.</p>
        )}
        <Disclosure summary={<span className="btn btn-soft btn-sm">＋ New meal</span>} className="mt-3" open={foods.length > 0 && !meals.length}>
          {foods.length ? <MealForm foods={foods} slots={settings.mealSlots} /> : <p className="text-sm text-ink-2">Add a food first.</p>}
        </Disclosure>
      </Card>
    </>
  );
}

function MealForm({ meal, foods, slots }: { meal?: { id: string; name: string; slot: string | null; items: schema.BodyMealItem[] }; foods: schema.BodyFood[]; slots: string[] }) {
  const rows = Array.from({ length: Math.max(MEAL_ROWS, (meal?.items.length ?? 0) + 2) }, (_, i) => meal?.items[i] ?? null);
  return (
    <form action={saveMealAction} className="mt-2 space-y-2" data-testid={meal ? "body-edit-meal" : "body-new-meal"}>
      {meal ? <input type="hidden" name="id" value={meal.id} /> : null}
      <div className="flex flex-wrap gap-2">
        <label className="min-w-0 flex-1">
          <span className="label">Meal name</span>
          <input name="name" className="field py-1 text-sm" defaultValue={meal?.name} required maxLength={80} />
        </label>
        <label>
          <span className="label">Usually</span>
          <select name="slot" className="field w-auto py-1 text-sm" defaultValue={meal?.slot ?? ""}>
            <option value="">Any slot</option>
            {slots.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {rows.map((item, i) => (
        <div key={i} className="flex gap-2">
          <select name={`item_${i}_food`} className="field min-w-0 flex-1 py-1 text-sm" defaultValue={item?.foodId ?? ""} aria-label={`Food ${i + 1}`}>
            <option value="">—</option>
            {foods.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (per {f.unit}{unitGroup(f.unit) === "weight" ? `, ${f.basis}` : ""})
              </option>
            ))}
          </select>
          <input name={`item_${i}_qty`} type="number" step="any" min={0} className="field w-20 py-1 text-sm tabular" defaultValue={item?.qty ?? ""} aria-label={`Quantity ${i + 1}`} />
        </div>
      ))}
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
        Save meal
      </SubmitButton>
    </form>
  );
}
