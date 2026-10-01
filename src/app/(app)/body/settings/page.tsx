import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { formatDate, formatDateTime } from "@/lib/dates";
import { MACROS, MACRO_NAME, nextRefeed } from "@/lib/engine/body";
import { bodySettingsFor, dayTypesFor, requireBodyEnabled, shareHistory } from "@/lib/queries/body";
import { deleteDayTypeAction, eraseBodyAction, saveBodySettingsAction, saveDayTypeAction, setBodyAiAction, setBodyShareAction } from "@/lib/actions/body";
import type * as schema from "@/db/schema";
import { EraseBodyForm } from "@/components/body/unit-inputs";

export const metadata = { title: "HumanOS · Settings" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayTypeFields({ t }: { t?: schema.BodyDayType }) {
  const pair = (label: string, lo: keyof schema.BodyDayType, hi: keyof schema.BodyDayType, unit: string) => (
    <div>
      <span className="label">
        {label} <span className="normal-case text-ink-3">({unit})</span>
      </span>
      <div className="flex items-center gap-1">
        <input name={lo} type="number" step="any" min={0} className="field w-full py-1 text-sm tabular" defaultValue={t?.[lo] == null ? "" : String(t[lo])} placeholder="from" aria-label={`${label} from`} />
        <span className="text-ink-3">–</span>
        <input name={hi} type="number" step="any" min={0} className="field w-full py-1 text-sm tabular" defaultValue={t?.[hi] == null ? "" : String(t[hi])} placeholder="to" aria-label={`${label} to`} />
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="label">Name</span>
        <input name="name" className="field py-1 text-sm" defaultValue={t?.name} required maxLength={60} />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {pair("Calories", "calMin", "calMax", "cal")}
        {pair("Protein", "pMin", "pMax", "g")}
        {pair("Fat", "fMin", "fMax", "g")}
        {pair("Carbs", "cMin", "cMax", "g")}
      </div>
      <label className="block">
        <span className="label">Reminder on these days (optional)</span>
        <input name="reminder" className="field py-1 text-sm" defaultValue={t?.reminder ?? ""} maxLength={140} placeholder="e.g. Electrolytes with lunch" />
      </label>
    </div>
  );
}

export default async function BodySettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const s = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!s) redirect("/body");
  const [types, history] = await Promise.all([dayTypesFor(v.workspace.id, v.user.id), shareHistory(v.workspace.id, v.user.id)]);
  const refeedNext = nextRefeed(v.today, { dayTypeId: s.refeedDayTypeId, anchor: s.refeedAnchor, everyDays: s.refeedEveryDays });
  const capRows = [...s.caps, null];

  return (
    <>
      <HumanosHeader title="Settings" subtitle="Your targets, your week, and who sees any of it." gear={false} action={<Link href="/body" className="btn btn-ghost btn-sm">← Log</Link>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      <Card className="mb-4" title="Sharing" id="share">
        <p className="text-sm text-ink-2">
          Your Body data is private by default. Switched on, your coach can <b>read</b> your days and leave a comment on a day, nothing else: no edits, no exports, no AI. Your health log and photos stay yours alone either way. You can switch it off any time, and every change is logged below.
        </p>
        <form action={setBodyShareAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="shared" value={s.shareWithCoach ? "0" : "1"} />
          <span className="text-sm font-medium" data-testid="body-share-state">
            Let my coach see my Body data: {s.shareWithCoach ? "On" : "Off"}
          </span>
          <SubmitButton className={`btn btn-sm ${s.shareWithCoach ? "btn-soft" : "btn-primary"}`} pendingText="Saving…" data-testid="body-share-toggle">
            {s.shareWithCoach ? "Switch off" : "Switch on"}
          </SubmitButton>
        </form>
        <p className="mt-4 text-sm text-ink-2">
          Separately, you can let HelixOS&apos;s AI use your Body numbers (targets, what you logged, your saved meals) to support you better, on your own AI key. Never your photos or notes. Off, AI only sees Body data when you press a button for that one request.
        </p>
        <form action={setBodyAiAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="on" value={s.aiUse ? "0" : "1"} />
          <span className="text-sm font-medium" data-testid="body-ai-state">
            Let AI use my Body data to support me: {s.aiUse ? "On" : "Off"}
          </span>
          <SubmitButton className={`btn btn-sm ${s.aiUse ? "btn-soft" : "btn-primary"}`} pendingText="Saving…" data-testid="body-ai-toggle">
            {s.aiUse ? "Switch off" : "Switch on"}
          </SubmitButton>
        </form>
        {history.length ? (
          <ul className="mt-3 space-y-0.5 text-xs text-ink-3" data-testid="body-share-log">
            {history.map((h) => (
              <li key={h.id} data-kind={h.kind}>
                {h.kind === "ai" ? "AI use" : "Coach sharing"} {h.shared ? "switched on" : "switched off"} · {formatDateTime(h.createdAt.includes("T") ? h.createdAt : `${h.createdAt.replace(" ", "T")}Z`, v.tz)}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="mb-4" title="Day types" id="day-types">
        <p className="mb-3 text-sm text-ink-2">Each day type has its own bands: a from and a to for each macro you track. Leave a macro blank to show its total without a target. The marks: inside the band ✅; slightly off 🟡 (5% or {`50 cal / 5 g P / 5 g F / 3 g C`}, whichever is more); significantly off ⚠️ (15%); beyond that, or more than slightly under a floor, ❌.</p>
        <ul className="space-y-3" data-testid="body-day-types">
          {types.map((t) => (
            <li key={t.id} className="rounded-lg border p-3">
              <form action={saveDayTypeAction}>
                <input type="hidden" name="id" value={t.id} />
                <DayTypeFields t={t} />
                <div className="mt-2 flex items-center gap-2">
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
                    Save {t.name}
                  </SubmitButton>
                </div>
              </form>
              {types.length > 1 ? (
                <form action={deleteDayTypeAction} className="mt-2">
                  <input type="hidden" name="id" value={t.id} />
                  <ConfirmDelete what={`the day type "${t.name}"`} undo="Days on your pattern that used it will have no day type until you pick one." />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <Disclosure summary={<span className="btn btn-soft btn-sm">＋ New day type</span>} className="mt-3">
          <form action={saveDayTypeAction} className="rounded-lg border p-3">
            <DayTypeFields />
            <SubmitButton className="btn btn-primary btn-sm mt-2" pendingText="Saving…">
              Add day type
            </SubmitButton>
          </form>
        </Disclosure>
      </Card>

      <Card className="mb-4" title="Your week, refeeds, floors and caps" id="week">
        <form action={saveBodySettingsAction} className="space-y-4" data-testid="body-settings-form">
          <div>
            <span className="label">Weekly pattern</span>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {DAYS.map((d, i) => (
                <label key={d} className="text-xs">
                  <span className="block text-ink-3">{d}</span>
                  <select name={`pattern_${i}`} className="field py-1 text-sm" defaultValue={s.weekPattern[String(i) as "0"] ?? ""}>
                    <option value="">—</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="label">Refeed day type</span>
              <select name="refeedDayTypeId" className="field py-1 text-sm" defaultValue={s.refeedDayTypeId ?? ""}>
                <option value="">No refeeds</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Next refeed</span>
              <input name="refeedAnchor" type="date" className="field py-1 text-sm" defaultValue={s.refeedAnchor ?? ""} data-testid="body-refeed-anchor" />
            </label>
            <label>
              <span className="label">Then every (days)</span>
              <input name="refeedEveryDays" type="number" min={1} max={60} className="field py-1 text-sm tabular" defaultValue={s.refeedEveryDays} />
            </label>
          </div>
          <p className="-mt-2 text-xs text-ink-3">{refeedNext ? `Next refeed: ${formatDate(refeedNext, { weekday: "long", month: "short", day: "numeric" })}. It replaces that day's usual type.` : "No refeed days until you set the next one."}</p>

          <div className="grid gap-3 sm:grid-cols-4">
            <label>
              <span className="label">Calorie floor</span>
              <input name="calFloor" type="number" min={0} className="field py-1 text-sm tabular" defaultValue={s.calFloor ?? ""} placeholder="none" />
            </label>
            <label>
              <span className="label">Fat floor (g)</span>
              <input name="fatFloor" type="number" min={0} className="field py-1 text-sm tabular" defaultValue={s.fatFloor ?? ""} placeholder="none" />
            </label>
            <label>
              <span className="label">Weight in</span>
              <select name="weightUnit" className="field py-1 text-sm" defaultValue={s.weightUnit}>
                <option value="lb">lb</option>
                <option value="kg">kg</option>
              </select>
            </label>
            <label>
              <span className="label">Food weights in</span>
              <select name="foodUnit" className="field py-1 text-sm" defaultValue={s.foodUnit}>
                <option value="oz">oz</option>
                <option value="g">g</option>
              </select>
            </label>
          </div>

          <div>
            <span className="label">Over the top is fine (🟢) for</span>
            <div className="flex flex-wrap gap-3 text-sm">
              {MACROS.map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input type="checkbox" name={`overOk_${m}`} defaultChecked={s.overOk.includes(m)} /> {MACRO_NAME[m]}
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="label">Meal slots, in order (comma-separated)</span>
            <input name="mealSlots" className="field py-1 text-sm" defaultValue={s.mealSlots.join(", ")} />
          </label>

          <div>
            <span className="label">Caps (e.g. cheese: 1 oz default, 2 oz flex top)</span>
            <div className="space-y-2">
              {capRows.map((c, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 text-sm">
                  <input name={`cap_${i}_tag`} className="field py-1" defaultValue={c?.tag ?? ""} placeholder="tag" aria-label="Cap tag" />
                  <input name={`cap_${i}_label`} className="field py-1" defaultValue={c?.label ?? ""} placeholder="label" aria-label="Cap label" />
                  <input name={`cap_${i}_unit`} className="field py-1" defaultValue={c?.unit ?? ""} placeholder="oz" aria-label="Cap unit" />
                  <input name={`cap_${i}_soft`} type="number" step="any" min={0} className="field py-1 tabular" defaultValue={c?.soft ?? ""} placeholder="default" aria-label="Cap default" />
                  <input name={`cap_${i}_hard`} type="number" step="any" min={0} className="field py-1 tabular" defaultValue={c?.hard ?? ""} placeholder="flex top" aria-label="Cap flex top" />
                  <select name={`cap_${i}_per`} className="field py-1" defaultValue={c?.per ?? "day"} aria-label="Cap per">
                    <option value="day">a day</option>
                    <option value="week">a week</option>
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-3">A food counts toward a cap when it carries the cap&apos;s tag (set on the food). Clear the tag to remove a cap.</p>
          </div>

          <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="body-settings-save">
            Save
          </SubmitButton>
        </form>
      </Card>

      <Card className="mb-4" title="From Airtable" id="airtable">
        <p className="text-sm text-ink-2">Your HumanOS base&apos;s weigh-ins, routines and workouts, brought over with a read-only token you paste for that run only.</p>
        <Link href="/body/import" className="btn btn-soft btn-sm mt-3" data-testid="body-import-link">
          Bring it over
        </Link>
      </Card>

      <Card className="mb-8" title="Download your Body data" id="download">
        <p className="text-sm text-ink-2">One file with everything in Body: your targets and day types, foods, saved meals, every logged day, your coach&apos;s comments and your sharing log.</p>
        <a href="/api/export?format=json&scope=body" className="btn btn-soft btn-sm mt-3" data-testid="body-export">
          Download
        </a>
      </Card>

      <section className="card border-danger p-4 sm:p-5" id="delete" data-testid="body-delete-card">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-danger">Delete all Body data</h2>
        <p className="text-sm text-ink-2">This removes every Body row: targets, foods, meals, logged days, comments and your sharing log. It can&apos;t be undone, so download your data first if you might want it. The rest of your HelixOS is untouched.</p>
        <EraseBodyForm action={eraseBodyAction} />
      </section>
    </>
  );
}
