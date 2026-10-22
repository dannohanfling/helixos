import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime, nowIso } from "@/lib/dates";
import { approveClaudeDraftAction, discardClaudeDraftAction, editNewClaudeDraftAction, undoClaudeChangeAction } from "@/lib/actions/claude-drafts";
import { changeLine, type DraftRow } from "@/lib/engine/claude-drafts";
import { canUndo } from "@/lib/claude-drafts";
import type { ChangeHistoryRow } from "@/db/schema";

/**
 * Claude's draft (H-184), the one look everywhere: an amber outline and tint, the amber label "Claude's draft: not approved
 * yet", the draft's words in the normal colour beside what's there now, and Approve, Edit and Discard. Red only for a problem:
 * a red line says why, and Approve stays off until the draft is edited past it. Stacked on a phone, side by side from a tablet.
 */
export function ClaudeDraftCard({ draft, title, rows, red, tz, editHref, back, open }: { draft: { id: string; byLabel: string; createdAt: string; notes: string[] }; title?: string; rows: DraftRow[]; red: string[]; tz: string; /** Null for a draft of a new row: Edit makes the row first. */ editHref: string | null; back: string; open?: string }) {
  return (
    <section className="rounded-xl border-2 border-accent bg-accent-soft/40 p-4 sm:p-5" data-testid="claude-draft" data-draft={draft.id} data-blocked={red.length ? "1" : "0"}>
      <p className="mb-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink" data-testid="claude-draft-label">
        Claude&apos;s draft: not approved yet
      </p>
      {title ? <h3 className="mt-1 text-base font-semibold">{title}</h3> : null}
      <p className="mb-3 mt-1 text-xs text-ink-2">
        Written {formatDateTime(draft.createdAt, tz)} by {draft.byLabel}. Nothing has changed yet: Approve puts it in, Edit opens the form with it filled in, Discard drops it.
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="rounded-lg border border-line bg-surface p-3" data-testid={`claude-draft-row-${r.key}`}>
            <p className="mb-2 text-xs font-semibold text-ink-2">{r.label}</p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-ink-3">Now</p>
                <p className="whitespace-pre-line break-words text-sm text-ink-2">{r.now || <span className="italic text-ink-3">empty</span>}</p>
              </div>
              <div className="min-w-0 rounded-md border border-accent/40 p-2">
                <p className="text-[11px] uppercase tracking-wide text-accent-ink">Claude&apos;s draft</p>
                <p className="whitespace-pre-line break-words text-sm text-ink" data-testid={`claude-draft-value-${r.key}`}>{r.draft}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      {draft.notes.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-2" data-testid="claude-draft-notes">
          {draft.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {red.length ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="claude-draft-red">
          {red.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={approveClaudeDraftAction}>
          <input type="hidden" name="draftId" value={draft.id} />
          <input type="hidden" name="back" value={back} />
          {open ? <input type="hidden" name="open" value={open} /> : null}
          <SubmitButton className="btn btn-accent" pendingText="Approving…" disabled={red.length > 0} data-testid="claude-draft-approve">
            Approve
          </SubmitButton>
        </form>
        {editHref ? (
          <Link href={editHref} className="btn" data-testid="claude-draft-edit">
            Edit
          </Link>
        ) : (
          <form action={editNewClaudeDraftAction}>
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="back" value={back} />
            <SubmitButton className="btn" pendingText="Opening…" data-testid="claude-draft-edit">
              Edit
            </SubmitButton>
          </form>
        )}
        <form action={discardClaudeDraftAction}>
          <input type="hidden" name="draftId" value={draft.id} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton className="btn btn-ghost" pendingText="Discarding…" data-testid="claude-draft-discard">
            Discard
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

/** What happened to Claude's drafts here, newest first, with Undo for seven days on what can be undone. */
export function ClaudeDraftHistory({ rows, tz, back }: { rows: ChangeHistoryRow[]; tz: string; back: string }) {
  if (!rows.length) return null;
  const now = Date.parse(nowIso());
  return (
    <details className="card p-4 sm:p-5" data-testid="claude-draft-history">
      <summary className="cursor-pointer text-sm font-semibold">Claude&apos;s drafts here ({rows.length})</summary>
      <ul className="mt-3 divide-y divide-line text-sm">
        {rows.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="claude-history-row" data-action={h.action}>
            <span className={h.undoneAt ? "text-ink-3 line-through" : ""}>
              {changeLine(h)} <span className="text-xs text-ink-3">· {formatDateTime(h.createdAt, tz)}</span>
            </span>
            {canUndo(h, now) ? (
              <form action={undoClaudeChangeAction}>
                <input type="hidden" name="historyId" value={h.id} />
                <input type="hidden" name="back" value={back} />
                <SubmitButton className="btn btn-ghost px-2 py-1 text-xs" pendingText="Undoing…" data-testid="claude-history-undo">
                  Undo
                </SubmitButton>
              </form>
            ) : h.undoneAt ? (
              <span className="text-xs text-ink-3">undone</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The line after a button: what happened, or why it didn't. */
export const DRAFT_NOTES: Record<string, string> = { approved: "Claude's draft is in. Undo is under Claude's drafts here, for seven days.", discarded: "Claude's draft was discarded. Undo is under Claude's drafts here, for seven days.", undone: "Undone.", edited: "Saved. Claude's draft is settled as edited." };
