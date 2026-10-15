import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { GhlConnect } from "@/components/ghl-connect";
import { ClConnect } from "@/components/cl-connect";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { connectionFor, listUsers } from "@/lib/ghl";
import { agentChoicesFor, clTokenSet } from "@/lib/community-loyalty";
import { getIntegration } from "@/lib/integrations";
import { CL_COPY, GHL_COPY, connectProgress } from "@/lib/engine/connect-copy";

export const metadata = { title: "Connect your tools" };

/**
 * Connect your tools (rev 850): the two connections a member makes for themself, in order, on one page. Step 1 is GoHighLevel
 * (posting), step 2 is Community Loyalty (the bot); each is the same card as on Settings. "Do this later" leaves without a
 * word: the Today card and Settings keep the way back. A coach switched into a client sees connected or not yet, nothing more.
 */
export default async function ConnectToolsPage({ searchParams }: { searchParams: Promise<{ cl?: string }> }) {
  const v = await requireViewer();
  const { cl } = await searchParams;
  const [conn] = await Promise.all([connectionFor(v.user.id), getIntegration(v.workspace.id, "gohighlevel")]);
  const ghl = Boolean(conn && conn.accounts.length && !conn.lastError && conn.ghlUserId?.trim());
  const clOn = clTokenSet(v.membership);
  const progress = connectProgress({ ghl, cl: clOn });

  if (v.switchedInto) {
    const first = v.switchedInto.clientName.split(" ")[0];
    return (
      <>
        <PageHeader title="Connect your tools" subtitle={progress.line} />
        <Card>
          <p className="text-sm text-ink-2" data-testid="connect-switched">
            {first} connects these with their own keys. Nothing here can be seen or changed from their HelixOS. GoHighLevel: {ghl ? "connected" : "not yet"}. Community Loyalty: {clOn ? "connected" : "not yet"}.
          </p>
        </Card>
      </>
    );
  }

  const users = conn && conn.accounts.length && !conn.lastError && !conn.ghlUserId?.trim() ? await listUsers(conn) : [];
  const agents = clOn ? await agentChoicesFor(v.membership) : [];
  return (
    <>
      <ScrollToHash />
      <PageHeader title="Connect your tools" subtitle="Two short steps, each made while signed in as yourself. Stop any time and come back." />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm" data-testid="connect-progress" data-done={progress.done}>
        <span className="font-semibold">{progress.line}</span>
        <span aria-hidden="true" className="flex gap-1">
          {[ghl, clOn].map((on, i) => (
            <span key={i} className={`h-2 w-10 rounded-full ${on ? "bg-good" : "bg-surface-2"}`} />
          ))}
        </span>
        <Link href="/today" className="ml-auto text-ink-3 underline" data-testid="connect-later">
          {progress.done === progress.total ? "Done, back to Today" : "Do this later"}
        </Link>
      </div>
      <Card id="publishing" className="mb-4 scroll-mt-20" title={`Step 1. ${GHL_COPY.title}`}>
        <GhlConnect conn={conn ?? null} tz={v.tz} users={users} />
      </Card>
      <Card id="community-loyalty" className="mb-4 scroll-mt-20" title={`Step 2. ${CL_COPY.title}`}>
        <ClConnect connected={clTokenSet(v.membership)} m={v.membership} agents={agents} notice={cl ?? null} back="/connect-tools" tz={v.tz} />
      </Card>
    </>
  );
}
