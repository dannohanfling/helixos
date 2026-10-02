import { deleteCheckinAction, sendCheckinAction } from "@/lib/actions/body";
import { SubmitButton } from "@/components/submit-button";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { BodyCheckin } from "@/db/schema";

/**
 * "Send this week to your coach" (B9b): the week's numbers as lines plus one note, sent even with sharing off. What was sent shows
 * as sent, with Delete; sending again replaces it. Never a food, a note from a day, a photo or the health log.
 */
export function CheckinCard({ monday, sent, justSent, lines }: { monday: string; sent: BodyCheckin | null; justSent: boolean; lines: string[] }) {
  return (
    <Card className="mb-4" title="Send this week to your coach" id="checkin">
      <p className="mb-2 text-xs text-ink-3">Only these numbers and your note go, as a snapshot, whether or not your coach can see your days. Delete takes it back for them too.</p>
      {justSent ? (
        <p className="mb-2 text-xs text-good" role="status" data-testid="checkin-just-sent">
          Sent.
        </p>
      ) : null}
      {sent ? (
        <div className="mb-3 rounded-lg border p-3 text-sm" data-testid="checkin-sent" data-monday={sent.monday}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-3">Sent {formatDate(sent.sentAt.slice(0, 10), { month: "short", day: "numeric" })} for the week of {formatDate(sent.monday, { month: "short", day: "numeric" })}</span>
            <form action={deleteCheckinAction}>
              <input type="hidden" name="id" value={sent.id} />
              <SubmitButton className="btn btn-ghost btn-xs text-ink-3 hover:text-danger" pendingText="…" data-testid="checkin-delete">
                Delete
              </SubmitButton>
            </form>
          </div>
          <ul className="space-y-0.5 text-xs text-ink-2">
            {sent.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {sent.note ? <p className="mt-2 text-sm break-words" data-testid="checkin-note">&ldquo;{sent.note}&rdquo;</p> : null}
        </div>
      ) : null}
      <details data-testid="checkin-fold">
        <summary className="cursor-pointer text-sm font-medium">{sent ? "Send it again" : "What goes"}</summary>
        <ul className="mt-2 space-y-0.5 text-xs text-ink-2" data-testid="checkin-preview">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <form action={sendCheckinAction} className="mt-3 flex flex-col gap-2" data-testid="checkin-form">
          <input type="hidden" name="monday" value={monday} />
          <label>
            <span className="label">One note, in your words (optional)</span>
            <textarea name="note" className="field" rows={2} maxLength={500} defaultValue={sent?.note ?? ""} placeholder="How the week went, what you want your coach to know." data-testid="checkin-note-input" />
          </label>
          <SubmitButton className="btn btn-humanos btn-sm self-start" pendingText="Sending…" data-testid="checkin-send">
            {sent ? "Send again" : "Send to my coach"}
          </SubmitButton>
        </form>
      </details>
    </Card>
  );
}
