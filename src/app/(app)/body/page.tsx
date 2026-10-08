import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { Badge, Card, Disclosure } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CapsLine, EntriesBySlot, LeftLine, MacroTiles, MarkKey } from "@/components/body/day-parts";
import { addDays, formatDate } from "@/lib/dates";
import { MACROS, MACRO_LABEL, MARK_ICON, MARK_WORD, fmtMacro, slotNow } from "@/lib/engine/body";
import { LogFoodForm } from "@/components/body/unit-inputs";
import { loggableUnits } from "@/lib/engine/body-units";
import { bodyDay, latestComposition, recentDays, requireBodyEnabled, deviceDay, templateSendsFor } from "@/lib/queries/body";
import { CoachSends } from "@/components/body/coach-sends";
import { fmtMetric } from "@/lib/engine/body-scale";
import { deleteEntryAction, logFoodAction, logMealAction, logPhotoAction, mealPhotoAction, setBodyAiAction, setBodyDayFlagAction, setBodyDayTypeAction, setupBodyAction } from "@/lib/actions/body";
import { DAY_FLAGS, FLAG_LABEL, flagText } from "@/lib/engine/body-flags";
import { PhotoForm } from "@/components/body/photo-form";
import { photoReady } from "@/lib/body-ai";

export const metadata = { title: "HumanOS · Log" };


export default async function BodyPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string; erased?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= v.today ? sp.date : v.today;
  const d = await bodyDay(v.workspace.id, v.user.id, date, v.today);
  const photoOk = d?.settings.aiUse ? await photoReady(v) : false;

  // B9: a coach's templates wait here (every kind), and on the page each kind belongs to, until the member decides.
  const sends = await templateSendsFor(v.workspace.id, v.user.id);
  if (!d) {
    return (
      <>
        <HumanosHeader title="Log" gear={false} subtitle="Nutrition targets and fast meal logging. Workouts and weigh-ins come next." />
        {sends.length ? <p className="mb-4 text-sm text-ink-2" data-testid="coach-sends-held">Your coach sent you {sends.length} template{sends.length === 1 ? "" : "s"}; set up HumanOS to take {sends.length === 1 ? "it" : "them"}.</p> : null}
        {sp.erased ? (
          <p className="mb-4 rounded-xl border p-3 text-sm" role="status" data-testid="body-erased">
            All your HumanOS data is deleted.
          </p>
        ) : null}
        <Card title="Start">
          <p className="mb-1 text-sm text-ink-2">HumanOS starts empty and you fill it in: your daily targets, the foods you eat most, your go-to meals. A short checklist walks you through it.</p>
          <p className="mb-4 text-sm text-ink-2" data-testid="body-private-note">
            🔒 Your HumanOS data is <b>private to you</b>. Your coach doesn&apos;t see it unless you switch on &quot;Let my coach see my HumanOS data&quot; in HumanOS settings, and it&apos;s never sent to AI.
          </p>
          <form action={setupBodyAction}>
            <SubmitButton className="btn btn-humanos btn-sm" pendingText="Setting up…" data-testid="body-start">
              Set up HumanOS
            </SubmitButton>
          </form>
        </Card>
      </>
    );
  }

  const [recent, weighIn, device] = await Promise.all([recentDays(v.workspace.id, v.user.id, v.today), latestComposition(v.workspace.id, v.user.id), deviceDay(v.workspace.id, v.user.id, date)]);
  const slots = d.settings.mealSlots;
  const defaultSlot = date === v.today ? slotNow(slots, v.hour) : slots[slots.length - 1] ?? "Meal";
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const label = date === v.today ? "Today" : date === addDays(v.today, -1) ? "Yesterday" : formatDate(date, { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <HumanosHeader
        title="Log"
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
      <CoachSends sends={sends} back="/body" className="mb-4" />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      {!(d.checklist.ai && d.checklist.targets && d.checklist.foods && d.checklist.logged) ? (
        <Card className="mb-4" title="Fill in your HumanOS">
          <div className="mb-3 rounded-lg border p-3" data-testid="body-step-ai" data-done={d.checklist.ai ? "1" : "0"}>
            <div className="flex items-start gap-2 text-sm">
              <span aria-hidden className="w-5 shrink-0">{d.checklist.ai ? "✅" : "①"}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Choose whether AI can help you</div>
                <p className="text-ink-2">With Yes, HelixOS&apos;s AI can use your HumanOS numbers and short text (targets, what you logged, saved meals) to support you, on your own AI key. Never photos or notes. You can change it any time in HumanOS settings.</p>
                {d.checklist.ai ? (
                  <p className="mt-1 text-xs text-ink-3" data-testid="body-ai-answer">{d.settings.aiUse ? "You said Yes." : "You said Not now."}</p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <form action={setBodyAiAction}>
                      <input type="hidden" name="on" value="1" />
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="body-ai-yes">
                        Yes
                      </SubmitButton>
                    </form>
                    <form action={setBodyAiAction}>
                      <input type="hidden" name="on" value="0" />
                      <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="body-ai-not-now">
                        Not now
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
          <ol className="space-y-1.5 text-sm" data-testid="body-checklist">
            {[
              { key: "targets", done: d.checklist.targets, href: "/body/settings#day-types", text: "Set your daily targets (calories, protein, fat, carbs)" },
              { key: "dayTypes", done: d.checklist.dayTypes, href: "/body/settings#day-types", text: "Add your day types if they differ, e.g. training and rest days, plus your weekly pattern", optional: true },
              { key: "foods", done: d.checklist.foods, href: "/body/foods#foods", text: "Add the foods you eat most, with macros per unit" },
              { key: "meals", done: d.checklist.meals, href: "/body/foods#meals", text: "Save your go-to meals" },
              { key: "logged", done: d.checklist.logged, href: "/body#log", text: "Log your first meal" },
            ].map((step, i) => (
              <li key={step.key} className="flex items-start gap-2" data-testid={`body-step-${step.key}`} data-done={step.done ? "1" : "0"}>
                <span aria-hidden className="w-5 shrink-0">{step.done ? "✅" : ["②", "③", "④", "⑤", "⑥"][i]}</span>
                <Link href={step.href} className={step.done ? "text-ink-3 line-through" : "underline"}>
                  {step.text}
                </Link>
                {step.optional && !step.done ? <span className="text-xs text-ink-3">(if they differ)</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-3">This list goes away once you&apos;ve chosen about AI and your targets, a food and your first meal are in.</p>
        </Card>
      ) : null}

      {d.left && !d.final ? (
        <section className="card mb-4 border-l-4 border-l-humanos p-4" data-testid="body-lead">
          <LeftLine left={d.left} />
          {d.dayType?.reminder ? <p className="mt-1 text-sm text-ink-2">📌 {d.dayType.reminder}</p> : null}
        </section>
      ) : null}

      <Link href="/body/weight" className="card mb-4 flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-2" data-testid="body-weight-line" data-has={weighIn ? "1" : "0"}>
        <span>
          ⚖️{" "}
          {weighIn?.values.weight != null ? (
            <>
              <span className="font-semibold tabular">{fmtMetric("weight", weighIn.values.weight, d.settings.weightUnit)}</span>
              {weighIn.values.bf != null ? <span className="tabular text-ink-2"> · {fmtMetric("bf", weighIn.values.bf, d.settings.weightUnit)} body fat</span> : null}
              <span className="text-xs text-ink-3"> · {weighIn.date === v.today ? "today" : formatDate(weighIn.date)}</span>
            </>
          ) : (
            <span className="text-ink-2">No weigh-in yet</span>
          )}
        </span>
        <span className="text-xs text-ink-2">{weighIn ? "Weigh-ins & trends →" : "Log a weigh-in →"}</span>
      </Link>

      {d.dueSoon.length ? (
        <Link href="/body/pantry" className="card mb-4 block px-4 py-2.5 text-sm hover:bg-surface-2" data-testid="body-use-soon">
          ⏳ <span className="font-semibold">Use soon:</span> {d.dueSoon.map((u) => `${u.name} (${u.days < 0 ? "past" : u.days === 0 ? "today" : u.days === 1 ? "tomorrow" : `${u.days} days`})`).join(", ")} <span className="text-xs text-ink-2">· Pantry →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card id="log" title="Log a meal" action={<Link href="/body/foods" className="text-xs text-ink-2 hover:underline">Nutrition →</Link>}>
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
                  <li key={m.id} className="p-3" data-testid="body-meal" data-name={m.name}>
                    <form action={logMealAction} className="flex flex-wrap items-center justify-between gap-2">
                      <input type="hidden" name="mealId" value={m.id} />
                      <input type="hidden" name="date" value={date} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="tabular text-xs text-ink-3">
                          {fmtMacro("cal", m.totals.cal)} cal · {fmtMacro("p", m.totals.p)} P · {fmtMacro("f", m.totals.f)} F · {fmtMacro("c", m.totals.c)} C
                        </div>
                      </div>
                      <select name="slot" className="field w-auto py-2 text-base sm:py-1 sm:text-sm" defaultValue={m.slot && slots.includes(m.slot) ? m.slot : defaultSlot} aria-label="Slot">
                        {slots.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <SubmitButton className="btn btn-humanos px-5" pendingText="Logging…" data-testid="body-log-meal">
                        Log
                      </SubmitButton>
                      <details className="w-full">
                        <summary className="btn btn-soft btn-xs w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden">Adjust quantities</summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.lines.map((l, n) => (
                            <label key={n} className="text-xs">
                              <span className="block text-ink-3">{l.food.name}</span>
                              <span className="flex items-center gap-1">
                                <input name={`qty_${n}`} type="text" autoComplete="off" inputMode="decimal" defaultValue={l.qty} className="field w-20 py-1 text-sm tabular" />
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
            {/* A meal from a photo (phase 14): only with the member's AI switch on and a working key; otherwise one line says what it needs. */}
            {photoOk ? (
              <Disclosure summary={<span className="text-sm font-medium">📷 From a photo</span>} className="mt-3">
                <div className="mt-2">
                  <PhotoForm action={mealPhotoAction} logAction={logPhotoAction} date={date} slots={slots} defaultSlot={defaultSlot} />
                </div>
              </Disclosure>
            ) : (
              <p className="mt-3 text-xs text-ink-3" data-testid="body-photo-off">
                📷 A meal from a photo needs {d.settings.aiUse ? "your own AI key on Settings (under today's cap)" : "\"Let AI use my HumanOS data\" on in HumanOS settings, and your own AI key"}.
              </p>
            )}
            {d.library.foods.length ? (
              <LogFoodForm action={logFoodAction} date={date} slots={slots} defaultSlot={defaultSlot} foods={d.library.foods.map((f) => ({ id: f.id, name: f.name, unit: f.unit, units: loggableUnits(f.unit), basis: f.basis }))} recent={d.recentFoodIds} />
            ) : null}
          </Card>

          <Card
            title={
              <span data-testid="body-day-type">
                {d.dayType ? d.dayType.name : "No day type"}
                {d.overridden ? <span className="ml-1 normal-case text-ink-3">(set by hand)</span> : null}
              </span>
            }
            action={d.worst && d.entries.length ? <Badge tone={d.worst === "in" || d.worst === "over_ok" || d.worst === "open" ? "good" : "warn"}>{MARK_ICON[d.worst]} {d.final ? MARK_WORD[d.worst] : "so far"}</Badge> : null}
          >
            {d.flag ? (
              <p className="mb-3 text-sm text-ink-2" data-testid="body-day-flag">
                {flagText(d.flag)} · this day can be left out of Patterns
              </p>
            ) : null}
            {d.dayType?.reminder ? (
              <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" data-testid="body-reminder">
                📌 {d.dayType.reminder}
              </p>
            ) : null}
            <MacroTiles totals={d.totals} bands={d.bands} marks={d.marks} setTargetsHref="/body/settings#day-types" />
            {device.burnCal != null ? (
              /* Phase 16b: the wearable's day beside intake, worded as the estimate it is. */
              <p className="mt-2 text-xs text-ink-3" data-testid="body-burn" data-cal={device.burnCal}>
                Burned about {device.burnCal.toLocaleString("en-US")} cal today by your device&apos;s estimate
                {device.avgHr != null ? ` · ${device.avgHr} bpm on average` : ""}
              </p>
            ) : null}
            <div className="mt-3 space-y-1">
              <CapsLine caps={d.caps} />
              {d.sodium ? <p className="text-xs text-ink-3" data-testid="body-sodium">Sodium: {Math.round(d.sodium).toLocaleString("en-US")} mg</p> : null}
              {d.bands ? <MarkKey /> : null}
            </div>
            <Disclosure summary={<span className="text-xs text-ink-3 underline">Change this day&apos;s type or mark it</span>} className="mt-2">
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
              {/* Rev 237 phase 15: a day travelling or ill can be left out of Patterns. */}
              <form action={setBodyDayFlagAction} className="mt-2 flex flex-wrap items-end gap-2" data-testid="body-day-flag-form">
                <input type="hidden" name="date" value={date} />
                <label className="text-xs text-ink-3">
                  Mark this day
                  <select name="flag" className="field w-auto py-1 text-sm" defaultValue={d.flag ?? ""} aria-label="Mark this day">
                    <option value="">No mark</option>
                    {DAY_FLAGS.map((f) => (
                      <option key={f} value={f}>
                        {FLAG_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="body-day-flag-save">
                  Mark
                </SubmitButton>
              </form>
            </Disclosure>
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

          <Card title="Last 7 days" action={<Link href="/body/week" className="text-xs text-ink-2 hover:underline" data-testid="body-week-link">This week →</Link>}>
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
              Nutrition
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
