import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTENT_STATUSES, type ContentItem } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { setContentStatusAction } from "@/lib/actions/content";
import { ContentForm } from "@/components/content-form";
import { Badge, Card, Disclosure, Empty, PageHeader, Tabs } from "@/components/ui";
import { addDays, formatDate, rangeDays, startOfWeek } from "@/lib/dates";

export const metadata = { title: "Content" };

const STATUS_META: Record<(typeof CONTENT_STATUSES)[number], { label: string; icon: string; next?: (typeof CONTENT_STATUSES)[number]; nextLabel?: string }> = {
  idea: { label: "Ideas", icon: "💡", next: "creating", nextLabel: "Start creating" },
  creating: { label: "Creating", icon: "✍️", next: "ready", nextLabel: "It's ready" },
  ready: { label: "Ready", icon: "🚀", next: "scheduled", nextLabel: "Schedule" },
  scheduled: { label: "Scheduled", icon: "📆", next: "posted", nextLabel: "Posted ✓" },
  posted: { label: "Posted", icon: "✅" },
};

function ContentCard({ item, today }: { item: ContentItem; today: string }) {
  const meta = STATUS_META[item.status];
  const day = item.postAt?.slice(0, 10);
  const late = item.status !== "posted" && day && day < today;
  return (
    <div className="rounded-lg border bg-surface p-3 text-sm">
      <Link href={`/content/${item.id}`} className="font-medium hover:underline">
        {item.title}
      </Link>
      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-3">
        <span>{item.platform}</span>
        <span>· {item.contentType}</span>
        {item.hasCta ? <span className="badge badge-accent">CTA</span> : null}
        {day ? <span className={late ? "font-semibold text-danger" : ""}>· {late ? "late · " : ""}{formatDate(day, { month: "short", day: "numeric" })}</span> : null}
      </div>
      {item.status === "posted" ? (
        <div className="mt-2 flex gap-3 text-xs text-ink-2 tabular">
          <span>👍 {item.engagements}</span>
          <span>👀 {item.views.toLocaleString()}</span>
          <span>🆕 {item.leads}</span>
        </div>
      ) : meta.next ? (
        <form action={setContentStatusAction} className="mt-2">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="status" value={meta.next} />
          <button className="btn btn-soft btn-xs" type="submit">
            {meta.nextLabel}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const v = await requireViewer();
  const { view = "board" } = await searchParams;
  const items = await db.query.contentItems.findMany({
    where: eq(schema.contentItems.userId, v.user.id),
    orderBy: [asc(schema.contentItems.postAt), desc(schema.contentItems.createdAt)],
  });
  const posted = items.filter((i) => i.status === "posted").sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  const pipeline = items.filter((i) => i.status !== "posted");
  const thisWeek = posted.filter((i) => (i.postedAt ?? "").slice(0, 10) >= startOfWeek(v.today)).length;
  const tabs = [
    { key: "board", label: "Board", href: "/content", count: pipeline.length },
    { key: "calendar", label: "Calendar", href: "/content?view=calendar" },
    { key: "posted", label: "Posted", href: "/content?view=posted", count: posted.length },
    { key: "ladders", label: "Ladders", href: "/content/ladders" },
  ];

  return (
    <>
      <PageHeader
        title="Content"
        subtitle={`${thisWeek} posted this week. Done beats perfect.`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/content/compose" className="btn btn-primary btn-sm">✍️ New post</Link>
            <Disclosure summary={<span className="btn btn-ghost btn-sm">Quick idea</span>}>
              <div className="card p-4">
                <ContentForm today={v.today} />
              </div>
            </Disclosure>
          </div>
        }
      />
      <Tabs items={tabs} current={view} />

      {view === "board" ? (
        <div className="grid gap-3 md:grid-cols-4">
          {(["idea", "creating", "ready", "scheduled"] as const).map((s) => {
            const col = pipeline.filter((i) => i.status === s);
            return (
              <div key={s} className="rounded-xl bg-surface-2 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">
                  <span>
                    {STATUS_META[s].icon} {STATUS_META[s].label}
                  </span>
                  <span className="badge">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.length ? col.map((i) => <ContentCard key={i.id} item={i} today={v.today} />) : <div className="rounded-lg border border-dashed p-3 text-center text-xs text-ink-3">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {view === "calendar" ? (
        <div className="space-y-3">
          {[0, 1, 2].map((w) => {
            const monday = addDays(startOfWeek(v.today), w * 7);
            const days = rangeDays(monday, addDays(monday, 6));
            return (
              <Card key={monday} title={w === 0 ? "This week" : w === 1 ? "Next week" : `Week of ${formatDate(monday)}`}>
                <div className="grid gap-2 sm:grid-cols-7">
                  {days.map((day) => {
                    const dayItems = items.filter((i) => i.postAt?.slice(0, 10) === day);
                    const isToday = day === v.today;
                    return (
                      <div key={day} className={`min-h-24 rounded-lg p-2 ${isToday ? "bg-accent-soft" : "bg-surface-2"}`}>
                        <div className="mb-1 text-[11px] font-semibold text-ink-2">{formatDate(day, { weekday: "short", day: "numeric" })}</div>
                        <div className="space-y-1">
                          {dayItems.map((i) => (
                            <Link key={i.id} href={`/content/${i.id}`} className="block truncate rounded bg-surface px-1.5 py-1 text-[11px] hover:underline" title={i.title}>
                              {STATUS_META[i.status].icon} {i.title}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {view === "posted" ? (
        <Card>
          {posted.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-2">
                  <tr>
                    <th className="py-2 pr-3">Post</th>
                    <th className="py-2 pr-3">Where</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Eng.</th>
                    <th className="py-2 pr-3 text-right">Views</th>
                    <th className="py-2 text-right">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular">
                  {posted.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-3">
                        <Link href={`/content/${i.id}`} className="font-medium hover:underline">
                          {i.title}
                        </Link>{" "}
                        {i.hasCta ? <Badge tone="accent">CTA</Badge> : null}
                      </td>
                      <td className="py-2 pr-3 text-ink-2">{i.platform}</td>
                      <td className="py-2 pr-3 text-ink-2">{i.postedAt ? formatDate(i.postedAt.slice(0, 10)) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{i.engagements}</td>
                      <td className="py-2 pr-3 text-right">{i.views.toLocaleString()}</td>
                      <td className="py-2 text-right">{i.leads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="📭" title="Nothing posted yet" hint="Move a card to Posted and it shows up here with its numbers." />
          )}
        </Card>
      ) : null}
    </>
  );
}
