import type { ProgramCall, ProgramCallSkip } from "@/db/schema";
import { CALL_AUDIENCES } from "@/db/schema";
import { addDefaultCallsAction, moveCallAction, saveCallAction, saveCallsSharedAction, setCallActiveAction, skipCallDateAction, unskipCallAction } from "@/lib/actions/calls";
import { CALL_AUDIENCE_LABEL, CALL_DAY_NAMES, CALL_MINUTES_MAX, CALL_MINUTES_MIN, CALL_TZ_DEFAULT, lengthWords, nextCallDates, skipDay } from "@/lib/engine/calls";
import { zoneName } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card } from "@/components/ui";

const NOTICE: Record<string, string> = { added: "Added.", saved: "Saved.", moved: "Moved.", skipped: "Skipped. Members won't see the call that day.", unskipped: "The call is back on that day.", shared: "Saved. Every call without its own link uses it." };
const ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Australia/Sydney"];

/** The add and edit form for one call. `call` absent is a new one. */
function CallForm({ call }: { call?: ProgramCall }) {
  const key = call?.id ?? "new";
  return (
    <form action={saveCallAction} className="grid gap-2 sm:grid-cols-2" data-testid={call ? "call-edit-form" : "call-add-form"}>
      {call ? <input type="hidden" name="callId" value={call.id} /> : null}
      <label className="block text-sm sm:col-span-2">
        <span className="text-xs text-ink-2">Name</span>
        <input className="field" name="name" required maxLength={80} defaultValue={call?.name ?? ""} placeholder="Academy call" data-testid="call-name" />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Day</span>
        <select className="field" name="weekday" defaultValue={String(call?.weekday ?? 1)} data-testid="call-weekday">
          {CALL_DAY_NAMES.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Start (24-hour)</span>
        <input className="field tabular" name="start" required pattern="([01][0-9]|2[0-3]):[0-5][0-9]" inputMode="numeric" placeholder="10:00" defaultValue={call?.start ?? ""} data-testid="call-start" />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Length (minutes)</span>
        <input className="field tabular" name="minutes" type="number" min={CALL_MINUTES_MIN} max={CALL_MINUTES_MAX} defaultValue={call?.minutes ?? 60} data-testid="call-minutes" />
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Time zone</span>
        <input className="field" name="timezone" list={`call-zones-${key}`} defaultValue={call?.timezone ?? CALL_TZ_DEFAULT} data-testid="call-timezone" />
        <datalist id={`call-zones-${key}`}>
          {ZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Who it&apos;s for</span>
        <select className="field" name="audience" defaultValue={call?.audience ?? "academy"} data-testid="call-audience">
          {CALL_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {CALL_AUDIENCE_LABEL[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-ink-2">Its own link (blank for the shared one)</span>
        <input className="field" name="link" type="url" placeholder="https://" defaultValue={call?.link ?? ""} data-testid="call-link" />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton className="btn btn-primary btn-sm min-h-11" pendingText="Saving…" data-testid={call ? "call-save" : "call-add"}>
          {call ? "Save the call" : "Add the call"}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Settings → Calls (H-820, plan H-828), the coach's: the weekly calls members see on /calls and Today, in the coach's order,
 * each with who it is for, its day and time in its own zone, a switch, a skip list and an edit form; and the shared link and
 * passcode. With no calls yet it offers the usual week. Office Hours keeps its own settings on OOH requests.
 */
export function CallsSettingsCard({ rows, workspace, notice, error, openCall, field }: { rows: { call: ProgramCall; skips: ProgramCallSkip[] }[]; workspace: { callsLink: string | null; callsPasscode: string | null }; notice?: string; error?: string; /** The call whose form was refused ("new" for the add form): it opens again. */ openCall?: string; field?: string }) {
  return (
    <Card id="calls" className="scroll-mt-20" title="📅 Calls">
      {error ? (
        <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="calls-error">
          {error}
        </p>
      ) : notice && NOTICE[notice] ? (
        <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="calls-saved">
          {NOTICE[notice]}
        </p>
      ) : null}
      <p className="mb-3 text-sm text-ink-2">The weekly calls members see on Calls and Today, each in their own time. A member sees the calls their level is in; you see them all. Office Hours has its own settings.</p>
      <form id="calls-shared" action={saveCallsSharedAction} className="mb-4 grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end" data-testid="calls-shared">
        <label className="block text-sm">
          <span className="text-xs text-ink-2">Shared link</span>
          <input className="field" name="link" type="url" placeholder="https://" defaultValue={workspace.callsLink ?? ""} data-testid="calls-link" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-ink-2">Passcode</span>
          <input className="field" name="passcode" maxLength={60} defaultValue={workspace.callsPasscode ?? ""} data-testid="calls-passcode" />
        </label>
        <SubmitButton className="btn btn-soft btn-sm min-h-11" pendingText="Saving…" data-testid="calls-shared-save">
          Save
        </SubmitButton>
      </form>
      {rows.length ? (
        <ul className="space-y-2" data-testid="calls-list">
          {rows.map(({ call, skips }, i) => (
            <li key={call.id} id={`call-${call.id}`} className="scroll-mt-20 rounded-lg border p-3 text-sm" data-testid="calls-row" data-call={call.id} data-active={call.active ? "1" : "0"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <b data-testid="calls-row-name">{call.name}</b>{" "}
                  <span className="tabular text-ink-2" data-testid="calls-row-when">
                    {CALL_DAY_NAMES[call.weekday].slice(0, 3)} {call.start} {zoneName(call.timezone)}
                  </span>
                  <span className="text-ink-3"> · {lengthWords(call.minutes)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone={call.audience === "academy" ? "accent" : "neutral"}>
                    <span data-testid="calls-row-audience">{CALL_AUDIENCE_LABEL[call.audience]}</span>
                  </Badge>
                  {call.active ? null : <Badge tone="warn">Off</Badge>}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <form action={moveCallAction}>
                  <input type="hidden" name="callId" value={call.id} />
                  <input type="hidden" name="dir" value="up" />
                  <SubmitButton className="btn btn-ghost btn-xs min-h-11 min-w-11" pendingText="…" disabled={i === 0} aria-label={`Move ${call.name} up`} data-testid="calls-up">
                    ↑
                  </SubmitButton>
                </form>
                <form action={moveCallAction}>
                  <input type="hidden" name="callId" value={call.id} />
                  <input type="hidden" name="dir" value="down" />
                  <SubmitButton className="btn btn-ghost btn-xs min-h-11 min-w-11" pendingText="…" disabled={i === rows.length - 1} aria-label={`Move ${call.name} down`} data-testid="calls-down">
                    ↓
                  </SubmitButton>
                </form>
                <form action={setCallActiveAction}>
                  <input type="hidden" name="callId" value={call.id} />
                  <input type="hidden" name="active" value={call.active ? "0" : "1"} />
                  <SubmitButton className="btn btn-soft btn-xs min-h-11" pendingText="Saving…" data-testid="calls-toggle">
                    {call.active ? "Switch off" : "Switch on"}
                  </SubmitButton>
                </form>
              </div>
              {skips.length ? (
                <ul className="mt-2 space-y-1" data-testid="calls-skips">
                  {skips.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2" data-testid="calls-skip" data-date={s.date}>
                      <span>
                        No call on {skipDay(s.date)}
                        {s.note ? <span className="text-ink-3"> ({s.note})</span> : null}
                      </span>
                      <form action={unskipCallAction}>
                        <input type="hidden" name="skipId" value={s.id} />
                        <SubmitButton className="btn btn-ghost btn-xs min-h-11" pendingText="Undoing…" data-testid="calls-unskip">
                          Undo
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : null}
              <details className="mt-2" open={error && openCall === call.id && field === "date" ? true : undefined}>
                <summary className="flex min-h-11 cursor-pointer items-center text-xs underline" data-testid="calls-skip-open">
                  Skip a date
                </summary>
                <form action={skipCallDateAction} className="mt-2 flex flex-wrap items-end gap-2" data-testid="calls-skip-form">
                  <input type="hidden" name="callId" value={call.id} />
                  <label className="block text-sm">
                    <span className="text-xs text-ink-2">Date</span>
                    <select className="field" name="date" data-testid="calls-skip-date">
                      {nextCallDates(call)
                        .filter((d) => !skips.some((s) => s.date === d))
                        .map((d) => (
                          <option key={d} value={d}>
                            {skipDay(d)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block min-w-0 flex-1 text-sm">
                    <span className="text-xs text-ink-2">Note (optional)</span>
                    <input className="field" name="note" maxLength={80} placeholder="Holiday" data-testid="calls-skip-note" />
                  </label>
                  <SubmitButton className="btn btn-soft btn-sm min-h-11" pendingText="Skipping…" data-testid="calls-skip">
                    No call that day
                  </SubmitButton>
                </form>
              </details>
              <details className="mt-1" open={error && openCall === call.id && field !== "date" ? true : undefined}>
                <summary className="flex min-h-11 cursor-pointer items-center text-xs underline" data-testid="calls-edit-open">
                  Edit
                </summary>
                <div className="mt-2">
                  <CallForm call={call} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="calls-empty">
          <p className="mb-2">No calls yet. Start from the usual week: the Academy call Monday to Thursday at 10:00 and Friday at 13:00, the Accelerator Orientation Monday at 9:00 and the Accelerator call Wednesday at 10:00, all Pacific. You can change each one after.</p>
          <form action={addDefaultCallsAction}>
            <SubmitButton className="btn btn-primary btn-sm min-h-11" pendingText="Adding…" data-testid="calls-defaults">
              Add the usual week
            </SubmitButton>
          </form>
        </div>
      )}
      <details id="calls-add" className="mt-3 scroll-mt-20" open={error && openCall === "new" ? true : undefined}>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium underline" data-testid="calls-add-open">
          Add a call
        </summary>
        <div className="mt-2">
          <CallForm />
        </div>
      </details>
    </Card>
  );
}
