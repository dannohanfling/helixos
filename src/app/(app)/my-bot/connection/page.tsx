import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { agentChoicesFor, briefAccessFor, clTokenSet } from "@/lib/community-loyalty";
import { CL_COPY } from "@/lib/engine/connect-copy";
import { ClConnect } from "@/components/cl-connect";
import { MyBotTabs } from "@/components/my-bot-tabs";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "My bot · Connection" };

/**
 * My bot's Connection tab (H-164 §15): the Community Loyalty connection that carries everything to the bot, the same card as in
 * Settings (one action, one sealing), and whether the bot's agent reads what HelixOS sends. The key is never shown.
 */
export default async function MyBotConnectionPage({ searchParams }: { searchParams: Promise<{ cl?: string }> }) {
  const v = await requireViewer();
  const { cl } = await searchParams;
  const connected = clTokenSet(v.membership);
  const [agents, access] = await Promise.all([connected ? agentChoicesFor(v.membership) : Promise.resolve([]), connected ? briefAccessFor(v.membership) : Promise.resolve(null)]);
  return (
    <>
      <PageHeader title="My bot" subtitle="Where your bot lives, and whether it is reading what you send it." />
      <MyBotTabs current="connection" />
      <Card id="community-loyalty" className="mb-4 scroll-mt-20" title={CL_COPY.title}>
        <ClConnect connected={connected} m={v.membership} agents={agents} notice={cl ?? null} back="/my-bot/connection" tz={v.tz} />
      </Card>
      <Card title="Your bot's agent" className="mb-4">
        <div data-testid="bot-agent-status">
          {!connected ? (
            <p className="text-sm text-ink-2">Connect Community Loyalty above and your bot&apos;s agent shows here.</p>
          ) : access?.agent ? (
            <p className="text-sm">
              <span className="mr-1 text-good" aria-hidden>✓</span>
              Reading from <b>{access.agent.name}</b>. What it is sent is on <Link href="/my-bot" className="underline">What it says</Link>.
            </p>
          ) : (
            <p className="text-sm text-warn">Couldn&apos;t read your bot&apos;s agent from Community Loyalty just now. Pick it above, or try again in a minute.</p>
          )}
          {access?.blocked ? <p className="mt-2 text-sm text-warn" role="alert">{access.blocked}</p> : null}
        </div>
      </Card>
      <p className="text-xs text-ink-3">
        Your bot&apos;s own words (what you do, its three questions, your booking link) are in <Link href="/settings#your-bot" className="underline">Settings → What your bot says</Link>.
      </p>
    </>
  );
}
