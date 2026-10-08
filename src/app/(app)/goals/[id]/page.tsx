import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PLAN_STATUSES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { ownTitle } from "@/lib/page-title";
import { archivePlanRecordAction, linkPlanRecordsAction, linkPlanTaskAction, unlinkPlanAction, updatePlanRecordAction } from "@/lib/actions/plan";
import { CHILD_OF, KIND_LABEL, KIND_PLURAL, PARENT_OF, STATUS_LABEL, STATUS_TONE, linksOf } from "@/lib/engine/plan";
import { ownRecord, planData } from "@/lib/queries/plan";
import { formatDate } from "@/lib/dates";
import { Badge, Card, Disclosure, Field, PageHeader } from "@/components/ui";
import { NewRecordForm } from "@/components/plan-forms";
import { KpiCard } from "@/components/kpi-card";
import { ConfirmDelete } from "@/components/confirm-delete";
import { TaskRow } from "@/components/task-row";
import { SubmitButton } from "@/components/submit-button";
import { db, schema } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return ownTitle(async (v) => (await ownRecord({ workspaceId: v.workspace.id, userId: v.user.id }, id))?.title, "Business goals");
}

/**
 * One record of the plan (BG1): its fields, its links both ways (clickable), and for an initiative its tasks with add and
 * tick. The member's own, or not found. Nothing here is Body's.
 */
export default async function PlanRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kpiError?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const { id } = await params;
  const sp = await searchParams;
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const r = await ownRecord(m, id);
  if (!r || r.archivedAt) notFound();
  const { records, links, tasks, reads, logs, values } = await planData(m, v.today);
  const byId = new Map(records.map((x) => [x.id, x]));
  const { down, up } = linksOf(r.id, links);
  const parents = up.map((l) => byId.get(l.fromId)).filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.archivedAt);
  const children = down.filter((l) => l.toKind === "record").map((l) => byId.get(l.toId)).filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.archivedAt);
  const taskIds = down.filter((l) => l.toKind === "task").map((l) => l.toId);
  const taskRows = taskIds.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, v.user.id), inArray(schema.tasks.id, taskIds)) }) : [];
  const childKind = CHILD_OF[r.kind];
  const parentKind = PARENT_OF[r.kind];
  const linkable = childKind === "task" ? [] : records.filter((x) => !x.archivedAt && x.kind === childKind && !children.some((c) => c.id === x.id));
  const parentable = parentKind ? records.filter((x) => !x.archivedAt && x.kind === parentKind && !parents.some((p) => p.id === x.id)) : [];
  const openTasks = (await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, v.user.id)), columns: { id: true, title: true, status: true } })).filter((t) => t.status !== "done" && !taskIds.includes(t.id)).slice(0, 60);
  // The chain up, for the breadcrumb: a task's initiative, key result and goal read the same way from a task (BG3's chip).
  const grand = parents.flatMap((p) => linksOf(p.id, links).up.map((l) => byId.get(l.fromId)).filter((x): x is NonNullable<typeof x> => Boolean(x)));
  return (
    <>
      <PageHeader
        title={`${r.primary ? "★ " : ""}${r.title}`}
        subtitle={
          <span data-testid="plan-crumb">
            {KIND_LABEL[r.kind]}
            {parents.map((p) => (
              <span key={p.id}> · under <Link href={`/goals/${p.id}`} className="underline" data-testid="plan-parent-link">{p.title}</Link></span>
            ))}
            {grand.map((g) => (
              <span key={g.id}> · in <Link href={`/goals/${g.id}`} className="underline">{g.title}</Link></span>
            ))}
          </span>
        }
        action={<Link href="/goals" className="btn btn-ghost btn-sm">← Business goals</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card title="The record" action={<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}>
            <form action={updatePlanRecordAction} className="grid gap-3 sm:grid-cols-2" data-testid="plan-edit">
              <input type="hidden" name="id" value={r.id} />
              <div className="sm:col-span-2">
                <Field label="Title">
                  <input className="field" name="title" defaultValue={r.title} required data-testid="plan-edit-title" />
                </Field>
              </div>
              <Field label="Status">
                <select className="field" name="status" defaultValue={r.status} data-testid="plan-edit-status">
                  {PLAN_STATUSES.map((k) => (
                    <option key={k} value={k}>{STATUS_LABEL[k]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Owner">
                <input className="field" name="owner" defaultValue={r.owner ?? ""} />
              </Field>
              <Field label="Due">
                <input className="field" name="dueDate" type="date" defaultValue={r.dueDate ?? ""} />
              </Field>
              <Field label="Pathway stage">
                <input className="field" name="pathwayStage" defaultValue={r.pathwayStage ?? ""} />
              </Field>
              {r.kind === "initiative" ? (
                <>
                  <Field label="Budget" hint="A number; what this initiative may spend.">
                    <input className="field" name="budget" defaultValue={r.budget ?? ""} inputMode="decimal" />
                  </Field>
                  <Field label="Hire trigger" hint="What has to be true before you hire for it.">
                    <input className="field" name="hireTrigger" defaultValue={r.hireTrigger ?? ""} />
                  </Field>
                </>
              ) : null}
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea className="field" name="notes" rows={3} defaultValue={r.notes ?? ""} />
                </Field>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="plan-edit-save">Save</SubmitButton>
                {r.primary ? <span className="text-xs text-ink-3">Your Primary business goal: Today&apos;s progress bar reads its first KPI. Settings → Your one goal sets that KPI&apos;s target and period too.</span> : null}
              </div>
            </form>
            {r.primary ? null : (
              <form action={archivePlanRecordAction} className="mt-3 text-right">
                <input type="hidden" name="id" value={r.id} />
                <ConfirmDelete what={`"${r.title}"`} undo="It comes off the tree and the table; its links stay with the records they joined." label="Archive" className="btn btn-ghost btn-xs text-danger" testId="plan-archive" />
              </form>
            )}
          </Card>
          {childKind === "task" ? (
            <Card title={`Tasks · ${taskRows.filter((t) => t.status === "done").length} of ${taskRows.length} done`}>
              {taskRows.length ? (
                <div className="-mx-2 divide-y" data-testid="plan-tasks">
                  {taskRows.map((t) => (
                    <TaskRow key={t.id} task={t} today={v.today} compact showCategory={false} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-2">No tasks yet. Add the first one that moves this initiative.</p>
              )}
              <form action={linkPlanTaskAction} className="mt-3 flex flex-wrap items-end gap-2" data-testid="plan-task-new">
                <input type="hidden" name="fromId" value={r.id} />
                <div className="min-w-[12rem] flex-1">
                  <Field label="New task">
                    <input className="field" name="title" placeholder="Write the welcome sequence" data-testid="plan-task-title" />
                  </Field>
                </div>
                <Field label="Due">
                  <input className="field" name="dueDate" type="date" defaultValue={v.today} />
                </Field>
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Adding…" data-testid="plan-task-add">Add and link</SubmitButton>
              </form>
              {openTasks.length ? (
                <form action={linkPlanTaskAction} className="mt-2 flex items-end gap-2">
                  <input type="hidden" name="fromId" value={r.id} />
                  <div className="flex-1">
                    <Field label="Or link a task you already have">
                      <select className="field" name="taskId" defaultValue="" data-testid="plan-task-pick">
                        <option value="">Pick a task…</option>
                        {openTasks.map((t) => (
                          <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="Linking…">Link</SubmitButton>
                </form>
              ) : null}
            </Card>
          ) : (
            <Card title={KIND_PLURAL[childKind]} action={<span className="text-xs text-ink-3">{children.length} linked</span>}>
              {children.length ? (
                <ul className="divide-y" data-testid="plan-children">
                  {children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/goals/${c.id}`} className="font-medium hover:underline" data-testid="plan-child-link">{c.title}</Link>
                        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                        {c.dueDate ? <span className="text-xs text-ink-3">due {formatDate(c.dueDate)}</span> : null}
                      </span>
                      <form action={unlinkPlanAction}>
                        <input type="hidden" name="fromId" value={r.id} />
                        <input type="hidden" name="toId" value={c.id} />
                        <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="plan-unlink">Unlink</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">None linked yet.</p>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {linkable.length ? (
                  <form action={linkPlanRecordsAction} className="flex items-end gap-2">
                    <input type="hidden" name="fromId" value={r.id} />
                    <Field label={`Link a ${KIND_LABEL[childKind].toLowerCase()} you have`}>
                      <select className="field" name="toId" defaultValue="" data-testid="plan-link-pick">
                        <option value="">Pick one…</option>
                        {linkable.map((x) => (
                          <option key={x.id} value={x.id}>{x.title}</option>
                        ))}
                      </select>
                    </Field>
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Linking…" data-testid="plan-link">Link</SubmitButton>
                  </form>
                ) : null}
                <Disclosure summary={<span className="btn btn-soft btn-sm" data-testid="plan-child-new">+ New {KIND_LABEL[childKind].toLowerCase()} under this</span>}>
                  <NewRecordForm records={records} kind={childKind} parentId={r.id} back={`/goals/${r.id}`} />
                </Disclosure>
              </div>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {parentKind ? (
            <Card title={`Under · ${KIND_LABEL[parentKind]}`}>
              {parents.length ? (
                <ul className="divide-y" data-testid="plan-parents">
                  {parents.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <Link href={`/goals/${p.id}`} className="font-medium hover:underline">{p.primary ? "★ " : ""}{p.title}</Link>
                      <form action={unlinkPlanAction}>
                        <input type="hidden" name="fromId" value={p.id} />
                        <input type="hidden" name="toId" value={r.id} />
                        <SubmitButton className="btn btn-ghost btn-xs" pendingText="…">Unlink</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">Not under a {KIND_LABEL[parentKind].toLowerCase()} yet.</p>
              )}
              {parentable.length ? (
                <form action={linkPlanRecordsAction} className="mt-3 flex items-end gap-2">
                  <input type="hidden" name="toId" value={r.id} />
                  <div className="flex-1">
                    <Field label={`Put it under a ${KIND_LABEL[parentKind].toLowerCase()}`}>
                      <select className="field" name="fromId" defaultValue="" data-testid="plan-parent-pick">
                        <option value="">Pick one…</option>
                        {parentable.map((x) => (
                          <option key={x.id} value={x.id}>{x.primary ? "★ " : ""}{x.title}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="Linking…" data-testid="plan-parent-set">Link</SubmitButton>
                </form>
              ) : null}
            </Card>
          ) : null}
          {r.kind === "initiative" ? null : <KpiCard recordId={r.id} reads={reads} logs={logs} values={values} today={v.today} error={sp.kpiError} />}
          {tasks.length ? null : null}
        </div>
      </div>
    </>
  );
}
