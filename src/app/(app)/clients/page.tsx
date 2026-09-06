import Link from "next/link";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createClientRecordAction } from "@/lib/actions/clients";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Tabs } from "@/components/ui";
import { addDays, relativeDay } from "@/lib/dates";
import { tierFor } from "@/lib/engine/tiers";

export const metadata = { title: "Clients" };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" }> = {
  lead: { label: "Lead", tone: "neutral" },
  active: { label: "Active", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Completed", tone: "accent" },
  alumni: { label: "Alumni", tone: "neutral" },
};

export function checkinDue(c: { lastCheckinAt: string | null; startDate: string | null; checkinCadenceDays: number; status: string }, today: string): boolean {
  if (c.status !== "active") return false;
  const base = c.lastCheckinAt ?? c.startDate;
  if (!base) return true;
  return addDays(base, c.checkinCadenceDays) <= today;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const v = await requireViewer();
  const { filter = "active" } = await searchParams;
  const [records, offers] = await Promise.all([
    db.query.clientRecords.findMany({ where: eq(schema.clientRecords.userId, v.user.id), orderBy: asc(schema.clientRecords.name) }),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
  ]);
  const linked = records.map((r) => r.contactId).filter((x): x is string => Boolean(x));
  const convertible = await db.query.contacts.findMany({
    where: and(eq(schema.contacts.userId, v.user.id), inArray(schema.contacts.stage, ["client", "call_booked"]), linked.length ? notInArray(schema.contacts.id, linked) : undefined),
  });
  const points = records.length ? await db.query.memberPoints.findMany({ where: inArray(schema.memberPoints.clientRecordId, records.map((r) => r.id)) }) : [];
  const pointsFor = (id: string) => points.filter((p) => p.clientRecordId === id).reduce((a, p) => a + p.points, 0);
  const active = records.filter((r) => r.status === "active");
  const due = active.filter((r) => checkinDue(r, v.today));
  const list = filter === "due" ? due : filter === "all" ? records : filter === "past" ? records.filter((r) => r.status === "completed" || r.status === "alumni" || r.status === "paused") : active;
  const tabs = [
    { key: "active", label: "Active", href: "/clients", count: active.length },
    { key: "due", label: "Check-in due", href: "/clients?filter=due", count: due.length },
    { key: "past", label: "Past & paused", href: "/clients?filter=past" },
    { key: "all", label: "All", href: "/clients?filter=all", count: records.length },
  ];
  const cashMonth = 0;
  void cashMonth;

  return (
    <>
      <PageHeader
        title="Your clients"
        subtitle={`${active.length} active · ${due.length} due for a check-in. Coach them the way you're being coached.`}
        action={
          <Disclosure summary={<span className="btn btn-primary btn-sm">+ New client</span>}>
            <form action={createClientRecordAction} className="card grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Name">
                <input className="field" name="name" required autoFocus />
              </Field>
              <Field label="Email">
                <input className="field" name="email" type="email" />
              </Field>
              <Field label="Program / offer">
                <select className="field" name="offerId" defaultValue="">
                  <option value="">—</option>
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start date">
                <input className="field" name="startDate" type="date" defaultValue={v.today} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Their 90-day goal">
                  <input className="field" name="goal90" placeholder="Lose 15 lbs and keep it off through the holidays." />
                </Field>
              </div>
              <Field label="#1 fear">
                <input className="field" name="fear" />
              </Field>
              <Field label="#1 roadblock">
                <input className="field" name="roadblock" />
              </Field>
              <Field label="Check-in every (days)">
                <input className="field tabular" name="checkinCadenceDays" type="number" min={1} defaultValue={7} />
              </Field>
              <Field label="Next call">
                <input className="field" name="nextCallAt" type="datetime-local" />
              </Field>
              <div className="sm:col-span-2">
                <button className="btn btn-primary" type="submit">
                  Add client
                </button>
              </div>
            </form>
          </Disclosure>
        }
      />
      <Tabs items={tabs} current={filter} />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          {list.length ? (
            <div className="-mx-2 divide-y">
              {list.map((c) => {
                const isDue = checkinDue(c, v.today);
                const pts = pointsFor(c.id);
                return (
                  <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center gap-3 px-2 py-2.5 hover:bg-surface-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-lg">{c.avatarEmoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                        {isDue ? <Badge tone="warn">check-in due</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {c.programName ?? offers.find((o) => o.id === c.offerId)?.name ?? "No program"}
                        {c.goal90 ? ` · ${c.goal90}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-ink-3">
                      {c.nextCallAt ? <div className="font-semibold text-good">📞 {relativeDay(c.nextCallAt.slice(0, 10), v.today)}</div> : null}
                      {c.lastCheckinAt ? <div>checked in {relativeDay(c.lastCheckinAt, v.today).toLowerCase()}</div> : <div>no check-ins yet</div>}
                      {v.membership.passEnabled ? (
                        <div>
                          {pts.toLocaleString()} pts · {tierFor(pts).name}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty icon="🤝" title={filter === "due" ? "Nobody is due" : "No clients here yet"} hint={filter === "due" ? "Every active client has been checked in on within their cadence." : "Add your first client, or pull one in from Conversations."} />
          )}
        </Card>
        <div className="space-y-4">
          {convertible.length ? (
            <Card title="Turn conversations into clients">
              <ul className="space-y-2">
                {convertible.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {c.name} <span className="text-xs text-ink-3">· {c.stage.replace("_", " ")}</span>
                    </span>
                    <form action={createClientRecordAction}>
                      <input type="hidden" name="name" value={c.name} />
                      <input type="hidden" name="contactId" value={c.id} />
                      <input type="hidden" name="goal90" value={c.whatTheyreBuilding ?? ""} />
                      <button className="btn btn-soft btn-xs" type="submit">
                        Add as client
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card title="Weekly rhythm">
            <ul className="space-y-1.5 text-sm text-ink-2">
              <li>1. Check in on every active client on their cadence. Wins first, then blockers.</li>
              <li>2. Score mindset, energy, business 1 to 10. Watch the trend, not the number.</li>
              <li>3. One next step per client. Written down. Theirs, not yours.</li>
              <li>4. Ask for the win in public. Wins become content and referrals.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
