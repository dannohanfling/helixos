import Link from "next/link";
import { Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime, nowIso } from "@/lib/dates";
import { approveWebinarDraftAction, discardWebinarDraftAction, undoWebinarChangeAction } from "@/lib/actions/webinar-drafts";
import { CONNECTOR_LABEL, historyLine, undoOpen, type DraftRow } from "@/lib/engine/webinar-drafts";
import type { WebinarHistoryRow } from "@/db/schema";

/**
 * Claude's draft of one step (H-181), or of one section's script or slides (PR 2), beside what the webinar says now: each field
 * it sets, now and draft, then Approve, Edit and Discard. Stacked on a phone, side by side from a tablet up.
 */
export function WebinarDraftPanel({ webinarId, step, sectionKey = "", sectionName, draftId, rows, notes, written, tz, editHref }: { webinarId: string; step: string; sectionKey?: string; sectionName?: string; draftId: string; rows: DraftRow[]; notes: string[]; written: string; tz: string; editHref: string }) {
  const hidden = (
    <>
      <input type="hidden" name="webinarId" value={webinarId} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="draftId" value={draftId} />
      {sectionKey ? <input type="hidden" name="section" value={sectionKey} /> : null}
    </>
  );
  return (
    <Card title={`✨ Claude's ${step === "deck" ? "slides" : "draft"}${sectionName ? `: ${sectionName}` : ""}`} className="border-accent/40" id="claude-draft">
      <div data-testid={`claude-draft-${step}`} data-section={sectionKey}>
        <p className="mb-3 text-sm text-ink-2">
          Written {formatDateTime(written, tz)} by {CONNECTOR_LABEL}. Nothing in your webinar has changed. Approve puts it in, Edit opens the form with it filled in, Discard drops it.
          {step === "deck" ? " Each slide's line becomes one of this section's key points; its notes become the script only if the section has none yet." : ""}
        </p>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.key} className="rounded-lg border border-line p-3" data-testid={`draft-row-${r.key}`}>
              <p className="mb-2 text-xs font-semibold text-ink-2">{r.label}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-ink-3">Now</p>
                  <p className="whitespace-pre-line break-words text-sm text-ink-2">{r.now || <span className="italic text-ink-3">empty</span>}</p>
                </div>
                <div className="min-w-0 rounded-md bg-accent/5 p-2">
                  <p className="text-[11px] uppercase tracking-wide text-accent">Claude&apos;s draft</p>
                  <p className="whitespace-pre-line break-words text-sm" data-testid={`draft-value-${r.key}`}>{r.draft}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {notes.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-2" data-testid="draft-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={approveWebinarDraftAction}>
            {hidden}
            <SubmitButton className="btn btn-accent" pendingText="Approving…" data-testid="draft-approve">
              Approve
            </SubmitButton>
          </form>
          <Link href={editHref} className="btn" data-testid="draft-edit">
            Edit
          </Link>
          <form action={discardWebinarDraftAction}>
            {hidden}
            <SubmitButton className="btn btn-ghost" pendingText="Discarding…" data-testid="draft-discard">
              Discard
            </SubmitButton>
          </form>
        </div>
      </div>
    </Card>
  );
}

/** The webinar's history of Claude's drafts, newest first, with Undo for seven days on what can be undone. */
export function WebinarHistory({ webinarId, step, rows, tz }: { webinarId: string; step: string; rows: WebinarHistoryRow[]; tz: string }) {
  if (!rows.length) return null;
  const now = Date.parse(nowIso());
  return (
    <details className="card p-4 sm:p-5" data-testid="webinar-history">
      <summary className="cursor-pointer text-sm font-semibold">History ({rows.length})</summary>
      <ul className="mt-3 divide-y divide-line text-sm">
        {rows.map((h) => {
          const canUndo = !h.undoneAt && ["approved", "drafted", "discarded"].includes(h.action) && undoOpen(h.createdAt, now);
          return (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="history-row" data-action={h.action} data-connector={h.byConnector ? "1" : "0"}>
              <span className={h.undoneAt ? "text-ink-3 line-through" : ""}>
                {historyLine(h)} <span className="text-xs text-ink-3">· {formatDateTime(h.createdAt, tz)}</span>
              </span>
              {canUndo ? (
                <form action={undoWebinarChangeAction}>
                  <input type="hidden" name="webinarId" value={webinarId} />
                  <input type="hidden" name="step" value={step} />
                  <input type="hidden" name="historyId" value={h.id} />
                  <SubmitButton className="btn btn-ghost px-2 py-1 text-xs" pendingText="Undoing…" data-testid="history-undo">
                    Undo
                  </SubmitButton>
                </form>
              ) : h.undoneAt ? (
                <span className="text-xs text-ink-3">undone</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
