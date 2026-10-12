import type { Membership } from "@/db/schema";
import { connectClAction, removeClKeyAction, saveClSettingsAction } from "@/lib/actions/connect";
import { CL_COPY, CL_HELP, CL_NOTICE } from "@/lib/engine/connect-copy";
import { FAQ_BOT_FIELD_DEFAULT } from "@/lib/engine/faq";
import { formatDateTime } from "@/lib/dates";
import { ConnectBox } from "@/components/connect-box";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { Field } from "./ui";

const REMOVE_MESSAGE = "Remove your Community Loyalty key from HelixOS? Ladder replies and FAQ pushes stop until you connect again. The token itself stays in Community Loyalty until you delete it there.";
const OK_NOTICE: Record<string, string> = { ok: "Connected. HelixOS made one tiny test call and your bot answered.", saved: "Saved.", removed: "Key removed from HelixOS." };

/**
 * A member's own Community Loyalty card (rev 850, with rev 849): Danno's steps in the grey box, one key field and Connect. The
 * key is tested before it is kept, and on a refusal nothing is saved and the card says why. Connected: a masked "saved", Replace
 * and check, Remove key, then the agent (a pick from the bot's own list, the FAQ agent by default), the member's contact ID with
 * its format checked, and the FAQ field. The key is never rendered again. Served on Settings and on Connect your tools.
 */
export function ClConnect({ connected, m, agents, notice, back, tz }: { connected: boolean; m: Pick<Membership, "clConnectedAt" | "clAgentNs" | "clUserNs" | "faqBotField">; agents: { ns: string; name: string }[]; notice: string | null; back: "/settings" | "/connect-tools"; tz: string }) {
  const good = notice && OK_NOTICE[notice];
  const bad = notice && !good ? (CL_NOTICE[notice] ?? null) : null;
  return (
    <div className="space-y-3" data-testid={connected ? "cl-connected" : "cl-not-connected"}>
      {good ? (
        <p className="rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="cl-notice">
          {good}
        </p>
      ) : null}
      {bad ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="cl-error">
          {bad}
        </p>
      ) : null}
      {connected ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1 font-semibold text-good" data-testid="cl-connected-badge">
              <span aria-hidden="true">✓</span> Connected
            </span>
            <span className="text-ink-2" data-testid="cl-key-masked">Key •••••••• saved</span>
            {m.clConnectedAt ? <span className="text-ink-3">· checked {formatDateTime(m.clConnectedAt, tz)}</span> : null}
            <form action={removeClKeyAction} className="ml-auto text-xs" data-testid="cl-remove">
              <input type="hidden" name="back" value={back} />
              <ConfirmButton className="text-ink-3 underline" message={REMOVE_MESSAGE} pendingText="Removing…">
                Remove key
              </ConfirmButton>
            </form>
          </div>
          <form action={saveClSettingsAction} className="grid gap-3 text-sm sm:grid-cols-2" data-testid="cl-settings">
            <input type="hidden" name="back" value={back} />
            <Field label="Which agent answers questions?" hint={CL_HELP.agent}>
              {agents.length ? (
                <select className="field" name="clAgentNs" defaultValue={m.clAgentNs ?? ""} data-testid="cl-agent">
                  <option value="">Pick an agent</option>
                  {m.clAgentNs && !agents.some((a) => a.ns === m.clAgentNs) ? <option value={m.clAgentNs}>The saved agent ({m.clAgentNs})</option> : null}
                  {agents.map((a) => (
                    <option key={a.ns} value={a.ns}>
                      {a.name || a.ns}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="field" name="clAgentNs" defaultValue={m.clAgentNs ?? ""} placeholder="ai_agent_ns" data-testid="cl-agent" />
              )}
            </Field>
            <Field label="Your contact ID in your bot" hint={CL_HELP.contact}>
              <input className="field" name="clUserNs" defaultValue={m.clUserNs ?? ""} placeholder="f12345u67890" autoComplete="off" pattern="[A-Za-z0-9_\-]{4,40}" data-testid="cl-contact" />
            </Field>
            <Field label="FAQ field" hint={CL_HELP.faqField}>
              <input className="field" name="faqBotField" defaultValue={m.faqBotField ?? ""} placeholder={FAQ_BOT_FIELD_DEFAULT} data-testid="cl-faq-field" />
            </Field>
            <div className="flex items-end">
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
          <details className="text-sm" data-testid="cl-replace">
            <summary className="cursor-pointer text-ink-3">Replace and check: a new key</summary>
            <KeyForm back={back} label="Replace and check" />
          </details>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-2">{CL_COPY.intro}</p>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <ConnectBox copy={CL_COPY} testId="cl-howto">
              <p className="mt-3 text-xs text-ink-3">{CL_COPY.after}</p>
            </ConnectBox>
            <KeyForm back={back} label="Connect" />
          </div>
        </>
      )}
    </div>
  );
}

function KeyForm({ back, label }: { back: string; label: string }) {
  return (
    <form action={connectClAction} className="mt-2 space-y-3 text-sm" data-testid="cl-key-form">
      <input type="hidden" name="back" value={back} />
      <Field label="Your Community Loyalty key" hint="Stored encrypted. Never shown again.">
        <input className="field" name="clKey" type="password" autoComplete="off" required data-testid="cl-token" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Checking…">
          {label}
        </SubmitButton>
        <span className="text-xs text-ink-3">One tiny test call. Nothing is saved unless it works.</span>
      </div>
    </form>
  );
}
