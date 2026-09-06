import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { addDays, todayInTz } from "@/lib/dates";

/** Gives a brand-new client a pathway, a first goal, and a few starter tasks so day one is never empty. */
export async function seedNewClient(workspaceId: string, userId: string): Promise<void> {
  const workspace = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) });
  const today = todayInTz(workspace?.timezone ?? "America/Los_Angeles");
  const library = await db.query.libraryTasks.findMany();
  if (library.length) {
    await db
      .insert(schema.pathwayProgress)
      .values(library.map((t) => ({ id: newId(), workspaceId, userId, libraryTaskKey: t.key, status: "todo" as const })))
      .onConflictDoNothing();
  }
  await db.insert(schema.goals).values({
    id: newId(),
    workspaceId,
    userId,
    title: "Cash collected this month",
    target: 0, // not set: Today hides the bar until the client chooses a number on Settings
    actual: 0,
    unit: "$",
    period: "This month",
    primary: true,
  });
  const starters: { title: string; details: string; urgency: "top3" | "high" | "medium"; category: "sales" | "content" | "community" | "system"; due: number }[] = [
    { title: "Reach out to 3 people in your audience", details: "Not a pitch. A real 'I noticed your work on X.' Log each one in Conversations.", urgency: "top3", category: "sales", due: 0 },
    { title: "Post one update with today's hashtag", details: "What you're working on today. What you finished yesterday. Short beats perfect.", urgency: "top3", category: "content", due: 0 },
    { title: "Write your Big Promise in one sentence", details: "I help [who] go from [pain] to [outcome] in [time] without [thing they hate].", urgency: "high", category: "system", due: 1 },
    { title: "Pick where your community lives", details: "Facebook group, Skool, Slack. Choose one. You can change it later.", urgency: "medium", category: "community", due: 2 },
  ];
  await db.insert(schema.tasks).values(
    starters.map((s) => ({
      id: newId(),
      workspaceId,
      userId,
      title: s.title,
      details: s.details,
      urgency: s.urgency,
      category: s.category,
      status: s.due === 0 ? ("today" as const) : ("upcoming" as const),
      dueDate: addDays(today, s.due),
      focusDate: s.urgency === "top3" ? today : null,
      points: s.urgency === "top3" ? 15 : 5,
    })),
  );
}
