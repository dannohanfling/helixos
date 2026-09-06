import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { reviewPathwayTaskAction } from "@/lib/actions/pathway";
import { setClientPassAction } from "@/lib/actions/coach";
import { setCertEnabledAction } from "@/lib/actions/courses";
import { setMemberPassAction } from "@/lib/actions/integrations";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { TIER_ICONS, tierFor } from "@/lib/engine/tiers";
import { runningStreak } from "@/lib/engine/streak";
import { daysBetween, formatDate, formatDateTime } from "@/lib/dates";

export const metadata = { title: "Coach" };

export default async function CoachPage() {
  const v = await requireCoach();
  const wsId = v.workspace.id;
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, wsId), eq(schema.memberships.role, "client")) });
  const userIds = members.map((m) => m.userId);
  const [users, logs, points, verified, submitted, library] = await Promise.all([
    userIds.length ? db.query.users.findMany({ where: inArray(schema.users.id, userIds) }) : [],
    userIds.length ? db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.workspaceId, wsId), inArray(schema.dailyLogs.userId, userIds)) }) : [],
    userIds.length ? db.select({ userId: schema.pointsLedger.userId, points: schema.pointsLedger.points }).from(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, wsId), inArray(schema.pointsLedger.userId, userIds))) : [],
    userIds.length ? db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, wsId), inArray(schema.pathwayProgress.userId, userIds), eq(schema.pathwayProgress.status, "verified")) }) : [],
    db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, wsId), eq(schema.pathwayProgress.status, "submitted")), orderBy: desc(schema.pathwayProgress.submittedAt) }),
    db.query.libraryTasks.findMany(),
  ]);
  const libByKey = new Map(library.map((l) => [l.key, l]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const rows = members
    .map((m) => {
      const u = userById.get(m.userId);
      const mine = logs.filter((l) => l.userId === m.userId);
      const closed = new Set(mine.filter((l) => l.eveningDoneAt).map((l) => l.date));
      const lastActive = mine.map((l) => l.date).sort().at(-1) ?? null;
      const pts = points.filter((p) => p.userId === m.userId).reduce((a, p) => a + p.points, 0);
      const todayLog = mine.find((l) => l.date === v.today);
      const daysSilent = lastActive ? daysBetween(lastActive, v.today) : 999;
      return {
        m,
        u,
        pts,
        tier: tierFor(pts),
        streak: runningStreak(closed, v.today),
        lastActive,
        daysSilent,
        verified: verified.filter((p) => p.userId === m.userId).length,
        todayLocked: Boolean(todayLog?.morningDoneAt),
        todayClosed: Boolean(todayLog?.eveningDoneAt),
        waiting: submitted.filter((s) => s.userId === m.userId).length,
      };
    })
    .sort((a, b) => b.daysSilent - a.daysSilent);
  const atRisk = rows.filter((r) => r.daysSilent >= 3);

  return (
    <>
      <PageHeader title="Coach view" subtitle={`${members.length} clients · ${submitted.length} submissions waiting · ${atRisk.length} quiet for 3+ days`} action={<Link href="/settings" className="btn btn-ghost btn-sm">Invite links</Link>} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Clients">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-2">
                  <tr>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Today</th>
                    <th className="py-2 pr-3">Streak</th>
                    <th className="py-2 pr-3">Tier</th>
                    <th className="py-2 pr-3 text-right">Pathway</th>
                    <th className="py-2 pr-3 text-right">Last active</th>
                    <th className="py-2 text-right">Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.m.id} className={r.daysSilent >= 3 ? "bg-warn-soft/40" : ""}>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{r.u?.avatarEmoji}</span>
                          <div>
                            <div className="font-medium">{r.u?.name}</div>
                            <div className="text-xs text-ink-3">{r.m.businessName ?? r.m.programTier}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span title="Locked in">{r.todayLocked ? "☀️" : "○"}</span> <span title="Closed">{r.todayClosed ? "🌙" : "○"}</span>
                      </td>
                      <td className="py-2 pr-3 tabular">🔥 {r.streak}</td>
                      <td className="py-2 pr-3">
                        {TIER_ICONS[r.tier.name]} {r.tier.name} <span className="text-xs text-ink-3 tabular">{r.pts.toLocaleString()}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular">
                        {r.verified}/{library.length}
                        {r.waiting ? <Badge tone="accent">{r.waiting} waiting</Badge> : null}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs">
                        {r.lastActive ? (
                          <span className={r.daysSilent >= 3 ? "font-semibold text-warn" : "text-ink-2"}>
                            {r.daysSilent === 0 ? "today" : r.daysSilent === 1 ? "yesterday" : `${r.daysSilent}d ago`}
                          </span>
                        ) : (
                          <span className="text-danger">never</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-xs">
                        <form action={setClientPassAction} className="flex items-center justify-end gap-1">
                          <input type="hidden" name="membershipId" value={r.m.id} />
                          <select className="field w-auto py-1 text-xs" name="programTier" defaultValue={r.m.programTier}>
                            {["Accelerator", "Academy", "Elite", "Luxe"].map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                          <button className={`btn btn-xs ${r.m.passEnabled ? "btn-accent" : "btn-ghost"}`} type="submit" name="enabled" value={r.m.passEnabled ? "0" : "1"} title="Community Pass">
                            🎟️ {r.m.passEnabled ? "on" : "off"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="👥" title="No clients yet" hint="Share your invite link from Settings." />
          )}
        </Card>
        <Card title="Programs and passes" action={<span className="flex gap-3 text-xs"><Link href="/certification" className="underline">Certification queue</Link><Link href="/integrations" className="underline">Integrations</Link></span>}>
          {rows.length ? (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="w-36 truncate font-medium">{r.u?.avatarEmoji} {r.u?.name}</span>
                  <form action={setCertEnabledAction}>
                    <input type="hidden" name="membershipId" value={r.m.id} />
                    <button className={`btn btn-xs ${r.m.certEnabled ? "btn-accent" : "btn-ghost"}`} type="submit" name="enabled" value={r.m.certEnabled ? "0" : "1"} title="Certification track">
                      🎓 {r.m.certEnabled ? "cert on" : "cert off"}
                    </button>
                  </form>
                  <a className="btn btn-ghost btn-xs" href={`/api/export?format=json&user=${r.m.userId}`} download title="Everything this client has put in, as one JSON file (for offboarding)">
                    ⬇ export
                  </a>
                  <form action={setMemberPassAction} className="flex flex-1 flex-wrap items-center gap-1">
                    <input type="hidden" name="membershipId" value={r.m.id} />
                    <input className="field min-w-40 flex-1 py-1 text-xs" name="eoPassUrl" placeholder="Evolve Omega pass link" defaultValue={r.m.eoPassUrl ?? ""} />
                    <input className="field w-28 py-1 text-xs" name="eoPassSerial" placeholder="serial" defaultValue={r.m.eoPassSerial ?? ""} />
                    <button className="btn btn-ghost btn-xs" type="submit">Save</button>
                    <span className="text-[11px] text-ink-3">{r.m.eoPassInstalledAt ? "installed" : r.m.eoPassSerial ? "not installed" : ""}</span>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card title="Verify submissions" action={<Badge tone="accent">{submitted.length}</Badge>}>
            {submitted.length ? (
              <ul className="space-y-3">
                {submitted.map((s) => {
                  const lib = libByKey.get(s.libraryTaskKey);
                  const u = userById.get(s.userId);
                  return (
                    <li key={s.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{lib?.name}</div>
                        <span className="text-xs text-ink-3">+{lib?.points}</span>
                      </div>
                      <div className="text-xs text-ink-2">
                        {u?.avatarEmoji} {u?.name} · {s.submittedAt ? formatDateTime(s.submittedAt, v.workspace.timezone) : ""}
                      </div>
                      {s.submissionText ? <p className="mt-2 whitespace-pre-line rounded bg-surface-2 p-2">{s.submissionText}</p> : null}
                      {s.submissionUrl ? (
                        <a href={s.submissionUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline">
                          Open proof ↗
                        </a>
                      ) : null}
                      <form action={reviewPathwayTaskAction} className="mt-2 space-y-2">
                        <input type="hidden" name="id" value={s.id} />
                        <input className="field" name="feedback" placeholder="One line of feedback (optional for verify, needed for a tweak)" />
                        <div className="flex gap-2">
                          <button className="btn btn-accent btn-sm" type="submit" name="decision" value="verify">
                            Verify · award points
                          </button>
                          <button className="btn btn-ghost btn-sm" type="submit" name="decision" value="revision">
                            Ask for a tweak
                          </button>
                        </div>
                      </form>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon="🎉" title="Queue is clear" />
            )}
          </Card>
          <Card title="Who needs a nudge">
            {atRisk.length ? (
              <ul className="space-y-2 text-sm">
                {atRisk.map((r) => (
                  <li key={r.m.id} className="flex items-center justify-between gap-2">
                    <span>
                      {r.u?.avatarEmoji} {r.u?.name}
                    </span>
                    <span className="text-xs text-warn">{r.lastActive ? `last seen ${formatDate(r.lastActive)}` : "never logged in"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">Everyone has shown up in the last 3 days.</p>
            )}
            <p className="mt-3 text-xs text-ink-3">Tip: the &ldquo;Insider Check-In&rdquo; sequence in the DM playbook is built for exactly this.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
