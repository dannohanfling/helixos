import Link from "next/link";
import { PLAN_KINDS, PLAN_STATUSES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { KIND_LABEL, KIND_PLURAL, STATUS_LABEL, STATUS_TONE, tableRows, type GoalNode, type PlanRow } from "@/lib/engine/plan";
import { PACE_LABEL, PACE_TONE, formatKpi, type KpiRead } from "@/lib/engine/kpi";
import { ensurePrimaryGoal, planData } from "@/lib/queries/plan";
import { formatDate } from "@/lib/dates";
import { Badge, Card, Disclosure, Empty, PageHeader, Tabs } from "@/components/ui";
import { NewRecordForm } from "@/components/plan-forms";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Business goals" };

/**
 * Business goals (rev 530, BG1): one linked plan for every client. A goal, then its key results, then initiatives, then tasks,
 * in a tree; or every record in a table, filtered. The member's own records, scoped on every read; a coach looking in sees
 * the read-only summary on the client page, not this. Never Body's Health goals.
 */
export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string; status?: string; owner?: string; due?: string; stage?: string; error?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const sp = await searchParams;
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  if (!v.switchedInto) await ensurePrimaryGoal(m, v.today);
  const { records, tree, reads } = await planData(m, v.today);
  const view = sp.view === "table" ? "table" : "tree";
  const kind = PLAN_KINDS.find((k) => k === sp.kind) ?? "";
  const status = PLAN_STATUSES.find((k) => k === sp.status) ?? "";
  const rows = tableRows(records, { kind, status, owner: sp.owner, dueBefore: sp.due, stage: sp.stage });
  const live = records.filter((r) => !r.archivedAt);
  const counts = { goal: live.filter((r) => r.kind === "goal").length, key_result: live.filter((r) => r.kind === "key_result").length, initiative: live.filter((r) => r.kind === "initiative").length };
  return (
    <>
      <PageHeader
        title="Business goals"
        subtitle={`${counts.goal} goals · ${counts.key_result} key results · ${counts.initiative} initiatives. A goal, its key results, the initiatives that move them, and the tasks that do the work.`}
        action={
          <Disclosure open={Boolean(sp.error)} summary={<span className="btn btn-primary btn-sm" data-testid="plan-new">+ New</span>}>
            <NewRecordForm records={live} error={sp.error} />
          </Disclosure>
        }
      />
      <Tabs items={[{ key: "tree", label: "Tree", href: "/goals" }, { key: "table", label: "Table", href: "/goals?view=table", count: live.length }]} current={view} />
      {view === "tree" ? (
        tree.goals.length || tree.loose.length ? (
          <div className="space-y-3" data-testid="plan-tree">
            {tree.goals.map((g) => (
              <GoalCard key={g.record.id} node={g} reads={reads} />
            ))}
            {tree.loose.length ? (
              <Card title="Not yet linked" action={<span className="text-xs text-ink-3">open one to link it under a goal or key result</span>}>
                <ul className="divide-y" data-testid="plan-loose">
                  {tree.loose.map((r) => (
                    <li key={r.id} className="py-1.5">
                      <RecordLine r={r} />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        ) : (
          <Card>
            <Empty icon="🏁" title="No goals yet" hint="Start with the one goal that matters this quarter; add its key results and the initiatives that move them." />
          </Card>
        )
      ) : (
        <Card>
          <form className="mb-3 grid gap-2 sm:grid-cols-5" data-testid="plan-filter">
            <input type="hidden" name="view" value="table" />
            <select className="field py-1 text-sm" name="kind" defaultValue={kind} aria-label="Kind">
              <option value="">Every kind</option>
              {PLAN_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_PLURAL[k]}</option>
              ))}
            </select>
            <select className="field py-1 text-sm" name="status" defaultValue={status} aria-label="Status">
              <option value="">Every status</option>
              {PLAN_STATUSES.map((k) => (
                <option key={k} value={k}>{STATUS_LABEL[k]}</option>
              ))}
            </select>
            <input className="field py-1 text-sm" name="owner" defaultValue={sp.owner ?? ""} placeholder="Owner" aria-label="Owner" />
            <input className="field py-1 text-sm" name="due" type="date" defaultValue={sp.due ?? ""} aria-label="Due on or before" />
            <div className="flex gap-1">
              <input className="field py-1 text-sm" name="stage" defaultValue={sp.stage ?? ""} placeholder="Pathway stage" aria-label="Pathway stage" />
              <SubmitButton className="btn btn-soft btn-sm" pendingText="…">Filter</SubmitButton>
            </div>
          </form>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="plan-table">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-2">
                  <tr>
                    <th className="py-2 pr-3">Record</th>
                    <th className="py-2 pr-3">Kind</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} data-testid="plan-table-row">
                      <td className="py-2 pr-3"><Link href={`/goals/${r.id}`} className="font-medium hover:underline">{r.primary ? "★ " : ""}{r.title}</Link></td>
                      <td className="py-2 pr-3 text-ink-2">{KIND_LABEL[r.kind]}</td>
                      <td className="py-2 pr-3"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                      <td className="py-2 pr-3 text-ink-2">{r.owner ?? ""}</td>
                      <td className="py-2 pr-3 text-ink-2">{r.dueDate ? formatDate(r.dueDate) : ""}</td>
                      <td className="py-2 text-ink-2">{r.pathwayStage ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="🏁" title="Nothing matches" hint="Loosen a filter, or add a record with + New." />
          )}
        </Card>
      )}
    </>
  );
}

function RecordLine({ r, extra }: { r: PlanRow; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={`/goals/${r.id}`} className="font-medium hover:underline" data-testid="plan-record-link" data-kind={r.kind}>{r.primary ? "★ " : ""}{r.title}</Link>
      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      {r.owner ? <span className="text-xs text-ink-3">{r.owner}</span> : null}
      {r.dueDate ? <span className="text-xs text-ink-3">due {formatDate(r.dueDate)}</span> : null}
      {extra ? <span className="text-xs text-ink-3">{extra}</span> : null}
    </div>
  );
}

/** A record's KPIs in the tree (BG2): each one's actual against its target, with its pace. */
function KpiLines({ recordId, reads }: { recordId: string; reads: KpiRead[] }) {
  const own = reads.filter((r) => r.kpi.recordId === recordId);
  if (!own.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="plan-kpis">
      {own.map((r) => (
        <li key={r.kpi.id} className="flex items-center gap-1.5" data-testid="plan-kpi" data-pace={r.pace}>
          <span className="text-ink-2">{r.kpi.name}</span>
          <span className="tabular">{formatKpi(r.actual, r.kpi.unit)} / {formatKpi(r.kpi.target, r.kpi.unit)}</span>
          <Badge tone={PACE_TONE[r.pace]}>{PACE_LABEL[r.pace]}</Badge>
        </li>
      ))}
    </ul>
  );
}

function GoalCard({ node, reads }: { node: GoalNode; reads: KpiRead[] }) {
  const g = node.record;
  return (
    <Card title={<span>{g.primary ? "★ " : ""}{g.title}</span>} action={<span className="text-xs text-ink-3" data-testid="plan-goal-pace">{node.keyResults.length ? `${node.onPace} of ${node.keyResults.length} key results on track` : "no key results yet"}</span>} id={`g-${g.id}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge>
        {g.owner ? <span>{g.owner}</span> : null}
        {g.dueDate ? <span>due {formatDate(g.dueDate)}</span> : null}
        <Link href={`/goals/${g.id}`} className="underline">Open</Link>
      </div>
      <KpiLines recordId={g.id} reads={reads} />
      {node.keyResults.length ? (
        <ul className="mt-2 space-y-2" data-testid="plan-goal-krs">
          {node.keyResults.map((k) => (
            <li key={k.record.id} className="rounded-lg bg-surface-2 p-2">
              <RecordLine r={k.record} extra={k.pace !== "none" ? `KPIs: ${PACE_LABEL[k.pace].toLowerCase()}` : undefined} />
              <KpiLines recordId={k.record.id} reads={reads} />
              {k.initiatives.length ? (
                <ul className="mt-1 space-y-1 pl-4">
                  {k.initiatives.map((i) => (
                    <li key={i.record.id}>
                      <RecordLine r={i.record} extra={`${i.done} of ${i.tasks.length} tasks done`} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">No key results yet. Open the goal to add the three that would prove it.</p>
      )}
    </Card>
  );
}
