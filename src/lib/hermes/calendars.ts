/**
 * The two booking calendars for the pass invitations (H-892, plan H-1040, approved H-1044): Academy Conversation (the stray
 * copy, renamed and updated) and Elite Conversation (new), both one-person calendars of Danno's in his own sub-account, copied
 * from Evolve Omega Booking with only the brief's changes. Pure rules only: which ids, which fields, what each body holds. The
 * calls are in src/lib/hermes/calendars-ghl.ts; nothing here talks to GoHighLevel.
 */

/** Danno's own sub-account (H-892). The page refuses to write anywhere else. */
export const CAL_LOCATION = "OsyiwYzwGdK9O1noUOcT";
/** Evolve Omega Booking: read only, the settings both calendars copy. Never written. */
export const TEMPLATE_ID = "nntnynKtR00uxmgnrivj";
/** "Copy of Evolve Omega Booking", the stray copy that becomes Academy Conversation. */
export const ACADEMY_COPY_ID = "9lNBnfzLoNpgkcwwiUGj";

export type CalKey = "academy" | "elite";
export type CalSpec = { key: CalKey; name: string; slug: string; description: string };

const line = (tier: string) => `A private 30-minute conversation with Danno about joining ${tier}. You earned this invitation by showing up and doing the work.`;

export const CALENDARS: Record<CalKey, CalSpec> = {
  academy: { key: "academy", name: "Academy Conversation", slug: "academy-conversation", description: line("Academy") },
  elite: { key: "elite", name: "Elite Conversation", slug: "elite-conversation", description: line("Elite") },
};

/** The calendar permissions Danno adds to his own Private Integration (not the members' list, which stays as it is). */
export const CAL_SCOPES = ["calendars.readonly", "calendars.write", "calendars/events.write"] as const;

/**
 * The template's settings copied unchanged when it has them: the weekly hours, the buffers, the date range, the booking rules
 * and the form. Anything not named here is left out of the body, so GoHighLevel keeps its own default for a new calendar and
 * the copy's existing value for Academy. Workflows are not calendar fields, so none can ride along.
 */
export const COPY_FIELDS = [
  "openHours",
  "availabilities",
  "availabilityType",
  "slotBuffer",
  "slotBufferUnit",
  "preBuffer",
  "preBufferUnit",
  "allowBookingAfter",
  "allowBookingAfterUnit",
  "allowBookingFor",
  "allowBookingForUnit",
  "appoinmentPerSlot",
  "appoinmentPerDay",
  "enableRecurring",
  "autoConfirm",
  "allowReschedule",
  "allowCancellation",
  "googleInvitationEmails",
  "shouldSendAlertEmailsToAssignedMember",
  "formId",
  "formSubmitType",
  "formSubmitRedirectURL",
  "formSubmitThanksMessage",
  "guestType",
  "consentLabel",
  "stickyContact",
  "notes",
  "eventColor",
  "eventTitle",
  "widgetType",
] as const;

/** Fields of the template that look like conflict checking, shown in Step 1 so Danno sees what it checks. */
export function conflictFields(template: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(template)
    .filter(([k]) => /conflict|linkedcalendar|syncoption|checkcalendar/i.test(k))
    .map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

/**
 * The body for one calendar: the template's copied fields, then the brief's changes. Both are personal calendars with Danno as
 * the one team member and Zoom as his meeting location, so the Zoom link is made under him. `create` adds the location (only a
 * new calendar takes it).
 */
export function calendarBody(spec: CalSpec, template: Record<string, unknown>, userId: string, create: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of COPY_FIELDS) if (template[k] !== undefined && template[k] !== null) body[k] = template[k];
  Object.assign(body, {
    name: spec.name,
    description: spec.description,
    slug: spec.slug,
    widgetSlug: spec.slug,
    calendarType: "personal",
    teamMembers: [{ userId, priority: 1, isPrimary: true, locationConfigurations: [{ kind: "zoom_conf", location: "" }] }],
    slotDuration: 30,
    slotDurationUnit: "mins",
    slotInterval: 30,
    slotIntervalUnit: "mins",
    lookBusyConfig: { enabled: false },
    isActive: true,
  });
  if (create) body.locationId = CAL_LOCATION;
  return body;
}

/** Field by field, for Step 1: what Evolve Omega Booking has, and what the calendar will be written with. */
export function fieldRows(body: Record<string, unknown>, template: Record<string, unknown>): { key: string; template: string; written: string; changed: boolean }[] {
  const show = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
  return Object.keys(body)
    .filter((k) => k !== "locationId")
    .map((key) => ({ key, template: show(template[key]), written: show(body[key]), changed: show(template[key]) !== show(body[key]) }));
}

/** The public booking links: by id (always works) and by slug. Neither is secret. */
export function bookingLinks(calendarId: string, slug: string): { byId: string; bySlug: string } {
  return { byId: `https://api.leadconnectorhq.com/widget/booking/${encodeURIComponent(calendarId)}`, bySlug: `https://api.leadconnectorhq.com/widget/bookings/${encodeURIComponent(slug)}` };
}

/** The first Zoom meeting link anywhere in a GoHighLevel appointment reply, or null. */
export function zoomLink(o: unknown): string | null {
  const s = JSON.stringify(o ?? null);
  const m = s.match(/https:\/\/[a-z0-9.-]*zoom\.us\/[^"\\\s]+/i);
  return m ? m[0] : null;
}

/** A Zoom link shown with its meeting number cut to the last four digits and no passcode. */
export function maskZoom(url: string): string {
  try {
    const u = new URL(url);
    const id = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${u.host}/…${id.slice(-4)}`;
  } catch {
    return "zoom.us/…";
  }
}

/** A GoHighLevel contact id as typed: letters and digits only, nothing else gets near a request. */
export function cleanContactId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^[A-Za-z0-9]{10,40}$/.test(s) ? s : null;
}

/** The first free slot in GoHighLevel's free-slots reply ({ "2026-10-20": { slots: [iso, …] }, traceId }), or null. */
export function firstSlot(reply: unknown): string | null {
  if (!reply || typeof reply !== "object") return null;
  const all: string[] = [];
  for (const [k, v] of Object.entries(reply as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    const slots = (v as { slots?: unknown })?.slots;
    if (Array.isArray(slots)) for (const s of slots) if (typeof s === "string") all.push(s);
  }
  all.sort((a, b) => Date.parse(a) - Date.parse(b));
  return all[0] ?? null;
}

/** Which of our own field names a refusal mentions: our words, never GoHighLevel's (its reply stays in the server log). */
export function fieldsNamed(detail: string): string[] {
  const ours = new Set<string>([...COPY_FIELDS, ...Object.keys(calendarBody(CALENDARS.elite, {}, "u", true)), "contactId", "startTime", "calendarId", "assignedUserId", "appointmentStatus", "toNotify"]);
  return [...ours].filter((k) => new RegExp(`\\b${k}\\b`).test(detail));
}
