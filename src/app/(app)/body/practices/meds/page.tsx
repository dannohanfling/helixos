import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { archiveMedAction, countMedAction, fillBoxesMedAction, refillMedAction, saveMedAction, setMedsSwitchAction, takeMedAction } from "@/lib/actions/body";
import { bodySettingsFor, medsView, requireBodyEnabled, type MedsView } from "@/lib/queries/body";
import { DAY_NAMES } from "@/lib/engine/body-habits";
import { MED_TYPES, MED_TYPE_LABEL, WITH_FOOD, WITH_FOOD_LABEL, type MedLine } from "@/lib/engine/body-meds";

export const metadata = { title: "HumanOS · Supplements & meds" };

type Med = MedsView["meds"][number];
const TONE: Record<MedLine["tone"], string> = { info: "text-ink-2", soon: "text-warn", now: "text-danger", stop: "text-danger font-medium" };

/** One item's form: what it is, when it's taken, the supply, and for a script its dates, repeats and refill rule. */
function MedForm({ m }: { m?: Med }) {
  return (
    <form action={saveMedAction} className="grid gap-2 sm:grid-cols-2" data-testid={m ? "med-edit-form" : "med-new-form"}>
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <label className="block">
        <span className="label">Name</span>
        <input name="name" className="field" required maxLength={80} defaultValue={m?.name ?? ""} placeholder="Vitamin D3" />
      </label>
      <label className="block">
        <span className="label">Type</span>
        <select name="type" className="field" defaultValue={m?.type ?? "supplement"} data-testid="med-type">
          {MED_TYPES.map((t) => (
            <option key={t} value={t}>
              {MED_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Dose</span>
        <input name="dose" className="field" maxLength={60} defaultValue={m?.dose ?? ""} placeholder="1000 IU" />
      </label>
      <label className="block">
        <span className="label">How it&apos;s taken</span>
        <input name="howTaken" className="field" maxLength={80} defaultValue={m?.howTaken ?? ""} placeholder="1 capsule" />
      </label>
      <label className="block">
        <span className="label">Times a day</span>
        <input name="timesPerDay" type="number" min={0} max={12} className="field tabular" defaultValue={m?.timesPerDay ?? 1} />
      </label>
      <label className="block">
        <span className="label">With food</span>
        <select name="withFood" className="field" defaultValue={m?.withFood ?? ""}>
          <option value="">Not said</option>
          {WITH_FOOD.map((w) => (
            <option key={w} value={w}>
              {WITH_FOOD_LABEL[w]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="label">Days (none ticked = every day)</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="inline-flex items-center gap-1">
              <input type="checkbox" name={`d${d}`} value="1" defaultChecked={!!m?.days.includes(d)} /> {DAY_NAMES[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">On hand (count)</span>
        <input name="onHand" type="number" step="any" min={0} className="field tabular" defaultValue={m?.onHand ?? ""} placeholder="60" data-testid="med-on-hand" />
      </label>
      <label className="block">
        <span className="label">Per dose, and what you count</span>
        <span className="flex gap-2">
          <input name="perDose" type="number" step="any" min={0.25} className="field tabular" defaultValue={m?.perDose ?? 1} />
          <input name="unitWord" className="field" maxLength={20} defaultValue={m?.unitWord ?? ""} placeholder="tablets" />
        </span>
      </label>
      <label className="block">
        <span className="label">Days&apos; supply per fill</span>
        <input name="supplyDays" type="number" min={1} max={400} className="field tabular" defaultValue={m?.supplyDays ?? ""} placeholder="30" />
      </label>
      <label className="block">
        <span className="label">Last filled</span>
        <input name="lastFilledOn" type="date" className="field" defaultValue={m?.lastFilledOn ?? ""} />
      </label>
      <fieldset className="grid gap-2 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="label px-1">For a prescription</legend>
        <label className="block">
          <span className="label">Issued</span>
          <input name="issuedOn" type="date" className="field" defaultValue={m?.issuedOn ?? ""} />
        </label>
        <label className="block">
          <span className="label">Expires (or pick a length)</span>
          <span className="flex gap-2">
            <input name="expiresOn" type="date" className="field" defaultValue={m?.expiresOn ?? ""} />
            <select name="expiryMonths" className="field" defaultValue="">
              <option value="">—</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </span>
        </label>
        <label className="block">
          <span className="label">Repeats left</span>
          <input name="repeatsLeft" type="number" min={0} max={99} className="field tabular" defaultValue={m?.repeatsLeft ?? ""} data-testid="med-repeats" />
        </label>
        <label className="block">
          <span className="label">Script</span>
          <select name="scriptKind" className="field" defaultValue={m?.scriptKind ?? ""}>
            <option value="">Not said</option>
            <option value="electronic">Electronic</option>
            <option value="paper">Paper</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">When the refill opens</span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <select name="refillRule" className="field w-auto" defaultValue={m?.refillRule ?? "before_runout"}>
              <option value="before_runout">days before you run out</option>
              <option value="share_used">once this % is used</option>
            </select>
            <input name="refillDays" type="number" min={0} max={60} className="field w-20 tabular" defaultValue={m?.refillDays ?? 12} aria-label="Days before you run out" />
            <input name="refillShare" type="number" min={1} max={100} className="field w-20 tabular" defaultValue={m?.refillShare ?? 75} aria-label="Percent used" />
          </span>
        </label>
        <label className="block">
          <span className="label">Pharmacy</span>
          <input name="pharmacy" className="field" maxLength={80} defaultValue={m?.pharmacy ?? ""} />
        </label>
        <label className="block">
          <span className="label">Prescriber</span>
          <input name="prescriber" className="field" maxLength={80} defaultValue={m?.prescriber ?? ""} />
        </label>
      </fieldset>
      <label className="block">
        <span className="label">Remind me</span>
        <span className="flex gap-2">
          <input name="remindDays" type="number" min={0} max={60} className="field w-20 tabular" defaultValue={m?.remindDays ?? 5} aria-label="Days ahead" />
          <select name="remindOn" className="field" defaultValue={m?.remindOn ?? "runout"}>
            <option value="runout">days before it runs out</option>
            <option value="refill_open">when the refill opens</option>
          </select>
        </span>
      </label>
      <label className="block">
        <span className="label">Note</span>
        <input name="note" className="field" maxLength={200} defaultValue={m?.note ?? ""} />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid={m ? "med-save" : "med-add"}>
          {m ? "Save" : "Add"}
        </SubmitButton>
      </div>
    </form>
  );
}

export default async function MedsPage({ searchParams }: { searchParams: Promise<{ error?: string; said?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const { meds } = await medsView(v.workspace.id, v.user.id, v.today, v.today);
  const dueToday = meds.filter((m) => m.due > 0);

  return (
    <>
      <HumanosHeader title="Supplements & meds" subtitle="What you take and when, and the supply. HumanOS records what you enter: it gives no dose advice and checks no interactions." action={<Link href="/body/practices" className="btn btn-ghost btn-sm">← Practices</Link>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      {sp.said ? (
        <p className="mb-4 rounded-xl border p-3 text-sm" role="status" data-testid="med-said">
          {sp.said.slice(0, 300)}
        </p>
      ) : null}

      {dueToday.length ? (
        <Card className="mb-4" title="Today">
          <ul className="divide-y text-sm" data-testid="meds-today">
            {dueToday.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="med-today" data-name={m.name} data-taken={m.taken.length} data-due={m.due}>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-ink-3">{[m.howTaken, m.withFood ? WITH_FOOD_LABEL[m.withFood] : null].filter(Boolean).length ? ` · ${[m.howTaken, m.withFood ? WITH_FOOD_LABEL[m.withFood] : null].filter(Boolean).join(", ")}` : ""}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {Array.from({ length: m.due }, (_, i) => i + 1).map((slot) => (
                    <form key={slot} action={takeMedAction}>
                      <input type="hidden" name="medId" value={m.id} />
                      <input type="hidden" name="slot" value={slot} />
                      <input type="hidden" name="back" value="/body/practices/meds" />
                      <SubmitButton className={`btn btn-xs ${m.taken.includes(slot) ? "btn-humanos" : "btn-soft"}`} pendingText="…" aria-pressed={m.taken.includes(slot)} data-testid="med-take" data-slot={slot}>
                        {m.taken.includes(slot) ? "✓ " : ""}Take{m.due > 1 ? ` ${slot}` : ""}
                      </SubmitButton>
                    </form>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-4" title={`Your list · ${meds.length}`}>
        {meds.length ? (
          <ul className="space-y-3" data-testid="meds-list">
            {meds.map((m) => (
              <li key={m.id} className="rounded-lg border p-3 text-sm" data-testid="med" data-name={m.name} data-on-hand={m.onHand ?? ""} data-repeats={m.repeatsLeft ?? ""}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{m.name}</span> <span className="text-xs text-ink-3">{MED_TYPE_LABEL[m.type]}{m.dose ? ` · ${m.dose}` : ""}{m.timesPerDay ? ` · ${m.timesPerDay}× a day` : ""}{m.days.length ? ` · ${m.days.map((d) => DAY_NAMES[d]).join(", ")}` : ""}</span>
                  </span>
                  <span className="text-xs text-ink-2 tabular">{m.onHand != null ? `${m.onHand} ${m.unitWord ?? "on hand"}` : "count not set"}{m.boxedUntil && m.boxedUntil >= v.today ? ` · boxes to ${m.boxedUntil}` : ""}</span>
                </div>
                {m.lines.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs" data-testid="med-lines">
                    {m.lines.map((l, i) => (
                      <li key={i} className={TONE[l.tone]} data-tone={l.tone}>
                        {l.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={refillMedAction} className="flex items-end gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="added" type="number" step="any" min={0} className="field w-20 py-1 text-xs tabular" placeholder={m.supplyDays ? "a fill" : "how many"} aria-label="How many you got" />
                    <SubmitButton className="btn btn-soft btn-xs" pendingText="…" data-testid="med-refill">
                      Refilled
                    </SubmitButton>
                  </form>
                  <form action={fillBoxesMedAction} className="flex items-end gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="days" type="number" min={1} max={120} defaultValue={14} className="field w-16 py-1 text-xs tabular" aria-label="Days of pill boxes" />
                    <SubmitButton className="btn btn-soft btn-xs" pendingText="…" data-testid="med-boxes">
                      Filled pill boxes
                    </SubmitButton>
                  </form>
                  <form action={countMedAction} className="flex items-end gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="onHand" type="number" step="any" min={0} className="field w-20 py-1 text-xs tabular" placeholder="count" aria-label="How many are left" data-testid="med-count-value" />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="med-count">
                      Count what&apos;s left
                    </SubmitButton>
                  </form>
                </div>
                <div className="mt-2">
                  <Disclosure summary={<span className="text-xs underline">Edit {m.name}</span>}>
                    <div className="mt-2 space-y-2">
                      <MedForm m={m} />
                      <form action={archiveMedAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <SubmitButton className="btn btn-ghost btn-sm text-ink-3" pendingText="…" data-testid="med-archive">
                          Archive
                        </SubmitButton>
                      </form>
                    </div>
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Nothing yet. Add what you take below.</p>
        )}
      </Card>

      <Card className="mb-4" title="Add">
        <MedForm />
      </Card>

      <Card className="mb-8" title="Who sees this">
        <p className="mb-2 text-sm text-ink-2">Private by default, like your health log. Your coach sees it only with this switch on, apart from sharing your days. An AI reads it only with its own switch on too. It never goes to Community Loyalty, GoHighLevel or email.</p>
        <div className="flex flex-wrap gap-3">
          <form action={setMedsSwitchAction}>
            <input type="hidden" name="which" value="share" />
            <input type="hidden" name="on" value={settings.medsShare ? "0" : "1"} />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="meds-share-toggle">
              Let my coach see this: {settings.medsShare ? "On" : "Off"}
            </SubmitButton>
          </form>
          <form action={setMedsSwitchAction}>
            <input type="hidden" name="which" value="ai" />
            <input type="hidden" name="on" value={settings.medsAi ? "0" : "1"} />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="meds-ai-toggle">
              Let AI read my supplements and meds: {settings.medsAi ? "On" : "Off"}
            </SubmitButton>
          </form>
        </div>
      </Card>
    </>
  );
}
