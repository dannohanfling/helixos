import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { audienceOf, clientMembers, workspaceFathom } from "@/lib/recordings";
import { AUDIENCE_LABEL, inviteeMembers } from "@/lib/engine/recordings";
import { prefetchTranscriptAction, publishRecordingAction, setTranscriptHiddenAction, syncRecordingsNowAction, unpublishRecordingAction } from "@/lib/actions/recordings";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Disclosure, PageHeader } from "@/components/ui";
import { RecordingSummary } from "@/components/recording-summary";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata = { title: "Recordings" };

/**
 * The coach's Recordings (R1): every recording of the workspace. Drafts first, each with one-tap publish to an audience
 * (Accelerator and Academy, Academy, or named members, with the members on the call pre-ticked); then the published list with
 * who sees each, Unpublish, Hide transcript and Fetch transcript. Sync now lists Fathom since the last sync. The backfill by
 * time slot is R2.
 */
export default async function CoachRecordingsPage({ searchParams }: { searchParams: Promise<{ synced?: string; error?: string; published?: string; unpublished?: string; fetched?: string }> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [conn, rows, members] = await Promise.all([
    workspaceFathom(v.workspace.id),
    db.query.recordings.findMany({ where: eq(schema.recordings.workspaceId, v.workspace.id), orderBy: [desc(schema.recordings.startedAt), desc(schema.recordings.createdAt)] }),
    clientMembers(v.workspace.id),
  ]);
  const drafts = rows.filter((r) => r.status === "draft");
  const published = rows.filter((r) => r.status === "published");
  const stepCounts = new Map<string, number>();
  if (published.length) {
    const steps = await db.query.recordingSteps.findMany({ where: and(eq(schema.recordingSteps.workspaceId, v.workspace.id), eq(schema.recordingSteps.state, "accepted")) });
    for (const s of steps) stepCounts.set(s.recordingId, (stepCounts.get(s.recordingId) ?? 0) + 1);
  }
  const syncLine = sp.synced ? (() => {
    const [seen, created, pub] = sp.synced!.split("-").map(Number);
    return `Synced: ${seen} listed, ${created} new, ${pub} published by title.`;
  })() : null;
  const tz = v.workspace.timezone;
  const when = (r: schema.Recording) => (r.startedAt ? formatDateTime(r.startedAt, tz) : "Date unknown");

  return (
    <>
      <PageHeader
        title="Recordings"
        subtitle={`${drafts.length} draft${drafts.length === 1 ? "" : "s"} · ${published.length} published`}
        action={
          <span className="flex flex-wrap gap-2">
            {conn && !conn.lastError ? (
              <form action={syncRecordingsNowAction}>
                <input type="hidden" name="from" value="coach" />
                <SubmitButton className="btn btn-accent btn-sm" data-testid="recordings-sync" pendingText="Syncing…">Sync now</SubmitButton>
              </form>
            ) : null}
            <Link href="/integrations#fathom-recordings" className="btn btn-ghost btn-sm">Fathom connection</Link>
            <Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>
          </span>
        }
      />
      {!conn ? (
        <p className="mb-4 rounded-lg border border-warn bg-warn-soft p-3 text-sm" data-testid="recordings-not-connected">
          Fathom isn&apos;t connected for this workspace. <Link href="/integrations#fathom-recordings" className="underline">Connect it on Integrations</Link> with your own key; from then on your calls arrive here.
        </p>
      ) : conn.lastError ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm">
          The Fathom key failed its last check: {conn.lastError} <Link href="/integrations#fathom-recordings" className="underline">Fix it on Integrations</Link>.
        </p>
      ) : !conn.webhookId ? (
        <p className="mb-4 text-sm text-ink-2" data-testid="recordings-no-webhook">
          New calls arrive when you press Sync now. <Link href="/integrations#fathom-recordings" className="underline">Register the webhook</Link> and they arrive on their own.
        </p>
      ) : null}
      {syncLine ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-synced">{syncLine}</p> : null}
      {sp.error ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="recordings-error">{sp.error}</p> : null}
      {sp.published ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-published-notice">Published.</p> : null}
      {sp.unpublished ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-unpublished-notice">Unpublished: members no longer see it.</p> : null}
      {sp.fetched ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-fetched-notice">Transcript fetched and kept: the first member to ask opens it from here.</p> : null}

      <div className="space-y-4">
        <Card title="Drafts: yours until you publish" action={<Badge tone={drafts.length ? "warn" : "neutral"}>{drafts.length}</Badge>}>
          {drafts.length ? (
            <ul className="divide-y" data-testid="recordings-drafts">
              {drafts.map((r) => {
                const onCall = inviteeMembers(r.invitees, members);
                return (
                  <li key={r.id} id={`r-${r.id}`} className="grid gap-3 py-3 text-sm md:grid-cols-[1.3fr_1fr]" data-testid="recording-draft" data-title-match={r.titleMatch}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-words" data-testid="recording-draft-title">{r.title}</span>
                        <Badge tone="neutral">{r.source}</Badge>
                        {r.titleMatch === "close" ? <Badge tone="warn">title didn&apos;t match</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-ink-3">{when(r)}{r.invitees.length ? ` · on the call: ${r.invitees.map((i) => i.name ?? i.email).filter(Boolean).join(", ")}` : ""}</p>
                      {r.note ? <p className="mt-1 text-xs text-warn" data-testid="recording-draft-note">{r.note}</p> : null}
                      {r.summary ? (
                        <Disclosure summary={<span className="text-xs underline">Summary and action items</span>} className="mt-2">
                          <RecordingSummary markdown={r.summary} />
                          {r.actionItems.length ? (
                            <ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
                              {r.actionItems.map((it, i) => (
                                <li key={i}>{it.description}{it.assigneeName ? ` (${it.assigneeName})` : ""}</li>
                              ))}
                            </ul>
                          ) : null}
                        </Disclosure>
                      ) : null}
                      {r.shareUrl || r.url ? (
                        <a href={r.shareUrl || r.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
                          Watch in Fathom ↗
                        </a>
                      ) : null}
                    </div>
                    <form action={publishRecordingAction} className="space-y-2 rounded-lg border p-3" data-testid="recording-publish-form">
                      <input type="hidden" name="recordingId" value={r.id} />
                      <p className="text-xs font-medium">Publish to</p>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="radio" name="audience" value="accelerator_academy" defaultChecked={r.audience === "accelerator_academy"} data-testid="recording-audience-acc" /> {AUDIENCE_LABEL.accelerator_academy} (everyone)
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="radio" name="audience" value="academy" defaultChecked={r.audience === "academy"} data-testid="recording-audience-academy" /> {AUDIENCE_LABEL.academy} (Academy, Elite and Luxe)
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="radio" name="audience" value="members" defaultChecked={!r.audience} data-testid="recording-audience-members" /> Named members (a one-to-one)
                      </label>
                      <div className="ml-5 grid gap-1 sm:grid-cols-2" data-testid="recording-member-picks">
                        {members.map((m) => (
                          <label key={m.userId} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" name="members" value={m.userId} defaultChecked={onCall.includes(m.userId)} data-testid="recording-member" data-on-call={onCall.includes(m.userId) ? "1" : "0"} /> {m.name}
                            {onCall.includes(m.userId) ? <span className="text-ink-3">(on the call)</span> : null}
                          </label>
                        ))}
                      </div>
                      <SubmitButton className="btn btn-primary btn-sm" data-testid="recording-publish" pendingText="Publishing…">Publish</SubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No drafts. Calls titled Evolve Omega Accelerator or Evolve Omega Academy publish themselves; everything else waits here for you.</p>
          )}
        </Card>

        <Card title="Published" action={<Badge tone="good">{published.length}</Badge>}>
          {published.length ? (
            <ul className="divide-y" data-testid="recordings-published">
              {published.map((r) => {
                const audience = audienceOf(r, members);
                return (
                  <li key={r.id} id={`r-${r.id}`} className="py-3 text-sm" data-testid="recording-published" data-audience={r.audience ?? ""}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words" data-testid="recording-published-title">{r.title}</span>
                      <Badge tone="accent">{r.audience ? AUDIENCE_LABEL[r.audience] : "nobody"}</Badge>
                      {r.publishedBy === "title" ? <Badge tone="good">by title</Badge> : null}
                      {r.transcriptHidden ? <Badge tone="warn">transcript hidden</Badge> : null}
                      {r.transcript ? <Badge tone="neutral">transcript kept</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-3" data-testid="recording-published-reach">
                      {when(r)} · reaches {audience.length} member{audience.length === 1 ? "" : "s"}{audience.length ? `: ${audience.map((m) => m.name).join(", ")}` : ""}
                      {stepCounts.get(r.id) ? ` · ${stepCounts.get(r.id)} step${stepCounts.get(r.id) === 1 ? "" : "s"} made tasks` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.shareUrl || r.url ? (
                        <a href={r.shareUrl || r.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-xs">
                          Watch in Fathom ↗
                        </a>
                      ) : null}
                      <form action={setTranscriptHiddenAction}>
                        <input type="hidden" name="recordingId" value={r.id} />
                        <input type="hidden" name="hidden" value={r.transcriptHidden ? "0" : "1"} />
                        <SubmitButton className="btn btn-ghost btn-xs" data-testid="recording-toggle-transcript" pendingText="Saving…">
                          {r.transcriptHidden ? "Show transcript to members" : "Hide transcript"}
                        </SubmitButton>
                      </form>
                      {!r.transcript ? (
                        <form action={prefetchTranscriptAction}>
                          <input type="hidden" name="recordingId" value={r.id} />
                          <SubmitButton className="btn btn-ghost btn-xs" data-testid="recording-prefetch" pendingText="Fetching…">Fetch transcript now</SubmitButton>
                        </form>
                      ) : null}
                      <form action={unpublishRecordingAction}>
                        <input type="hidden" name="recordingId" value={r.id} />
                        <ConfirmButton message="Unpublish this recording? Members stop seeing it; steps already made tasks stay theirs." className="btn btn-ghost btn-xs" pendingText="Unpublishing…">
                          Unpublish
                        </ConfirmButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Nothing published yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
