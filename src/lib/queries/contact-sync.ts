import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { identityOf } from "@/lib/engine/contact-sync";

/**
 * What a replay would push for one client, without pushing: client records and pipeline contacts with an identity and no
 * GoHighLevel id yet, and how many have no identity to push on.
 */
export async function replayCandidates(workspaceId: string, userId: string) {
  const [clients, contacts] = await Promise.all([
    db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.workspaceId, workspaceId), eq(schema.clientRecords.userId, userId)) }),
    db.query.contacts.findMany({ where: and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.userId, userId)) }),
  ]);
  const ready = [
    ...clients.filter((c) => !c.ghlContactId && identityOf(c)).map((c) => ({ kind: "client" as const, rowId: c.id, name: c.name, email: c.email, phone: c.phone, userNs: null, stage: "client", source: "HelixOS client" })),
    ...contacts.filter((c) => !c.ghlContactId && identityOf(c) && (c.stage === "call_booked" || c.stage === "client")).map((c) => ({ kind: "contact" as const, rowId: c.id, name: c.name, email: c.email, phone: c.phone, userNs: c.userNs, stage: c.stage, source: c.source })),
  ];
  const noIdentity = clients.filter((c) => !c.ghlContactId && !identityOf(c)).length + contacts.filter((c) => !c.ghlContactId && !identityOf(c) && (c.stage === "call_booked" || c.stage === "client")).length;
  const linked = clients.filter((c) => c.ghlContactId).length + contacts.filter((c) => c.ghlContactId).length;
  return { ready, noIdentity, linked };
}

