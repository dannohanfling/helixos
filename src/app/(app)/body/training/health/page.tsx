import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { HumanosHeader } from "@/components/body/humanos-header";
import { deleteHealthAction, resolveHealthAction, saveHealthAction } from "@/lib/actions/body";
import { formatDate } from "@/lib/dates";
import { healthLog, requireBodyEnabled } from "@/lib/queries/body";
import { HEALTH_SIDES } from "@/db/schema";

export const metadata = { title: "HumanOS · Health log" };

type Entry = Awaited<ReturnType<typeof healthLog>>["open"][number];
type Exercise = Awaited<ReturnType<typeof healthLog>>["exercises"][number];

function HealthForm({ e, exercises, today }: { e?: Entry; exercises: Exercise[]; today: string }) {
  return (
    <form action={saveHealthAction} className="grid gap-2 sm:grid-cols-2" data-testid={e ? "health-edit-form" : "health-form"}>
      {e ? <input type="hidden" name="id" value={e.id} /> : null}
      <label className="block sm:col-span-2">
        <span className="label">What</span>
        <input name="title" className="field" required maxLength={80} defaultValue={e?.title ?? ""} placeholder="Right shoulder, sharp on overhead press" data-testid="health-title" />
      </label>
      <label className="block">
        <span className="label">Side</span>
        <select name="side" className="field" defaultValue={e?.side ?? ""}>
          <option value="">—</option>
          {HEALTH_SIDES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Since</span>
        <input name="startedOn" type="date" className="field" defaultValue={e?.startedOn ?? today} max={today} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Movements it affects</span>
        <input name="movements" className="field" maxLength={200} defaultValue={e?.movements ?? ""} placeholder="overhead pressing, dips" />
      </label>
      {exercises.length ? (
        <fieldset className="sm:col-span-2">
          <legend className="label">Leave these out while it&apos;s open (marked on Training)</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="health-restrict">
            {exercises.map((x) => (
              <label key={x.id} className="inline-flex items-center gap-1">
                <input type="checkbox" name="restricted" value={x.id} defaultChecked={!!e?.restricted.includes(x.id)} /> {x.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {e ? (
        <label className="block">
          <span className="label">Resolved on (blank = still open)</span>
          <input name="resolvedOn" type="date" className="field" defaultValue={e.resolvedOn ?? ""} />
        </label>
      ) : null}
      <div className="sm:col-span-2">
        <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid={e ? "health-save" : "health-add"}>
          {e ? "Save" : "Add to the log"}
        </SubmitButton>
      </div>
    </form>
  );
}

function EntryRow({ e, exercises, today }: { e: Entry; exercises: Exercise[]; today: string }) {
  return (
    <li className="py-3" data-testid="health-entry" data-open={e.open ? "1" : "0"} data-title={e.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {e.title}
          {e.side ? <span className="text-ink-2"> · {e.side}</span> : null}
        </span>
        <span className="text-xs text-ink-3">
          since {formatDate(e.startedOn)}
          {e.resolvedOn ? ` · resolved ${formatDate(e.resolvedOn)}` : ""}
        </span>
      </div>
      {e.movements ? <p className="mt-0.5 text-sm text-ink-2">{e.movements}</p> : null}
      {e.restrictedNames.length ? (
        <p className="mt-0.5 text-xs text-ink-2" data-testid="health-restricted">
          Leaving out: {e.restrictedNames.join(", ")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {e.open ? (
          <form action={resolveHealthAction} className="flex items-center gap-1">
            <input type="hidden" name="id" value={e.id} />
            <input name="resolvedOn" type="date" className="field py-1 text-xs" defaultValue={today} max={today} aria-label="Resolved on" />
            <SubmitButton className="btn btn-soft btn-sm" pendingText="…" data-testid="health-resolve">
              Resolved
            </SubmitButton>
          </form>
        ) : (
          <form action={resolveHealthAction}>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="reopen" value="1" />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" data-testid="health-reopen">
              Reopen
            </SubmitButton>
          </form>
        )}
        <Disclosure summary={<span className="text-xs underline">Edit</span>}>
          <div className="mt-2 space-y-2">
            <HealthForm e={e} exercises={exercises} today={today} />
            <form action={deleteHealthAction}>
              <input type="hidden" name="id" value={e.id} />
              <SubmitButton className="btn btn-ghost btn-sm text-ink-3" pendingText="…" data-testid="health-delete">
                Delete
              </SubmitButton>
            </form>
          </div>
        </Disclosure>
      </div>
    </li>
  );
}

/**
 * The health log (revs 231 and 251): injuries, the member's alone. Never shown to the coach even while sharing is on, never in AI
 * features or Claude's tools, never in any export to the coach. Its open entries mark restricted exercises on Training.
 */
export default async function HealthLogPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const log = await healthLog(v.workspace.id, v.user.id, v.today);

  return (
    <>
      <HumanosHeader
        title="Health log"
        subtitle="Yours alone: never your coach, even while you share the rest; never AI or Claude; never in anything sent to them."
        action={
          <Link href="/body/training" className="btn btn-ghost btn-sm">
            ← Training
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      <Card title="Open" className="mb-4">
        {log.open.length ? (
          <ul className="divide-y" data-testid="health-open">
            {log.open.map((e) => (
              <EntryRow key={e.id} e={e} exercises={log.exercises} today={v.today} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3" data-testid="health-none">
            Nothing open.
          </p>
        )}
      </Card>
      <Card title="Add" className="mb-4">
        <HealthForm exercises={log.exercises} today={v.today} />
      </Card>
      {log.resolved.length ? (
        <Card title="Resolved" className="mb-8">
          <ul className="divide-y" data-testid="health-resolved">
            {log.resolved.map((e) => (
              <EntryRow key={e.id} e={e} exercises={log.exercises} today={v.today} />
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
