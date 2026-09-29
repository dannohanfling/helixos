import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CapsLine, EntriesBySlot, MacroTiles, MarkKey } from "@/components/body/day-parts";
import { addDays, formatDate, formatDateTime } from "@/lib/dates";
import { MARK_ICON, MARK_WORD } from "@/lib/engine/body";
import { bodyDay, sharedClient } from "@/lib/queries/body";
import { addBodyCommentAction } from "@/lib/actions/body";

export const metadata = { title: "Client's Body" };

/**
 * A coach's read-only view of one client's Body day, plus a comment on the day. Only while the client shares: otherwise this page
 * says it's private and shows nothing else, not even whether there's anything to see. A client whose Body is switched off (rev
 * 195) has no such page at all: a 404.
 */
export default async function CoachClientBodyPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ date?: string }> }) {
  const v = await requireCoach();
  const { clientId } = await params;
  const sp = await searchParams;
  const client = await sharedClient(v, clientId);
  if (!client) notFound();
  if (!client.shared) {
    return (
      <>
        <PageHeader title="Body" action={<Link href={`/coach/${clientId}`} className="btn btn-ghost btn-sm">← Client</Link>} />
        <Card>
          <p className="text-sm text-ink-2" data-testid="coach-body-private">
            🔒 This client&apos;s Body data is private. They can choose to share it with you from their Body settings.
          </p>
        </Card>
      </>
    );
  }
  const today = client.today;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const d = await bodyDay(v.workspace.id, client.userId, date, today);
  if (!d) return null;
  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <>
      <PageHeader
        title={`${client.name.split(" ")[0]}'s Body`}
        subtitle="Shared with you, read-only. You can leave a comment on a day."
        action={
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/coach/${clientId}`} className="btn btn-ghost btn-sm">
              ← Client
            </Link>
            <Link href={`/coach/${clientId}/body?date=${prev}`} className="btn btn-ghost btn-sm" aria-label="Previous day">
              ←
            </Link>
            <span className="font-medium" data-testid="coach-body-date">
              {date === today ? "Today" : formatDate(date, { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <Link href={`/coach/${clientId}/body?date=${next}`} className={`btn btn-ghost btn-sm ${date >= today ? "pointer-events-none opacity-40" : ""}`} aria-label="Next day">
              →
            </Link>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title={d.dayType?.name ?? "No day type"} action={d.worst && d.entries.length ? <Badge tone={d.worst === "in" || d.worst === "over_ok" || d.worst === "open" ? "good" : "warn"}>{MARK_ICON[d.worst]} {d.final ? MARK_WORD[d.worst] : "so far"}</Badge> : null}>
            <MacroTiles totals={d.totals} bands={d.bands} marks={d.marks} />
            <div className="mt-3 space-y-1">
              <CapsLine caps={d.caps} />
              <MarkKey />
            </div>
          </Card>
          <Card title="Eaten">
            <EntriesBySlot entries={d.entries} slots={d.settings.mealSlots} />
          </Card>
        </div>
        <Card title="Comments on this day">
          {d.comments.length ? (
            <ul className="mb-3 space-y-2 text-sm" data-testid="coach-body-comments">
              {d.comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-surface-2 p-2.5">
                  <div className="whitespace-pre-line">{c.text}</div>
                  <div className="mt-1 text-xs text-ink-3">
                    {c.author} · {formatDateTime(c.createdAt.includes("T") ? c.createdAt : `${c.createdAt.replace(" ", "T")}Z`, v.tz)}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <form action={addBodyCommentAction} className="space-y-2">
            <input type="hidden" name="membershipId" value={clientId} />
            <input type="hidden" name="date" value={date} />
            <textarea name="text" rows={3} className="field text-sm" required maxLength={1000} placeholder="A note on this day" data-testid="coach-body-comment" />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…" data-testid="coach-body-comment-send">
              Comment
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
