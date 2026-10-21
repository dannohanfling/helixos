import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { followUpAction } from "@/lib/actions/reports";
import { KIND_SHORT } from "@/lib/engine/reports";
import { STATUS_WORDS, topicOf } from "@/lib/engine/report-status";
import { markRepliesRead, myReports } from "@/lib/report-replies";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "My reports" };

/**
 * My reports (H-202): what the member sent from "I have an issue or a suggestion", newest first, each with where it stands and
 * everything said on it. A follow-up goes on the same report instead of a new one. Opening the page marks the replies read.
 */
export default async function MyReportsPage({ searchParams }: { searchParams: Promise<{ followed?: string; error?: string; report?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const threads = await myReports(m);
  if (!v.switchedInto) await markRepliesRead(m);
  return (
    <>
      <PageHeader title="My reports" subtitle="What you sent, where it stands, and every reply." />
      {threads.length ? (
        <ul className="space-y-3" data-testid="my-reports">
          {threads.map(({ report: r, messages, merged }) => (
            <li key={r.id} id={`r-${r.id}`} className="scroll-mt-4">
              <Card>
                <div data-testid="my-report" data-status={r.status}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{topicOf(r)}</span>
                    <Badge tone={r.kind === "suggestion" ? "good" : r.kind === "ask_danno" ? "accent" : "warn"}>{KIND_SHORT[r.kind]}</Badge>
                    <Badge tone={r.status === "done" ? "good" : r.status === "new" ? "neutral" : "accent"}>{STATUS_WORDS[r.status]}</Badge>
                    <span className="ml-auto text-xs text-ink-3">{formatDateTime(r.createdAt, v.tz)}</span>
                  </div>
                  {r.description ? <p className="mt-2 whitespace-pre-line break-words text-sm text-ink-2">{r.description}</p> : null}
                  {/* H-202: the ones merged into this report; one reply here answers them all. */}
                  {merged.length ? (
                    <div className="mt-2 text-sm" data-testid="my-report-merged">
                      <p className="text-xs text-ink-3">Also in this report, so one reply covers them all:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                        {merged.map((c) => (
                          <li key={c.id} className="whitespace-pre-line break-words">
                            {c.description || c.question || topicOf(c)} <span className="text-xs text-ink-3">· {formatDateTime(c.createdAt, v.tz)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {messages.length ? (
                    <ol className="mt-3 space-y-2 border-l-2 pl-3 text-sm" data-testid="my-report-log">
                      {messages.map((x) => (
                        <li key={x.id} data-testid="my-report-line" data-kind={x.kind}>
                          <span className="text-xs text-ink-3">
                            {x.kind === "followup" ? "You" : x.kind === "receipt" ? "Received" : STATUS_WORDS[x.status ?? "seen"]} · {formatDateTime(x.createdAt, v.tz)}
                          </span>
                          <span className="block whitespace-pre-line break-words">{x.body}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {sp.report === r.id && sp.error ? <p className="mt-2 rounded-lg bg-danger-soft p-2 text-sm" role="alert">{sp.error}</p> : null}
                  {sp.followed === r.id ? <p className="mt-2 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="followed">Added. It&apos;s back with your coach.</p> : null}
                  {v.switchedInto ? null : (
                    <details className="mt-3" data-testid="follow-up">
                      <summary className="cursor-pointer text-sm font-medium">Add a follow-up</summary>
                      <form action={followUpAction} className="mt-2 space-y-2">
                        <input type="hidden" name="reportId" value={r.id} />
                        <textarea className="field min-h-20" name="text" maxLength={2000} required placeholder="Anything to add, on this same report" data-testid="follow-up-text" />
                        <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="follow-up-send">
                          Send
                        </SubmitButton>
                      </form>
                    </details>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="🛟" title="Nothing sent yet" hint="Use “I have an issue or a suggestion” in your menu; what you send shows here with every reply." action={<Link className="btn btn-soft btn-sm" href="/today">Back to Today</Link>} />
      )}
    </>
  );
}
