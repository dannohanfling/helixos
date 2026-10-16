"use client";

/**
 * The Handoff inbox's interactive parts: Approve / Change / Decline (Change opens a box for what to change), and an agent's
 * token, shown once when it's made.
 */
import { useActionState, useState } from "react";
import { decideHandoffAction, holdHandoffAction, makeAgentTokenAction, noteDecisionAction, releaseHandoffAction, supersedeHandoffAction, type HandoffFormState } from "@/lib/actions/handoff";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";

export function ApprovalButtons({ id, refLabel }: { id: string; refLabel: string }) {
  const [state, action] = useActionState<HandoffFormState, FormData>(decideHandoffAction, null);
  const [changing, setChanging] = useState(false);
  if (state?.ok) return <p className="text-sm text-good" role="status" data-testid="handoff-decided">{state.ok}</p>;
  return (
    <form action={action} className="mt-2 space-y-2" data-testid="handoff-decide">
      <input type="hidden" name="id" value={id} />
      {changing ? (
        <label className="block text-sm">
          <span className="label">What to change in {refLabel}</span>
          <textarea name="note" className="field min-h-20" required maxLength={4000} data-testid="handoff-change-note" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {changing ? (
          <>
            <SubmitButton className="btn btn-primary btn-sm" name="decision" value="changed" pendingText="Sending…" data-testid="handoff-change-send">
              Send the change
            </SubmitButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <SubmitButton className="btn btn-primary btn-sm" name="decision" value="approved" pendingText="Approving…" data-testid="handoff-approve">
              Approve
            </SubmitButton>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setChanging(true)} data-testid="handoff-change">
              Change
            </button>
            <SubmitButton className="btn btn-ghost btn-sm" name="decision" value="declined" pendingText="Declining…" data-testid="handoff-decline">
              Decline
            </SubmitButton>
          </>
        )}
      </div>
      {state?.error ? <p className="text-sm text-danger" role="alert">{state.error}</p> : null}
    </form>
  );
}

export function AgentTokenButton({ agentId, label }: { agentId: string; label: string }) {
  const [state, action] = useActionState<HandoffFormState, FormData>(makeAgentTokenAction, null);
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="agentId" value={agentId} />
        <SubmitButton className="btn btn-soft btn-sm" pendingText="Making…" data-testid="agent-token-make">
          {label}
        </SubmitButton>
      </form>
      {state?.token ? (
        <div className="rounded-lg border border-warn bg-warn-soft p-3 text-sm" role="status" data-testid="agent-token-shown">
          <p className="font-medium">{state.agent}&apos;s token. Copy it now: it won&apos;t be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded bg-surface px-2 py-1 text-xs" data-testid="agent-token-value">
              {state.token}
            </code>
            <CopyButton text={state.token} label="Copy" className="btn btn-soft btn-xs" />
          </div>
          <p className="mt-2 text-xs text-ink-2">Put it only in that agent&apos;s own environment settings (for a Claude Code session, an environment variable there), sent as Authorization: Bearer. Never in a chat, a repo or a document.</p>
        </div>
      ) : state?.error ? (
        <p className="text-sm text-danger" role="alert">{state.error}</p>
      ) : null}
    </div>
  );
}

const QUICK_NOTES = ["Duplicate", "Replaced by H-__", "Not now"];

/** "Add a note" under a decided message (H-47): one line to the sender, marked from Danno, tied to the decision. */
export function DecisionNote({ id, refLabel }: { id: string; refLabel: string }) {
  const [state, action] = useActionState<HandoffFormState, FormData>(noteDecisionAction, null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (state?.ok) return <p className="mt-1 text-xs text-good" role="status" data-testid="handoff-noted">{state.ok}</p>;
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={() => setOpen(true)} data-testid="handoff-note-open">
        Add a note
      </button>
    );
  return (
    <form action={action} className="mt-2 space-y-2" data-testid="handoff-note">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-1">
        {QUICK_NOTES.map((q) => (
          <button key={q} type="button" className="btn btn-soft btn-xs" onClick={() => setNote(q)} data-testid="handoff-note-quick">
            {q}
          </button>
        ))}
      </div>
      <textarea name="note" className="field min-h-16" required maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`A note on ${refLabel}`} data-testid="handoff-note-text" />
      {state?.error ? <p className="text-sm text-danger" role="alert">{state.error}</p> : null}
      <div className="flex gap-2">
        <SubmitButton className="btn btn-primary btn-xs" pendingText="Sending…" data-testid="handoff-note-send">
          Send the note
        </SubmitButton>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * H-351: Danno's own Hold / Release / Supersede on a post. Hold asks for the one-line reason; Supersede asks for the newer
 * post's H-number. A held or superseded post shows no Approve, and the server refuses a decision on it too.
 */
export function HoldButtons({ refLabel, held, superseded }: { refLabel: string; held: boolean; superseded: boolean }) {
  const [holdState, hold] = useActionState<HandoffFormState, FormData>(holdHandoffAction, null);
  const [releaseState, release] = useActionState<HandoffFormState, FormData>(releaseHandoffAction, null);
  const [supState, supersede] = useActionState<HandoffFormState, FormData>(supersedeHandoffAction, null);
  const [mode, setMode] = useState<"idle" | "hold" | "supersede">("idle");
  const done = holdState?.ok ?? releaseState?.ok ?? supState?.ok;
  const error = holdState?.error ?? releaseState?.error ?? supState?.error;
  if (done) return <p className="mt-1 text-xs text-good" role="status" data-testid="handoff-hold-done">{done}</p>;
  if (superseded) return null;
  return (
    <div className="mt-2 space-y-2 text-xs" data-testid="handoff-hold-controls">
      {mode === "hold" ? (
        <form action={hold} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="ref" value={refLabel} />
          <label className="min-w-0 flex-1">
            <span className="label">Why it&apos;s on hold</span>
            <input name="reason" className="field" required maxLength={200} placeholder="waiting on your H-336 decision" data-testid="handoff-hold-reason" />
          </label>
          <SubmitButton className="btn btn-soft btn-xs" pendingText="Holding…" data-testid="handoff-hold-send">
            Hold it
          </SubmitButton>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      ) : mode === "supersede" ? (
        <form action={supersede} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="ref" value={refLabel} />
          <label>
            <span className="label">Replaced by</span>
            <input name="by" className="field w-28" required maxLength={20} placeholder="H-___" data-testid="handoff-supersede-by" />
          </label>
          <SubmitButton className="btn btn-soft btn-xs" pendingText="Marking…" data-testid="handoff-supersede-send">
            Mark superseded
          </SubmitButton>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {held ? (
            <form action={release}>
              <input type="hidden" name="ref" value={refLabel} />
              <SubmitButton className="btn btn-soft btn-xs" pendingText="Releasing…" data-testid="handoff-release">
                Release the hold
              </SubmitButton>
            </form>
          ) : (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode("hold")} data-testid="handoff-hold">
              Hold
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode("supersede")} data-testid="handoff-supersede">
            Superseded by…
          </button>
        </div>
      )}
      {error ? <p className="text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
