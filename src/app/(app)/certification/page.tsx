import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { reviewCertAction, submitCertAction } from "@/lib/actions/courses";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Certification" };

export default async function CertificationPage() {
  const v = await requireViewer();
  const isCoach = v.role === "coach";
  if (!isCoach && !v.membership.certEnabled) {
    return (
      <>
        <PageHeader title="Certification" />
        <Card>
          <Empty icon="🎓" title="Not unlocked yet" hint="The certification track is opened by your coach when you're ready to implement for clients. Ask them about it on your next call." action={<Link href="/pathway" className="btn btn-ghost btn-sm">Back to pathway</Link>} />
        </Card>
      </>
    );
  }
  const [modules, deliverables, subs] = await Promise.all([
    db.query.certModules.findMany({ orderBy: asc(schema.certModules.order) }),
    db.query.certDeliverables.findMany({ orderBy: asc(schema.certDeliverables.order) }),
    isCoach
      ? db.query.certSubmissions.findMany({ where: eq(schema.certSubmissions.workspaceId, v.workspace.id), orderBy: desc(schema.certSubmissions.createdAt) })
      : db.query.certSubmissions.findMany({ where: eq(schema.certSubmissions.userId, v.user.id) }),
  ]);
  const byDeliverable = new Map(subs.filter((s) => s.userId === v.user.id).map((s) => [s.deliverableId, s]));
  const passed = deliverables.filter((d) => byDeliverable.get(d.id)?.status === "passed").length;
  const pct = deliverables.length ? Math.round((passed / deliverables.length) * 100) : 0;
  const nameOf = new Map(deliverables.map((d) => [d.id, d]));
  const userIds = Array.from(new Set(subs.map((s) => s.userId)));
  const users = isCoach && userIds.length ? await db.query.users.findMany({ where: inArray(schema.users.id, userIds) }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const queue = subs.filter((s) => s.status === "submitted");
  return (
    <>
      <PageHeader title="Certification" subtitle={isCoach ? `${queue.length} submissions to score` : `${passed} of ${deliverables.length} deliverables passed. Each one is scored. Pass the threshold and it's yours.`} action={<Link href="/pathway" className="btn btn-ghost btn-sm">Pathway</Link>} />
      {!isCoach ? <div className="mb-4"><Progress value={pct} tone="good" /></div> : null}
      {isCoach && queue.length ? (
        <Card className="mb-4" title="To score">
          <ul className="divide-y">
            {queue.map((s) => {
              const d = nameOf.get(s.deliverableId);
              return (
                <li key={s.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{userName.get(s.userId) ?? "Member"}</span> · {d?.name}
                      <span className="ml-2 text-xs text-ink-3">pass at {d?.passThreshold}</span>
                    </div>
                    <span className="text-xs text-ink-3">{formatDate(s.createdAt.slice(0, 10))}</span>
                  </div>
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-sm underline">Open evidence ↗</a> : null}
                  {s.notes ? <p className="mt-1 text-sm text-ink-2">{s.notes}</p> : null}
                  <form action={reviewCertAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <label className="block w-24">
                      <span className="label">Score</span>
                      <input className="field tabular py-1" name="score" type="number" min={0} max={100} required />
                    </label>
                    <label className="block min-w-60 flex-1">
                      <span className="label">Feedback</span>
                      <input className="field py-1" name="feedback" placeholder="What was strong, what to fix." />
                    </label>
                    <button className="btn btn-primary btn-sm" type="submit">Score it</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <div className="space-y-4">
        {modules.map((m) => {
          const ds = deliverables.filter((d) => d.moduleId === m.id);
          const mPassed = ds.filter((d) => byDeliverable.get(d.id)?.status === "passed").length;
          return (
            <Card key={m.id} title={m.name} action={<span className="text-xs text-ink-3">{isCoach ? `${ds.length} deliverables` : `${mPassed}/${ds.length}`}</span>}>
              {m.objective ? <p className="mb-3 text-sm text-ink-2">{m.objective}</p> : null}
              <ul className="space-y-2">
                {ds.map((d) => {
                  const s = byDeliverable.get(d.id);
                  const tone = s?.status === "passed" ? "good" : s?.status === "revise" ? "warn" : s ? "accent" : "neutral";
                  const label = s?.status === "passed" ? `Passed · ${s.score}` : s?.status === "revise" ? `Revise · ${s.score}` : s ? "Submitted" : `Pass at ${d.passThreshold}`;
                  return (
                    <li key={d.id} className={`rounded-lg border p-3 ${s?.status === "passed" ? "border-good" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{d.name}</div>
                        <Badge tone={tone}>{label}</Badge>
                      </div>
                      {d.evidenceType ? <div className="text-xs text-ink-3">Evidence: {d.evidenceType}</div> : null}
                      {s?.feedback ? <p className="mt-1 rounded bg-surface-2 p-2 text-sm">{s.feedback}</p> : null}
                      {!isCoach && s?.status !== "passed" ? (
                        <Disclosure summary={<span className="text-xs underline">{s ? "Resubmit" : "Submit evidence"}</span>} className="mt-2">
                          <form action={submitCertAction} className="mt-2 space-y-2">
                            <input type="hidden" name="deliverableId" value={d.id} />
                            <Field label="Link (Loom, screenshot, doc)">
                              <input className="field" name="url" type="url" defaultValue={s?.url ?? ""} />
                            </Field>
                            <Field label="Notes">
                              <textarea className="field" name="notes" defaultValue={s?.notes ?? ""} />
                            </Field>
                            <button className="btn btn-accent btn-sm" type="submit">Submit for scoring</button>
                          </form>
                        </Disclosure>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
