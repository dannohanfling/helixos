"use client";

/**
 * The Handoff inbox's interactive parts: Approve / Change / Decline (Change opens a box for what to change), and an agent's
 * token, shown once when it's made.
 */
import { useActionState, useState } from "react";
import { decideHandoffAction, makeAgentTokenAction, type HandoffFormState } from "@/lib/actions/handoff";
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
