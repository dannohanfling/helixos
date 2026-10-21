import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { sendReplyAction } from "@/lib/actions/reports";
import { hideWinAction } from "@/lib/actions/colosseum";
import { REPORT_STATUSES, type ReportStatus } from "@/db/schema";
import { REPLY_STATUSES, STATUS_WORDS, firstName, replyText, topicOf } from "@/lib/engine/report-status";
import { countsByStatus, withMessages } from "@/lib/report-replies";
import { KIND_SHORT, SEVERITY_LABEL } from "@/lib/engine/reports";
import { REASON_LABEL, reasonOf } from "@/lib/engine/blocks";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader, Tabs } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Issues and ideas" };

const DOT: Record<string, string> = { red: "bg-danger", orange: "bg-warn", green: "bg-good" };

/**
 * The coach's inbox for "I have an issue or a suggestion" (rev 432 items 2 and 3): newest first, each with who sent it, the
 * page, the colour, the words, the screenshot, and for an Ask Danno answer the question, the answer and whether they want to
 * talk. H-202: one tab per status (New first, oldest or newest first); each status is a reply in Danno's words, edited and sent
 * with Send, and everything said on the report is logged under it. A Content report (H-745), from Report on a win or a member
 * in the Colosseum, shows the reason, the win's words and who wrote it, with Hide this win (for everyone, undoable).
 */
export default async function CoachReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; sort?: string; replied?: string; replyError?: string; report?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  // H-202: one tab per status, New first; the older Open and Done addresses still land somewhere sensible.
  const tab: ReportStatus = REPORT_STATUSES.find((s) => s === sp.tab) ?? (sp.tab === "done" ? "done" : "new");
  const oldest = sp.sort === "oldest";
  const [rows, all] = await Promise.all([
    db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, v.workspace.id), eq(schema.memberReports.status, tab)), orderBy: oldest ? asc(schema.memberReports.createdAt) : desc(schema.memberReports.createdAt), limit: 200 }),
    db.query.memberReports.findMany({ where: eq(schema.memberReports.workspaceId, v.workspace.id), columns: { status: true } }),
  ]);
  const counts = countsByStatus(all);
  const threads = await withMessages(v.workspace.id, rows);
  // A Content report's win, and the names of everyone involved: senders and the members reported.
  const winIds = rows.filter((r) => r.kind === "content" && r.targetKind === "win" && r.targetId).map((r) => r.targetId!);
  const winRows = winIds.length ? await db.query.colosseumWins.findMany({ where: and(eq(schema.colosseumWins.workspaceId, v.workspace.id), inArray(schema.colosseumWins.id, winIds)) }) : [];
  const winOf = new Map(winRows.map((w) => [w.id, w]));
  const people = [...new Set([...rows.map((r) => r.userId), ...rows.map((r) => r.targetUserId).filter((x): x is string => Boolean(x))])];
  const users = people.length ? await db.query.users.findMany({ where: inArray(schema.users.id, people) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  // Rev 843: each report in the sender's own zone, labelled ("1:32 PM EDT"), never the workspace's unlabelled.
  const senders = rows.length ? await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), inArray(schema.memberships.userId, [...new Set(rows.map((r) => r.userId))])), columns: { userId: true, timezone: true } }) : [];
  const tzOf = new Map(senders.map((m) => [m.userId, m.timezone ?? v.tz]));
  const href = (t: string, sort = oldest ? "oldest" : "") => `/coach/reports?tab=${t}${sort ? `&sort=${sort}` : ""}`;
  return (
    <>
      <PageHeader title="Issues and ideas" subtitle="What members send from “I have an issue or a suggestion”, newest first." action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      <Tabs current={tab} items={REPORT_STATUSES.map((s) => ({ key: s, label: STATUS_WORDS[s], href: href(s), count: counts[s] }))} />
      <p className="mt-2 text-xs text-ink-3" data-testid="reports-sort">
        {oldest ? <Link className="underline" href={href(tab, "")}>Newest first</Link> : <span>Newest first</span>} ·{" "}
        {oldest ? <span>Oldest first</span> : <Link className="underline" href={href(tab, "oldest")} data-testid="reports-oldest">Oldest first</Link>}
      </p>
      {rows.length ? (
        <ul className="mt-4 space-y-3" data-testid="reports-list">
          {threads.map(({ report: r, messages }) => (
            <li key={r.id} id={`r-${r.id}`}>
              <Card>
                <div data-testid="report-row" data-kind={r.kind} data-severity={r.severity} data-seen={r.seenAt ? "1" : "0"} data-done={r.doneAt ? "1" : "0"} data-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[r.severity]}`} aria-label={SEVERITY_LABEL[r.severity]} title={SEVERITY_LABEL[r.severity]} />
                    {r.kind === "content" ? <span className="text-xs text-ink-3">Reported by</span> : null}
                    <span className="font-semibold" data-testid="report-from">{nameOf.get(r.userId) ?? "A member"}</span>
                    <Badge tone={r.kind === "suggestion" ? "good" : r.kind === "ask_danno" ? "accent" : r.kind === "content" ? "danger" : "warn"}>{KIND_SHORT[r.kind]}</Badge>
                    <span className="text-xs text-ink-3" data-testid="report-reason">{r.kind === "content" ? REASON_LABEL[reasonOf(r.severity)] : SEVERITY_LABEL[r.severity]}</span>
                    <Badge tone={r.status === "new" ? "danger" : r.status === "done" ? "good" : r.status === "not_now" ? "neutral" : "accent"}>{STATUS_WORDS[r.status]}</Badge>
                    {r.handledAt ? <Badge tone="good">handled</Badge> : null}
                    {r.talkToCoach ? <Badge tone="warn">wants to talk</Badge> : null}
                    <span className="ml-auto text-xs text-ink-3">{formatDateTime(r.createdAt, tzOf.get(r.userId) ?? v.tz, { zone: true })}</span>
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
                  {r.kind === "content" ? <ContentTarget r={r} win={r.targetId ? winOf.get(r.targetId) : undefined} nameOf={nameOf} /> : null}
                  {r.description ? <p className="mt-2 whitespace-pre-line break-words text-sm" data-testid="report-description-text">{r.kind === "content" ? <span className="font-medium">Their note: </span> : null}{r.description}</p> : null}
                  {r.screenshotUrl ? (
                    <a href={`/api/reports/${r.id}/screenshot`} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a private screenshot served by the app's own route */}
                      <img src={`/api/reports/${r.id}/screenshot`} alt={`Screenshot from ${nameOf.get(r.userId) ?? "a member"}`} className="max-h-48 rounded-lg border" data-testid="report-screenshot-img" />
                    </a>
                  ) : null}
                  {/* What was said on it (H-202): the receipt, each reply with its status, the member's follow-ups. Who, when, what. */}
                  {messages.length ? (
                    <ol className="mt-3 space-y-1 border-l-2 pl-3 text-sm" data-testid="report-log">
                      {messages.map((x) => (
                        <li key={x.id} data-testid="report-log-line" data-kind={x.kind}>
                          <span className="text-xs text-ink-3">
                            {x.kind === "receipt" ? "Receipt" : x.kind === "followup" ? `${nameOf.get(r.userId)?.split(" ")[0] ?? "They"} followed up` : `${STATUS_WORDS[x.status ?? "seen"]}${x.emailed ? " · emailed" : ""}`} · {formatDateTime(x.createdAt, v.tz)}
                          </span>
                          <span className="block whitespace-pre-line break-words">{x.body}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {sp.report === r.id && sp.replyError ? <p className="mt-2 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="reply-error">{sp.replyError}</p> : null}
                  {sp.replied === r.id ? <p className="mt-2 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="reply-sent">Sent.</p> : null}
                  <div className="mt-3 flex flex-wrap items-start gap-2" data-testid="report-replies">
                    {REPLY_STATUSES.map((s) => (
                      <details key={s} className="w-full rounded-lg border sm:w-auto" data-testid={`reply-${s}`}>
                        <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium">{STATUS_WORDS[s]}</summary>
                        <form action={sendReplyAction} className="space-y-2 p-3 sm:w-[28rem]">
                          <input type="hidden" name="reportId" value={r.id} />
                          <input type="hidden" name="status" value={s} />
                          <input type="hidden" name="tab" value={tab} />
                          <label className="block text-xs">
                            <span className="label">Topic</span>
                            <input className="field" name="topic" defaultValue={topicOf(r)} maxLength={80} data-testid="reply-topic" />
                          </label>
                          <label className="block text-xs">
                            <span className="label">To {nameOf.get(r.userId)?.split(" ")[0] ?? "the member"}</span>
                            <textarea className="field min-h-24" name="message" defaultValue={replyText(s, { first: firstName(nameOf.get(r.userId)), topic: topicOf(r) })} data-testid="reply-message" />
                          </label>
                          <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="reply-send">
                            Send
                          </SubmitButton>
                        </form>
                      </details>
                    ))}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-2" data-testid="reports-empty">{tab === "new" ? "Nothing new. Members send these from “I have an issue or a suggestion” in their menu." : `Nothing in ${STATUS_WORDS[tab]}.`}</p>
      )}
    </>
  );
}

/** What a Content report is about: the win's words and who wrote it, with Hide this win (and its undo); or the member reported. */
function ContentTarget({ r, win, nameOf }: { r: schema.MemberReport; win: schema.ColosseumWin | undefined; nameOf: Map<string, string> }) {
  const author = r.targetUserId ? (nameOf.get(r.targetUserId) ?? "A former member") : "A member";
  if (r.targetKind === "member") {
    return (
      <p className="mt-2 text-sm" data-testid="report-target">
        <span className="font-medium">Member reported: </span>
        {author}
      </p>
    );
  }
  if (!win) {
    return (
      <p className="mt-2 text-sm text-ink-2" data-testid="report-target">
        A win by {author}. It has since been taken down.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-lg border p-2 text-sm" data-testid="report-target">
      <p className="text-xs text-ink-3">
        A {win.kind} win by <span className="font-medium text-ink">{author}</span>
        {win.hiddenAt ? " · hidden for everyone" : ""}
      </p>
      <p className="mt-1 whitespace-pre-line break-words" data-testid="report-win-text">{win.text}</p>
      <form action={hideWinAction} className="mt-2">
        <input type="hidden" name="winId" value={win.id} />
        <input type="hidden" name="hidden" value={win.hiddenAt ? "0" : "1"} />
        <SubmitButton className="btn btn-soft btn-xs" data-testid={win.hiddenAt ? "report-unhide-win" : "report-hide-win"} pendingText="Saving…">
          {win.hiddenAt ? "Show this win again" : "Hide this win"}
        </SubmitButton>
      </form>
    </div>
  );
}
