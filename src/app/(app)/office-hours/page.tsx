import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfficeHoursRequest } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { saveOohRequestAction } from "@/lib/actions/office-hours";
import { GO_BACK, OOH_OUTCOME_LABEL, oohEditable, upcomingFridays } from "@/lib/engine/office-hours";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Office Hours" };

const fridayLabel = (d: string) => formatDate(d, { weekday: "long", month: "long", day: "numeric" });

/** The request form, new or filled to edit. The two gates sit at the end, as on the old form. */
function RequestForm({ fridays, categories, request }: { fridays: string[]; categories: string[]; request?: OfficeHoursRequest }) {
  const choices = request && !fridays.includes(request.friday) ? [request.friday, ...fridays] : fridays;
  return (
    <form action={saveOohRequestAction} className="space-y-3" data-testid="ooh-form">
      {request ? <input type="hidden" name="requestId" value={request.id} /> : null}
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
  const v = await requireViewer();
  const sp = await searchParams;
  const fridays = upcomingFridays(v.today);
  const mine = await db.query.officeHoursRequests.findMany({ where: and(eq(schema.officeHoursRequests.workspaceId, v.workspace.id), eq(schema.officeHoursRequests.userId, v.user.id)), orderBy: [desc(schema.officeHoursRequests.friday), desc(schema.officeHoursRequests.createdAt)] });
  return (
    <>
      <PageHeader title="Office Hours" subtitle="Ask ahead of a Friday session, so we can come prepared." />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div id="request">
          <Card title="Ask for help on a Friday">
            {sp.error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="ooh-error">{sp.error}</p> : null}
            {sp.back ? (
              <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="ooh-back">
                That&apos;s a good call. Work through it on your own first, and if you&apos;re still stuck, ask here before the next Friday. Nothing was sent.
              </p>
            ) : null}
            {fridays.length ? (
              <RequestForm fridays={fridays} categories={v.workspace.oohCategories} />
            ) : (
              <p className="text-sm text-ink-2" data-testid="ooh-none">There are no Office Hours left this month. Next month&apos;s Fridays open on the 1st.</p>
            )}
          </Card>
        </div>
        <div id="mine">
          <Card title="Your requests" action={<span className="text-xs text-ink-3">{mine.length}</span>}>
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
                    <p className="mt-1 whitespace-pre-line text-ink-2">{r.description}</p>
                    {r.responsible ? <p className="mt-1 text-xs text-ink-3">With {r.responsible}</p> : null}
                    {oohEditable(v.today, r.friday) ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs underline" data-testid="ooh-edit">Change this request</summary>
                        <div className="mt-2">
                          <RequestForm fridays={fridays} categories={v.workspace.oohCategories} request={r} />
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
