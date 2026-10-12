import { cookies, headers } from "next/headers";
import { appUrl } from "@/lib/branded-email";
import { botKeyStatus } from "@/lib/bot-mcp/data";
import { hideBotKeyAction, makeBotKeyAction, revokeBotKeyAction } from "@/lib/actions/bot-connection";
import { BOT_KEY_COOKIE, BOT_TOOLS } from "@/lib/engine/bot-mcp";
import { formatDateTime } from "@/lib/dates";
import { Card } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";

/**
 * Settings → Bot connection (rev 696): the address and key a member's Community Loyalty bot uses to call HelixOS. The key is shown
 * once, then only its last four, with Rotate and Revoke. On a coach's client page it acts for that client (membershipId).
 */
export async function BotConnectionCard({ workspaceId, userId, membershipId, tz, forClient = false }: { workspaceId: string; userId: string; membershipId: string; tz: string; forClient?: boolean }) {
  const status = await botKeyStatus({ workspaceId, userId });
  const raw = (await cookies()).get(BOT_KEY_COOKIE)?.value;
  let shown: string | null = null;
  try {
    const c = raw ? (JSON.parse(raw) as { m?: string; key?: string }) : null;
    if (c?.m === membershipId && typeof c.key === "string") shown = c.key;
  } catch {}
  const host = (await headers()).get("host");
  const url = `${process.env.NODE_ENV === "production" ? appUrl() : `http://${host ?? "localhost:3000"}`}/api/bot-mcp`;
  const who = forClient ? <input type="hidden" name="membershipId" value={membershipId} /> : null;
  return (
    <Card id="bot-connection" title="Bot connection" action={<span className="text-xs text-ink-3" data-testid="bot-key-state">{status ? `key ····${status.last4}` : "no key"}</span>}>
      <p className="mb-3 text-sm text-ink-2">
        Lets {forClient ? "their" : "your"} Community Loyalty bot use HelixOS mid-chat: your offers, FAQ, booking link and next webinar, and add people to DMs or sign them up for the webinar. It
        never sees your numbers, tasks, Proof Bank, other leads or anything private, and it can&apos;t send messages or delete anything.
      </p>
      <dl className="mb-3 grid gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-ink-3">Address</dt>
          <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]" data-testid="bot-url">
            {url}
          </dd>
          <CopyButton text={url} />
        </div>
        <div className="text-xs text-ink-3">
          In Community Loyalty: AI Hub → MCP Servers → add a server with this address and Authentication &quot;Bearer Token&quot;, then the key. Tools: {BOT_TOOLS.join(", ")}.
        </div>
      </dl>
      {shown ? (
        <div className="mb-3 rounded-xl border border-accent bg-accent-soft p-3" data-testid="bot-key-shown">
          <p className="text-sm font-medium">The key, shown this once. Copy it into Community Loyalty now.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]" data-testid="bot-key">
              {shown}
            </code>
            <CopyButton text={shown} />
          </div>
          <form action={hideBotKeyAction} className="mt-2">
            {who}
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="…" data-testid="bot-key-hide">
              I&apos;ve saved it
            </SubmitButton>
          </form>
        </div>
      ) : null}
      {status ? (
        <p className="mb-3 text-xs text-ink-3" data-testid="bot-key-status">
          Key ····{status.last4}, made {formatDateTime(status.createdAt.replace(" ", "T") + (status.createdAt.includes("Z") ? "" : "Z"), tz)}. {status.lastUsedAt ? `Last used ${formatDateTime(status.lastUsedAt, tz)}.` : "Not used yet."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={makeBotKeyAction}>
          {who}
          <SubmitButton className={`btn btn-sm ${status ? "btn-ghost" : "btn-primary"}`} pendingText="Making…" data-testid="bot-key-make">
            {status ? "Rotate the key" : "Make a key"}
          </SubmitButton>
        </form>
        {status ? (
          <form action={revokeBotKeyAction}>
            {who}
            <SubmitButton className="btn btn-ghost btn-sm text-danger" pendingText="Revoking…" data-testid="bot-key-revoke">
              Revoke
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {status ? <p className="mt-2 text-xs text-ink-3">Rotating makes a new key and stops the old one at once; so does Revoke, with no new key.</p> : null}
    </Card>
  );
}
