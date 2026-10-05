import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { BY_RULES, audienceOf, reviewContext, reviewOf, workspaceFathom } from "@/lib/recordings";
import { AUDIENCE_LABEL, shownTitle } from "@/lib/engine/recordings";
import { fewNames, type Group } from "@/lib/engine/recording-review";
import { bulkRecordingsAction, prefetchTranscriptAction, restoreRecordingAction, setTranscriptHiddenAction, syncRecordingsNowAction, unpublishRecordingAction } from "@/lib/actions/recordings";
import { addDays, formatDateTime } from "@/lib/dates";
import { Badge, Card, PageHeader, Tabs } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata = { title: "Recordings" };

/**
 * The coach's Recordings (R1; the review list, rev 488; Danno's rules, rev 491). To review: one compact row per call, grouped by
 * the coach's series and time slots (Publishing rules) with a count,
 * newest first, each with its date, length, how many were on it, which members (names only, never a guest's email), where it
 * came from, the suggested audience and Review; tick several to Publish as suggested or Skip. Calls with nobody but the coach
 * on them wait folded under "Just you". Published lists who sees each, with Unpublish, Hide transcript and Fetch transcript;
 * Skipped keeps what isn't for members, recoverable. Sync now lists Fathom since the last sync.
 */
type Sp = { synced?: string; error?: string; published?: string; unpublished?: string; fetched?: string; skipped?: string; restored?: string; bulk?: string; tab?: string; series?: string; range?: string; members?: string };
const RANGES: Record<string, { label: string; days: number | null }> = { "7": { label: "Last 7 days", days: 7 }, "30": { label: "Last 30 days", days: 30 }, all: { label: "All", days: null } };

export default async function CoachRecordingsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [conn, rows, rc] = await Promise.all([
    workspaceFathom(v.workspace.id),
    db.query.recordings.findMany({ where: eq(schema.recordings.workspaceId, v.workspace.id), orderBy: [desc(schema.recordings.startedAt), desc(schema.recordings.createdAt)] }),
    reviewContext(v.workspace.id),
  ]);
  const members = rc.members;
  const drafts = rows.filter((r) => r.status === "draft");
  const published = rows.filter((r) => r.status === "published");
  const skipped = rows.filter((r) => r.status === "skipped");
  const tab = sp.tab === "published" || sp.tab === "skipped" ? sp.tab : "review";
  const stepCounts = new Map<string, number>();
  if (published.length) {
    const steps = await db.query.recordingSteps.findMany({ where: and(eq(schema.recordingSteps.workspaceId, v.workspace.id), eq(schema.recordingSteps.state, "accepted")) });
    for (const s of steps) stepCounts.set(s.recordingId, (stepCounts.get(s.recordingId) ?? 0) + 1);
  }
  const syncLine = sp.synced ? (() => {
    const [seen, created, pub] = sp.synced!.split("-").map(Number);
    return `Synced: ${seen} listed, ${created} new, ${pub} published by your rules.`;
  })() : null;
  const bulkLine = sp.bulk ? (() => {
    const [what, done, left] = sp.bulk!.split("-");
    if (what === "skip") return `Skipped ${done}. They're under Skipped if you need one back.`;
    return `Published ${done} as suggested.${Number(left) ? ` ${left} had no suggestion: open each with Review and choose who it's for.` : ""}`;
  })() : null;
  const tz = v.workspace.timezone;
  const when = (r: schema.Recording) => (r.startedAt ? formatDateTime(r.startedAt, tz) : "Date unknown");

  // To review, read once: series, members on the call, the suggestion. Filtered by series, date range and "has members on it".
  const range = RANGES[sp.range ?? "all"] ?? RANGES.all;
  const since = range.days ? addDays(v.today, -range.days) : null;
  const reviewed = drafts.map((r) => ({ r, ...reviewOf(r, rc) }));
  const allGroups = [...new Map(reviewed.map((x) => [x.group.key, x.group] as const)).values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const shown = reviewed.filter((x) => (!sp.series || x.group.key === sp.series) && (!since || (x.r.startedAt ?? x.r.createdAt) >= since) && (sp.members !== "1" || x.onCall.length > 0));
  const groups: { group: Group; items: typeof shown }[] = allGroups.map((g) => ({ group: g, items: shown.filter((x) => x.group.key === g.key) })).filter((g) => g.items.length);
  const qs = (patch: Partial<Sp>) => {
    const q = new URLSearchParams();
    const next = { series: sp.series, range: sp.range, members: sp.members, ...patch };
    for (const [k, val] of Object.entries(next)) if (val) q.set(k, val);
    const s = q.toString();
    return `/coach/recordings${s ? `?${s}` : ""}`;
  };
  const chip = (href: string, on: boolean, label: string, testid?: string) => (
    <Link key={href + label} href={href} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft font-medium" : "text-ink-2 hover:bg-surface-2"}`} aria-current={on ? "true" : undefined} data-testid={testid}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Recordings"
        subtitle={`${drafts.length} to review · ${published.length} published · ${skipped.length} skipped`}
        action={
          <span className="flex flex-wrap gap-2">
            {conn && !conn.lastError ? (
              <form action={syncRecordingsNowAction}>
                <input type="hidden" name="from" value="coach" />
                <SubmitButton className="btn btn-accent btn-sm" data-testid="recordings-sync" pendingText="Syncing…">Sync now</SubmitButton>
              </form>
            ) : null}
            <Link href="/coach/recordings/rules" className="btn btn-ghost btn-sm" data-testid="recordings-rules">Publishing rules</Link>
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
      {sp.skipped ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-skipped-notice">Skipped. It&apos;s under Skipped if you need it back.</p> : null}
      {sp.restored ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-restored-notice">Back in To review.</p> : null}
      {bulkLine ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-bulk-notice">{bulkLine}</p> : null}

      <Tabs
        current={tab}
        items={[
          { key: "review", label: "To review", href: "/coach/recordings", count: drafts.length },
          { key: "published", label: "Published", href: "/coach/recordings?tab=published", count: published.length },
          { key: "skipped", label: "Skipped", href: "/coach/recordings?tab=skipped", count: skipped.length },
        ]}
      />
      <div className="mt-4 space-y-4">
        {tab === "review" ? (
          <Card title="To review" action={<Badge tone={drafts.length ? "warn" : "neutral"}>{drafts.length}</Badge>}>
            <div className="mb-3 space-y-2" data-testid="recordings-filters">
              <div className="flex flex-wrap gap-1.5">
                {chip(qs({ series: undefined }), !sp.series, "All series")}
                {allGroups.map((g) => chip(qs({ series: g.key }), sp.series === g.key, g.label, `filter-series-${g.key}`))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(RANGES).map(([k, rg]) => chip(qs({ range: k === "all" ? undefined : k }), (sp.range ?? "all") === k, rg.label))}
                {chip(qs({ members: sp.members === "1" ? undefined : "1" }), sp.members === "1", "Has members on it", "filter-members")}
              </div>
            </div>
            {shown.length ? (
              <form action={bulkRecordingsAction} data-testid="recordings-drafts">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-ink-3">Ticked:</span>
                  <SubmitButton className="btn btn-primary btn-xs" name="bulk" value="publish" pendingText="Publishing…" data-testid="bulk-publish">Publish as suggested</SubmitButton>
                  <SubmitButton className="btn btn-ghost btn-xs" name="bulk" value="skip" pendingText="Skipping…" data-testid="bulk-skip">Skip</SubmitButton>
                </div>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <details key={g.group.key} open={g.group.key !== "just_you"} className="rounded-lg border" data-testid="recording-group" data-series={g.group.key}>
                      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
                        <span>{g.group.label}</span>
                        <Badge tone="neutral">{g.items.length}</Badge>
                      </summary>
                      <ul className="divide-y border-t">
                        {g.items.map(({ r, attendees, minutes, suggestion, clearTitle }) => (
                          <li key={r.id} id={`r-${r.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-testid="recording-draft" data-title-match={r.titleMatch} data-suggested={suggestion?.audience ?? ""}>
                            <input type="checkbox" name="ids" value={r.id} className="mt-1" aria-label={`Tick ${clearTitle ?? r.title}`} data-testid="recording-tick" />
                            <div className="min-w-0 flex-1 basis-56">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-medium break-words" data-testid="recording-draft-title">{clearTitle ?? r.title}</span>
                              </div>
                              {clearTitle ? <p className="text-xs text-ink-3 break-words" data-testid="recording-fathom-title">In Fathom: {r.title}</p> : null}
                              <p className="mt-0.5 text-xs text-ink-3" data-testid="recording-draft-meta">
                                {when(r)}
                                {minutes ? ` · ${minutes} min` : ""} · {attendees.people} on the call
                                {attendees.memberNames.length ? ` · ${fewNames(attendees.memberNames)}` : ""} · {r.source}
                              </p>
                              <p className="mt-0.5 text-xs" data-testid="recording-draft-suggestion">
                                {suggestion ? <span className="text-ink-2">Suggested: {suggestion.audience === "members" ? fewNames(members.filter((m) => suggestion.userIds.includes(m.userId)).map((m) => m.name)) : AUDIENCE_LABEL[suggestion.audience]}</span> : <span className="text-warn">Needs you to choose who it&apos;s for</span>}
                              </p>
                              {r.note ? <p className="mt-0.5 text-xs text-warn" data-testid="recording-draft-note">{r.note}</p> : null}
                            </div>
                            <Link href={`/coach/recordings/${r.id}`} className="btn btn-ghost btn-xs shrink-0" data-testid="recording-review">
                              Review
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </form>
            ) : drafts.length ? (
              <p className="text-sm text-ink-3" data-testid="recordings-filtered-empty">Nothing matches these filters. <Link href="/coach/recordings" className="underline">Show all</Link>.</p>
            ) : (
              <p className="text-sm text-ink-3">Nothing to review. Calls your <Link href="/coach/recordings/rules" className="underline">publishing rules</Link> place publish themselves; everything else waits here for you.</p>
            )}
          </Card>
        ) : null}

        {tab === "skipped" ? (
          <Card title="Skipped: not for members" action={<Badge tone="neutral">{skipped.length}</Badge>}>
            {skipped.length ? (
              <ul className="divide-y" data-testid="recordings-skipped">
                {skipped.map((r) => (
                  <li key={r.id} id={`r-${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-testid="recording-skipped">
                    <div className="min-w-0 flex-1 basis-56">
                      <span className="font-medium break-words">{shownTitle(r)}</span>
                      <p className="text-xs text-ink-3">{when(r)}</p>
                    </div>
                    <form action={restoreRecordingAction}>
                      <input type="hidden" name="recordingId" value={r.id} />
                      <SubmitButton className="btn btn-ghost btn-xs" pendingText="Restoring…" data-testid="recording-restore">Back to review</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Nothing skipped. Skipping keeps a call here, never deletes it from Fathom.</p>
            )}
          </Card>
        ) : null}

        {tab === "published" ? (
        <Card title="Published" action={<Badge tone="good">{published.length}</Badge>}>
          {published.length ? (
            <ul className="divide-y" data-testid="recordings-published">
              {published.map((r) => {
                const audience = audienceOf(r, members);
                return (
                  <li key={r.id} id={`r-${r.id}`} className="py-3 text-sm" data-testid="recording-published" data-audience={r.audience ?? ""}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words" data-testid="recording-published-title">{shownTitle(r)}</span>
                      <Badge tone="accent">{r.audience ? AUDIENCE_LABEL[r.audience] : "nobody"}</Badge>
                      {BY_RULES.has(r.publishedBy ?? "") ? <Badge tone="good">by your rules</Badge> : null}
                      {r.transcriptHidden ? <Badge tone="warn">transcript hidden</Badge> : null}
                      {r.transcript ? <Badge tone="neutral">transcript kept</Badge> : null}
                    </div>
                    {r.clearTitle ? <p className="text-xs text-ink-3 break-words">In Fathom: {r.title}</p> : null}
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
        ) : null}
      </div>
    </>
  );
}
