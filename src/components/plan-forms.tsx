import { PLAN_KINDS, PLAN_STATUSES, type PlanKind } from "@/db/schema";
import { createPlanRecordAction } from "@/lib/actions/plan";
import { KIND_LABEL, STATUS_LABEL, type PlanRow } from "@/lib/engine/plan";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/** The new-record form: the kind, its title, owner, due, status, notes, and a parent to sit under. */
export function NewRecordForm({ records, error, kind: fixedKind, parentId, back }: { records: PlanRow[]; error?: string; kind?: PlanKind; parentId?: string; back?: string }) {
  const parents = records.filter((r) => !r.archivedAt && (r.kind === "goal" || r.kind === "key_result"));
  return (
    <form action={createPlanRecordAction} className="card grid gap-3 p-4 sm:grid-cols-2" data-testid="plan-form">
      {error ? <p className="rounded-lg bg-danger-soft p-2 text-sm sm:col-span-2" role="alert">{error}</p> : null}
      {back ? <input type="hidden" name="back" value={back} /> : null}
      {fixedKind ? <input type="hidden" name="kind" value={fixedKind} /> : null}
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      <div className="sm:col-span-2">
        <Field label="Title">
          <input className="field" name="title" required placeholder="Three new clients a month" data-testid="plan-title" />
        </Field>
      </div>
      {fixedKind ? null : (
        <Field label="Kind">
          <select className="field" name="kind" defaultValue="goal" data-testid="plan-kind">
            {PLAN_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </Field>
      )}
      {parentId || !parents.length ? null : (
        <Field label="Under" hint="A key result sits under a goal; an initiative under a key result.">
          <select className="field" name="parentId" defaultValue="" data-testid="plan-parent">
            <option value="">Nothing yet</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{KIND_LABEL[p.kind]}: {p.title}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Owner" hint="A name. No account needed.">
        <input className="field" name="owner" placeholder="Me" data-testid="plan-owner" />
      </Field>
      <Field label="Due">
        <input className="field" name="dueDate" type="date" data-testid="plan-due" />
      </Field>
      <Field label="Status">
        <select className="field" name="status" defaultValue="not_started">
          {PLAN_STATUSES.map((k) => (
            <option key={k} value={k}>{STATUS_LABEL[k]}</option>
          ))}
        </select>
      </Field>
      <Field label="Pathway stage (optional)">
        <input className="field" name="pathwayStage" placeholder="Foundation" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes (optional)">
          <textarea className="field" name="notes" rows={2} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="plan-save">Save</SubmitButton>
      </div>
    </form>
  );
}
