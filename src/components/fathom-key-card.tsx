import type { Viewer } from "@/lib/auth";
import { fathomConnectionFor } from "@/lib/fathom";
import { recheckFathomKeyAction, removeFathomKeyAction, saveFathomKeyAction } from "@/lib/actions/fathom";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Field } from "./ui";

/** Settings: the member's own Fathom API key, and tick one, the acknowledgement that the recordings hold other people's words. */
export async function FathomKeyCard({ v, notice }: { v: Viewer; notice?: string }) {
  const conn = await fathomConnectionFor(v.workspace.id, v.user.id);
  const consentAt = v.membership.fathomConsentAt;
  const message = notice === "consent" ? "Tick the line about your clients' recordings to connect." : notice === "nokey" ? "Paste the key to connect." : conn?.lastError ?? null;
  return (
    <Card
      id="fathom"
      title="🎙️ Fathom (your own API key)"
      action={conn && !conn.lastError ? <Badge tone="good">connected · ····{conn.last4}</Badge> : conn ? <Badge tone="danger">key problem</Badge> : <Badge tone="neutral">not connected</Badge>}
    >
      <p className="mb-3 text-sm text-ink-2">Pull testimonials out of your own recorded calls. HelixOS lists your recordings and reads one only when you pick it; nothing is read on its own. In Fathom, open Settings → API keys, create a key, and paste it here. It is stored encrypted and never shown again.</p>
      <form action={saveFathomKeyAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="API key" hint={conn ? "A key is saved. Paste a new one only to replace it." : undefined}>
            <input className="field" name="fathomKey" type="password" autoComplete="off" placeholder={conn ? "•••••••• saved" : ""} data-testid="fathom-key" />
          </Field>
          <div className="flex items-end">
            <button className="btn btn-primary btn-sm" type="submit" data-testid="fathom-connect">
              {conn ? "Replace and check" : "Connect and check"}
            </button>
          </div>
        </div>
        {consentAt ? (
          <p className="text-xs text-ink-3" data-testid="fathom-consent-date">Acknowledged {formatDateTime(consentAt, v.tz)}: these are my clients&apos; recordings, and it&apos;s my responsibility to have their permission before I use anything from them.</p>
        ) : (
          <label className="flex items-start gap-2 text-sm" data-testid="fathom-consent">
            <input type="checkbox" name="consent" className="mt-1" />
            <span>These are my clients&apos; recordings. Anything I take from them is someone else&apos;s words, and it&apos;s my responsibility to have their permission before I use it anywhere.</span>
          </label>
        )}
      </form>
      {message ? (
        <p className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="fathom-error">
          {message}
        </p>
      ) : null}
      {conn ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-3">
          {conn.lastValidatedAt ? <span>Checked {formatDateTime(conn.lastValidatedAt, v.tz)}</span> : null}
          <form action={recheckFathomKeyAction}>
            <button className="underline" type="submit">Check again</button>
          </form>
          <form action={removeFathomKeyAction}>
            <button className="underline" type="submit">Remove key</button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
