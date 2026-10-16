import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfficeHoursRequest } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { saveOohRequestAction } from "@/lib/actions/office-hours";
import { GO_BACK, OOH_OUTCOME_LABEL, attendeeWords, oohAttendees, oohCanEdit, oohNoticeWords, oohVisibleTo, submittedByWords, upcomingFridays } from "@/lib/engine/office-hours";
import { teamOf } from "@/lib/team";
import { OohNoticeSeen } from "@/components/ooh-notice-seen";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { DraftKeeper } from "@/components/draft-keeper";
import { Badge, Card, PageHeader } from "@/components/ui";
import { OohStamps } from "@/components/ooh-stamps";

export const metadata = { title: "Office Hours" };

const fridayLabel = (d: string) => formatDate(d, { weekday: "long", month: "long", day: "numeric" });

type Person = { id: string; name: string };
/** The request form, new or filled to edit. The two gates sit at the end, as on the old form. `people` is the owner first, then their team (H-413). */
function RequestForm({ fridays, categories, request, owner, people }: { fridays: string[]; categories: string[]; request?: OfficeHoursRequest; owner: string; people: Person[] }) {
  const choices = request && !fridays.includes(request.friday) ? [request.friday, ...fridays] : fridays;
  const ticked = new Set(request ? oohAttendees(request) : [people[0].id]);
  return (
    <form action={saveOohRequestAction} className="space-y-3" data-testid="ooh-form">
      {request ? <input type="hidden" name="requestId" value={request.id} /> : null}
      <DraftKeeper id={`ooh.${owner}.${request?.id ?? "new"}`} />
      <label className="block text-sm font-medium">
        Which Friday
        <select className="field mt-1" name="friday" defaultValue={request?.friday ?? fridays[0]} data-testid="ooh-friday">
          {choices.map((f) => (
            <option key={f} value={f}>
              {fridayLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Describe the issue
        <textarea className="field mt-1" name="description" rows={3} defaultValue={request?.description ?? ""} data-testid="ooh-description" />
      </label>
      <label className="block text-sm font-medium">
        How did you try to solve it yourself?
        <textarea className="field mt-1" name="triedSelf" rows={2} defaultValue={request?.triedSelf ?? ""} data-testid="ooh-tried" />
      </label>
      <label className="block text-sm font-medium">
        What tools are needed?
        <input className="field mt-1" name="tools" defaultValue={request?.tools ?? ""} placeholder="Community Loyalty, Airtable, GoHighLevel…" data-testid="ooh-tools" />
      </label>
      <label className="block text-sm font-medium">
        What solution are we trying to reach on the call?
        <textarea className="field mt-1" name="goal" rows={2} defaultValue={request?.goal ?? ""} data-testid="ooh-goal" />
      </label>
      <label className="block text-sm font-medium">
        Category
        <select className="field mt-1" name="category" defaultValue={request?.category ?? ""} data-testid="ooh-category">
          <option value="">Pick one</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {/* Who's attending (H-413): the owner and their team, the owner ticked by default, and a names-only line for anyone else. */}
      <fieldset className="space-y-1 rounded-lg border p-3 text-sm" data-testid="ooh-attendees">
        <legend className="px-1 font-medium">Who&apos;s attending</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {people.map((p, i) => (
            <label key={p.id} className="flex items-center gap-2">
              <input type="checkbox" name="attendees" value={p.id} defaultChecked={ticked.has(p.id)} data-testid="ooh-attendee" data-user={p.id} /> {p.name}
              {i === 0 ? <span className="text-xs text-ink-3">(owner)</span> : null}
            </label>
          ))}
        </div>
        <label className="block text-sm">
          <span className="text-ink-2">Others, names only</span>
          <input className="field mt-1" name="attendeesOther" defaultValue={request?.attendeesOther ?? ""} placeholder="Anyone not on HelixOS" maxLength={200} data-testid="ooh-others" />
        </label>
      </fieldset>
      <fieldset className="space-y-1 rounded-lg border p-3 text-sm">
        <legend className="px-1 font-medium">Have you tried to overcome this obstacle yourself?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="triedGate" value="yes" defaultChecked={Boolean(request)} data-testid="ooh-gate-yes" /> Yes, I have tried to overcome this obstacle myself
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="triedGate" value={GO_BACK} data-testid="ooh-gate-back" /> I need to go back and try to work through this myself
        </label>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="promise" value="yes" defaultChecked={Boolean(request)} data-testid="ooh-promise" /> I promise to attend our Office Hours call
      </label>
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="ooh-submit">
        {request ? "Save changes" : "Send my request"}
      </SubmitButton>
    </form>
  );
}

/**
 * Open Office Hours (handoff rev 124): a member asks ahead of a Friday session so the coach can prepare, and sees their requests,
 * each editable up to and including its Friday. The Airtable "OOH Form" keeps working until members move over.
 */
export default async function OfficeHoursPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; back?: string }> }) {
  // Team access (H-413): a team member books for the owner and sees the requests they are part of; the owner sees them all.
  const v = await requireViewer({ team: "allow" });
  const sp = await searchParams;
  const fridays = upcomingFridays(v.today);
  const who = { ownerId: v.user.id, actorId: v.actor.id, team: Boolean(v.team) };
  const [all, team] = await Promise.all([
    db.query.officeHoursRequests.findMany({ where: and(eq(schema.officeHoursRequests.workspaceId, v.workspace.id), eq(schema.officeHoursRequests.userId, v.user.id)), orderBy: [desc(schema.officeHoursRequests.friday), desc(schema.officeHoursRequests.createdAt)] }),
    teamOf(v.membership.id),
  ]);
  const mine = all.filter((r) => oohVisibleTo(r, who));
  const people: Person[] = [{ id: v.user.id, name: v.user.name }, ...team.map((t) => ({ id: t.member.teamUserId, name: t.name }))];
  const onTeam = new Set(team.map((t) => t.member.teamUserId));
  // Names for people on past requests who have since left the team, and for the notice line.
  const known = new Map(people.map((p) => [p.id, p.name]));
  const missing = [...new Set(mine.flatMap((r) => [...oohAttendees(r), r.submittedByUserId ?? ""]).concat(v.membership.oohNotice?.teamUserId ?? ""))].filter((id) => id && !known.has(id));
  for (const u of missing.length ? await db.query.users.findMany({ where: inArray(schema.users.id, missing), columns: { id: true, name: true } }) : []) known.set(u.id, u.name);
  const nameOf = (id: string) => known.get(id);
  const notice = !v.team && !v.switchedInto ? v.membership.oohNotice : null;
  const ownerFirst = v.user.name.split(" ")[0];
  return (
    <>
      <PageHeader title="Office Hours" subtitle={v.team ? `Ask ahead of a Friday session for ${ownerFirst}, so we can come prepared.` : "Ask ahead of a Friday session, so we can come prepared."} />
      {notice ? (
        <p className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-accent-ink" role="status" data-testid="ooh-notice">
          {oohNoticeWords(nameOf(notice.teamUserId) ?? "A team member", fridayLabel(notice.friday))}. It is under Your requests, with who&apos;s attending.
        </p>
      ) : null}
      <OohNoticeSeen pending={Boolean(notice)} />
      {/* When and where (friction walk OH1, 7 Oct): the time in the workspace's zone and the link, as the coach set them. */}
      <p className="mb-4 rounded-lg bg-surface-2 p-3 text-sm" data-testid="ooh-when">
        {v.workspace.oohTime || v.workspace.oohLink ? (
          <>
            {v.workspace.oohTime ? <span>🗓 {v.workspace.oohTime} ({v.workspace.timezone})</span> : <span>🗓 Fridays ({v.workspace.timezone})</span>}
            {v.workspace.oohLink ? (
              <>
                {" · "}
                <a href={v.workspace.oohLink} target="_blank" rel="noopener noreferrer" className="underline" data-testid="ooh-join">Join the call ↗</a>
              </>
            ) : null}
          </>
        ) : (
          <span>Your coach hasn&apos;t set the call&apos;s time and link here yet. Ask them, or check the Academy.</span>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div id="request">
          <Card title="Ask for help on a Friday">
            {sp.error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="ooh-error">{sp.error}</p> : null}
            {sp.back ? (
              <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="ooh-back">
                That&apos;s a good call. Work through it on your own first, and if you&apos;re still stuck, ask here before the next Friday. Nothing was sent.
              </p>
            ) : null}
            <RequestForm fridays={fridays} categories={v.workspace.oohCategories} owner={v.actor.id} people={people} />
          </Card>
        </div>
        <div id="mine">
          <Card title={v.team ? "Requests you're part of" : "Your requests"} action={<span className="text-xs text-ink-3">{mine.length}</span>}>
            {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="ooh-saved">Got it. Your request is in for that Friday. You can change it here until then.</p> : null}
            {mine.length ? (
              <ul className="space-y-3">
                {mine.map((r) => (
                  <li key={r.id} className="rounded-lg border p-3 text-sm" data-testid="ooh-mine" data-friday={r.friday}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{fridayLabel(r.friday)}</span>
                      <span className="flex items-center gap-1">
                        <Badge tone="neutral">{r.category}</Badge>
                        {r.outcome ? <Badge tone={r.outcome === "covered" ? "good" : "warn"}>{OOH_OUTCOME_LABEL[r.outcome]}</Badge> : null}
                      </span>
                    </div>
                    <OohStamps createdAt={r.createdAt} editedAt={r.editedAt} tz={v.tz} today={v.today} />
                    {submittedByWords(r, nameOf, onTeam) ? <p className="text-xs text-ink-3" data-testid="ooh-submitted-by">{submittedByWords(r, nameOf, onTeam)}</p> : null}
                    <p className="text-xs text-ink-3" data-testid="ooh-attending">{attendeeWords(r, nameOf, onTeam)}</p>
                    <p className="mt-1 whitespace-pre-line text-ink-2">{r.description}</p>
                    {r.responsible ? <p className="mt-1 text-xs text-ink-3">With {r.responsible}</p> : null}
                    {oohCanEdit(r, who, v.today, r.friday) ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs underline" data-testid="ooh-edit">Change this request</summary>
                        <div className="mt-2">
                          <RequestForm fridays={fridays} categories={v.workspace.oohCategories} request={r} owner={v.actor.id} people={people} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No requests yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
