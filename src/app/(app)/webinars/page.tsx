import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createWebinarAction, duplicateExampleAction } from "@/lib/actions/webinars";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { STEPS, nextStep, webinarProgress } from "@/lib/engine/webinar";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Webinars" };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" }> = {
  draft: { label: "Draft", tone: "neutral" },
  building: { label: "Building", tone: "accent" },
  ready: { label: "Ready", tone: "good" },
  scheduled: { label: "Scheduled", tone: "good" },
  delivered: { label: "Delivered", tone: "neutral" },
};

export default async function WebinarsPage() {
  const v = await requireViewer();
  const list = await db.query.webinars.findMany({ where: eq(schema.webinars.userId, v.user.id), orderBy: [asc(schema.webinars.isExample), desc(schema.webinars.createdAt)] });
  const ids = list.map((w) => w.id);
  const [sections, beliefs, reviews] = ids.length
    ? await Promise.all([
        db.query.webinarSections.findMany({ where: inArray(schema.webinarSections.webinarId, ids) }),
        db.query.webinarBeliefs.findMany({ where: inArray(schema.webinarBeliefs.webinarId, ids) }),
        db.query.readinessReviews.findMany({ where: inArray(schema.readinessReviews.webinarId, ids), orderBy: desc(schema.readinessReviews.createdAt) }),
      ])
    : [[], [], []];
  const delivered = list.filter((w) => w.status === "delivered");
  const totals = delivered.reduce((a, w) => ({ registered: a.registered + w.registered, showed: a.showed + w.showed, sales: a.sales + w.sales, revenue: a.revenue + w.revenue }), { registered: 0, showed: 0, sales: 0, revenue: 0 });

  return (
    <>
      <PageHeader
        title="Webinars"
        subtitle="Five acts. Three belief breaks. One offer. Build it once, run it monthly."
        action={
          <div className="flex gap-2">
            <form action={duplicateExampleAction}>
              <button className="btn btn-ghost btn-sm" type="submit">
                Start from the example
              </button>
            </form>
            <Disclosure summary={<span className="btn btn-primary btn-sm">+ New webinar</span>}>
              <form action={createWebinarAction} className="card grid gap-3 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Working title">
                    <input className="field" name="title" required placeholder="How to lose 15 lbs without giving up wine" autoFocus />
                  </Field>
                </div>
                <Field label="Type">
                  <select className="field" name="category" defaultValue="Live">
                    <option>Live</option>
                    <option>Evergreen</option>
                    <option>JV / partner</option>
                    <option>Challenge</option>
                  </select>
                </Field>
                <Field label="Promise (rough is fine)">
                  <input className="field" name="promise" placeholder="Leave with a plan you can run this week" />
                </Field>
                <div className="sm:col-span-2">
                  <button className="btn btn-primary" type="submit">
                    Open the wizard
                  </button>
                </div>
              </form>
            </Disclosure>
          </div>
        }
      />
      {delivered.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Delivered", delivered.length],
            ["Registered", totals.registered],
            ["Show-up rate", totals.registered ? `${Math.round((totals.showed / totals.registered) * 100)}%` : "—"],
            ["Revenue", `$${totals.revenue.toLocaleString()}`],
          ].map(([k, val]) => (
            <div key={String(k)} className="card p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{k}</div>
              <div className="mt-1 text-2xl font-semibold">{val}</div>
            </div>
          ))}
        </div>
      ) : null}
      {list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((w) => {
            const secs = sections.filter((s) => s.webinarId === w.id);
            const bel = beliefs.filter((b) => b.webinarId === w.id);
            const rev = reviews.find((r) => r.webinarId === w.id) ?? null;
            const p = webinarProgress(w, secs, bel, rev);
            const next = STEPS.find((s) => s.key === nextStep(p.steps))!;
            return (
              <Link key={w.id} href={`/webinars/${w.id}?step=${w.status === "delivered" ? "run" : next.key}`} className="card block p-4 transition hover:border-ink">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{w.title}</div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {w.category}
                      {w.scheduledAt ? ` · ${formatDate(w.scheduledAt.slice(0, 10), { month: "short", day: "numeric" })}` : ""}
                      {w.isExample ? " · worked example" : ""}
                    </div>
                  </div>
                  <Badge tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Badge>
                </div>
                {w.promise ? <p className="mt-2 text-sm text-ink-2">{w.promise}</p> : null}
                <div className="mt-3">
                  <Progress value={p.overall} tone={p.overall >= 100 ? "good" : "accent"} height={6} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-ink-3">
                  <span>
                    {p.drafted}/{secs.length} sections · ~{p.totalMinutes} min
                  </span>
                  <span>
                    {w.status === "delivered" ? `${w.showed}/${w.registered} showed · $${w.revenue.toLocaleString()}` : `Next: ${next.icon} ${next.label}`}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty icon="🎤" title="No webinars yet" hint="Start from the worked example to see what done looks like, or open the wizard with your own title." />
      )}
    </>
  );
}
