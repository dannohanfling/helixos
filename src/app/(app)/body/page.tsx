import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { Badge, Card, Disclosure, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CapsLine, EntriesBySlot, LeftLine, MacroTiles, MarkKey } from "@/components/body/day-parts";
import { addDays, formatDate } from "@/lib/dates";
import { MACROS, MACRO_LABEL, MARK_ICON, MARK_WORD, fmtMacro } from "@/lib/engine/body";
import { bodyDay, recentDays, requireBodyEnabled } from "@/lib/queries/body";
import { deleteEntryAction, logFoodAction, logMealAction, setBodyDayTypeAction, setupBodyAction } from "@/lib/actions/body";

export const metadata = { title: "Body" };

/** The slot a meal most likely goes in at this hour, from the member's own slots. */
function slotNow(slots: string[], hour: number): string {
  const want = hour < 11 ? "breakfast" : hour < 15 ? "lunch" : "dinner";
  return slots.find((s) => s.toLowerCase() === want) ?? (hour < 15 ? slots[0] : slots[slots.length - 1]) ?? "Meal";
}

export default async function BodyPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string; erased?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= v.today ? sp.date : v.today;
  const d = await bodyDay(v.workspace.id, v.user.id, date, v.today);

  if (!d) {
    return (
      <>
        <PageHeader title="Body" subtitle="Nutrition targets and fast meal logging. Workouts and weigh-ins come next." />
        {sp.erased ? (
          <p className="mb-4 rounded-xl border p-3 text-sm" role="status" data-testid="body-erased">
            All your Body data is deleted.
          </p>
        ) : null}
        <Card title="Start">
          <p className="mb-1 text-sm text-ink-2">Body starts empty and you fill it in: your daily targets, the foods you eat most, your go-to meals. A short checklist walks you through it.</p>
          <p className="mb-4 text-sm text-ink-2" data-testid="body-private-note">
            🔒 Your Body data is <b>private to you</b>. Your coach doesn&apos;t see it unless you switch on &quot;Let my coach see my Body data&quot; in Body settings, and it&apos;s never sent to AI.
          </p>
          <form action={setupBodyAction}>
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Setting up…" data-testid="body-start">
              Set up Body
            </SubmitButton>
          </form>
        </Card>
      </>
    );
  }

  const recent = await recentDays(v.workspace.id, v.user.id, v.today);
  const slots = d.settings.mealSlots;
  const defaultSlot = date === v.today ? slotNow(slots, v.hour) : slots[slots.length - 1] ?? "Meal";
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const label = date === v.today ? "Today" : date === addDays(v.today, -1) ? "Yesterday" : formatDate(date, { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <PageHeader
        title="Body"
        subtitle={d.settings.shareWithCoach ? <span data-testid="body-sharing">👀 Shared with your coach (read-only). <Link href="/body/settings#share" className="underline">Change</Link></span> : <span data-testid="body-sharing">🔒 Private to you. <Link href="/body/settings#share" className="underline">Sharing</Link></span>}
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/body?date=${prev}`} className="btn btn-ghost btn-sm" aria-label="Previous day">
              ←
            </Link>
            <span className="font-medium" data-testid="body-date">
              {label}
            </span>
            <Link href={`/body?date=${next}`} className={`btn btn-ghost btn-sm ${date >= v.today ? "pointer-events-none opacity-40" : ""}`} aria-label="Next day">
              →
            </Link>
          </div>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      {!(d.checklist.targets && d.checklist.foods && d.checklist.logged) ? (
        <Card className="mb-4" title="Fill in your Body">
          <ol className="space-y-1.5 text-sm" data-testid="body-checklist">
            {[
              { key: "targets", done: d.checklist.targets, href: "/body/settings#day-types", text: "Set your daily targets (calories, protein, fat, carbs)" },
              { key: "dayTypes", done: d.checklist.dayTypes, href: "/body/settings#day-types", text: "Add your day types if they differ, e.g. training and rest days, plus your weekly pattern", optional: true },
              { key: "foods", done: d.checklist.foods, href: "/body/foods#foods", text: "Add the foods you eat most, with macros per unit" },
              { key: "meals", done: d.checklist.meals, href: "/body/foods#meals", text: "Save your go-to meals" },
              { key: "logged", done: d.checklist.logged, href: "/body#log", text: "Log your first meal" },
            ].map((step, i) => (
              <li key={step.key} className="flex items-start gap-2" data-testid={`body-step-${step.key}`} data-done={step.done ? "1" : "0"}>
                <span aria-hidden className="w-5 shrink-0">{step.done ? "✅" : ["①", "②", "③", "④", "⑤"][i]}</span>
                <Link href={step.href} className={step.done ? "text-ink-3 line-through" : "underline"}>
                  {step.text}
                </Link>
                {step.optional && !step.done ? <span className="text-xs text-ink-3">(if they differ)</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-3">This list goes away once your targets, a food and your first meal are in.</p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card
            title={
              <span data-testid="body-day-type">
                {d.dayType ? d.dayType.name : "No day type"}
                {d.overridden ? <span className="ml-1 normal-case text-ink-3">(set by hand)</span> : null}
              </span>
            }
            action={d.worst && d.entries.length ? <Badge tone={d.worst === "in" || d.worst === "over_ok" || d.worst === "open" ? "good" : "warn"}>{MARK_ICON[d.worst]} {d.final ? MARK_WORD[d.worst] : "so far"}</Badge> : null}
          >
            {d.dayType?.reminder ? (
              <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" data-testid="body-reminder">
                📌 {d.dayType.reminder}
              </p>
            ) : null}
            <MacroTiles totals={d.totals} bands={d.bands} marks={d.marks} setTargetsHref="/body/settings#day-types" />
            <div className="mt-3 space-y-1">
              {d.left && !d.final ? <LeftLine left={d.left} /> : null}
              <CapsLine caps={d.caps} />
              {d.bands ? <MarkKey /> : null}
            </div>
            {d.dayTypes.length > 1 ? (
            <Disclosure summary={<span className="text-xs text-ink-3 underline">Change this day&apos;s type</span>} className="mt-2">
              <form action={setBodyDayTypeAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="date" value={date} />
                <select name="dayTypeId" className="field w-auto py-1 text-sm" defaultValue={d.overridden ? d.dayType?.id : ""} aria-label="Day type">
                  <option value="">From my weekly pattern</option>
                  {d.dayTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…">
                  Set
                </SubmitButton>
              </form>
            </Disclosure>
            ) : null}
          </Card>

          <Card id="log" title="Log" action={<Link href="/body/foods" className="text-xs text-ink-2 hover:underline">Foods &amp; meals →</Link>}>
            {!d.library.foods.length ? (
              <p className="text-sm text-ink-2" data-testid="body-no-foods">
                Nothing to log from yet.{" "}
                <Link href="/body/foods#foods" className="font-medium underline">
                  Add your first food →
                </Link>
              </p>
            ) : d.library.meals.length ? (
              <ul className="divide-y rounded-lg border" data-testid="body-meals">
                {d.library.meals.map((m) => (
                  <li key={m.id} className="p-2.5" data-testid="body-meal" data-name={m.name}>
                    <form action={logMealAction} className="flex flex-wrap items-center justify-between gap-2">
                      <input type="hidden" name="mealId" value={m.id} />
                      <input type="hidden" name="date" value={date} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="tabular text-xs text-ink-3">
                          {fmtMacro("cal", m.totals.cal)} cal · {fmtMacro("p", m.totals.p)} P · {fmtMacro("f", m.totals.f)} F · {fmtMacro("c", m.totals.c)} C
                        </div>
                      </div>
                      <select name="slot" className="field w-auto py-1 text-sm" defaultValue={m.slot && slots.includes(m.slot) ? m.slot : defaultSlot} aria-label="Slot">
                        {slots.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="Logging…" data-testid="body-log-meal">
                        Log
                      </SubmitButton>
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs text-ink-3 underline">Adjust quantities</summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.lines.map((l, n) => (
                            <label key={n} className="text-xs">
                              <span className="block text-ink-3">{l.food.name}</span>
                              <span className="flex items-center gap-1">
                                <input name={`qty_${n}`} type="number" step="any" min={0} defaultValue={l.qty} className="field w-20 py-1 text-sm tabular" />
                                {l.food.unit}
                              </span>
                            </label>
                          ))}
                        </div>
                      </details>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">
                No saved meals yet. <Link href="/body/foods#meals" className="underline">Save a go-to meal</Link> to log it in one tap, or log a food below.
              </p>
            )}
            {d.library.foods.length ? (
              <form action={logFoodAction} className="mt-3 flex flex-wrap items-end gap-2" data-testid="body-log-food-form">
                <input type="hidden" name="date" value={date} />
                <label className="min-w-0 flex-1">
                  <span className="label">Food</span>
                  <select name="foodId" className="field py-1 text-sm" defaultValue="">
                    <option value="" disabled>
                      Pick a food…
                    </option>
                    {d.library.foods.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} (per {f.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Qty</span>
                  <input name="qty" type="number" step="any" min={0} defaultValue={1} className="field w-20 py-1 text-sm tabular" />
                </label>
                <label>
                  <span className="label">Slot</span>
                  <select name="slot" className="field w-auto py-1 text-sm" defaultValue={defaultSlot}>
                    {slots.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Logging…" data-testid="body-log-food">
                  Log food
                </SubmitButton>
              </form>
            ) : null}
          </Card>

          <Card title={`Eaten · ${label}`}>
            <EntriesBySlot
              entries={d.entries}
              slots={slots}
              action={(e) => (
                <form action={deleteEntryAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <ConfirmDelete what={`"${e.name}" from ${e.slot}`} undo="Log it again any time." label="✕" title="Remove" className="btn btn-ghost btn-xs" />
                </form>
              )}
            />
          </Card>
        </div>

        <div className="space-y-4">
          {!d.final && d.bands ? (
            <Card title="What fits tonight?">
              {d.fits.length ? (
                <ul className="space-y-2 text-sm" data-testid="body-fits">
                  {d.fits.map((f) => (
                    <li key={f.id} className="rounded-lg border p-2.5" data-testid="body-fit">
                      <div className="font-medium">{f.name}</div>
                      <div className="tabular text-xs text-ink-3">
                        → {MACROS.map((m) => `${fmtMacro(m, f.after[m])} ${MACRO_LABEL[m]}${f.marks[m] ? ` ${MARK_ICON[f.marks[m]!]}` : ""}`).join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2" data-testid="body-fits-none">
                  {d.library.meals.length ? "None of your saved meals fits what's left without going over a band. A single food might: see what's left above." : "Save a few meals and this suggests the ones that fit."}
                </p>
              )}
              <p className="mt-2 text-[11px] text-ink-3">Rule-based from your saved meals: each keeps every band at or under its top (🟡 marks a small overshoot).</p>
            </Card>
          ) : null}

          {d.comments.length ? (
            <Card title="From your coach">
              <ul className="space-y-2 text-sm" data-testid="body-comments">
                {d.comments.map((c) => (
                  <li key={c.id} className="rounded-lg bg-surface-2 p-2.5">
                    <div className="whitespace-pre-line">{c.text}</div>
                    <div className="mt-1 text-xs text-ink-3">{c.author}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Last 7 days">
            <ul className="space-y-1 text-sm" data-testid="body-recent">
              {recent.map((r) => (
                <li key={r.date}>
                  <Link href={`/body?date=${r.date}`} className={`flex justify-between gap-2 rounded px-1 hover:bg-surface-2 ${r.date === date ? "font-semibold" : ""}`}>
                    <span>
                      {formatDate(r.date, { weekday: "short", day: "numeric" })} <span className="text-xs text-ink-3">{r.dayType ?? ""}</span>
                    </span>
                    <span className="tabular text-xs text-ink-2">{r.logged ? `${fmtMacro("cal", r.totals.cal)} cal · ${fmtMacro("p", r.totals.p)} P ${r.worst ? MARK_ICON[r.worst] : ""}` : "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {d.nextRefeed ? <p className="mt-2 text-xs text-ink-3" data-testid="body-next-refeed">Next refeed: {formatDate(d.nextRefeed, { weekday: "short", month: "short", day: "numeric" })}</p> : null}
          </Card>

          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/body/foods" className="btn btn-ghost btn-sm">
              Foods &amp; meals
            </Link>
            <Link href="/body/settings" className="btn btn-ghost btn-sm" data-testid="body-settings-link">
              Targets &amp; settings
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
