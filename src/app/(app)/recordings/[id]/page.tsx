import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { clientMembers, coachEmailsOf, markSeen, stepsFor, visibleRecording } from "@/lib/recordings";
import { groupActionItems, itemMoment, type ItemGroup } from "@/lib/engine/recording-members";
import { programLine, shownTitle } from "@/lib/engine/recordings";
import { deepLink } from "@/lib/engine/fathom";
import { dismissStepAction, makeStepTaskAction, viewTranscriptAction } from "@/lib/actions/recordings";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RecordingSummary } from "@/components/recording-summary";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Recording" };

/**
 * One recording as a member sees it (R1): title, date, program, Watch in Fathom, the summary, the action items each with one tap
 * to make it their own task, and View transcript on request: the first press fetches it with the coach's key and keeps it, every
 * later press opens it from HelixOS. Nothing here is fetched while a coach is switched into this member.
 */
export default async function RecordingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ transcript?: string; error?: string; task?: string }> }) {
  const v = await requireViewer();
  if (v.role === "coach") redirect("/coach/recordings");
  const { id } = await params;
  const sp = await searchParams;
  const r = await visibleRecording(v.workspace.id, id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role });
  if (!r) notFound();
  const [steps, members, coachEmails] = await Promise.all([stepsFor(v.user.id, [r.id]), clientMembers(v.workspace.id), coachEmailsOf(v.workspace.id)]);
  // Opening it here is seeing it (rev 498); a coach switched in marks nothing for the member.
  if (!v.switchedInto) await markSeen(v.workspace.id, v.user.id, r.id);
  const watch = r.shareUrl || r.url;
  const watchHref = `/recordings/${r.id}/watch`;
  // Who each item is for, by email (rev 496): the member's own first as "Yours", the others folded. A coach's email is named by
  // the name Fathom gave, since only members are listed here.
  const groups = groupActionItems(r.actionItems, [...members.map((m) => ({ name: m.name, email: m.email })), ...coachEmails.map((e) => ({ name: r.actionItems.find((i) => (i.assigneeEmail ?? "").toLowerCase() === e.toLowerCase())?.assigneeName ?? "Your coach", email: e }))], { email: v.user.email, name: v.user.name, role: "client" });
  const showTranscript = Boolean(r.transcript) && sp.transcript === "1";
  const switched = Boolean(v.switchedInto);
  return (
    <>
      <PageHeader
        title={shownTitle(r)}
        subtitle={
          <span>
            {r.clearTitle ? <span className="block text-xs text-ink-3" data-testid="recording-fathom-title">In Fathom: {r.title}</span> : null}
            {r.startedAt ? formatDateTime(r.startedAt, v.tz) : "Date unknown"} · <span data-testid="recording-program">{programLine(r.audience)}</span>
          </span>
        }
        action={
          <span className="flex flex-wrap gap-2">
            {watch ? (
              <a href={watchHref} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" data-testid="recording-watch">
                Watch in Fathom ↗
              </a>
            ) : null}
            <Link href="/recordings" className="btn btn-ghost btn-sm">All recordings</Link>
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card title="Summary">
            {r.summary ? <RecordingSummary markdown={r.summary} /> : <p className="text-sm text-ink-3">Fathom sent no summary for this call.</p>}
          </Card>
          <Card title="Transcript" id="transcript">
            {r.transcriptHidden ? (
              <p className="text-sm text-ink-3" data-testid="recording-transcript-hidden">Your coach has kept the transcript of this call private.</p>
            ) : switched ? (
              <p className="text-sm text-ink-3" data-testid="recording-transcript-switched">The transcript is {v.user.name.split(" ")[0]}&apos;s to open, not something to fetch from a switched view.</p>
            ) : showTranscript && r.transcript ? (
              <ol className="max-h-[32rem] space-y-2 overflow-y-auto text-sm" data-testid="recording-transcript">
                {r.transcript.map((e, i) => (
                  <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-2">
                    {watch ? (
                      <a href={deepLink(watch, e.timestamp)} target="_blank" rel="noreferrer" className="font-mono text-xs text-ink-3 hover:underline">
                        {e.timestamp}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-ink-3">{e.timestamp}</span>
                    )}
                    <span className="break-words">
                      <span className="font-medium">{e.speaker}:</span> {e.text}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="space-y-2">
                {sp.error ? (
                  <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="recording-transcript-error">
                    {sp.error}
                  </p>
                ) : (
                  <p className="text-sm text-ink-2">{r.transcript ? "The transcript is here. Open it when you want to read what was said." : "The transcript is fetched from Fathom the first time anyone asks, then kept here."}</p>
                )}
                <form action={viewTranscriptAction}>
                  <input type="hidden" name="recordingId" value={r.id} />
                  <SubmitButton className="btn btn-accent btn-sm" data-testid="recording-view-transcript" pendingText="Fetching the transcript…">
                    {sp.error ? "Retry" : "View transcript"}
                  </SubmitButton>
                </form>
              </div>
            )}
          </Card>
        </div>
        <Card title="Action items" id="steps">
          {sp.task ? (
            <p className="mb-2 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recording-task-made">
              Added to your tasks for today.
            </p>
          ) : null}
          {r.actionItems.length ? (
            <div className="space-y-3 text-sm" data-testid="recording-steps">
              {groups.map((g: ItemGroup) => {
                const list = (
                  <ul className="mt-2 space-y-3">
                    {g.items.map(({ item: it, index: i }) => {
                      const step = steps.get(`${r.id}:${i}`);
                      const mine = (it.assigneeEmail ?? "").toLowerCase() === v.user.email.toLowerCase();
                      const moment = itemMoment(it, watch);
                      return (
                        <li key={i} className="rounded-lg border p-3" data-testid="recording-step" data-state={step?.state ?? (mine ? "mine" : "open")}>
                          <p className="break-words">{it.description}</p>
                          {moment ? (
                            <a href={moment.href} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-accent hover:underline" data-testid="recording-step-moment">
                              {moment.label}
                            </a>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {step?.taskId ? (
                              <Link href="/tasks" className="text-xs font-medium text-good" data-testid="recording-step-done">
                                In your tasks ✓
                              </Link>
                            ) : switched ? (
                              <span className="text-xs text-ink-3">Steps are {v.user.name.split(" ")[0]}&apos;s to take.</span>
                            ) : (
                              <>
                                <form action={makeStepTaskAction}>
                                  <input type="hidden" name="recordingId" value={r.id} />
                                  <input type="hidden" name="itemIndex" value={i} />
                                  <SubmitButton className="btn btn-primary btn-xs" data-testid="recording-step-make-task" pendingText="Adding…">
                                    Make this my task
                                  </SubmitButton>
                                </form>
                                {step?.state === "suggested" ? (
                                  <form action={dismissStepAction}>
                                    <input type="hidden" name="stepId" value={step.id} />
                                    <SubmitButton className="btn btn-ghost btn-xs" data-testid="recording-step-dismiss" pendingText="Letting go…">
                                      Not mine
                                    </SubmitButton>
                                  </form>
                                ) : null}
                                {step?.state === "dismissed" ? <Badge tone="neutral">let go</Badge> : null}
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
                const heading = (
                  <span className="font-semibold">
                    {g.label} ({g.items.length})
                  </span>
                );
                return g.own ? (
                  <section key={g.key} data-testid="recording-group-items" data-own="yes">
                    {heading}
                    {list}
                  </section>
                ) : (
                  <details key={g.key} data-testid="recording-group-items" data-own="no">
                    <summary className="cursor-pointer">{heading}</summary>
                    {list}
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Fathom found no action items in this call.</p>
          )}
        </Card>
      </div>
    </>
  );
}
