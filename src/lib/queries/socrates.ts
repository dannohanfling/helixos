import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { QuestionLike } from "@/lib/engine/socrates";

/** The library (owner-less rows, in seed order) plus this client's own questions. A client never sees another client's. */
export async function visibleQuestions(userId: string): Promise<QuestionLike[]> {
  const rows = await db.query.socratesQuestions.findMany({ where: or(isNull(schema.socratesQuestions.userId), eq(schema.socratesQuestions.userId, userId)), orderBy: [asc(schema.socratesQuestions.key), asc(schema.socratesQuestions.createdAt)] });
  const library = rows.filter((r) => r.userId === null);
  const own = rows.filter((r) => r.userId === userId);
  return [...library, ...own].map((r) => ({ id: r.id, question: r.question, clarityStage: r.clarityStage, nepqCategory: r.nepqCategory, source: r.source, scriptTypes: r.scriptTypes, own: r.userId === userId }));
}

export async function ownScript(id: string, userId: string) {
  return db.query.socratesScripts.findFirst({ where: and(eq(schema.socratesScripts.id, id), eq(schema.socratesScripts.userId, userId)) });
}
