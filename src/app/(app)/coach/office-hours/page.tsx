import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { setOohListsAction, updateOohRequestAction } from "@/lib/actions/office-hours";
import { OOH_OUTCOMES, OOH_OUTCOME_LABEL, attendeeWords, byStamp, oohAttendees, submittedByWords } from "@/lib/engine/office-hours";
import { OohStamps as Stamps } from "@/components/ooh-stamps";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { sharedDecisionsFor } from "@/lib/board-steps";

export const metadata = { title: "Office Hours requests" };

/**
 * The coach's Open Office Hours (handoff rev 124): every request grouped by its Friday, upcoming first, each with who takes it,
 * covered or no-show, and notes that stay the coach's. Below, the category list members pick from and who can be responsible.
 */
export default async function CoachOfficeHoursPage({ searchParams }: { searchParams: Promise<{ updated?: string; lists?: string; error?: string; order?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const requests = await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.workspaceId, v.workspace.id), orderBy: [desc(schema.officeHoursRequests.friday), schema.officeHoursRequests.createdAt] });
  // Names for the member, the team member who submitted (H-413) and everyone attending; the live teams say who has since left.
  const ids = [...new Set(requests.flatMap((r) => [r.userId, r.submittedByUserId ?? "", ...oohAttendees(r)]).filter(Boolean))];
  const [users, teams] = await Promise.all([
    ids.length ? db.query.users.findMany({ where: inArray(schema.users.id, ids), columns: { id: true, name: true } }) : [],
    db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.workspaceId, v.workspace.id), isNull(schema.teamMembers.removedAt)), columns: { userId: true, teamUserId: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const teamOfOwner = (ownerId: string) => new Set(teams.filter((t) => t.userId === ownerId).map((t) => t.teamUserId));
  const fridays = [...new Set(requests.map((r) => r.friday))];
  const upcoming = fridays.filter((f) => f >= v.today).sort();
  const past = fridays.filter((f) => f < v.today).sort().reverse();
  // Inside each Friday, newest first unless the coach asks for the order they came in (rev 625).
  const order = sp.order === "oldest" ? "oldest" : "newest";
  const group = (f: string) => requests.filter((r) => r.friday === f).sort(byStamp(order));
  // My Board (rev 664 §7): only the decisions a member chose to share; the only way one reaches the coach.
  const shared = await sharedDecisionsFor(v.workspace.id);

  return (
    <>
      <PageHeader title="Office Hours requests" subtitle={`${requests.filter((r) => r.friday >= v.today).length} upcoming · ${requests.length} in all`} action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.updated ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="ooh-updated">Saved.</p> : null}
      {requests.length ? (
        <p className="mb-3 text-sm text-ink-2" data-testid="ooh-order">
          In each Friday: {order === "newest" ? <b>newest first</b> : <Link href="/coach/office-hours" className="underline" data-testid="ooh-order-newest">newest first</Link>} ·{" "}
          {order === "oldest" ? <b>oldest first</b> : <Link href="/coach/office-hours?order=oldest" className="underline" data-testid="ooh-order-oldest">oldest first</Link>}
        </p>
      ) : (
        <p className="mb-4 text-sm text-ink-2">No requests yet. Members ask from Office Hours in their menu.</p>
      )}
      {shared.length ? (
        <div className="mb-4" data-testid="ooh-shared-decisions">
        <Card title="Office Hours: shared decisions">
          <p className="mb-2 text-xs text-ink-3">Board decisions your clients shared with you. Only what they share shows here; they can stop sharing at any time.</p>
          <ul className="divide-y">
            {shared.map((d) => (
              <li key={d.id} className="py-3 text-sm" data-testid="ooh-shared-decision">
                <details>
                  <summary className="cursor-pointer">
                    <b>{d.member}</b>: {d.answer?.decision ?? d.question} <span className="text-xs text-ink-3">· shared {formatDate(d.sharedAt.slice(0, 10))}{d.example ? " · Example" : ""}{!d.example && !d.remembered ? " · Not remembered" : ""}</span>
                  </summary>
                  <div className="mt-2 space-y-1">
                    <p><span className="text-ink-3">They asked:</span> {d.question}</p>
                    {d.answer ? (
                      <>
                        <p><span className="text-ink-3">The Board recommended:</span> {d.answer.recommendation}</p>
                        {d.answer.split ? <p><span className="text-ink-3">Where it split:</span> {d.answer.split}</p> : null}
                        <ol className="list-decimal pl-5">
                          {d.answer.steps.map((s, i) => (
                            <li key={i}>{s.do} <span className="text-ink-3">(by {formatDate(s.by)})</span></li>
                          ))}
                        </ol>
                      </>
                    ) : null}
                    {d.followUps.map((f, i) => (
                      <p key={i} className="text-ink-2"><span className="text-ink-3">Then:</span> {f.question}{f.recommendation ? ` → ${f.recommendation}` : ""}</p>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
        </div>
      ) : null}
      <div className="space-y-4">
        {[...upcoming, ...past].map((f) => (
          <Card key={f} title={formatDate(f, { weekday: "long", month: "long", day: "numeric" })} action={<Badge tone={f >= v.today ? "accent" : "neutral"}>{group(f).length} {f >= v.today ? "upcoming" : "past"}</Badge>}>
            <ul className="divide-y" data-testid="ooh-friday-group" data-friday={f}>
              {group(f).map((r) => (
                <li key={r.id} id={`r-${r.id}`} className="grid gap-3 py-3 text-sm md:grid-cols-[1.4fr_1fr]" data-testid="ooh-request">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{nameOf.get(r.userId) ?? "A member"}</span>
                      <Badge tone="neutral">{r.category}</Badge>
                    </div>
                    <Stamps createdAt={r.createdAt} editedAt={r.editedAt} tz={v.tz} today={v.today} />
                    {submittedByWords(r, (id) => nameOf.get(id), teamOfOwner(r.userId)) ? <p className="text-xs text-ink-3" data-testid="ooh-submitted-by">{submittedByWords(r, (id) => nameOf.get(id), teamOfOwner(r.userId))}</p> : null}
                    <p className="text-xs text-ink-3" data-testid="ooh-attending">{attendeeWords(r, (id) => nameOf.get(id), teamOfOwner(r.userId))}</p>
                    <dl className="mt-1 space-y-1 text-ink-2">
                      <div>
                        <dt className="inline font-medium text-ink">The issue: </dt>
                        <dd className="inline whitespace-pre-line">{r.description}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-ink">Tried: </dt>
                        <dd className="inline whitespace-pre-line">{r.triedSelf}</dd>
                      </div>
                      {r.tools ? (
                        <div>
                          <dt className="inline font-medium text-ink">Tools: </dt>
                          <dd className="inline">{r.tools}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="inline font-medium text-ink">Solution to reach: </dt>
                        <dd className="inline whitespace-pre-line">{r.goal}</dd>
                      </div>
                    </dl>
                  </div>
                  <form action={updateOohRequestAction} className="space-y-2" data-testid="ooh-coach-form">
                    <input type="hidden" name="requestId" value={r.id} />
                    <label className="block text-xs">
                      Responsible
                      <select className="field mt-1 py-1 text-xs" name="responsible" defaultValue={r.responsible ?? ""} data-testid="ooh-responsible">
                        <option value="">Not set</option>
                        {v.workspace.oohHosts.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs">
                      How it went
                      <select className="field mt-1 py-1 text-xs" name="outcome" defaultValue={r.outcome ?? ""} data-testid="ooh-outcome">
                        <option value="">Not yet</option>
                        {OOH_OUTCOMES.map((o) => (
                          <option key={o} value={o}>
                            {OOH_OUTCOME_LABEL[o]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs">
                      Notes (yours; the member never sees them)
                      <textarea className="field mt-1 text-xs" name="coachNotes" rows={2} defaultValue={r.coachNotes ?? ""} data-testid="ooh-notes" />
                    </label>
                    <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…" data-testid="ooh-coach-save">
                      Save
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <Card title="Your lists and the call">
          <form action={setOohListsAction} className="grid gap-3 sm:grid-cols-2" id="lists" data-testid="ooh-lists">
            {sp.error ? <p className="rounded-lg bg-danger-soft p-2 text-sm sm:col-span-2" role="alert">{sp.error}</p> : null}
            {sp.lists ? <p className="rounded-lg bg-good-soft p-2 text-sm sm:col-span-2" role="status" data-testid="ooh-lists-saved">Saved.</p> : null}
            <label className="block text-sm">
              Categories members pick from, one per line
              <textarea className="field mt-1" name="categories" rows={6} defaultValue={v.workspace.oohCategories.join("\n")} data-testid="ooh-categories" />
            </label>
            <label className="block text-sm">
              Who can be responsible, one per line
              <textarea className="field mt-1" name="hosts" rows={6} defaultValue={v.workspace.oohHosts.join("\n")} data-testid="ooh-hosts" />
            </label>
            <label className="block text-sm">
              When the call is, in {v.workspace.timezone}
              <input className="field mt-1" name="time" defaultValue={v.workspace.oohTime ?? ""} placeholder="Fridays at 12:00 pm" data-testid="ooh-time" />
            </label>
            <label className="block text-sm">
              The link to join
              <input className="field mt-1" name="link" type="url" defaultValue={v.workspace.oohLink ?? ""} placeholder="https://…" data-testid="ooh-link" />
            </label>
            <SubmitButton className="btn btn-soft btn-sm sm:col-span-2 sm:w-fit" pendingText="Saving…" data-testid="ooh-lists-save">
              Save lists
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
