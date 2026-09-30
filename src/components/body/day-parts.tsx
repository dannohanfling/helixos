/** The pieces of a Body day shared by the member's page and the coach's read-only view. Server components, no state. */
import Link from "next/link";
import { MACROS, MACRO_NAME, MARK_ICON, MARK_WORD, fmtBand, fmtMacro, type Bands, type Macro, type Macros, type Mark, type Marks } from "@/lib/engine/body";
import type { BodyDayView } from "@/lib/queries/body";
import { Progress } from "@/components/ui";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/dates";

const tone = (m: Mark): "good" | "accent" | "warn" => (m === "in" || m === "over_ok" ? "good" : m === "open" ? "accent" : "warn");

/**
 * Four tiles: what's eaten against the band, with the mark. A macro with no band shows its total alone; with no bands at all, a
 * "Set targets" link (for the member; the coach's read-only view passes none).
 */
export function MacroTiles({ totals, bands, marks, setTargetsHref }: { totals: Macros; bands: Bands | null; marks: Marks | null; setTargetsHref?: string }) {
  return (
    <>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="body-tiles">
      {MACROS.map((m) => {
        const b = bands?.[m];
        const mark = marks?.[m] ?? null;
        const pct = b && b.max > 0 ? (totals[m] / b.max) * 100 : 0;
        return (
          <div key={m} className="rounded-lg bg-surface-2 p-3" data-testid={`body-tile-${m}`} data-mark={mark ?? ""}>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              <span>{MACRO_NAME[m]}</span>
              {mark ? (
                <span title={MARK_WORD[mark]} aria-label={MARK_WORD[mark]}>
                  {MARK_ICON[mark]}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xl font-semibold leading-none tabular">
              {fmtMacro(m, totals[m])}
              {b ? <span className="text-xs font-normal text-ink-3"> / {fmtBand(m, b)}{m === "cal" ? "" : " g"}</span> : null}
            </div>
            {b ? (
              <div className="mt-2">
                <Progress value={pct} tone={mark ? tone(mark) : "accent"} height={5} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
    {!bands && setTargetsHref ? (
      <p className="mt-2 text-sm text-ink-2" data-testid="body-no-targets">
        No targets for this day yet, so these are totals only.{" "}
        <Link href={setTargetsHref} className="font-medium underline">
          Set targets →
        </Link>
      </p>
    ) : null}
    </>
  );
}

/** "Left: 620–720 cal · 90–110 P · up to 14 F · up to 2 C". A band already reached shows only its headroom; one passed says so. */
/**
 * What's left, said the way a member thinks it (rev 238): "62 g protein to go · 14 g fat left". To go = still under the band's
 * bottom; left = room up to its top; over = past the top. The page leads with this line.
 */
export function LeftLine({ left }: { left: Partial<Record<Macro, { min: number; max: number }>> }) {
  const parts = MACROS.flatMap((m) => {
    const band = left[m];
    if (!band) return [];
    const amount = (n: number) => (m === "cal" ? `${fmtMacro(m, n)} cal` : `${fmtMacro(m, n)} g ${MACRO_NAME[m].toLowerCase()}`);
    if (band.max < 0) return { m, text: `${amount(-band.max)} over`, over: true };
    if (band.min > 0) return { m, text: `${amount(band.min)} to go`, over: false };
    return { m, text: `${amount(band.max)} left`, over: false };
  });
  if (!parts.length) return null;
  return (
    <p className="text-lg font-semibold leading-snug text-humanos-ink" data-testid="body-left">
      {parts.map((p, i) => (
        <span key={p.m} className={p.over ? "text-danger" : undefined}>
          {i ? <span className="text-ink-3"> · </span> : null}
          {p.text}
        </span>
      ))}
    </p>
  );
}

/** The day's entries, grouped by slot in the member's slot order (any other slot after). */
export function EntriesBySlot({ entries, slots, action }: { entries: BodyDayView["entries"]; slots: string[]; action?: (e: BodyDayView["entries"][number]) => ReactNode }) {
  const order = [...slots, ...entries.map((e) => e.slot).filter((s) => !slots.includes(s))].filter((s, i, a) => a.indexOf(s) === i);
  const groups = order.map((slot) => ({ slot, list: entries.filter((e) => e.slot === slot) })).filter((g) => g.list.length);
  if (!groups.length) return <p className="text-sm text-ink-2">Nothing logged yet.</p>;
  return (
    <div className="space-y-3" data-testid="body-entries">
      {groups.map((g) => (
        <div key={g.slot}>
          <div className="label">{g.slot}</div>
          <ul className="divide-y rounded-lg border">
            {g.list.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 p-2.5 text-sm" data-testid="body-entry">
                <div className="min-w-0">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-ink-3">{e.items.map((i) => `${i.qty} ${i.unit} ${e.items.length > 1 || e.mealId ? i.name.toLowerCase() : ""}`.trim()).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs text-ink-2">
                    {fmtMacro("cal", e.cal)} cal · {fmtMacro("p", e.p)} P · {fmtMacro("f", e.f)} F · {fmtMacro("c", e.c)} C
                  </span>
                  {action?.(e)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CapsLine({ caps }: { caps: BodyDayView["caps"] }) {
  if (!caps.length) return null;
  return (
    <p className="text-xs text-ink-3" data-testid="body-caps">
      {caps.map((c) => (
        <span key={c.tag} className={`mr-3 ${c.state === "over" ? "font-semibold text-danger" : ""}`} data-state={c.state}>
          {c.label}: {c.used} of {c.soft} {c.unit}
          {c.per === "week" ? " this week" : ""}
          {c.state === "flex" ? ` (flex, top ${c.hard})` : c.state === "over" ? ` · over the ${c.hard} ${c.unit} cap` : ""}
          {c.nextAllowed ? ` · next ${formatDate(c.nextAllowed, { weekday: "short", month: "short", day: "numeric" })}` : ""}
        </span>
      ))}
    </p>
  );
}

export function MarkKey() {
  return (
    <p className="text-[11px] text-ink-3">
      {(["in", "over_ok", "slight", "significant", "out", "open"] as Mark[]).map((m) => `${MARK_ICON[m]} ${MARK_WORD[m]}`).join(" · ")}
    </p>
  );
}
