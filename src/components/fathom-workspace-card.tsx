import Link from "next/link";
import { ConfirmDelete } from "./confirm-delete";
import { ConfirmButton } from "./confirm-button";
import type { Viewer } from "@/lib/auth";
import { workspaceFathom } from "@/lib/recordings";
import { recheckFathomWorkspaceKeyAction, registerFathomWebhookAction, removeFathomWorkspaceAction, saveFathomWorkspaceKeyAction, syncRecordingsNowAction, unregisterFathomWebhookAction } from "@/lib/actions/recordings";
import { formatDateTime } from "@/lib/dates";
import { appUrl } from "@/lib/branded-email";
import { Badge, Card, Field } from "./ui";
import { SubmitButton } from "@/components/submit-button";

/**
 * Integrations: the workspace's Fathom connection for Recordings (R1): the coach's own key, sealed and shown as its last four;
 * Register webhook, which asks Fathom to call HelixOS when a recording is ready; Sync now for the days a webhook was missed; and
 * the switch-on date, from which title matching publishes group calls on its own.
 */
export async function FathomWorkspaceCard({ v, notice, synced }: { v: Viewer; notice?: string; synced?: string }) {
  const conn = await workspaceFathom(v.workspace.id);
  const tz = v.workspace.timezone;
  const message =
    notice === "nokey" ? "Paste the key to connect." : notice === "notconnected" ? "Connect Fathom first." : notice === "badkey" ? "The stored key can't be read any more. Paste it again." : notice?.startsWith("webhook:") ? notice.slice("webhook:".length) : conn?.lastError ?? null;
  const good = notice === "removed" ? "Fathom disconnected. The recordings already here stay." : notice === "webhook-on" ? "Webhook registered: Fathom will send each new recording here." : notice === "webhook-off" ? "Webhook removed." : null;
  const syncLine = synced ? (() => {
    const [seen, created, published] = synced.split("-").map(Number);
    return `Synced: ${seen} listed, ${created} new, ${published} published by title.`;
  })() : null;
  const hook = conn ? `${appUrl()}/api/webhooks/fathom/${conn.id}` : null;
  return (
    <Card
      id="fathom-recordings"
      title="🎥 Fathom (recordings for your members)"
      action={conn && !conn.lastError ? <Badge tone="good">connected · ····{conn.last4}</Badge> : conn ? <Badge tone="danger">key problem</Badge> : <Badge tone="neutral">not connected</Badge>}
    >
      <p className="mb-3 text-sm text-ink-2">
        Your coaching calls, from your own Fathom, shown to your members under Recordings. A call titled <strong>Evolve Omega Accelerator</strong> publishes itself to Accelerator and Academy members; <strong>Evolve Omega Academy</strong> to Academy members (Elite and Luxe see what Academy sees). Every other call lands as a draft for you on{" "}
        <Link href="/coach/recordings" className="underline">Recordings</Link>. Summaries and action items come with the call; a transcript is read only when someone asks for it. This key is yours, for the workspace; the per-member key on Settings stays for the testimonial harvest.
      </p>
      <form action={saveFathomWorkspaceKeyAction} className="space-y-3" data-testid="fathom-ws-form">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Your Fathom API key" hint={conn ? "A key is saved. Paste a new one only to replace it." : "In Fathom: Settings → API keys. Stored encrypted and never shown again."}>
            <input className="field" name="fathomKey" type="password" autoComplete="off" placeholder={conn ? "•••••••• saved" : ""} data-testid="fathom-ws-key" />
          </Field>
          <div className="flex items-end">
            <SubmitButton className="btn btn-primary btn-sm" data-testid="fathom-ws-connect" pendingText="Checking…">
              {conn ? "Replace and check" : "Connect and check"}
            </SubmitButton>
          </div>
        </div>
      </form>
      {message ? (
        <p className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="fathom-ws-error">
          {message}
        </p>
      ) : null}
      {good ? (
        <p className="mt-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="fathom-ws-notice">
          {good}
        </p>
      ) : null}
      {conn ? (
        <div className="mt-3 space-y-3 text-sm" data-testid="fathom-ws-connected">
          <p className="text-xs text-ink-3" data-testid="fathom-ws-enabled">
            Switched on {formatDateTime(conn.enabledAt, tz)}: calls recorded from then on publish by their title. Earlier calls come in as drafts.
            {conn.lastValidatedAt ? ` Key checked ${formatDateTime(conn.lastValidatedAt, tz)}.` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {conn.webhookId ? (
              <>
                <Badge tone="good">webhook registered</Badge>
                <form action={unregisterFathomWebhookAction}>
                  <ConfirmButton message="Remove the webhook at Fathom? New recordings then arrive only when you press Sync now." className="underline" pendingText="Removing…">Remove webhook</ConfirmButton>
                </form>
              </>
            ) : (
              <form action={registerFathomWebhookAction}>
                <SubmitButton className="btn btn-accent btn-sm" data-testid="fathom-ws-register" pendingText="Registering…">Register webhook</SubmitButton>
              </form>
            )}
            <form action={syncRecordingsNowAction}>
              <input type="hidden" name="from" value="integrations" />
              <SubmitButton className="btn btn-ghost btn-sm" data-testid="fathom-ws-sync" pendingText="Syncing…">Sync now</SubmitButton>
            </form>
          </div>
          {hook ? <p className="text-xs text-ink-3">Fathom calls <code className="break-all">{hook}</code>, signed; nothing unsigned is accepted. The URL carries no secret.</p> : null}
          {syncLine ? <p className="rounded-lg bg-good-soft p-2 text-xs" role="status" data-testid="fathom-ws-synced">{syncLine}</p> : null}
          {conn.lastSyncAt ? <p className="text-xs text-ink-3">Last sync {formatDateTime(conn.lastSyncAt, tz)}{conn.lastSyncNote ? `: ${conn.lastSyncNote}` : ""}.</p> : null}
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
            <form action={recheckFathomWorkspaceKeyAction}>
              <SubmitButton className="underline" pendingText="Checking…">Check the key again</SubmitButton>
            </form>
            <form action={removeFathomWorkspaceAction}>
              <ConfirmDelete verb="Disconnect" what="Fathom for this workspace" undo="The recordings already here stay; new ones stop arriving until you connect again." label="Disconnect" className="underline" />
            </form>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
