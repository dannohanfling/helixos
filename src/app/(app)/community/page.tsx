import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { awardMemberPointsAction, updatePassAction } from "@/lib/actions/clients";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Empty, Field, PageHeader } from "@/components/ui";
import { STREAK_BONUS } from "@/lib/engine/streak";
import { TIERS, TIER_ICONS, tierFor } from "@/lib/engine/tiers";
import curriculum from "@/data/seed/curriculum.json";

export const metadata = { title: "Community Pass" };

export default async function CommunityPage() {
  const v = await requireViewer();
  const m = v.membership;
  if (!m.passEnabled) {
    return (
      <>
        <PageHeader title="Community Pass" subtitle="Run the same loyalty engine you're inside of, for your own people." />
        <Card>
          <Empty
            icon="🎟️"
            title="Unlocked at Elite"
            hint="Elite clients get their own Community Pass: points, tiers, a daily hashtag streak, and a 30-day curriculum for their members. Ask your coach to switch it on."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            {["Your members earn points for showing up. You decide the quests.", "Nine tiers, from Artisan to Olympian. Doors open at Sage and Sentinel.", "A daily hashtag streak that resets Mondays: 10, 20, 40, 80, 160."].map((t) => (
              <div key={t} className="rounded-lg bg-surface-2 p-3 text-ink-2">
                {t}
              </div>
            ))}
          </div>
        </Card>
      </>
    );
  }
  const members = await db.query.clientRecords.findMany({ where: eq(schema.clientRecords.userId, v.user.id), orderBy: asc(schema.clientRecords.name) });
  const points = members.length ? await db.query.memberPoints.findMany({ where: inArray(schema.memberPoints.clientRecordId, members.map((r) => r.id)) }) : [];
  const totals = members.map((r) => ({ r, total: points.filter((p) => p.clientRecordId === r.id).reduce((a, p) => a + p.points, 0) })).sort((a, b) => b.total - a.total);
  const failed = points.filter((p) => p.syncStatus === "failed").length;
  const hashtag = m.passHashtag ?? "#showedup";
  const dailyPost = `Today's hashtag is ${hashtag}.\n\nPost one line: what you're working on today, and what you finished yesterday.\n\nDay 1 = 10 points. Day 5 = 160. Miss a day and you're back to 10. Weekends don't count. Mondays are restart day.`;

  return (
    <>
      <PageHeader title={m.passName ?? "Community Pass"} subtitle="Your loyalty engine. Points, tiers, and a daily rhythm for your members." action={<Badge tone="good">Elite</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card title="Leaderboard" action={<span className="text-xs text-ink-3">{members.length} members</span>}>
            {totals.length ? (
              <ol className="divide-y">
                {totals.map(({ r, total }, i) => {
                  const t = tierFor(total);
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-5 text-center text-xs font-bold text-ink-3">{i + 1}</span>
                      <span className="text-lg">{r.avatarEmoji}</span>
                      <Link href={`/clients/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-xs text-ink-2">
                        {TIER_ICONS[t.name]} {t.name}
                      </span>
                      <span className="w-16 text-right tabular font-semibold">{total.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty icon="👥" title="No members yet" hint="Add your clients under Clients. Everyone you add is a member of your community." action={<Link href="/clients" className="btn btn-ghost btn-sm">Go to clients</Link>} />
            )}
          </Card>
          <Card title="Award points" action={failed ? <Badge tone="danger">{failed} failed to sync</Badge> : m.passWebhookUrl ? <Badge tone="good">webhook on</Badge> : <Badge>local only</Badge>}>
            <form action={awardMemberPointsAction} className="grid items-end gap-2 sm:grid-cols-[1.2fr_5rem_1.4fr_auto]">
              <Field label="Member">
                <select className="field" name="clientRecordId" required>
                  {members.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Points">
                <input className="field tabular" name="points" type="number" defaultValue={10} />
              </Field>
              <Field label="Reason">
                <input className="field" name="reason" placeholder={`Posted with ${hashtag}`} />
              </Field>
              <button className="btn btn-accent" type="submit">
                Award
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                ["Daily hashtag · day 1", 10],
                ["Day 2", 20],
                ["Day 3", 40],
                ["Day 4", 80],
                ["Day 5", 160],
                ["Posted a win", 25],
                ["Referred a friend", 100],
                ["Completed a trial", 100],
              ].map(([l, p]) => (
                <span key={String(l)} className="badge">
                  {l} · +{p}
                </span>
              ))}
            </div>
          </Card>
          <Card title="Your daily post" action={<CopyButton text={dailyPost} label="Copy" />}>
            <p className="whitespace-pre-line text-sm">{dailyPost}</p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Pass settings">
            <form action={updatePassAction} className="space-y-3">
              <Field label="Pass name">
                <input className="field" name="passName" defaultValue={m.passName ?? ""} placeholder="Torres Nutrition Community Pass" />
              </Field>
              <Field label="Pass install link" hint="From Community Loyalty. Send this to members.">
                <input className="field" name="passUrl" type="url" defaultValue={m.passUrl ?? ""} />
              </Field>
              <Field label="Points webhook URL" hint="Your Community Loyalty inbound webhook. Points you award post here.">
                <input className="field" name="passWebhookUrl" type="url" defaultValue={m.passWebhookUrl ?? ""} placeholder="https://communityloyalty.io/api/iwh/…" />
              </Field>
              <Field label="Daily hashtag">
                <input className="field" name="passHashtag" defaultValue={m.passHashtag ?? ""} placeholder="#showedup" />
              </Field>
              <Field label="Community link">
                <input className="field" name="passCommunityUrl" type="url" defaultValue={m.passCommunityUrl ?? ""} />
              </Field>
              <button className="btn btn-primary w-full" type="submit">
                Save
              </button>
            </form>
          </Card>
          <Card title="The ladder your members climb">
            <ol className="space-y-1 text-sm">
              {TIERS.map((t) => (
                <li key={t.level} className="flex items-center gap-2">
                  <span className="w-6 text-center">{TIER_ICONS[t.name]}</span>
                  <span className="w-24 font-medium">{t.name}</span>
                  <span className="text-xs text-ink-3 tabular">{t.minPoints.toLocaleString()}+</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-3">Streak bonus ladder: {STREAK_BONUS.slice(1).join(" → ")}. Resets Monday.</p>
          </Card>
          <Card title="30-day curriculum for new members" action={<CopyButton text={(curriculum as { day: number; title: string; instructions: string; points: number }[]).map((d) => `Day ${d.day} · ${d.title} (+${d.points})\n${d.instructions}`).join("\n\n")} label="Copy all 30" className="btn btn-ghost btn-xs" />}>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {(curriculum as { day: number; title: string; points: number }[]).map((d) => (
                <li key={d.day} className="flex justify-between gap-2">
                  <span>
                    <span className="text-ink-3">Day {d.day}</span> {d.title}
                  </span>
                  <span className="tabular text-ink-3">+{d.points}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
