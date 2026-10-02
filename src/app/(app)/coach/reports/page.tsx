import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { markReportAction } from "@/lib/actions/reports";
import { KIND_SHORT, SEVERITY_LABEL } from "@/lib/engine/reports";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader, Tabs } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Issues and ideas" };

const DOT: Record<string, string> = { red: "bg-danger", orange: "bg-warn", green: "bg-good" };

/**
 * The coach's inbox for "I have an issue or a suggestion" (rev 432 items 2 and 3): newest first, each with who sent it, the
 * page, the colour, the words, the screenshot, and for an Ask Danno answer the question, the answer and whether they want to
 * talk. Seen and Done are toggles; Open lists what isn't done, Done what is.
 */
export default async function CoachReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const v = await requireCoach();
  const { tab } = await searchParams;
  const showDone = tab === "done";
  const [rows, open, done] = await Promise.all([
    db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), showDone ? isNotNull(schema.memberReports.doneAt) : isNull(schema.memberReports.doneAt)), orderBy: desc(schema.memberReports.createdAt), limit: 200 }),
    db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), isNull(schema.memberReports.doneAt)), columns: { id: true } }),
    db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), isNotNull(schema.memberReports.doneAt)), columns: { id: true } }),
  ]);
  const users = rows.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(rows.map((r) => r.userId))]) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const tz = v.workspace.timezone;
  return (
    <>
      <PageHeader title="Issues and ideas" subtitle="What members send from “I have an issue or a suggestion”, newest first." action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      <Tabs current={showDone ? "done" : "open"} items={[{ key: "open", label: "Open", href: "/coach/reports", count: open.length }, { key: "done", label: "Done", href: "/coach/reports?tab=done", count: done.length }]} />
      {rows.length ? (
        <ul className="mt-4 space-y-3" data-testid="reports-list">
          {rows.map((r) => (
            <li key={r.id} id={`r-${r.id}`}>
              <Card>
                <div data-testid="report-row" data-kind={r.kind} data-severity={r.severity} data-seen={r.seenAt ? "1" : "0"} data-done={r.doneAt ? "1" : "0"}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[r.severity]}`} aria-label={SEVERITY_LABEL[r.severity]} title={SEVERITY_LABEL[r.severity]} />
                    <span className="font-semibold" data-testid="report-from">{nameOf.get(r.userId) ?? "A member"}</span>
                    <Badge tone={r.kind === "suggestion" ? "good" : r.kind === "ask_danno" ? "accent" : "warn"}>{KIND_SHORT[r.kind]}</Badge>
                    <span className="text-xs text-ink-3">{SEVERITY_LABEL[r.severity]}</span>
                    {!r.seenAt ? <Badge tone="danger">new</Badge> : null}
                    {r.talkToCoach ? <Badge tone="warn">wants to talk</Badge> : null}
                    <span className="ml-auto text-xs text-ink-3">{formatDateTime(r.createdAt.includes("T") ? r.createdAt : `${r.createdAt.replace(" ", "T")}Z`, tz)}</span>
                  </div>
                  {r.page ? <p className="mt-1 text-xs text-ink-3">From <code className="break-all">{r.page}</code></p> : null}
                  {r.kind === "ask_danno" ? (
                    <dl className="mt-2 space-y-1 text-sm">
                      <div>
                        <dt className="inline font-medium">They asked: </dt>
                        <dd className="inline whitespace-pre-line break-words" data-testid="report-question-text">{r.question}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Ask Danno said: </dt>
                        <dd className="inline whitespace-pre-line break-words">{r.answer}</dd>
                      </div>
                    </dl>
                  ) : null}
                  {r.description ? <p className="mt-2 whitespace-pre-line break-words text-sm" data-testid="report-description-text">{r.description}</p> : null}
                  {r.screenshotUrl ? (
                    <a href={`/api/reports/${r.id}/screenshot`} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a private screenshot served by the app's own route */}
                      <img src={`/api/reports/${r.id}/screenshot`} alt={`Screenshot from ${nameOf.get(r.userId) ?? "a member"}`} className="max-h-48 rounded-lg border" data-testid="report-screenshot-img" />
                    </a>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={markReportAction}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <input type="hidden" name="mark" value="seen" />
                      <SubmitButton className="btn btn-ghost btn-xs" data-testid="report-seen" pendingText="Saving…">{r.seenAt ? "Mark unseen" : "Seen"}</SubmitButton>
                    </form>
                    <form action={markReportAction}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <input type="hidden" name="mark" value="done" />
                      <SubmitButton className="btn btn-ghost btn-xs" data-testid="report-done" pendingText="Saving…">{r.doneAt ? "Reopen" : "Done"}</SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2" data-testid="reports-empty">{showDone ? "Nothing marked done yet." : "Nothing open. Members send these from “I have an issue or a suggestion” in their menu."}</p>
      )}
    </>
  );
}
