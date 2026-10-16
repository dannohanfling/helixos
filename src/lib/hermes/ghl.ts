/**
 * Registration into the member's own GoHighLevel sub-account, with the connector's own credentials (src/lib/ghl.ts, unchanged):
 * the contact is found by its GoHighLevel id when the sign-up came with one, else by email (resolveContact), then the two Inner Circle tags go on with GoHighLevel's add-tags call (which adds,
 * never replaces), then the event date goes into the "IC Event Date" custom field when the sub-account has one and the key may
 * read the field list. GoHighLevel's own workflow starts on the ic-registered tag. A missing scope skips that step only. Returns
 * outcomes, never the person's details; nothing about them is logged.
 */
import { connectionFor, credentials } from "@/lib/ghl";
import { logSync } from "@/lib/integrations";
import type { CallWhen } from "@/lib/hermes/when";
import { dayTag } from "@/lib/hermes/when";

const VERSION = "2021-07-28";
export const REGISTERED_TAG = "ic-registered";
export const EVENT_DATE_FIELD = "contact.ic_event_date";

export type GhlOutcome = {
  ok: boolean;
  step: "no connection" | "contact" | "tags" | "done";
  dateField: "set" | "none" | "no access" | "failed";
  /** How the contact id the sign-up came with fared: used, skipped (other location, gone or no answer), another email on it, or none given. */
  idStep?: IdStep;
  phoneElsewhere?: boolean;
  /** H-51: the contact on file carries a different email; nothing was written to it, the registration went by email. */
  emailElsewhere?: boolean;
};
export type IdStep = "hit" | "miss" | "other email" | "none";
export type GhlPerson = { firstName: string; lastName: string | null; email: string; phone: string | null; ghlContactId?: string | null };

type Found = { id: string; email?: string | null } | null;

/**
 * Step 1 (H-51): the contact by the id the sign-up came with. It counts only when it exists in this sub-account; one whose
 * email differs from the typed one is reported and left alone. Empty email or phone on it are filled in; set ones never change.
 */
async function findById(base: string, token: string, locationId: string, id: string, p: { email: string; phone: string | null }): Promise<{ step: IdStep; id: string | null }> {
  const r = await call(base, token, `/contacts/${encodeURIComponent(id)}`, { method: "GET" });
  const c = (r.json as { contact?: { id?: string; email?: string | null; phone?: string | null; locationId?: string | null } | null } | null)?.contact;
  if (!r.ok || !c?.id || c.locationId !== locationId) return { step: "miss", id: null };
  if (c.email && c.email.trim().toLowerCase() !== p.email) return { step: "other email", id: null };
  const fill: Record<string, string> = {};
  if (!c.email) fill.email = p.email;
  if (!c.phone && p.phone) fill.phone = p.phone;
  // Best effort: a refused fill (a phone already on another contact, say) still leaves the registration on this contact.
  if (Object.keys(fill).length) await call(base, token, `/contacts/${encodeURIComponent(c.id)}`, { method: "PUT", body: JSON.stringify(fill) });
  return { step: "hit", id: c.id };
}
/** One contact by email alone, or by phone alone (GoHighLevel's duplicate search, one key at a time). */
async function findBy(base: string, token: string, locationId: string, key: "email" | "number", value: string): Promise<{ ok: boolean; status: number; contact: Found }> {
  const r = await call(base, token, `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&${key}=${encodeURIComponent(value)}`, { method: "GET" });
  const c = (r.json as { contact?: { id?: string; email?: string | null } | null } | null)?.contact;
  return { ok: r.ok, status: r.status, contact: c?.id ? { id: c.id, email: c.email ?? null } : null };
}

/**
 * Which contact a registration lands on. By the GoHighLevel id the sign-up came with when there is one (H-51), otherwise, and
 * when that contact has another email (H-15, H-17: a phone matched someone else's 2024 contact), email first, always. The
 * phone is used only when no contact has the email, and only if that contact has no email of its own (it gets this one; an
 * existing email is never changed). A phone that sits on a contact with another email is left alone: a new contact is made
 * with the email, without that phone, and the mismatch is reported. Nothing about an existing contact is overwritten.
 */
async function resolveContact(base: string, token: string, locationId: string, p: GhlPerson): Promise<{ id: string | null; status: number; phoneElsewhere: boolean; idStep: IdStep }> {
  let idStep: IdStep = "none";
  if (p.ghlContactId) {
    const byId = await findById(base, token, locationId, p.ghlContactId, p);
    idStep = byId.step;
    if (byId.id) return { id: byId.id, status: 200, phoneElsewhere: false, idStep };
  }
  const rest = await resolveByEmail(base, token, locationId, p);
  return { ...rest, idStep };
}

/** Steps 2 and 3: by email, then a new contact (PR #2's rule, unchanged). */
async function resolveByEmail(base: string, token: string, locationId: string, p: GhlPerson): Promise<{ id: string | null; status: number; phoneElsewhere: boolean }> {
  const byEmail = await findBy(base, token, locationId, "email", p.email);
  if (!byEmail.ok) return { id: null, status: byEmail.status, phoneElsewhere: false };
  const byPhone = p.phone ? await findBy(base, token, locationId, "number", p.phone) : { ok: true, status: 200, contact: null };
  const phoneElsewhere = Boolean(byPhone.contact && byPhone.contact.id !== byEmail.contact?.id && (byEmail.contact || (byPhone.contact.email && byPhone.contact.email.toLowerCase() !== p.email)));
  if (byEmail.contact) return { id: byEmail.contact.id, status: 200, phoneElsewhere };
  if (byPhone.contact && !byPhone.contact.email) {
    const set = await call(base, token, `/contacts/${encodeURIComponent(byPhone.contact.id)}`, { method: "PUT", body: JSON.stringify({ email: p.email }) });
    return { id: set.ok ? byPhone.contact.id : null, status: set.status, phoneElsewhere: false };
  }
  const made = await call(base, token, "/contacts/", { method: "POST", body: JSON.stringify({ locationId, firstName: p.firstName, lastName: p.lastName ?? undefined, email: p.email, phone: phoneElsewhere ? undefined : (p.phone ?? undefined), source: "HelixOS page" }) });
  const id = (made.json as { contact?: { id?: string } } | null)?.contact?.id ?? null;
  return { id: made.ok ? id : null, status: made.status, phoneElsewhere };
}

async function call(base: string, token: string, path: string, init: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", "content-type": "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/** The id of the sub-account's custom field with this key ("contact.ic_event_date"), when the key may list them. */
async function fieldId(base: string, token: string, locationId: string, key: string): Promise<{ id: string | null; access: boolean }> {
  const r = await call(base, token, `/locations/${encodeURIComponent(locationId)}/customFields?model=contact`, { method: "GET" });
  if (!r.ok) return { id: null, access: r.status !== 401 && r.status !== 403 };
  const list = (r.json as { customFields?: { id?: string; fieldKey?: string }[] } | null)?.customFields ?? [];
  const want = key.toLowerCase();
  const hit = list.find((f) => (f.fieldKey ?? "").toLowerCase() === want || `contact.${(f.fieldKey ?? "").toLowerCase()}` === want);
  return { id: hit?.id ?? null, access: true };
}

export async function registerInGhl(m: { workspaceId: string; userId: string }, person: GhlPerson, when: CallWhen): Promise<GhlOutcome> {
  const tags = [REGISTERED_TAG, dayTag(when)];
  const log = (status: "sent" | "failed" | "skipped", note: string) => logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "gohighlevel", direction: "out", event: "hermes.register", payload: { tags }, status, note }).catch(() => undefined);

  const conn = await connectionFor(m.userId);
  if (!conn || conn.workspaceId !== m.workspaceId) {
    await log("skipped", "No GoHighLevel connection on this account");
    return { ok: false, step: "no connection", dateField: "none" };
  }
  const cred = await credentials(conn);
  if (!cred.ok) {
    await log("failed", cred.error);
    return { ok: false, step: "contact", dateField: "none" };
  }
  const base = cred.data.base.replace(/\/$/, "");
  const found = await resolveContact(base, cred.data.token, conn.locationId, person);
  const flags = { idStep: found.idStep, phoneElsewhere: found.phoneElsewhere, emailElsewhere: found.idStep === "other email" };
  if (!found.id) {
    await log("failed", `Contact not saved (${found.status || "no answer"}); contact id ${found.idStep}`);
    return { ok: false, step: "contact", dateField: "none", ...flags };
  }
  const up = { data: { id: found.id } };
  const tagged = await call(base, cred.data.token, `/contacts/${encodeURIComponent(up.data.id)}/tags`, { method: "POST", body: JSON.stringify({ tags }) });
  if (!tagged.ok) {
    await log("failed", `Contact saved, tags not added (${tagged.status || "no answer"})`);
    return { ok: false, step: "tags", dateField: "none", ...flags };
  }

  let dateField: GhlOutcome["dateField"] = "none";
  const f = await fieldId(base, cred.data.token, conn.locationId, EVENT_DATE_FIELD);
  if (!f.access) dateField = "no access";
  else if (f.id) {
    const set = await call(base, cred.data.token, `/contacts/${encodeURIComponent(up.data.id)}`, { method: "PUT", body: JSON.stringify({ customFields: [{ id: f.id, field_value: when.isoDay }] }) });
    dateField = set.ok ? "set" : "failed";
  }
  const notes = [found.phoneElsewhere ? "the phone matches another contact, left alone" : "", flags.emailElsewhere ? "the contact id on file has another email, left alone" : ""].filter(Boolean);
  await log("sent", `Registered: tags ${tags.join(", ")}; event date field ${dateField}; contact id ${found.idStep}${notes.map((n) => `; ${n}`).join("")}`);
  return { ok: true, step: "done", dateField, ...flags };
}
