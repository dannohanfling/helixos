/**
 * The proof a preview page may show (H-142): the same rule as a public page (approved, with the permission tick, the quote
 * with the name once, no numbers until the webinar's proof is picked), read here so the preview route doesn't reach into
 * Hermes's data module for a private helper.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hasNumbers, quoteOnce } from "@/lib/hermes/rules";
import type { Proof } from "@/lib/hermes/data";

type Member = { workspaceId: string; userId: string };

export async function proofsForPreview(m: Member, ids: string[], picked: boolean): Promise<Proof[]> {
  if (!ids.length) return [];
  const rows = await db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, m.workspaceId), eq(schema.proofs.userId, m.userId), eq(schema.proofs.status, "approved")), columns: { id: true, who: true, name: true, quote: true, shortVersion: true, resultAfter: true, permissionAt: true } });
  const out: Proof[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id && x.permissionAt);
    if (!r) continue;
    const who = r.who?.trim() || r.name;
    const quote = quoteOnce((r.quote ?? r.shortVersion ?? r.resultAfter ?? "").trim(), who);
    if (!quote || (!picked && hasNumbers(quote))) continue;
    out.push({ id: r.id, who, quote });
  }
  return out.slice(0, 3);
}
