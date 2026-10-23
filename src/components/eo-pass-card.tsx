import QRCode from "qrcode";
import type { Viewer } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { getMyPassAction } from "@/lib/actions/eo-pass";
import { markPassInstalledAction, sendTestPushAction } from "@/lib/actions/integrations";
import { formatDateTime } from "@/lib/dates";
import { passOffer } from "@/lib/engine/eo-pass";
import { ownProgram, programState } from "@/lib/eo-pass";
import { passWired } from "@/lib/integrations";

/**
 * "My Evolve Omega pass" on Rewards (H-622): the member's pass on the coach's own program. Without one, "Get my pass" creates
 * it (once, on their own press), when the program is ready and, for clients, once the coach has opened it. With one, "Add to
 * wallet" and, on a computer, a QR code of the same link to scan with a phone.
 */
export async function EoPassCard({ v, ready, added, error }: { v: Viewer; ready?: boolean; added?: boolean; error?: string }) {
  const m = v.membership;
  const offer = passOffer({ role: m.role, hasPass: Boolean(m.eoCustomerId || m.eoPassUrl), installed: Boolean(m.eoPassInstalledAt) }, programState(await ownProgram(m.workspaceId)));
  const qr = m.eoPassUrl ? await QRCode.toString(m.eoPassUrl, { type: "svg", margin: 1, width: 132, color: { dark: "#030100", light: "#ffffff" } }) : null;
  const canAct = !v.switchedInto && !v.team;
  return (
    <Card className="mb-4" id="eo-pass" title="🎫 My Evolve Omega pass" action={m.eoPassInstalledAt ? <Badge tone="good">installed</Badge> : m.eoPassUrl ? <Badge tone="accent">ready to add</Badge> : <Badge tone="neutral">coming</Badge>}>
      <div className="flex flex-wrap items-center gap-4" data-testid="eo-pass">
        <div className="min-w-0 flex-1 text-sm">
          {offer.kind === "has" ? (
            <p className="text-ink-2">Your Evolve Omega pass lives in your phone&apos;s wallet. Messages from your coach arrive on it.</p>
          ) : offer.kind === "get" ? (
            <p className="text-ink-2">Your Evolve Omega pass is ready to make: one tap, then add it to Apple Wallet or Google Wallet.</p>
          ) : (
            <p className="text-ink-2" data-testid="eo-pass-closed">{offer.why}</p>
          )}
          {ready ? (
            <p className="mt-1 text-xs text-good" data-testid="eo-pass-made">
              Your pass is made. Add it to your wallet below.
            </p>
          ) : null}
          {added && m.eoPassInstalledAt ? (
            <p className="mt-1 text-xs text-good" data-testid="eo-pass-added">
              Pass added ✓ It&apos;s in your wallet now, and messages from your coach arrive on it.
            </p>
          ) : null}
          {error ? (
            <p className="mt-1 text-xs text-danger" data-testid="eo-pass-error">
              {error.slice(0, 200)}
            </p>
          ) : null}
          {m.eoPassLastPushAt ? <p className="mt-2 text-xs text-ink-3">Last message {formatDateTime(m.eoPassLastPushAt, v.tz)}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {offer.kind === "get" && canAct ? (
            <form action={getMyPassAction}>
              <SubmitButton className="btn btn-accent btn-sm" pendingText="Making your pass…" data-testid="eo-pass-get">
                Get my pass
              </SubmitButton>
            </form>
          ) : null}
          {m.eoPassUrl ? (
            <a href={m.eoPassUrl} target="_blank" rel="noreferrer" className="btn btn-accent min-h-11" data-testid="eo-pass-add">
              Add to wallet ↗
            </a>
          ) : null}
          {m.eoPassUrl && !m.eoPassInstalledAt && canAct ? (
            <form action={markPassInstalledAction}>
              <SubmitButton className="btn btn-soft min-h-11" pendingText="Saving…">I added it</SubmitButton>
            </form>
          ) : null}
          {m.eoPassSerial && passWired("walletpush") ? (
            <form action={sendTestPushAction}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Sending…">Send me a test push</SubmitButton>
            </form>
          ) : null}
          {qr ? (
            <figure className="hidden flex-col items-center gap-1 sm:flex" data-testid="eo-pass-qr">
              <span className="rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />
              <figcaption className="text-[11px] text-ink-3">On a computer? Scan with your phone.</figcaption>
            </figure>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
