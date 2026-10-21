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
import { ACADEMY_COPY_ID, CALENDARS, CAL_LOCATION, CAL_SCOPES, TEMPLATE_ID, calendarBody, fieldsNamed, firstSlot, maskZoom, zoomLink, type CalKey } from "@/lib/hermes/calendars";

/** The calendars API's own version header (GoHighLevel's calendars spec), not the contacts one. */
const CAL_VERSION = "2021-04-15";

export type Cal = Record<string, unknown> & { id?: string; name?: string; slug?: string; widgetSlug?: string; teamMembers?: { userId?: string }[] };
type Res<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const NEED = `Add ${CAL_SCOPES.join(", ")} to your own Private Integration in GoHighLevel (Settings → Private Integrations), then try again.`;

function explain(status: number | undefined, what: string, detail = ""): string {
  if (status === 401 || status === 403) return `GoHighLevel refused ${what}: the saved key has no calendar permission. ${NEED}`;
  if (status === 404) return `GoHighLevel has no ${what.replace(/^reading |^updating |^creating /, "")} in this sub-account.`;
  const named = fieldsNamed(detail);
  if (status === 400 || status === 422) return `GoHighLevel didn't accept ${what} (${status}). ${named.length ? `It named these fields: ${named.join(", ")}.` : "It named no field we send."} Tell Hermes; nothing else was changed.`;
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

/** The sub-account's calendars (read only). Step 1 shows them, names and ids only; Steps 2 and 3 find ours by slug. */
async function listCals(c: Ctx): Promise<Res<Cal[]>> {
  const r = await call<{ calendars?: Cal[] }>(c.base, c.token, `/calendars/?locationId=${encodeURIComponent(CAL_LOCATION)}`);
  if (!r.ok) return { ok: false, error: explain(r.status, "reading the calendar list", r.detail), status: r.status };
  return { ok: true, data: r.json?.calendars ?? [] };
}

const bySlug = (list: Cal[], key: CalKey): Cal | null => list.find((x) => x.slug === CALENDARS[key].slug || x.widgetSlug === CALENDARS[key].slug) ?? null;

export type Listed = { id: string; name: string; mark: "template" | "copy" | "academy" | "elite" | null };
export type Step1 = {
  template: Cal;
  /** The stray copy when it reads, else null: Step 2 then creates Academy fresh (H-1248). */
  copy: Cal | null;
  /** Why the copy didn't read, in our words (never GoHighLevel's), or null. */
  copyNote: string | null;
  academy: Cal | null;
  elite: Cal | null;
  calendars: Listed[];
  users: { id: string; name: string }[];
};

/** Step 1, read only. Evolve Omega Booking must read; the stray copy may not (H-1236): it is reported, never fatal. */
export async function readCalendars(c: Ctx): Promise<Res<Step1>> {
  const template = await getCal(c, TEMPLATE_ID, "Evolve Omega Booking");
  if (!template.ok) return template;
  const list = await listCals(c);
  if (!list.ok) return list;
  const academy = bySlug(list.data, "academy");
  const elite = bySlug(list.data, "elite");
  let copy: Cal | null = null;
  let copyNote: string | null = null;
  if (!academy) {
    const r = await getCal(c, ACADEMY_COPY_ID, "the stray copy");
    if (r.ok) copy = r.data;
    else {
      const listed = list.data.some((x) => x.id === ACADEMY_COPY_ID);
      copyNote = listed
        ? `The stray copy (${ACADEMY_COPY_ID}) is in the list, but GoHighLevel won't read it on its own (${r.status ?? "no answer"}). Step 2 makes Academy Conversation fresh from Evolve Omega Booking and leaves the copy as it is.`
        : `The stray copy (${ACADEMY_COPY_ID}) isn't in this sub-account's calendars any more. Step 2 makes Academy Conversation fresh from Evolve Omega Booking.`;
    }
  }
  const mark = (x: Cal): Listed["mark"] => (x.id === TEMPLATE_ID ? "template" : academy && x.id === academy.id ? "academy" : elite && x.id === elite.id ? "elite" : x.id === ACADEMY_COPY_ID ? "copy" : null);
  const calendars = list.data.filter((x) => x.id).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), mark: mark(x) }));
  const users = await listUsers(c.conn);
  return { ok: true, data: { template: template.data, copy, copyNote, academy, elite, calendars, users } };
}

export type Written = { key: CalKey; id: string; made: boolean };

/**
 * One of the two: the calendar with its slug is updated; failing that, Academy updates the stray copy when it still reads;
 * failing that, it is created. A second press always finds it by slug, so nothing is ever made twice.
 */
async function upsert(c: Ctx, key: CalKey, list: Cal[], template: Cal, userId: string): Promise<Res<Written>> {
  const spec = CALENDARS[key];
  let id = bySlug(list, key)?.id ? String(bySlug(list, key)!.id) : "";
  if (!id && key === "academy") {
    const copy = await getCal(c, ACADEMY_COPY_ID, "the stray copy");
    if (copy.ok) id = ACADEMY_COPY_ID;
  }
  const r = id
    ? await call<{ calendar?: Cal }>(c.base, c.token, `/calendars/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(calendarBody(spec, template, userId, false)) })
    : await call<{ calendar?: Cal }>(c.base, c.token, "/calendars/", { method: "POST", body: JSON.stringify(calendarBody(spec, template, userId, true)) });
  const done = id || (r.json?.calendar?.id ? String(r.json.calendar.id) : "");
  if (!r.ok || !done) {
    await log(c.conn, "failed", `${spec.name} ${id ? "update" : "create"} refused (${r.status})`, id ? { calendarId: id } : {});
    return { ok: false, error: explain(r.ok ? 0 : r.status, `${id ? "updating" : "creating"} ${spec.name}`, r.detail), status: r.status };
  }
  await log(c.conn, "sent", `${spec.name} ${id ? "updated" : "created"}`, { calendarId: done });
  return { ok: true, data: { key, id: done, made: !id } };
}

/** Step 2: Academy first (the copy, if it is still live, stops being live under its old name), then Elite. */
export async function writeCalendars(c: Ctx, userId: string): Promise<Res<Written[]>> {
  const users = await listUsers(c.conn);
  if (users.length && !users.some((u) => u.id === userId)) return { ok: false, error: "That user isn't in this sub-account. Pick yourself from the list again." };
  const template = await getCal(c, TEMPLATE_ID, "Evolve Omega Booking");
  if (!template.ok) return template;
  const list = await listCals(c);
  if (!list.ok) return list;
  const a = await upsert(c, "academy", list.data, template.data, userId);
  if (!a.ok) return a;
  const e = await upsert(c, "elite", list.data, template.data, userId);
  if (!e.ok) return { ok: false, error: `Academy Conversation is ${a.data.made ? "created" : "updated"}. ${e.error}` };
  return { ok: true, data: [a.data, e.data] };
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
  const list = await listCals(c);
  if (!list.ok) return list;
  const academy = bySlug(list.data, "academy");
  const elite = bySlug(list.data, "elite");
  if (!academy?.id || !elite?.id) return { ok: false, error: `${!academy?.id ? "Academy" : "Elite"} Conversation isn't made yet. Press Step 2 first.` };
  const out: Tested[] = [];
  for (const [key, cal] of [["academy", academy], ["elite", elite]] as const) out.push(await testOne(c, key, cal, contactId, waitMs));
  for (const t of out) await log(c.conn, t.cancelled && t.zoom ? "sent" : "failed", `test booking on ${CALENDARS[t.key].name}: ${t.appointmentId ? "made" : "not made"}, Zoom ${t.zoom ? "yes" : "no"}, ${t.cancelled ? "cancelled" : "not cancelled"}`, { calendarId: t.calendarId, appointmentId: t.appointmentId });
  return { ok: true, data: out };
}
