import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { stepsFor, visibleRecording } from "@/lib/recordings";
import { programLine } from "@/lib/engine/recordings";
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
  const steps = await stepsFor(v.user.id, [r.id]);
  const watch = r.shareUrl || r.url;
  const showTranscript = Boolean(r.transcript) && sp.transcript === "1";
  const switched = Boolean(v.switchedInto);
  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span>
            {r.startedAt ? formatDateTime(r.startedAt, v.tz) : "Date unknown"} · <span data-testid="recording-program">{programLine(r.audience)}</span>
          </span>
        }
        action={
          <span className="flex flex-wrap gap-2">
            {watch ? (
              <a href={watch} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" data-testid="recording-watch">
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
            <ul className="space-y-3 text-sm" data-testid="recording-steps">
              {r.actionItems.map((it, i) => {
                const step = steps.get(`${r.id}:${i}`);
                const mine = (it.assigneeEmail ?? "").toLowerCase() === v.user.email.toLowerCase();
                return (
                  <li key={i} className="rounded-lg border p-3" data-testid="recording-step" data-state={step?.state ?? (mine ? "mine" : "open")}>
                    <p className="break-words">{it.description}</p>
                    <p className="mt-1 text-xs text-ink-3">
                      {it.assigneeName ? `Fathom's guess: ${mine ? "you" : it.assigneeName}` : "Nobody named"}
                      {it.timestamp ? ` · at ${it.timestamp}` : ""}
                    </p>
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
          ) : (
            <p className="text-sm text-ink-3">Fathom found no action items in this call.</p>
          )}
        </Card>
      </div>
    </>
  );
}
