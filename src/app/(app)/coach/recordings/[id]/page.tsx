import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { reviewContext, reviewOf } from "@/lib/recordings";
import { AUDIENCE_LABEL } from "@/lib/engine/recordings";
import { fewNames, whyLine } from "@/lib/engine/recording-review";
import { publishRecordingAction, restoreRecordingAction, skipRecordingAction } from "@/lib/actions/recordings";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RecordingSummary } from "@/components/recording-summary";
import { SubmitButton } from "@/components/submit-button";
import { MemberPicker } from "@/components/member-picker";

export const metadata = { title: "Review a recording" };

const AUDIENCE_LINE = { accelerator_academy: "Accelerator and Academy (everyone)", academy: "Academy (Academy, Elite and Luxe)", members: "Named members (a one-to-one)" } as const;

/**
 * One call, reviewed (rev 488): what was said and what came of it, a Watch in Fathom link, who was on it folded away and said
 * without a guest's email, and the publish choice: Publish as suggested in one tap, or Change for the full choice with a member
 * search. Skip keeps it out of members' way, recoverable.
 */
export default async function ReviewRecordingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; field?: string }> }) {
  const v = await requireCoach();
  const { id } = await params;
  const sp = await searchParams;
  const r = await db.query.recordings.findFirst({ where: and(eq(schema.recordings.id, id), eq(schema.recordings.workspaceId, v.workspace.id)) });
  if (!r) notFound();
  const rc = await reviewContext(v.workspace.id);
  const { group, onCall, suggestion, clearTitle, attendees, minutes } = reviewOf(r, rc);
  const nameOf = new Map(rc.members.map((m) => [m.userId, m.name]));
  const suggestedWho = suggestion ? (suggestion.audience === "members" ? fewNames(suggestion.userIds.map((u) => nameOf.get(u) ?? "a member"), 5) : AUDIENCE_LABEL[suggestion.audience]) : null;
  const ready = Boolean(suggestion && (suggestion.audience !== "members" || suggestion.userIds.length));
  const picked = suggestion?.audience ?? (onCall.length ? "members" : null);

  return (
    <>
      <PageHeader title={clearTitle ?? r.title} subtitle={`${clearTitle ? `In Fathom: ${r.title} · ` : ""}${group.label} · ${r.startedAt ? formatDateTime(r.startedAt, v.workspace.timezone) : "Date unknown"}${minutes ? ` · ${minutes} min` : ""} · ${r.source}`} action={<Link href="/coach/recordings" className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.error ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="review-error">{sp.error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="What was said">
          <div className="space-y-3 text-sm">
            {r.shareUrl || r.url ? (
              <a href={r.shareUrl || r.url} target="_blank" rel="noreferrer" className="inline-block text-xs underline" data-testid="review-watch">
                Watch in Fathom ↗
              </a>
            ) : null}
            <details data-testid="review-attendees">
              <summary className="cursor-pointer text-xs text-ink-2" data-testid="review-attendees-line">{attendees.line}</summary>
              <div className="mt-2 text-xs text-ink-2">
                {attendees.memberNames.length ? <p>Members: {attendees.memberNames.join(", ")}</p> : <p>No members on this call.</p>}
                {attendees.guests ? <p className="mt-1">{attendees.guests} guest{attendees.guests === 1 ? "" : "s"}, not members of this workspace.</p> : null}
              </div>
            </details>
            {r.summary ? <RecordingSummary markdown={r.summary} /> : <p className="text-ink-3">Fathom hasn&apos;t sent a summary for this call.</p>}
            {r.actionItems.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-2">Action items</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
                  {r.actionItems.map((it, i) => (
                    <li key={i}>{it.description}{it.assigneeName ? ` (${it.assigneeName})` : ""}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {r.note ? <p className="text-xs text-warn">{r.note}</p> : null}
          </div>
        </Card>

        <Card title={r.status === "published" ? "Published" : r.status === "skipped" ? "Skipped" : "Publish"}>
          {r.status === "published" ? (
            <p className="text-sm" data-testid="review-published">
              Published to {r.audience ? AUDIENCE_LABEL[r.audience] : "nobody"}. <Link href="/coach/recordings?tab=published" className="underline">See it under Published</Link>.
            </p>
          ) : r.status === "skipped" ? (
            <form action={restoreRecordingAction} className="space-y-2 text-sm">
              <input type="hidden" name="recordingId" value={r.id} />
              <p>Skipped: members don&apos;t see it, and it stays in Fathom.</p>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Restoring…" data-testid="review-restore">Back to review</SubmitButton>
            </form>
          ) : (
            <div className="space-y-4 text-sm">
              {ready && suggestion ? (
                <form action={publishRecordingAction} className="space-y-2 rounded-lg border p-3" data-testid="review-suggested">
                  <input type="hidden" name="recordingId" value={r.id} />
                  <input type="hidden" name="from" value="review" />
                  <input type="hidden" name="audience" value={suggestion.audience} />
                  {suggestion.userIds.map((u) => (
                    <input key={u} type="hidden" name="members" value={u} />
                  ))}
                  <p>
                    Suggested: <strong data-testid="review-suggested-who">{suggestedWho}</strong>
                  </p>
                  <p className="text-xs text-ink-3" data-testid="review-why">{whyLine(suggestion)}{clearTitle && !r.clearTitle ? ` Publishing names it "${clearTitle}".` : ""}</p>
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Publishing…" data-testid="review-publish-suggested">Publish as suggested</SubmitButton>
                </form>
              ) : (
                <p className="rounded-lg bg-warn-soft p-2 text-xs" data-testid="review-no-suggestion">Nothing to suggest for this one: choose who it&apos;s for below.</p>
              )}
              <details open={!ready || Boolean(sp.error)} data-testid="review-change">
                <summary className="cursor-pointer text-xs underline">{ready ? "Change" : "Choose who it's for"}</summary>
                <form action={publishRecordingAction} className="mt-2 space-y-2" data-testid="recording-publish-form">
                  <input type="hidden" name="recordingId" value={r.id} />
                  <input type="hidden" name="from" value="review" />
                  {(["accelerator_academy", "academy", "members"] as const).map((a) => (
                    <label key={a} className="flex items-center gap-2 text-xs">
                      <input type="radio" name="audience" value={a} defaultChecked={picked === a} data-testid={`recording-audience-${a}`} /> {AUDIENCE_LINE[a]}
                    </label>
                  ))}
                  <div className="ml-5">
                    <MemberPicker members={rc.members.map((m) => ({ userId: m.userId, name: m.name }))} ticked={suggestion?.audience === "members" ? suggestion.userIds : onCall} onCall={onCall} />
                  </div>
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Publishing…" data-testid="recording-publish">Publish</SubmitButton>
                </form>
              </details>
              <form action={skipRecordingAction} className="border-t pt-3">
                <input type="hidden" name="recordingId" value={r.id} />
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Skipping…" data-testid="review-skip">Skip: not for members</SubmitButton>
                <p className="mt-1 text-xs text-ink-3">Kept under Skipped, never deleted from Fathom.</p>
              </form>
              <Badge tone="neutral">{onCall.length} member{onCall.length === 1 ? "" : "s"} on the call</Badge>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
