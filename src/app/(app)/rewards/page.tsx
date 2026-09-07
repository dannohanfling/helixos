import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { markPassInstalledAction, sendTestPushAction } from "@/lib/actions/integrations";
import { Badge, Card, PageHeader, Progress } from "@/components/ui";
import { ClaimButton } from "@/components/claim-button";
import { TIERS, TIER_ICONS, tierProgress } from "@/lib/engine/tiers";
import { catalogue, claimability, requirementText, type CatalogueItem, type Claimability } from "@/lib/engine/rewards";
import { loadRewardsConfig } from "@/lib/rewards-config";
import { leaderboard, recentLedger, totalPoints } from "@/lib/queries/points";
import { claimDatesByName } from "@/lib/queries/rewards";
import { formatDateTime, startOfWeek } from "@/lib/dates";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

export const metadata = { title: "Rewards" };

const TYPE_ICON: Record<string, string> = { checkin: "☀️", close: "🌙", streak: "🔥", task: "✅", content: "✍️", dm: "💬", call: "📞", pathway: "🛣️", curriculum: "📆", bonus: "🎁", redeem: "🛍️" };

export default async function RewardsPage() {
  const v = await requireViewer();
  const [points, ledger, claims, board] = await Promise.all([
    totalPoints(v.workspace.id, v.user.id),
    recentLedger(v.workspace.id, v.user.id, 25),
    db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, v.workspace.id), eq(schema.rewardClaims.userId, v.user.id)), orderBy: desc(schema.rewardClaims.createdAt) }),
    leaderboard(v.workspace.id, `${startOfWeek(v.today)}T00:00:00`),
  ]);
  const tier = tierProgress(points);
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client")) });
  const optedIn = new Set(members.filter((m) => m.leaderboardOptIn).map((m) => m.userId));
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u]));
  const topBoard = board.filter((b) => optedIn.has(b.userId)).slice(0, 8);
  const claimed = new Set(claims.map((c) => c.rewardName));
  const config = loadRewardsConfig();
  const items = catalogue(rewards, prizes, config);
  const claimDates = await claimDatesByName(v.workspace.id, v.tz);
  const verdictOf = (item: CatalogueItem): Claimability =>
    claimability(item, { points, tierLevel: tier.current.level, claimed, claimDates: claimDates.get(item.name) ?? [], today: v.today, mode: config.perMonth });
  const myClaim = (name: string) => claims.find((c) => c.rewardName === name);

  return (
    <>
      <PageHeader title="Rewards" subtitle="Points are proof of work. Tiers open doors." />
      <div className="mb-4 grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="card p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Your points</div>
          <div className="mt-1 text-5xl font-semibold leading-none">{points.toLocaleString()}</div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-2xl">{TIER_ICONS[tier.current.name]}</span>
            <div>
              <div className="font-semibold">{tier.current.name}</div>
              <div className="text-xs text-ink-2">{tier.next ? `${tier.toNext.toLocaleString()} to ${tier.next.name}` : "Top tier"}</div>
            </div>
          </div>
          <div className="mt-3">
            <Progress value={tier.pct} />
          </div>
          {tier.current.welcome ? <p className="mt-3 text-sm text-ink-2">{tier.current.welcome}</p> : null}
        </div>
        <Card title="The ladder">
          <ol className="space-y-1.5">
            {TIERS.map((t) => {
              const reached = points >= t.minPoints;
              const isCurrent = t.level === tier.current.level;
              return (
                <li key={t.level} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${isCurrent ? "bg-accent-soft" : ""} ${reached ? "" : "opacity-60"}`}>
                  <span className="w-6 text-center text-base">{TIER_ICONS[t.name]}</span>
                  <span className="w-24 font-semibold">{t.name}</span>
                  <span className="text-xs text-ink-3 tabular">{t.minPoints.toLocaleString()}+</span>
                  <span className="ml-auto text-xs text-ink-3">{reached ? "✓" : ""}</span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <Card className="mb-4" title="🎫 My Evolve Omega pass" action={v.membership.eoPassInstalledAt ? <Badge tone="good">installed</Badge> : v.membership.eoPassUrl ? <Badge tone="accent">ready to add</Badge> : <Badge tone="neutral">coming</Badge>}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-ink-2">Your pass lives in your phone wallet. Points you earn here land on it, and it&apos;s how your coach reaches you between calls.</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-3">
              {v.membership.eoPassSerial ? <span>Serial {v.membership.eoPassSerial}</span> : null}
              {v.membership.eoPassLastPushAt ? <span>· last message {formatDateTime(v.membership.eoPassLastPushAt, v.workspace.timezone)}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.membership.eoPassUrl ? (
              <a href={v.membership.eoPassUrl} target="_blank" rel="noreferrer" className="btn btn-accent btn-sm">Add to wallet ↗</a>
            ) : (
              <span className="text-xs text-ink-3">Your coach will send your pass link.</span>
            )}
            {v.membership.eoPassUrl && !v.membership.eoPassInstalledAt ? (
              <form action={markPassInstalledAction}>
                <button className="btn btn-ghost btn-sm" type="submit">I added it</button>
              </form>
            ) : null}
            {v.membership.eoPassSerial ? (
              <form action={sendTestPushAction}>
                <button className="btn btn-ghost btn-sm" type="submit">Send me a test push</button>
              </form>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prizes you unlock" action={<span className="text-xs text-ink-3">milestones, no points spent</span>}>
          <ul className="space-y-2" data-testid="prize-list">
            {items.filter((i) => i.kind === "prize").map((item) => (
              <CatalogueRow key={item.name} item={item} verdict={verdictOf(item)} claim={myClaim(item.name)} tz={v.tz} />
            ))}
          </ul>
        </Card>
        <Card title="Spend your points" action={<span className="text-xs text-ink-3">the whole ladder, locked rungs included</span>}>
          <ul className="space-y-2" data-testid="reward-list">
            {items.filter((i) => i.kind === "reward").map((item) => (
              <CatalogueRow key={item.name} item={item} verdict={verdictOf(item)} claim={myClaim(item.name)} tz={v.tz} />
            ))}
          </ul>
        </Card>
        <Card title="This week's leaderboard" action={<span className="text-xs text-ink-3">Opt out in settings</span>}>
          {topBoard.length ? (
            <ol className="space-y-1.5">
              {topBoard.map((b, i) => {
                const u = nameOf.get(b.userId);
                return (
                  <li key={b.userId} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${b.userId === v.user.id ? "bg-accent-soft" : ""}`}>
                    <span className="w-5 text-center text-xs font-bold text-ink-3">{i + 1}</span>
                    <span className="text-base">{u?.avatarEmoji ?? "🧭"}</span>
                    <span className="font-medium">{u?.name ?? "Member"}</span>
                    <span className="ml-auto tabular text-ink-2">{b.total.toLocaleString()}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-ink-2">Nobody has scored this week yet. First mover wins.</p>
          )}
        </Card>
        <Card title="Recent points">
          <ul className="divide-y text-sm">
            {ledger.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-1.5">
                <span>{TYPE_ICON[l.type] ?? "•"}</span>
                <span className="min-w-0 flex-1 truncate">{l.reason}</span>
                <span className="text-[11px] text-ink-3">{formatDateTime(l.createdAt.includes("T") ? l.createdAt : l.createdAt.replace(" ", "T") + "Z", v.workspace.timezone)}</span>
                <span className={`tabular font-semibold ${l.points < 0 ? "text-danger" : "text-good"}`}>
                  {l.points > 0 ? "+" : ""}
                  {l.points}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/**
 * One reward or prize: what it is, what it asks for, and exactly one of: a Claim button, the reason it can't be claimed
 * yet, or (once claimed) that reward's own booking link. A claim is an instant unlock; the next step is the client's.
 */
function CatalogueRow({ item, verdict, claim, tz }: { item: CatalogueItem; verdict: Claimability; claim?: { id: string; createdAt: string; bookingOpenedAt: string | null }; tz: string }) {
  const locked = !claim && !verdict.ok;
  const soon = !verdict.ok && (verdict.reason === "opening-soon" || verdict.reason === "not-earnable");
  return (
    <li className={`rounded-lg border p-3 ${claim ? "border-good" : locked && !soon ? "opacity-75" : ""}`} data-testid="catalogue-item" data-reward={item.name}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">{item.name}</div>
        <span className="shrink-0 text-xs text-ink-3">{item.kind === "prize" ? `${item.minPoints.toLocaleString()} pts` : item.cost ? `${item.cost.toLocaleString()} pts` : item.tierRequired ? "tier unlock" : "earned"}</span>
      </div>
      <p className="mt-1 text-sm text-ink-2">{item.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <span>{requirementText(item) || "By invitation"}</span>
        {item.category ? <span>· {item.category}</span> : null}
        <span className="ml-auto flex items-center gap-2">
          {claim ? (
            <>
              <span className="text-good">Claimed {formatDateTime(claim.createdAt.includes("T") ? claim.createdAt : claim.createdAt.replace(" ", "T") + "Z", tz)}</span>
              {item.bookingUrl ? (
                <a href={`/rewards/book/${claim.id}`} target="_blank" rel="noreferrer" className="btn btn-accent btn-xs" data-testid="book-link">
                  {claim.bookingOpenedAt ? "Booking link ↗" : "Book your slot ↗"}
                </a>
              ) : (
                <span>· next step opening soon</span>
              )}
            </>
          ) : verdict.ok ? (
            <ClaimButton name={item.name} label={item.cost ? `Claim for ${item.cost.toLocaleString()}` : "Claim"} className={item.kind === "prize" ? "btn btn-accent btn-xs" : "btn btn-soft btn-xs"} />
          ) : (
            <Badge tone={verdict.reason === "cap" ? "warn" : soon ? "neutral" : "accent"}>
              <span data-testid="reward-status">{verdict.message}</span>
            </Badge>
          )}
        </span>
      </div>
      {claim && item.bookingUrl && !claim.bookingOpenedAt ? <p className="mt-2 text-xs text-ink-2">Your points are spent and the slot is yours to book. Nobody books it for you.</p> : null}
    </li>
  );
}
