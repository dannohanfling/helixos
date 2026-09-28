import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { intentionsDue, weekOf, type IntentionsDue } from "@/lib/engine/intentions";
import { monthOf } from "@/lib/engine/month-intentions";
import { feedbackMonth } from "@/lib/engine/feedback";

/** What is due on Intentions for this member today: the menu's badge and the page's own order (rev 157). */
export async function intentionsDueFor(workspaceId: string, userId: string, today: string): Promise<IntentionsDue[]> {
  const fbMonth = feedbackMonth(today);
  const [week, month, fb] = await Promise.all([
    db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, weekOf(today))) }),
    db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.workspaceId, workspaceId), eq(schema.monthlyIntentions.userId, userId), eq(schema.monthlyIntentions.month, monthOf(today))) }),
    fbMonth ? db.query.monthlyFeedback.findFirst({ where: and(eq(schema.monthlyFeedback.workspaceId, workspaceId), eq(schema.monthlyFeedback.userId, userId), eq(schema.monthlyFeedback.month, fbMonth)) }) : Promise.resolve(undefined),
  ]);
  return intentionsDue(today, { week: week ?? null, monthSet: Boolean(month), feedbackMonth: fbMonth, feedbackGiven: Boolean(fb) });
}
