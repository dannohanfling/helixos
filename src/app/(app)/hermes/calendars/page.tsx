import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CalendarTest, CalendarWrite } from "@/components/hermes/calendar-steps";
import { ACADEMY_COPY_ID, CALENDARS, CAL_LOCATION, CAL_SCOPES, TEMPLATE_ID, calendarBody, conflictFields, fieldRows } from "@/lib/hermes/calendars";
import { calendarContext, readCalendars } from "@/lib/hermes/calendars-ghl";

export const metadata = { title: "Booking calendars" };
export const dynamic = "force-dynamic";

/**
 * Coach → Booking calendars (H-892, plan H-1040, approved H-1044): the two private 30-minute calls the pass invitations link
 * to. Step 1 only reads. Step 2 and Step 3 write, each on Danno's press and nothing else. Coach only; the key stays on the
 * server.
 */
export default async function BookingCalendarsPage() {
  const v = await requireCoach();
  const c = await calendarContext(v.user.id);
  const read = c.ok ? await readCalendars(c.data) : c;
  const step1 = read.ok ? read.data : null;
  const userId = "<the user you pick>";
  const preview = step1 ? (["academy", "elite"] as const).map((k) => ({ spec: CALENDARS[k], rows: fieldRows(calendarBody(CALENDARS[k], step1.template, userId, k === "elite" ? !step1.elite : !step1.academy && !step1.copy), step1.template) })) : [];
  const conflicts = step1 ? conflictFields(step1.template) : [];

  return (
    <>
      <PageHeader
        title="Booking calendars"
        subtitle="Academy Conversation and Elite Conversation, the private 30-minute calls the pass invitations open. Nothing is written until you press a button."
        action={
          <Link href="/coach" className="btn btn-ghost btn-sm">
            Back
          </Link>
        }
      />
      <div className="space-y-4" data-testid="cal-page">
        <Card title="Before you start">
          <p className="text-sm">
            Your own Private Integration in GoHighLevel (Settings → Private Integrations) needs three permissions: {CAL_SCOPES.join(", ")}. Members&apos; lists don&apos;t change. If GoHighLevel gives you a new key, paste it in Settings → Publishing as before.
          </p>
          <p className="mt-2 text-xs text-ink-3">
            Sub-account {CAL_LOCATION}. Copies Evolve Omega Booking ({TEMPLATE_ID}); updates the stray copy ({ACADEMY_COPY_ID}) into Academy Conversation when it still reads, and makes Academy fresh when it doesn&apos;t; nothing is deleted and no other calendar is touched.
          </p>
        </Card>

        <Card title="Step 1: what's there now (read only)">
          {!read.ok ? (
            <p className="text-sm text-danger" role="alert" data-testid="cal-read-error">
              {read.error}
            </p>
          ) : (
            <div className="space-y-4" data-testid="cal-read">
              <ul className="space-y-1 text-sm">
                <li>
                  Evolve Omega Booking: <span className="font-semibold">{String(step1!.template.name ?? "")}</span>
                </li>
                <li data-testid="cal-academy-now">
                  Academy Conversation:{" "}
                  {step1!.academy ? (
                    <Badge tone="good">made ({String(step1!.academy.id)})</Badge>
                  ) : step1!.copy ? (
                    <>
                      the copy, <span className="font-semibold">{String(step1!.copy.name ?? "")}</span>, <Badge tone="warn">live under its old name</Badge>; Step 2 updates it
                    </>
                  ) : (
                    <>
                      <Badge>not made yet</Badge> <span data-testid="cal-copy-note">{step1!.copyNote}</span>
                    </>
                  )}
                </li>
                <li data-testid="cal-elite-now">Elite Conversation: {step1!.elite ? <Badge tone="good">made ({String(step1!.elite.id)})</Badge> : <Badge>not made yet</Badge>}</li>
                <li>
                  Conflict checking on Evolve Omega Booking: {conflicts.length ? conflicts.map((f) => `${f.key} ${f.value}`).join("; ") : "not in the API's reply. Linked Google calendars are set per user in GoHighLevel, Settings → Calendars → Connections, and every calendar of yours uses them."}
                </li>
              </ul>
              <details className="rounded-lg border border-line" data-testid="cal-list">
                <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-semibold">All {step1!.calendars.length} calendars in this sub-account (names and ids)</summary>
                <ul className="space-y-1 px-3 pb-3 text-xs">
                  {step1!.calendars.map((x) => (
                    <li key={x.id} className="break-all">
                      {x.name || "(no name)"} · {x.id}
                      {x.mark ? <span className="ml-1 font-semibold">({x.mark === "template" ? "Evolve Omega Booking, copied" : x.mark === "copy" ? "the stray copy" : x.mark === "academy" ? "Academy Conversation" : "Elite Conversation"})</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
              {preview.map((p) => (
                <details key={p.spec.key} className="rounded-lg border border-line" data-testid={`cal-fields-${p.spec.key}`}>
                  <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-semibold">{p.spec.name}: the fields as they would be written</summary>
                  <div className="overflow-x-auto px-3 pb-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-ink-3">
                          <th className="py-1 pr-2">Field</th>
                          <th className="py-1 pr-2">Evolve Omega Booking</th>
                          <th className="py-1">Written</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {p.rows.map((r) => (
                          <tr key={r.key} className={r.changed ? "font-semibold" : ""}>
                            <td className="py-1 pr-2 align-top">{r.key}</td>
                            <td className="max-w-[240px] break-all py-1 pr-2 align-top">{r.template}</td>
                            <td className="max-w-[240px] break-all py-1 align-top">{r.written}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>

        {step1 ? (
          <>
            <Card title="Step 2: write the two calendars">
              <p className="mb-3 text-sm text-ink-2">Academy goes first, so the copy stops being live under its old name. Pressing again updates both in place; it never makes a second Elite.</p>
              <CalendarWrite users={step1.users} />
            </Card>
            <Card title="Step 3: test bookings">
              <p className="mb-3 text-sm text-ink-2">Books the next free slot on each calendar for the test contact, checks GoHighLevel made a Zoom link, then cancels both. No email goes out.</p>
              <CalendarTest />
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
