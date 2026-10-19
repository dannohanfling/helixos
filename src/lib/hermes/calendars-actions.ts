"use server";

/**
 * Coach → Booking calendars, the two buttons (H-892, plan H-1040). Coach only; each runs only on Danno's press, with his own
 * saved connection. What comes back is ids, links and outcomes, never a key.
 */
import { requireCoach } from "@/lib/auth";
import { bookingLinks, CALENDARS, cleanContactId } from "@/lib/hermes/calendars";
import { calendarContext, testCalendars, writeCalendars } from "@/lib/hermes/calendars-ghl";

export type WriteState = { ok: true; rows: { name: string; id: string; made: boolean; link: string; slugLink: string }[] } | { ok: false; error: string } | null;
export type TestState = { ok: true; rows: { name: string; calendarId: string; appointmentId: string | null; slot: string | null; zoom: string | null; cancelled: boolean; error: string | null }[] } | { ok: false; error: string } | null;

export async function writeCalendarsAction(_prev: WriteState, form: FormData): Promise<WriteState> {
  const v = await requireCoach();
  const userId = String(form.get("userId") ?? "").trim();
  if (!/^[A-Za-z0-9]{6,40}$/.test(userId)) return { ok: false, error: "Pick yourself from the list first." };
  if (form.get("sure") !== "on") return { ok: false, error: "Tick the box to say you've read the fields above." };
  const c = await calendarContext(v.user.id);
  if (!c.ok) return c;
  const r = await writeCalendars(c.data, userId);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, rows: r.data.map((w) => ({ name: CALENDARS[w.key].name, id: w.id, made: w.made, link: bookingLinks(w.id, CALENDARS[w.key].slug).byId, slugLink: bookingLinks(w.id, CALENDARS[w.key].slug).bySlug })) };
}

export async function testCalendarsAction(_prev: TestState, form: FormData): Promise<TestState> {
  const v = await requireCoach();
  const contactId = cleanContactId(form.get("contactId"));
  if (!contactId) return { ok: false, error: "Paste the test contact's GoHighLevel id (letters and digits, from the booking follow-up notes)." };
  const c = await calendarContext(v.user.id);
  if (!c.ok) return c;
  const r = await testCalendars(c.data, contactId);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, rows: r.data.map((t) => ({ name: CALENDARS[t.key].name, calendarId: t.calendarId, appointmentId: t.appointmentId, slot: t.slot, zoom: t.zoom, cancelled: t.cancelled, error: t.error })) };
}
