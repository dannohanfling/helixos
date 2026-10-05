import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { seenIds, visibleRecordings } from "@/lib/recordings";
import { weekHeading } from "@/lib/engine/recording-members";
import { markAllSeenAction } from "@/lib/actions/recordings";
import { SubmitButton } from "@/components/submit-button";
import { programLine, shownTitle } from "@/lib/engine/recordings";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Recordings" };

/**
 * A member's Recordings (R1; rev 498): the coaching calls published for them, newest first under week headings, each with its
 * title, date, program, a line of the summary and a yellow dot until they open it or press Watch in Fathom; Mark all as seen. The coach's own view is /coach/recordings; a coach landing here is sent there.
 */
export default async function RecordingsPage({ searchParams }: { searchParams: Promise<{ seen?: string }> }) {
  const v = await requireViewer();
  if (v.role === "coach") redirect("/coach/recordings");
  const sp = await searchParams;
  const rows = await visibleRecordings(v.workspace.id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role });
  const seen = await seenIds(v.user.id, rows.map((r) => r.id));
  const fresh = rows.filter((r) => !seen.has(r.id)).length;
  // Newest first by the call's own date (rev 498), under "This week", "Last week", then the week's Monday.
  const weeks: { heading: string; items: typeof rows }[] = [];
  for (const r of rows) {
    const heading = weekHeading(r.startedAt ?? r.createdAt, v.tz);
    const last = weeks[weeks.length - 1];
    if (last?.heading === heading) last.items.push(r);
    else weeks.push({ heading, items: [r] });
  }
  return (
    <>
      <PageHeader
        title="Recordings"
        subtitle={`${rows.length} coaching call${rows.length === 1 ? "" : "s"} from your coach${fresh ? ` · ${fresh} new` : ""}`}
        action={
          fresh && !v.switchedInto ? (
            <form action={markAllSeenAction}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Marking…" data-testid="recordings-mark-all">
                Mark all as seen
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      {sp.seen ? (
        <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="recordings-seen-notice">
          All caught up.
        </p>
      ) : null}
      {rows.length ? (
        <div className="space-y-5" data-testid="recordings-list">
          {weeks.map((w) => (
            <section key={w.heading} data-testid="recordings-week">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{w.heading}</h2>
              <ul className="space-y-3">
                {w.items.map((r) => (
                  <li key={r.id} data-testid="recording-row" data-new={seen.has(r.id) ? "no" : "yes"}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 basis-0">
                          <span className="flex items-center gap-2">
                            {!seen.has(r.id) ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label="New, not opened yet" title="New" data-testid="recording-new" /> : null}
                            <Link href={`/recordings/${r.id}`} className="font-semibold break-words hover:underline" data-testid="recording-title">
                              {shownTitle(r)}
                            </Link>
                          </span>
                          <p className="mt-1 text-xs text-ink-3">
                            {r.startedAt ? formatDateTime(r.startedAt, v.tz) : "Date unknown"} · <span data-testid="recording-program">{programLine(r.audience)}</span>
                            {r.actionItems.length ? ` · ${r.actionItems.length} action item${r.actionItems.length === 1 ? "" : "s"}` : ""}
                          </p>
                        </div>
                        <Badge tone="accent">{programLine(r.audience)}</Badge>
                      </div>
                      {r.summary ? <p className="mt-2 line-clamp-3 text-sm text-ink-2 break-words">{r.summary.replace(/^#+\s.*$/gm, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim().split("\n").filter(Boolean).slice(0, 3).join(" ")}</p> : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link href={`/recordings/${r.id}`} className="btn btn-primary btn-sm">Open</Link>
                        {r.shareUrl || r.url ? (
                          <a href={`/recordings/${r.id}/watch`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" data-testid="recording-row-watch">
                            Watch in Fathom ↗
                          </a>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty icon="🎥" title="No recordings yet" hint="When your coach publishes a call for you, it shows here." />
      )}
    </>
  );
}
