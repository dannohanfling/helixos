import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canUndo } from "@/lib/engine/proof-bank";

/** The member's last Approve selected batch when it can still be undone (within 24 hours, not undone yet), else null. */
export async function undoableBatch(userId: string): Promise<schema.ProofBatch | null> {
  const last = await db.query.proofBatches.findFirst({ where: eq(schema.proofBatches.userId, userId), orderBy: [desc(schema.proofBatches.approvedAt)] });
  return canUndo(last, Date.now()) ? last! : null;
}
