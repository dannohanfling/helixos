import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { claimRewardAction } from "@/lib/actions/settings";
import { Badge, Card, PageHeader, Progress } from "@/components/ui";
import { TIERS, TIER_ICONS, tierProgress } from "@/lib/engine/tiers";
import { leaderboard, recentLedger, totalPoints } from "@/lib/queries/points";
import { formatDateTime, startOfWeek } from "@/lib/dates";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

export const metadata = { title: "Rewards" };

const TYPE_ICON: Record<string, string> = { checkin: "☀️", close: "🌙", streak: "🔥", task: "✅", content: "✍️", dm: "💬", call: "📞", pathway: "🛣️", curriculum: "📆", bonus: "🎁", redeem: "🛍️" };

export default async function RewardsPage() {
  const v = await requireViewer();
  const [points, ledger, claims, board] = await Promise.all([
    totalPoints(v.user.id),
    recentLedger(v.user.id, 25),
    db.query.rewardClaims.findMany({ where: eq(schema.rewardClaims.userId, v.user.id), orderBy: desc(schema.rewardClaims.createdAt) }),
    leaderboard(v.workspace.id, `${startOfWeek(v.today)}T00:00:00`),
  ]);
  const tier = tierProgress(points);
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client")) });
  const optedIn = new Set(members.filter((m) => m.leaderboardOptIn).map((m) => m.userId));
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u]));
  const topBoard = board.filter((b) => optedIn.has(b.userId)).slice(0, 8);
  const claimed = new Set(claims.map((c) => c.rewardName));
  const tierLevel = (name: string) => TIERS.find((t) => t.name === name)?.level ?? 0;

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prizes you unlock">
          <ul className="space-y-2">
            {prizes.map((p) => {
              const unlocked = points >= p.pointsRequired;
              return (
                <li key={p.name} className={`rounded-lg border p-3 ${unlocked ? "border-good" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{p.name}</div>
                    <Badge tone={unlocked ? "good" : "neutral"}>{unlocked ? "Unlocked" : `${p.pointsRequired.toLocaleString()} pts`}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{p.description}</p>
                  {unlocked && !claimed.has(p.name) ? (
                    <form action={claimRewardAction} className="mt-2">
                      <input type="hidden" name="name" value={p.name} />
                      <input type="hidden" name="cost" value={0} />
                      <button className="btn btn-accent btn-xs" type="submit">
                        Claim
                      </button>
                    </form>
                  ) : claimed.has(p.name) ? (
                    <div className="mt-2 text-xs text-good">Claimed · your coach will follow up</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Spend your points">
          <ul className="space-y-2">
            {rewards.slice(0, 8).map((r) => {
              const tierOk = !r.tierRequired || tierLevel(r.tierRequired.replace(/^[^\w]+/, "")) <= tier.current.level;
              const cost = Number(r.pointsCost ?? 0);
              const canClaim = tierOk && points >= cost && !claimed.has(r.name);
              return (
                <li key={r.name} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{r.name}</div>
                    <span className="text-xs text-ink-3">{cost ? `${cost.toLocaleString()} pts` : "tier unlock"}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{r.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-3">
                    {r.tierRequired ? <span>{r.tierRequired}+</span> : null}
                    {r.category ? <span>· {r.category}</span> : null}
                    {canClaim ? (
                      <form action={claimRewardAction} className="ml-auto">
                        <input type="hidden" name="name" value={r.name} />
                        <input type="hidden" name="cost" value={cost} />
                        <button className="btn btn-soft btn-xs" type="submit">
                          Claim {cost ? `for ${cost}` : ""}
                        </button>
                      </form>
                    ) : claimed.has(r.name) ? (
                      <span className="ml-auto text-good">Claimed</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
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
