import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { NewTaskForm } from "@/components/new-task-form";
import { TaskRow } from "@/components/task-row";
import { taskOrigins } from "@/lib/queries/tasks";
import { Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { addDays, formatDate } from "@/lib/dates";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const v = await requireViewer();
  const { filter = "open" } = await searchParams;
  const today = v.today;
  const open = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, v.user.id), ne(schema.tasks.status, "done")),
    orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
  });
  const done = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, v.user.id), eq(schema.tasks.status, "done")),
    orderBy: desc(schema.tasks.completedAt),
    limit: 50,
  });
  const origins = await taskOrigins([...open, ...done]);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const focus = open.filter((t) => t.focusDate === today);
  const later = open.filter((t) => !t.dueDate || t.dueDate > today);

  const tabs = [
    { key: "open", label: "Open", href: "/tasks", count: open.length },
    { key: "overdue", label: "Overdue", href: "/tasks?filter=overdue", count: overdue.length },
    { key: "done", label: "Done", href: "/tasks?filter=done", count: done.length },
  ];

  const groups: { title: string; items: typeof open }[] = [];
  if (filter === "overdue") groups.push({ title: "Overdue", items: overdue });
  else if (filter === "done") groups.push({ title: "Completed", items: done });
  else {
    if (focus.length) groups.push({ title: "★ Top 3 today", items: focus });
    if (overdue.length) groups.push({ title: "Overdue", items: overdue });
    groups.push({ title: "Due today", items: dueToday.filter((t) => t.focusDate !== today) });
    const byDay = new Map<string, typeof open>();
    for (const t of later) {
      const k = t.dueDate ?? "someday";
      byDay.set(k, [...(byDay.get(k) ?? []), t]);
    }
    for (const [k, items] of [...byDay.entries()].sort()) {
      groups.push({ title: k === "someday" ? "Someday" : k === addDays(today, 1) ? "Tomorrow" : formatDate(k, { weekday: "long", month: "short", day: "numeric" }), items });
    }
  }

  return (
    <>
      <PageHeader title="Tasks" subtitle="Three that matter, then everything else." action={<NewTaskForm today={today} />} />
      <Tabs items={tabs} current={filter} />
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.title} title={g.title}>
            {g.items.length ? (
              <div className="-mx-2 divide-y">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} origin={origins.get(t.id)} />
                ))}
              </div>
            ) : (
              <Empty icon="🎯" title={g.title === "Due today" ? "Nothing else due today" : "Nothing here"} hint={g.title === "Due today" ? "Add one thing that moves a conversation forward." : undefined} />
            )}
          </Card>
        ))}
        {filter === "done" && !done.length ? <Empty icon="✅" title="No completed tasks yet" hint="Check one off on Today and it lands here." /> : null}
      </div>
    </>
  );
}
