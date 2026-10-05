import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { workspaceRules } from "@/lib/recordings";
import { DAY_LONG, DEFAULT_RULES, PROGRAM_AUDIENCES, SLOT_WINDOW_MINUTES, slotTitle, type ProgramAudience, type SeriesRule, type SlotRule } from "@/lib/engine/recording-rules";
import { saveRecordingRulesAction } from "@/lib/actions/recordings";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Publishing rules" };

const AUDIENCE_OPTION: Record<ProgramAudience, string> = { accelerator_academy: "Accelerator and Academy (everyone)", academy: "Academy" };
const BLANK_ROWS = 2;

/**
 * Recordings → Publishing rules (rev 491): the series names a Fathom title is matched on, ignoring case and punctuation, and
 * the time slots that place a call whose title names no series, each with who it is for. A new call that matches publishes
 * itself; a draft already here gets the same suggestion on To review. A blank name drops a row; Remove drops a saved one.
 */
export default async function RecordingRulesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const { rules } = await workspaceRules(v.workspace.id);
  const series: (SeriesRule | null)[] = [...rules.series, ...Array<null>(BLANK_ROWS).fill(null)];
  const slots: (SlotRule | null)[] = [...rules.slots, ...Array<null>(BLANK_ROWS).fill(null)];
  const audienceSelect = (name: string, value: ProgramAudience | undefined, label: string) => (
    <select className="field" name={name} defaultValue={value ?? "academy"} aria-label={label}>
      {PROGRAM_AUDIENCES.map((a) => (
        <option key={a} value={a}>
          {AUDIENCE_OPTION[a]}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title="Publishing rules" subtitle="Which calls publish themselves, and to whom" action={<Link href="/coach/recordings" className="btn btn-ghost btn-sm">Back to Recordings</Link>} />
      {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="rules-saved">Saved. Every draft&apos;s suggestion follows these now, and new calls publish by them.</p> : null}
      {sp.error ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="rules-error">{sp.error}</p> : null}
      <form action={saveRecordingRulesAction} className="space-y-4" data-testid="rules-form">
        <input type="hidden" name="series_count" value={series.length} />
        <input type="hidden" name="slot_count" value={slots.length} />
        <Card title="1. By series name">
          <p className="mb-3 text-sm text-ink-2">
            A call whose Fathom title contains one of these names goes to its audience. Case and punctuation don&apos;t matter: &ldquo;Evolve Omega: Automation Accelerator&rdquo; matches Automation Accelerator.
          </p>
          <ul className="space-y-2" data-testid="rules-series">
            {series.map((s, i) => (
              <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center" data-testid="rules-series-row">
                <input className="field" name={`series_name_${i}`} defaultValue={s?.name ?? ""} placeholder={s ? "" : "Add a series name"} aria-label="Series name" maxLength={80} data-testid={`series-name-${i}`} />
                {audienceSelect(`series_audience_${i}`, s?.audience, "Who it's for")}
                {s ? (
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input type="checkbox" name={`series_remove_${i}`} value="1" data-testid={`series-remove-${i}`} /> Remove
                  </label>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="2. By time slot">
          <p className="mb-3 text-sm text-ink-2">
            For a call whose title names no series (&ldquo;Impromptu Zoom Meeting&rdquo;): if it started within {SLOT_WINDOW_MINUTES} minutes of one of these times, it goes to that audience and HelixOS names it clearly, like &ldquo;{slotTitle(DEFAULT_RULES.slots[0])}&rdquo;. Fathom&apos;s own title stays under it. A call with only you on it stays a draft, even inside a slot.
          </p>
          <label className="mb-3 block max-w-sm">
            <span className="label">Timezone for these times</span>
            <input className="field" name="timezone" defaultValue={rules.timezone} required data-testid="rules-timezone" />
          </label>
          <ul className="space-y-2" data-testid="rules-slots">
            {slots.map((s, i) => (
              <li key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_0.8fr_1.4fr_auto] sm:items-center" data-testid="rules-slot-row">
                <input className="field col-span-2 sm:col-span-1" name={`slot_name_${i}`} defaultValue={s?.name ?? ""} placeholder={s ? "" : "Add a slot: its name"} aria-label="Name for calls in this slot" maxLength={80} data-testid={`slot-name-${i}`} />
                <select className="field" name={`slot_day_${i}`} defaultValue={s ? String(s.day) : "1"} aria-label="Day" data-testid={`slot-day-${i}`}>
                  {DAY_LONG.map((d, n) => (
                    <option key={d} value={n}>
                      {d}
                    </option>
                  ))}
                </select>
                <input className="field" type="time" name={`slot_time_${i}`} defaultValue={s?.time ?? ""} aria-label="Start time" data-testid={`slot-time-${i}`} />
                <div className="col-span-2 sm:col-span-1">{audienceSelect(`slot_audience_${i}`, s?.audience, "Who it's for")}</div>
                {s ? (
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input type="checkbox" name={`slot_remove_${i}`} value="1" data-testid={`slot-remove-${i}`} /> Remove
                  </label>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-xs text-ink-3">Need more rows? Save, and two empty ones come back.</p>
        <SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="rules-save">
          Save rules
        </SubmitButton>
      </form>
    </>
  );
}
