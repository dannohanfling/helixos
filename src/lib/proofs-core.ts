/**
 * The Proof Bank's add, shared (Voice pack 2, rev 642): the page's form and the connector's proof_add call this one function.
 * Every proof starts as a draft, private to the Proof Bank; the permission tick is recorded only when it is given and there is
 * someone to have given it. Approval, with its attachment check, stays on the proof's own page.
 */
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

export type ProofFields = Omit<typeof schema.proofs.$inferInsert, "id" | "workspaceId" | "userId" | "status" | "permissionAt" | "permissionBy">;

/** One-line proof, built from the parts when no short version was written. */
export function autoShort(f: Pick<ProofFields, "shortVersion" | "who" | "resultAfter" | "problemBefore">): string | null {
  if (f.shortVersion) return f.shortVersion;
  const who = f.who ?? "A client";
  if (f.resultAfter && f.problemBefore) return `${who} went from "${f.problemBefore.replace(/[.]$/, "")}" to ${f.resultAfter.replace(/[.]$/, "")}.`;
  if (f.resultAfter) return `${who}: ${f.resultAfter}`;
  return null;
}

export async function createProof(m: { workspaceId: string; userId: string }, f: ProofFields, opts: { permission: boolean }): Promise<string> {
  const id = newId();
  const ticked = opts.permission && Boolean(f.who);
  await db.insert(schema.proofs).values({ ...f, id, workspaceId: m.workspaceId, userId: m.userId, status: "draft", shortVersion: autoShort(f), ...(ticked ? { permissionAt: nowIso(), permissionBy: m.userId } : {}) });
  return id;
}
