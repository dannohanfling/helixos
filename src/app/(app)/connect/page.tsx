import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { SCOPE_WORDS } from "@/lib/engine/mcp";
import { issuerFor, resourceFor } from "@/lib/mcp/oauth";
import { formatDateTime, stampDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Connect HelixOS to Claude" };

/** Claude's own connectors page (H-187): opened in a new tab from step 2. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/** "Try saying" (H-187): six lines a member can say or type once connected. */
export const TRY_SAYING = ["What's on my plate today?", "Lock in my day: call Jess, post the ladder, energy Bright.", "Add a task: send the replay to Sam by Friday.", "Draft an offer for nutrition coaches.", "Write a ladder for my Tuesday post.", "Close my day: 12 DMs, 2 calls booked, $500 collected."];

/**
 * Connect HelixOS to Claude (H-187, replacing the three steps of rev 224): Claude's current menu names, eight numbered steps,
 * the address with a big Copy, a live "Connected ✓" line from the same connected-apps list as Settings, the phone note, the
 * free-account note, six "Try saying" chips, and what each area means, folded. Nothing here is a key.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  const { error } = await searchParams;
  const h = await headers();
  const url = resourceFor(issuerFor(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`));
  const closed = v.role === "client" && !v.workspace.connectedAppsOpen;
  const apps = await db.query.connectedApps.findMany({ where: and(eq(schema.connectedApps.workspaceId, v.workspace.id), eq(schema.connectedApps.userId, v.user.id), isNull(schema.connectedApps.revokedAt)), orderBy: desc(schema.connectedApps.createdAt) });
  const latest = apps[0] ?? null;
  const step = (n: number, text: React.ReactNode, aside?: React.ReactNode) => (
    <li key={n} className="flex gap-3" data-testid="connect-step">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-surface">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block">{text}</span>
        {aside ? <span className="mt-1 block text-xs text-ink-3">{aside}</span> : null}
      </span>
    </li>
  );
  return (
    <>
      <PageHeader title="Connect HelixOS to Claude" subtitle="About 2 minutes, on a computer. Then Claude can read and write your own HelixOS, acting only as you." />
      {error === "stale" ? <p className="mb-3 text-sm text-danger">That connection request was out of date. Start it again from Claude.</p> : null}
      {error === "closed" || closed ? (
        <p className="mb-3 text-sm text-warn" data-testid="connect-closed">Your coach hasn&apos;t opened connected apps to clients yet. Ask them, and come back.</p>
      ) : null}
      <p className={`mb-4 rounded-lg px-3 py-2 text-sm font-medium ${latest ? "bg-good-soft" : "bg-surface-2 text-ink-2"}`} data-testid="connect-status" data-connected={latest ? "1" : "0"}>
        {latest
          ? `Connected ✓ on ${stampDate(latest.createdAt, v.tz, { month: "short", day: "numeric" })}${latest.lastUsedAt ? `, last used ${formatDateTime(latest.lastUsedAt, v.tz)}` : ", not used yet"}.`
          : "Not connected yet."}{" "}
        {latest ? (
          <Link href="/settings?tab=connections#connected-apps" className="font-normal underline">Settings → Connected apps</Link>
        ) : null}
      </p>
      <Card title="Connect HelixOS to Claude">
        <ol className="space-y-3 text-sm" data-testid="connect-steps">
          {step(1, <>Open <b>claude.ai</b> on a computer and sign in.</>, "Easiest on a computer. It then works on your phone too.")}
          {step(
            2,
            <>
              Click <b>Customize</b>, then <b>Connectors</b>.{" "}
              <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer" className="btn btn-soft btn-xs" data-testid="connect-open-claude">
                Open Claude connectors ↗
              </a>
            </>,
          )}
          {step(3, <>Click <b>+ Add</b>, then <b>Add custom connector</b>.</>)}
          {step(
            4,
            <>
              Name: <b>HelixOS</b>. URL: paste the address below and click <b>Continue</b>.
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-surface-2 px-2 py-1.5 text-sm" data-testid="connect-url">{url}</code>
                <CopyButton text={url} label="Copy the address" className="btn btn-primary btn-sm" doneMs={2000} />
              </span>
            </>,
          )}
          {step(5, <>Leave the sign-in settings as they are (<b>Sign in now</b>, <b>Use Claude&apos;s published identity</b>) and click <b>Continue</b>, then <b>Add</b>.</>)}
          {step(6, <>Claude sends you to HelixOS. Sign in, tick what Claude may do, and click <b>Allow</b>.</>)}
          {step(7, <>Back in a Claude chat, tap <b>+</b> → <b>Connectors</b> and make sure <b>HelixOS</b> is on.</>)}
          {step(8, <>Try it: say or type <b>&ldquo;What&apos;s on my plate today?&rdquo;</b></>)}
        </ol>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-surface-2 p-3" data-testid="connect-phone">
            <div className="font-semibold">On your phone</div>
            <p className="mt-1 text-ink-2">Once step 8 works on a computer, open the Claude app on your phone. HelixOS is already there. Tap the voice button and try &ldquo;Lock in my day&rdquo;.</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-3" data-testid="connect-free">
            <div className="font-semibold">Free Claude account?</div>
            <p className="mt-1 text-ink-2">You can add one custom connector, so this one is enough.</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Try saying</div>
          <ul className="mt-2 flex flex-wrap gap-2" data-testid="connect-try">
            {TRY_SAYING.map((t) => (
              <li key={t} className="rounded-full border px-3 py-1 text-sm text-ink-2" data-testid="connect-try-chip">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <details className="card mt-4 p-5" data-testid="connect-areas">
        <summary className="cursor-pointer font-semibold">What Claude can do in HelixOS</summary>
        <ul className="mt-3 space-y-1.5 text-sm">
          {Object.entries(SCOPE_WORDS).map(([k, w]) => (
            <li key={k}>
              <span className="font-medium">{w.label}:</span> <span className="text-ink-2">{w.line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">A connected app never sends, publishes or deletes anything, never reaches another member, and never sees your keys. Today and Tasks work from a chat now (your lock-in, your close, adding, ticking and moving tasks), and HumanOS when its own AI switch is on; more areas follow. Disconnect any time in <Link href="/settings?tab=connections#connected-apps" className="underline">Settings → Connected apps</Link>.</p>
      </details>
    </>
  );
}
