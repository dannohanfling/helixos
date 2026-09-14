/**
 * The identity model for a person HelixOS pushes to GoHighLevel. Pure.
 *
 * First push requires an identity; every push after that targets the id GoHighLevel returned. HelixOS stores that id and
 * never re-matches, so a second push cannot create a second contact. GoHighLevel owns the person: HelixOS holds the id, the
 * chatbot id when there is one, and the minimum to render a row. A name alone is not an identity and is never pushed.
 */
export type ContactIdentity = { email?: string | null; phone?: string | null; userNs?: string | null };
export type IdentityKind = "email-or-phone" | "user-ns";

/** The stages that push a pipeline contact to GoHighLevel. */
export const PUSHING_STAGES = ["call_booked", "client"] as const;
export const pushesAt = (stage: string) => (PUSHING_STAGES as readonly string[]).includes(stage);

/** The custom field, created once by hand in the sub-account, that carries the chatbot id. Writing it needs contacts.write only. */
export const USER_NS_FIELD_KEY = "helixos_user_ns";

export const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

export function identityOf(c: ContactIdentity): IdentityKind | null {
  if (clean(c.email) || clean(c.phone)) return "email-or-phone";
  if (clean(c.userNs)) return "user-ns";
  return null;
}

/** What the sync log says, and what the contact says, when there is nothing to push on. */
export const NO_IDENTITY_NOTE = "No email or phone to sync this contact with. Add one on the contact.";
/** What the stage change says when it is refused for the same reason. */
export const stageNeedsIdentity = (stage: string) => `Add an email or phone before marking ${stage === "client" ? "them a client" : "the call booked"}: that is what GoHighLevel matches on.`;
/** The sync log's note after a push, from what GoHighLevel said it did. */
export const pushedNote = (r: { id: string; isNew: boolean | null }, locationId: string) => (r.isNew === null ? `Contact ${r.id} updated in ${locationId}` : r.isNew ? `Created a new contact ${r.id} in ${locationId}` : `Linked to an existing contact ${r.id} in ${locationId}`);
