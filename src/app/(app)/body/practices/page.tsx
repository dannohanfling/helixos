import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { archiveHabitAction, logHabitAction, saveHabitAction } from "@/lib/actions/body";
import { formatDate } from "@/lib/dates";
import { DAY_LETTERS, KIND_LABEL, STARTER_HABITS, fmtDays, fmtTarget, type Dot } from "@/lib/engine/body-habits";
import { bodySettingsFor, habitsDay, requireBodyEnabled, type HabitsDayView } from "@/lib/queries/body";
import { HABIT_KINDS } from "@/db/schema";

export const metadata = { title: "HumanOS · Practices" };

const DOT: Record<Dot, string> = { kept: "bg-humanos", missed: "bg-surface-3", off: "bg-transparent border border-dashed border-ink-4", today: "border-2 border-humanos", ahead: "bg-surface-2" };

/** Seven dots, Monday to Sunday. Positive framing (rev 196): a gap is a quiet grey, never a red mark. */
function WeekDots({ dots }: { dots: Dot[] }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`This week: ${dots.filter((d) => d === "kept").length} kept`} data-testid="habit-dots" data-kept={dots.filter((d) => d === "kept").length}>
      {dots.map((d, i) => (
        <span key={i} className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[d]}`} title={DAY_LETTERS[(i + 1) % 7]} />
      ))}
    </span>
  );
}

type Habit = HabitsDayView["habits"][number];

/** One habit's row: the tap (or the number), the streak, the week. */
function HabitRow({ h, date, today }: { h: Habit; date: string; today: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="habit" data-name={h.name} data-kept={h.kept ? "1" : "0"} data-streak={h.streak}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{h.name}</span>
          {h.streak ? (
            <span className="text-xs text-ink-2" data-testid="habit-streak">
              🔥 {h.streak} day{h.streak === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <WeekDots dots={h.dots} />
          <span>
            {fmtTarget(h) || KIND_LABEL[h.kind]}
            {h.days.length ? ` · ${fmtDays(h.days)}` : ""}
          </span>
        </div>
      </div>
      {h.kind === "done" ? (
        <form action={logHabitAction}>
          <input type="hidden" name="habitId" value={h.id} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="back" value={date === today ? "/body/practices" : `/body/practices?date=${date}`} />
          <input type="hidden" name="value" value={h.kept ? "0" : "1"} />
          <SubmitButton className={`btn btn-sm ${h.kept ? "btn-humanos" : "btn-soft"}`} pendingText="…" aria-pressed={h.kept} data-testid="habit-tap">
            {h.kept ? "✓ Done" : "Done"}
          </SubmitButton>
        </form>
      ) : (
        <form action={logHabitAction} className="flex items-center gap-1">
          <input type="hidden" name="habitId" value={h.id} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="back" value={date === today ? "/body/practices" : `/body/practices?date=${date}`} />
          <span className="w-24">
            <input name="value" type="number" step="any" min={0} inputMode="decimal" defaultValue={h.value ?? ""} placeholder={h.target != null ? String(h.target) : "0"} className="field py-1 text-sm tabular" aria-label={`${h.name} today`} data-testid="habit-value" />
          </span>
          <span className="text-xs text-ink-3">{h.kind === "minutes" ? "min" : (h.unit ?? "")}</span>
          <SubmitButton className={`btn btn-sm ${h.kept ? "btn-humanos" : "btn-soft"}`} pendingText="…" data-testid="habit-log">
            {h.kept ? "✓" : "Log"}
          </SubmitButton>
        </form>
      )}
    </li>
  );
}

function HabitForm({ h }: { h?: Habit }) {
  return (
    <form action={saveHabitAction} className="grid gap-2 sm:grid-cols-2" data-testid={h ? "habit-edit-form" : "habit-new-form"}>
      {h ? <input type="hidden" name="id" value={h.id} /> : null}
      <label className="block sm:col-span-2">
        <span className="label">Name</span>
        <input name="name" className="field" required maxLength={60} defaultValue={h?.name ?? ""} placeholder="Evening walk" />
      </label>
      <label className="block">
        <span className="label">Counts</span>
        <select name="kind" className="field" defaultValue={h?.kind ?? "done"}>
          {HABIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Daily target (optional) and unit</span>
        <span className="flex gap-2">
          <input name="target" type="number" step="any" min={0} inputMode="decimal" className="field tabular" defaultValue={h?.target ?? ""} placeholder="10" />
          <input name="unit" className="field" maxLength={12} defaultValue={h?.unit ?? ""} placeholder="oz" />
        </span>
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="label">Days (none ticked = every day)</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} className="inline-flex items-center gap-1">
              <input type="checkbox" name={`d${d}`} value="1" defaultChecked={!!h?.days.includes(d)} /> {DAY_LETTERS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-2 sm:col-span-2">
        <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid={h ? "habit-save" : "habit-add-own"}>
          {h ? "Save" : "Add habit"}
        </SubmitButton>
      </div>
    </form>
  );
}

export default async function PracticesPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= v.today ? sp.date : v.today;
  const hd = await habitsDay(v.workspace.id, v.user.id, date, v.today);
  const due = hd.habits.filter((h) => h.due);
  const rest = hd.habits.filter((h) => !h.due);
  const have = new Set(hd.habits.map((h) => h.name.toLowerCase()));
  const starters = STARTER_HABITS.filter((s) => !have.has(s.name.toLowerCase()));
  const keptToday = due.filter((h) => h.kept).length;

  return (
    <>
      <HumanosHeader
        title="Practices"
        subtitle={date === v.today ? `${keptToday} of ${due.length} kept today · ${hd.week.kept} of ${hd.week.due} this week` : `${formatDate(date, { weekday: "short", month: "short", day: "numeric" })} · ${keptToday} of ${due.length} kept`}
        action={
          <Link href="/body/week" className="text-xs text-ink-2 hover:underline">
            This week →
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="practices-summary" data-kept={keptToday} data-due={due.length} data-week-kept={hd.week.kept} data-week-due={hd.week.due}>
        {date !== v.today ? (
          <Link href="/body/practices" className="btn btn-ghost btn-sm">
            Today
          </Link>
        ) : null}
        <Link href={`/body/practices?date=${new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10)}`} className="btn btn-ghost btn-sm" aria-label="The day before">
          ← {formatDate(new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10))}
        </Link>
      </div>

      <Card title={date === v.today ? "Today" : formatDate(date, { weekday: "long", month: "short", day: "numeric" })} className="mb-4">
        {due.length ? (
          <ul className="divide-y" data-testid="habits-due">
            {due.map((h) => (
              <HabitRow key={h.id} h={h} date={date} today={v.today} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2" data-testid="habits-empty">
            {hd.habits.length ? "Nothing due today. A rest day for these." : "No habits yet. Pick a few below, or add your own."}
          </p>
        )}
        {rest.length ? (
          <Disclosure summary={<span className="mt-2 text-xs text-ink-2 underline">{rest.length} not due today</span>} className="mt-2">
            <ul className="divide-y">
              {rest.map((h) => (
                <HabitRow key={h.id} h={h} date={date} today={v.today} />
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </Card>

      <Card title="Add a habit" className="mb-4">
        {starters.length ? (
          <>
            <p className="mb-2 text-xs text-ink-3">One tap adds it with a sensible target you can change.</p>
            <div className="flex flex-wrap gap-2" data-testid="habit-starters">
              {starters.map((s) => (
                <form key={s.name} action={saveHabitAction}>
                  <input type="hidden" name="name" value={s.name} />
                  <input type="hidden" name="kind" value={s.kind} />
                  {s.unit ? <input type="hidden" name="unit" value={s.unit} /> : null}
                  {s.target != null ? <input type="hidden" name="target" value={s.target} /> : null}
                  <SubmitButton className="btn btn-soft btn-sm" pendingText="Adding…" data-testid="habit-starter" data-name={s.name}>
                    + {s.name}
                    {s.target != null ? <span className="ml-1 text-xs text-ink-3">{fmtTarget(s as { kind: typeof s.kind; unit: string | null; target: number | null }).replace(" a day", "")}</span> : null}
                  </SubmitButton>
                </form>
              ))}
            </div>
          </>
        ) : null}
        <Disclosure summary={<span className="mt-3 text-sm underline">Your own</span>} className="mt-3">
          <div className="mt-2">
            <HabitForm />
          </div>
        </Disclosure>
      </Card>

      {hd.habits.length ? (
        <Card title="Edit" className="mb-8">
          <ul className="divide-y text-sm">
            {hd.habits.map((h) => (
              <li key={h.id} className="py-2">
                <Disclosure summary={<span className="underline">{h.name}</span>}>
                  <div className="mt-2 space-y-2">
                    <HabitForm h={h} />
                    <form action={archiveHabitAction}>
                      <input type="hidden" name="id" value={h.id} />
                      <SubmitButton className="btn btn-ghost btn-sm text-ink-3" pendingText="…" data-testid="habit-archive">
                        Archive
                      </SubmitButton>
                    </form>
                  </div>
                </Disclosure>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
