import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { appUrl } from "@/lib/branded-email";
import { Card, PageHeader } from "@/components/ui";
import { LeaderboardEditor } from "@/components/leaderboard/editor";
import { feedAliases } from "@/lib/leaderboard";

export const metadata = { title: "Loyalty leaderboard" };

/**
 * The loyalty leaderboard page's editor (H-28, H-33): the owner's, their team's and their coach's. Only a program the coach
 * has set up (a feed row on this membership) has anything to edit; until then the page says so. The key itself lives on the
 * coach's page and never appears here.
 */
export default async function LoyaltyPage({ searchParams }: { searchParams: Promise<{ slugError?: string; slug?: string }> }) {
  const { slugError, slug: slugNote } = await searchParams;
  const v = await requireViewer({ team: "allow" });
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, v.membership.id) });
  const exportRows = feed?.exportJson ? ((JSON.parse(feed.exportJson) as unknown[]).length ?? 0) : null;
  const aliases = feed ? await feedAliases(feed.id) : [];
  return (
    <>
      <PageHeader title="Loyalty leaderboard" subtitle="Your members' points and tiers on a page you can share or embed. First names and initials only." />
      {feed ? (
        <LeaderboardEditor feed={feed} base={appUrl()} canHide={!v.team} exportRows={exportRows} aliases={aliases} slugError={slugError?.slice(0, 200) ?? null} slugChanged={slugNote === "changed"} />
      ) : (
        <Card title="Not set up yet">
          <p className="text-sm text-ink-2">Your coach connects your loyalty program here. Once it&apos;s set up, this page holds your leaderboard&apos;s words, tiers, rewards and link.</p>
        </Card>
      )}
    </>
  );
}
