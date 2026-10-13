/**
 * The GoHighLevel contact id that comes with a sign-up (H-49, H-51). mf_prepare hands it over through rememberGhlContact, which
 * keeps it in hermes_contact_links and never lets a failure reach the bot; registration reads it back with ghlContactFor. Only
 * the id is kept, keyed by the sign-up's own id, so nothing about the person is added anywhere.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hermesContactLinks } from "@/db/schema-hermes";

/** A GoHighLevel contact id as the bot sends it: trimmed, 8 to 40 of [A-Za-z0-9_-], else null. */
export function cleanGhlContactId(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9_-]{8,40}$/.test(s) ? s : null;
}

/** Keeps the id with the sign-up (an upsert). A null id is a no-op; a missing table or any other error is swallowed. */
export async function rememberGhlContact(signupId: string, ghlContactId: string | null | undefined): Promise<void> {
  if (!ghlContactId) return;
  try {
    await db.insert(hermesContactLinks).values({ signupId, ghlContactId }).onConflictDoUpdate({ target: hermesContactLinks.signupId, set: { ghlContactId } });
  } catch {
    // mf_prepare never fails because of the link; registration then goes by email.
  }
}

/** The id kept for this sign-up, or null (none, or no table on this database yet). */
export async function ghlContactFor(signupId: string): Promise<string | null> {
  try {
    const rows = await db.select({ id: hermesContactLinks.ghlContactId }).from(hermesContactLinks).where(eq(hermesContactLinks.signupId, signupId));
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
