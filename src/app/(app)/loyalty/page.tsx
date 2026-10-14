import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { appUrl } from "@/lib/branded-email";
import { Card, PageHeader } from "@/components/ui";
import { LeaderboardEditor } from "@/components/leaderboard/editor";

export const metadata = { title: "Loyalty leaderboard" };

/**
 * The loyalty leaderboard page's editor (H-28, H-33): the owner's, their team's and their coach's. Only a program the coach
 * has set up (a feed row on this membership) has anything to edit; until then the page says so. The key itself lives on the
 * coach's page and never appears here.
 */
export default async function LoyaltyPage() {
  const v = await requireViewer({ team: "allow" });
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, v.membership.id) });
  const exportRows = feed?.exportJson ? ((JSON.parse(feed.exportJson) as unknown[]).length ?? 0) : null;
  return (
    <>
      <PageHeader title="Loyalty leaderboard" subtitle="Your members' points and tiers on a page you can share or embed. First names and initials only." />
      {feed ? (
        <LeaderboardEditor feed={feed} base={appUrl()} canHide={!v.team} exportRows={exportRows} />
      ) : (
        <Card title="Not set up yet">
          <p className="text-sm text-ink-2">Your coach connects your loyalty program here. Once it&apos;s set up, this page holds your leaderboard&apos;s words, tiers, rewards and link.</p>
        </Card>
      )}
    </>
  );
}
