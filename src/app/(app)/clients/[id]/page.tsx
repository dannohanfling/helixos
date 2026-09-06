import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { CLIENT_STATUSES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { awardMemberPointsAction, deleteClientRecordAction, logCheckinAction, updateClientRecordAction } from "@/lib/actions/clients";
import { Sparkline } from "@/components/charts";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { TIER_ICONS, tierProgress } from "@/lib/engine/tiers";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const c = await db.query.clientRecords.findFirst({ where: and(eq(schema.clientRecords.id, id), eq(schema.clientRecords.userId, v.user.id)) });
  if (!c) notFound();
  const [checkins, offers, points] = await Promise.all([
    db.query.clientCheckins.findMany({ where: eq(schema.clientCheckins.clientRecordId, id), orderBy: desc(schema.clientCheckins.date) }),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
    db.query.memberPoints.findMany({ where: eq(schema.memberPoints.clientRecordId, id), orderBy: desc(schema.memberPoints.createdAt) }),
  ]);
  const total = points.reduce((a, p) => a + p.points, 0);
  const tier = tierProgress(total);
  const series = (k: "mindset" | "energy" | "business") => checkins.filter((x) => x[k]).slice(0, 8).reverse().map((x) => x[k] as number);
  const cash = checkins.reduce((a, x) => a + x.cashCollected, 0);
  const lastNps = checkins.find((x) => x.nps !== null)?.nps;

  return (
    <>
      <PageHeader
        title={`${c.avatarEmoji} ${c.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/clients" className="hover:underline">
              ← Clients
            </Link>
            <Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status}</Badge>
            {c.programName ?? offers.find((o) => o.id === c.offerId)?.name ?? ""}
            {c.startDate ? ` · since ${formatDate(c.startDate)}` : ""}
          </span>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Check-ins", checkins.filter((x) => x.kind !== "note").length],
          ["Cash collected", `$${cash.toLocaleString()}`],
          ["Last NPS", lastNps ?? "—"],
          v.membership.passEnabled ? ["Pass points", `${total.toLocaleString()} · ${TIER_ICONS[tier.current.name]} ${tier.current.name}`] : ["Next call", c.nextCallAt ? formatDateTime(c.nextCallAt, v.workspace.timezone) : "—"],
        ].map(([k, val]) => (
          <div key={String(k)} className="card p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{k}</div>
            <div className="mt-1 text-lg font-semibold">{val}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card title="Log a check-in">
            <form action={logCheckinAction} className="space-y-3">
              <input type="hidden" name="clientRecordId" value={c.id} />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {[
                  ["checkin", "Check-in"],
                  ["call", "Call"],
                  ["note", "Note"],
                ].map(([k, l], i) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" name="kind" value={k} defaultChecked={i === 0} /> {l}
                  </label>
                ))}
                <input className="field w-auto" name="date" type="date" defaultValue={v.today} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Wins">
                  <textarea className="field" name="wins" placeholder="What moved this week?" />
                </Field>
                <Field label="Blockers">
                  <textarea className="field" name="blockers" placeholder="What's in the way?" />
                </Field>
                <Field label="Support they asked for">
                  <textarea className="field" name="supportNeeded" />
                </Field>
                <Field label="Their next step (one thing)">
                  <textarea className="field" name="nextStep" />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {[
                  ["mindset", "Mindset /10"],
                  ["energy", "Energy /10"],
                  ["business", "Business /10"],
                  ["cashCollected", "Cash they made $"],
                  ["nps", "NPS 0-10"],
                ].map(([k, l]) => (
                  <label key={k} className="block">
                    <span className="label">{l}</span>
                    <input className="field tabular" name={k} type="number" min={0} max={k === "cashCollected" ? undefined : 10} />
                  </label>
                ))}
                <label className="block">
                  <span className="label">Next call</span>
                  <input className="field" name="nextCallAt" type="datetime-local" />
                </label>
              </div>
              <button className="btn btn-accent" type="submit">
                Save check-in
              </button>
            </form>
          </Card>
          <Card title="Timeline">
            {checkins.length ? (
              <ul className="space-y-3">
                {checkins.map((x) => (
                  <li key={x.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                      <span>
                        {x.kind === "call" ? "📞 Call" : x.kind === "note" ? "📝 Note" : "✅ Check-in"} · {formatDate(x.date, { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <span className="tabular">
                        {x.mindset ? `🧠 ${x.mindset}` : ""} {x.energy ? `⚡ ${x.energy}` : ""} {x.business ? `💼 ${x.business}` : ""} {x.cashCollected ? `💵 $${x.cashCollected.toLocaleString()}` : ""} {x.nps !== null ? `NPS ${x.nps}` : ""}
                      </span>
                    </div>
                    {x.wins ? (
                      <p className="mt-1">
                        <span className="font-semibold">Wins:</span> {x.wins}
                      </p>
                    ) : null}
                    {x.blockers ? (
                      <p>
                        <span className="font-semibold">Blockers:</span> {x.blockers}
                      </p>
                    ) : null}
                    {x.supportNeeded ? (
                      <p>
                        <span className="font-semibold">Support:</span> {x.supportNeeded}
                      </p>
                    ) : null}
                    {x.nextStep ? (
                      <p>
                        <span className="font-semibold">Next step:</span> {x.nextStep}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">No check-ins yet. Log the first one above.</p>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Trend">
            <div className="space-y-2 text-sm">
              {(["mindset", "energy", "business"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="capitalize">{k}</span>
                  <Sparkline values={series(k).length >= 2 ? series(k) : [0, 0]} width={140} height={28} />
                </div>
              ))}
            </div>
          </Card>
          <Card title="Profile">
            <form action={updateClientRecordAction} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid grid-cols-[4rem_1fr] gap-2">
                <Field label="Emoji">
                  <input className="field text-center" name="avatarEmoji" defaultValue={c.avatarEmoji} maxLength={4} />
                </Field>
                <Field label="Name">
                  <input className="field" name="name" defaultValue={c.name} />
                </Field>
              </div>
              <Field label="Status">
                <select className="field" name="status" defaultValue={c.status}>
                  {CLIENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Program">
                <select className="field" name="offerId" defaultValue={c.offerId ?? ""}>
                  <option value="">—</option>
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <input className="field" name="email" type="email" defaultValue={c.email ?? ""} />
              </Field>
              <Field label="Phone">
                <input className="field" name="phone" defaultValue={c.phone ?? ""} />
              </Field>
              <Field label="90-day goal">
                <textarea className="field" name="goal90" defaultValue={c.goal90 ?? ""} />
              </Field>
              <Field label="#1 fear">
                <input className="field" name="fear" defaultValue={c.fear ?? ""} />
              </Field>
              <Field label="#1 roadblock">
                <input className="field" name="roadblock" defaultValue={c.roadblock ?? ""} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <input className="field" name="startDate" type="date" defaultValue={c.startDate ?? ""} />
                </Field>
                <Field label="End">
                  <input className="field" name="endDate" type="date" defaultValue={c.endDate ?? ""} />
                </Field>
                <Field label="Check-in every (days)">
                  <input className="field tabular" name="checkinCadenceDays" type="number" min={1} defaultValue={c.checkinCadenceDays} />
                </Field>
                <Field label="Next call">
                  <input className="field" name="nextCallAt" type="datetime-local" defaultValue={c.nextCallAt?.slice(0, 16) ?? ""} />
                </Field>
              </div>
              {v.membership.passEnabled ? (
                <Field label="Pass serial (Community Loyalty)">
                  <input className="field" name="passSerial" defaultValue={c.passSerial ?? ""} />
                </Field>
              ) : null}
              <Field label="Notes">
                <textarea className="field" name="notes" defaultValue={c.notes ?? ""} />
              </Field>
              <button className="btn btn-primary w-full" type="submit">
                Save profile
              </button>
            </form>
          </Card>
          {v.membership.passEnabled ? (
            <Card title="Award pass points">
              <form action={awardMemberPointsAction} className="space-y-2">
                <input type="hidden" name="clientRecordId" value={c.id} />
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <input className="field tabular" name="points" type="number" defaultValue={10} />
                  <input className="field" name="reason" placeholder="Posted with the hashtag" />
                </div>
                <button className="btn btn-accent btn-sm" type="submit">
                  Award
                </button>
              </form>
              {points.length ? (
                <ul className="mt-3 divide-y text-xs">
                  {points.slice(0, 8).map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-1.5">
                      <span className="truncate">{p.reason}</span>
                      <span className="flex items-center gap-2">
                        <span className={p.syncStatus === "sent" ? "text-good" : p.syncStatus === "failed" ? "text-danger" : "text-ink-3"}>{p.syncStatus}</span>
                        <span className="tabular font-semibold">+{p.points}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
          <form action={deleteClientRecordAction}>
            <input type="hidden" name="id" value={c.id} />
            <button className="text-xs text-ink-3 hover:text-danger" type="submit">
              Remove client
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
