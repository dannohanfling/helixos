import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { visibleRecordings } from "@/lib/recordings";
import { programLine } from "@/lib/engine/recordings";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Recordings" };

/**
 * A member's Recordings (R1): the coaching calls published for them, newest first, each with its title, date, program and a
 * line of the summary. The coach's own view is /coach/recordings; a coach landing here is sent there.
 */
export default async function RecordingsPage() {
  const v = await requireViewer();
  if (v.role === "coach") redirect("/coach/recordings");
  const rows = await visibleRecordings(v.workspace.id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role });
  return (
    <>
      <PageHeader title="Recordings" subtitle={`${rows.length} coaching call${rows.length === 1 ? "" : "s"} from your coach`} />
      {rows.length ? (
        <ul className="space-y-3" data-testid="recordings-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-0">
                    <Link href={`/recordings/${r.id}`} className="font-semibold break-words hover:underline" data-testid="recording-title">
                      {r.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-3">
                      {r.startedAt ? formatDateTime(r.startedAt, v.tz) : "Date unknown"} · <span data-testid="recording-program">{programLine(r.audience)}</span>
                      {r.actionItems.length ? ` · ${r.actionItems.length} action item${r.actionItems.length === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <Badge tone="accent">{programLine(r.audience)}</Badge>
                </div>
                {r.summary ? <p className="mt-2 line-clamp-3 text-sm text-ink-2 break-words">{r.summary.replace(/^#+\s.*$/gm, "").replace(/\*\*/g, "").trim().split("\n").filter(Boolean).slice(0, 3).join(" ")}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/recordings/${r.id}`} className="btn btn-primary btn-sm">Open</Link>
                  {r.shareUrl || r.url ? (
                    <a href={r.shareUrl || r.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                      Watch in Fathom ↗
                    </a>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="🎥" title="No recordings yet" hint="When your coach publishes a call for you, it shows here." />
      )}
    </>
  );
}
