import { asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { TemplateLite } from "@/components/template-picker";

export async function templatesFor(workspaceId: string): Promise<TemplateLite[]> {
  const rows = await db.query.dmTemplates.findMany({
    where: or(isNull(schema.dmTemplates.workspaceId), eq(schema.dmTemplates.workspaceId, workspaceId)),
    orderBy: [asc(schema.dmTemplates.sequence), asc(schema.dmTemplates.step), asc(schema.dmTemplates.branch)],
  });
  return rows.map((r) => ({ id: r.id, name: r.name, sequence: r.sequence, step: r.step, branch: r.branch, body: r.body, whenToSend: r.whenToSend }));
}
