import Link from "next/link";
import { headers } from "next/headers";
import { requireViewer } from "@/lib/auth";
import { SCOPE_WORDS } from "@/lib/engine/mcp";
import { issuerFor, resourceFor } from "@/lib/mcp/oauth";
import { Card, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Connect HelixOS to Claude" };

/** The short help page the plan asked for (rev 224): the connector address, three steps, and what each area means. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  const { error } = await searchParams;
  const h = await headers();
  const url = resourceFor(issuerFor(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`));
  const closed = v.role === "client" && !v.workspace.connectedAppsOpen;
  return (
    <>
      <PageHeader title="Connect HelixOS to Claude" subtitle="Read and write your own HelixOS from a Claude chat, acting only as you." />
      {error === "stale" ? <p className="mb-3 text-sm text-danger">That connection request was out of date. Start it again from Claude.</p> : null}
      {error === "closed" || closed ? (
        <p className="mb-3 text-sm text-warn" data-testid="connect-closed">Your coach hasn&apos;t opened connected apps to clients yet. Ask them, and come back.</p>
      ) : null}
      <Card title="Three steps">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>In Claude, open Settings → Connectors → Add custom connector. Name it HelixOS and paste this address:</li>
        </ol>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 text-sm" data-testid="connect-url">{url}</code>
          <CopyButton text={url} label="Copy" className="btn btn-ghost btn-xs" />
        </div>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm" start={2}>
          <li>Claude sends you here to sign in and tick what it may do. You&apos;re asked every time you connect.</li>
          <li>Back in Claude, ask it something: &quot;who am I connected as?&quot; to start. Disconnect any time in <Link href="/settings#connected-apps" className="underline">Settings → Connected apps</Link>.</li>
        </ol>
      </Card>
      <Card className="mt-4" title="What each area means">
        <ul className="space-y-1.5 text-sm">
          {Object.entries(SCOPE_WORDS).map(([k, w]) => (
            <li key={k}>
              <span className="font-medium">{w.label}:</span> <span className="text-ink-2">{w.line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">A connected app never sends, publishes or deletes anything, never reaches another member, and never sees your keys. This first release answers who you are; tools for each area follow.</p>
      </Card>
    </>
  );
}
