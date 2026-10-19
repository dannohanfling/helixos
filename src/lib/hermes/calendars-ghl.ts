/**
 * The GoHighLevel calls behind Coach → Booking calendars (H-892, plan H-1040): with the coach's own saved connection, server
 * side only, never a key in the browser. Step 1 reads (the template, the stray copy, the users, the calendar list). Step 2
 * writes the two calendars, Academy first. Step 3 books one test call on each for the test contact, checks a Zoom link came
 * back, and cancels both. Each step runs only when Danno presses its button; nothing here runs on its own. Logged with the
 * cause and the outcome only, never a contact's details.
 */
import type { SocialConnection } from "@/db/schema";
import { connectionFor, credentials, listUsers } from "@/lib/ghl";
import { logSync } from "@/lib/integrations";
import { redactSecrets } from "@/lib/engine/redact";
import { ACADEMY_COPY_ID, CALENDARS, CAL_LOCATION, CAL_SCOPES, TEMPLATE_ID, calendarBody, firstSlot, maskZoom, zoomLink, type CalKey } from "@/lib/hermes/calendars";

/** The calendars API's own version header (GoHighLevel's calendars spec), not the contacts one. */
const CAL_VERSION = "2021-04-15";

export type Cal = Record<string, unknown> & { id?: string; name?: string; slug?: string; widgetSlug?: string; teamMembers?: { userId?: string }[] };
type Res<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const NEED = `Add ${CAL_SCOPES.join(", ")} to your own Private Integration in GoHighLevel (Settings → Private Integrations), then try again.`;

function explain(status: number | undefined, what: string, detail = ""): string {
  if (status === 401 || status === 403) return `GoHighLevel refused ${what}: the saved key has no calendar permission. ${NEED}`;
  if (status === 404) return `GoHighLevel has no ${what.replace(/^reading |^updating |^creating /, "")} in this sub-account.`;
  if (status === 400 || status === 422) return `GoHighLevel didn't accept ${what} (${status}): ${detail || "no reason given"}.`;
  return status ? `GoHighLevel didn't accept ${what} (${status}).` : `Couldn't reach GoHighLevel for ${what}.`;
}

async function call<T>(base: string, token: string, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: T | null; detail: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Version: CAL_VERSION, Accept: "application/json", "content-type": "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    let detail = "";
    if (!res.ok) {
      const raw = json && typeof json === "object" && "message" in json ? (json as { message: unknown }).message : text;
      // GoHighLevel's validation messages name fields, not people; redacted and capped all the same.
      detail = redactSecrets((Array.isArray(raw) ? raw.map(String).join("; ") : String(raw ?? "")).slice(0, 400));
      console.error("[hermes-calendars] upstream", JSON.stringify({ status: res.status, path: path.split("?")[0], message: detail }));
    }
    return { ok: res.ok, status: res.status, json: json as T, detail };
  } catch (e) {
    console.error("[hermes-calendars] request failed", JSON.stringify({ path: path.split("?")[0], cause: e instanceof Error ? e.name : "error" }));
    return { ok: false, status: 0, json: null, detail: "" };
  }
}

const log = (conn: SocialConnection, status: "sent" | "failed", note: string, payload: Record<string, unknown> = {}) =>
  logSync({ workspaceId: conn.workspaceId, userId: conn.userId, provider: "gohighlevel", direction: "out", event: "hermes.calendars", payload, status, note }).catch(() => undefined);

type Ctx = { conn: SocialConnection; base: string; token: string };

/** The coach's own connection, only when it is the brief's sub-account. */
export async function calendarContext(userId: string): Promise<Res<Ctx>> {
  const conn = await connectionFor(userId);
  if (!conn) return { ok: false, error: "There's no saved GoHighLevel connection on your account yet (Settings → Publishing)." };
  if (conn.locationId !== CAL_LOCATION) return { ok: false, error: `Your saved connection is for another sub-account (${conn.locationId}). These calendars belong in ${CAL_LOCATION} only, so nothing is read or written.` };
  const cred = await credentials(conn);
  if (!cred.ok) return { ok: false, error: cred.error };
  return { ok: true, data: { conn, base: cred.data.base, token: cred.data.token } };
}

async function getCal(c: Ctx, id: string, what: string): Promise<Res<Cal>> {
  const r = await call<{ calendar?: Cal }>(c.base, c.token, `/calendars/${encodeURIComponent(id)}`);
  if (!r.ok || !r.json?.calendar) return { ok: false, error: explain(r.ok ? 404 : r.status, `reading ${what}`, r.detail), status: r.status };
  return { ok: true, data: r.json.calendar };
}

/** Elite Conversation, if it was made already (found by its slug, so a second press updates it instead of making another). */
async function findElite(c: Ctx): Promise<Res<Cal | null>> {
  const r = await call<{ calendars?: Cal[] }>(c.base, c.token, `/calendars/?locationId=${encodeURIComponent(CAL_LOCATION)}`);
  if (!r.ok) return { ok: false, error: explain(r.status, "reading the calendar list", r.detail), status: r.status };
  const slug = CALENDARS.elite.slug;
  return { ok: true, data: (r.json?.calendars ?? []).find((x) => x.slug === slug || x.widgetSlug === slug) ?? null };
}

export type Step1 = { template: Cal; academy: Cal; elite: Cal | null; users: { id: string; name: string }[] };

/** Step 1, read only. */
export async function readCalendars(c: Ctx): Promise<Res<Step1>> {
  const template = await getCal(c, TEMPLATE_ID, "Evolve Omega Booking");
  if (!template.ok) return template;
  const academy = await getCal(c, ACADEMY_COPY_ID, "the stray copy");
  if (!academy.ok) return academy;
  const elite = await findElite(c);
  if (!elite.ok) return elite;
  const users = await listUsers(c.conn);
  return { ok: true, data: { template: template.data, academy: academy.data, elite: elite.data, users } };
}

export type Written = { key: CalKey; id: string; made: boolean };

/** Step 2: Academy first (the copy stops being live under its old name), then Elite, made or, when it is there, updated. */
export async function writeCalendars(c: Ctx, userId: string): Promise<Res<Written[]>> {
  const users = await listUsers(c.conn);
  if (users.length && !users.some((u) => u.id === userId)) return { ok: false, error: "That user isn't in this sub-account. Pick yourself from the list again." };
  const template = await getCal(c, TEMPLATE_ID, "Evolve Omega Booking");
  if (!template.ok) return template;
  const out: Written[] = [];

  const a = await call<{ calendar?: Cal }>(c.base, c.token, `/calendars/${ACADEMY_COPY_ID}`, { method: "PUT", body: JSON.stringify(calendarBody(CALENDARS.academy, template.data, userId, false)) });
  if (!a.ok) {
    await log(c.conn, "failed", `Academy Conversation update refused (${a.status})`, { calendarId: ACADEMY_COPY_ID });
    return { ok: false, error: explain(a.status, "updating Academy Conversation", a.detail), status: a.status };
  }
  out.push({ key: "academy", id: ACADEMY_COPY_ID, made: false });
  await log(c.conn, "sent", "Academy Conversation updated", { calendarId: ACADEMY_COPY_ID });

  const existing = await findElite(c);
  if (!existing.ok) return { ok: false, error: `Academy Conversation is updated. ${existing.error}` };
  const id = existing.data?.id;
  const e = id
    ? await call<{ calendar?: Cal }>(c.base, c.token, `/calendars/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(calendarBody(CALENDARS.elite, template.data, userId, false)) })
    : await call<{ calendar?: Cal }>(c.base, c.token, "/calendars/", { method: "POST", body: JSON.stringify(calendarBody(CALENDARS.elite, template.data, userId, true)) });
  const eliteId = id ?? (e.json?.calendar?.id ? String(e.json.calendar.id) : "");
  if (!e.ok || !eliteId) {
    await log(c.conn, "failed", `Elite Conversation ${id ? "update" : "create"} refused (${e.status})`);
    return { ok: false, error: `Academy Conversation is updated. ${explain(e.ok ? 0 : e.status, `${id ? "updating" : "creating"} Elite Conversation`, e.detail)}` };
  }
  out.push({ key: "elite", id: eliteId, made: !id });
  await log(c.conn, "sent", `Elite Conversation ${id ? "updated" : "created"}`, { calendarId: eliteId });
  return { ok: true, data: out };
}

export type Tested = { key: CalKey; calendarId: string; appointmentId: string | null; slot: string | null; zoom: string | null; cancelled: boolean; error: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Step 3 for one calendar: the next free slot, a booking for the test contact, the Zoom check, the cancel. */
async function testOne(c: Ctx, key: CalKey, cal: Cal, contactId: string, waitMs: number): Promise<Tested> {
  const calendarId = String(cal.id ?? "");
  const t: Tested = { key, calendarId, appointmentId: null, slot: null, zoom: null, cancelled: false, error: null };
  const now = Date.now();
  const free = await call<unknown>(c.base, c.token, `/calendars/${encodeURIComponent(calendarId)}/free-slots?startDate=${now}&endDate=${now + 14 * 86_400_000}&timezone=America%2FLos_Angeles`);
  t.slot = free.ok ? firstSlot(free.json) : null;
  if (!t.slot) {
    t.error = free.ok ? "no free slot in the next two weeks" : explain(free.status, "reading the free slots", free.detail);
    return t;
  }
  const made = await call<Record<string, unknown>>(c.base, c.token, "/calendars/events/appointments", {
    method: "POST",
    body: JSON.stringify({ calendarId, locationId: CAL_LOCATION, contactId, startTime: t.slot, title: "HelixOS test booking (cancelled straight away)", appointmentStatus: "confirmed", assignedUserId: cal.teamMembers?.[0]?.userId, toNotify: false }),
  });
  const appointmentId = made.ok ? String(made.json?.id ?? (made.json?.appointment as { id?: string } | undefined)?.id ?? "") : "";
  if (!appointmentId) {
    t.error = explain(made.ok ? 0 : made.status, "the test booking", made.detail);
    return t;
  }
  t.appointmentId = appointmentId;
  let zoom = zoomLink(made.json);
  // Zoom's link can arrive a moment after the booking: read the appointment back a few times before calling it missing.
  for (let i = 0; i < 3 && !zoom; i++) {
    await sleep(waitMs);
    const again = await call<unknown>(c.base, c.token, `/calendars/events/appointments/${encodeURIComponent(appointmentId)}`);
    if (again.ok) zoom = zoomLink(again.json);
  }
  t.zoom = zoom ? maskZoom(zoom) : null;
  const cancel = await call<unknown>(c.base, c.token, `/calendars/events/appointments/${encodeURIComponent(appointmentId)}`, { method: "PUT", body: JSON.stringify({ calendarId, appointmentStatus: "cancelled", toNotify: false }) });
  t.cancelled = cancel.ok;
  if (!cancel.ok) t.error = `${explain(cancel.status, "the cancel", cancel.detail)} Cancel it by hand in GoHighLevel.`;
  return t;
}

/** Step 3: one test booking on each calendar for the test contact, both cancelled afterwards. */
export async function testCalendars(c: Ctx, contactId: string, waitMs = 2000): Promise<Res<Tested[]>> {
  const academy = await getCal(c, ACADEMY_COPY_ID, "Academy Conversation");
  if (!academy.ok) return academy;
  const elite = await findElite(c);
  if (!elite.ok) return elite;
  if (!elite.data?.id) return { ok: false, error: "Elite Conversation isn't made yet. Press Step 2 first." };
  if (academy.data.name !== CALENDARS.academy.name) return { ok: false, error: "Academy Conversation isn't updated yet. Press Step 2 first." };
  const out: Tested[] = [];
  for (const [key, cal] of [["academy", academy.data], ["elite", elite.data]] as const) out.push(await testOne(c, key, cal, contactId, waitMs));
  for (const t of out) await log(c.conn, t.cancelled && t.zoom ? "sent" : "failed", `test booking on ${CALENDARS[t.key].name}: ${t.appointmentId ? "made" : "not made"}, Zoom ${t.zoom ? "yes" : "no"}, ${t.cancelled ? "cancelled" : "not cancelled"}`, { calendarId: t.calendarId, appointmentId: t.appointmentId });
  return { ok: true, data: out };
}
