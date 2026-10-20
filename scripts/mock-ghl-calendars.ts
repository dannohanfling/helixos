/**
 * The GoHighLevel calendar calls behind Coach → Booking calendars (H-892), for scripts/smoke-calendars.ts: one calendar, the
 * location's calendar list, a calendar update and a create, the users, free slots, an appointment made, read and cancelled.
 * `npx tsx scripts/mock-ghl-calendars.ts 4084`. Tokens: `pit-cal` may do everything; `pit-nocal` has no calendar permission
 * (401 on every calendar call, as GoHighLevel answers a key without the scope). Like GoHighLevel, a body field the calendar
 * API doesn't know is refused (400 "property x should not exist"), and an id it can't find answers 400, as GoHighLevel did on
 * 20 Oct (H-1236). Walk hooks: POST /__reset, POST /__drop-copy (the stray copy is gone), GET /__state (the calendars,
 * the writes in order, the appointments). Nothing here is ever real data.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4084);
const LOC = "OsyiwYzwGdK9O1noUOcT";
type Cal = Record<string, unknown> & { id: string; locationId: string; name: string };
type Appt = { id: string; calendarId: string; contactId: string; startTime: string; status: string; toNotify: unknown; address?: string };

/** CalendarCreateDTO / CalendarUpdateDTO's fields (GoHighLevel's calendars spec), the ones this mock accepts. */
const KNOWN = new Set([
  "locationId", "groupId", "name", "description", "slug", "widgetSlug", "calendarType", "widgetType", "eventTitle", "eventColor", "eventType", "teamMembers",
  "locationConfigurations", "meetingLocation", "slotDuration", "slotDurationUnit", "slotInterval", "slotIntervalUnit", "slotBuffer", "slotBufferUnit",
  "preBuffer", "preBufferUnit", "appoinmentPerSlot", "appoinmentPerDay", "allowBookingAfter", "allowBookingAfterUnit", "allowBookingFor", "allowBookingForUnit",
  "openHours", "enableRecurring", "recurring", "formId", "stickyContact", "isLivePaymentMode", "autoConfirm", "shouldAssignContactToTeamMember",
  "shouldSkipAssigningContactForExisting", "notes", "pixelId", "formSubmitType", "formSubmitRedirectURL", "formSubmitThanksMessage", "availabilityType",
  "availabilities", "guestType", "consentLabel", "calendarCoverImage", "lookBusyConfig", "isActive", "googleInvitationEmails", "allowReschedule",
  "allowCancellation", "shouldSendAlertEmailsToAssignedMember", "notifications",
]);

const template = (): Cal => ({
  id: "nntnynKtR00uxmgnrivj",
  locationId: LOC,
  name: "Evolve Omega Booking",
  description: "Book a call with the Evolve Omega team.",
  slug: "evolve-omega-booking",
  widgetSlug: "evolve-omega-booking",
  calendarType: "round_robin",
  eventType: "RoundRobin_OptimizeForAvailability",
  teamMembers: [{ userId: "usrDanno00001", priority: 0.5, meetingLocationType: "custom", isPrimary: true }],
  slotDuration: 45,
  slotDurationUnit: "mins",
  slotInterval: 15,
  slotIntervalUnit: "mins",
  slotBuffer: 15,
  slotBufferUnit: "mins",
  preBuffer: 15,
  preBufferUnit: "mins",
  allowBookingAfter: 4,
  allowBookingAfterUnit: "hours",
  allowBookingFor: 2,
  allowBookingForUnit: "weeks",
  openHours: [1, 2, 3, 4, 5].map((d) => ({ daysOfTheWeek: [d], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] })),
  autoConfirm: true,
  allowReschedule: true,
  allowCancellation: true,
  googleInvitationEmails: false,
  eventTitle: "{{contact.name}}",
  eventColor: "#DDA338",
  lookBusyConfig: { enabled: true, LookBusyPercentage: 30 },
  isActive: true,
});

const calendars = new Map<string, Cal>();
const writes: { method: string; id: string; body: Record<string, unknown> }[] = [];
const appts = new Map<string, Appt>();
let n = 0;
function reset() {
  calendars.clear();
  writes.length = 0;
  appts.clear();
  const t = template();
  calendars.set(t.id, t);
  // The stray copy: the template's settings under its old name.
  calendars.set("9lNBnfzLoNpgkcwwiUGj", { ...template(), id: "9lNBnfzLoNpgkcwwiUGj", name: "Copy of Evolve Omega Booking", slug: "copy-of-evolve-omega-booking", widgetSlug: "copy-of-evolve-omega-booking" });
  // Another calendar in the sub-account, which must never be touched.
  calendars.set("otherCal000000000001", { ...template(), id: "otherCal000000000001", name: "Evolve Omega Appointments", slug: "evolve-omega-appointments", widgetSlug: "evolve-omega-appointments" });
}
reset();

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      return json(400, { message: "Unexpected token in JSON" });
    }
    if (path === "/" && req.method === "GET") return json(200, { ok: true });
    if (path === "/__reset") {
      reset();
      return json(200, { ok: true });
    }
    if (path === "/__drop-copy") {
      calendars.delete("9lNBnfzLoNpgkcwwiUGj");
      return json(200, { ok: true });
    }
    if (path === "/__state") return json(200, { calendars: [...calendars.values()], writes, appointments: [...appts.values()] });

    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer pit-")) return json(401, { message: "Invalid JWT" });
    const token = auth.slice("Bearer ".length);

    if (path === "/users/" && req.method === "GET") {
      if (req.headers.version !== "2021-07-28") return json(400, { message: "version header" });
      if (url.searchParams.get("locationId") !== LOC) return json(403, { message: "The token does not have access to this location" });
      return json(200, { users: [{ id: "usrDanno00001", name: "Danno Hanfling" }, { id: "usrTeam000002", name: "Front desk" }] });
    }

    if (!path.startsWith("/calendars")) return json(404, { message: "not found" });
    if (req.headers.version !== "2021-04-15") return json(400, { message: "Version header must be 2021-04-15 for calendars" });
    if (token === "pit-nocal") return json(401, { statusCode: 401, message: "The token is not authorized for this scope." });

    const unknown = (b: Record<string, unknown>) => Object.keys(b).filter((k) => !KNOWN.has(k));
    if (path === "/calendars/" && req.method === "GET") {
      if (url.searchParams.get("locationId") !== LOC) return json(403, { message: "location" });
      return json(200, { calendars: [...calendars.values()].filter((c) => c.locationId === LOC) });
    }
    if (path === "/calendars/" && req.method === "POST") {
      const bad = unknown(body);
      if (bad.length) return json(400, { message: bad.map((k) => `property ${k} should not exist`) });
      if (body.locationId !== LOC || !body.name) return json(422, { message: ["locationId must be a string", "name should not be empty"] });
      const id = `newCal${String(++n).padStart(14, "0")}`;
      const cal = { ...(body as Record<string, unknown>), id, locationId: LOC, name: String(body.name) } as Cal;
      calendars.set(id, cal);
      writes.push({ method: "POST", id, body });
      return json(201, { calendar: cal });
    }
    if (path.endsWith("/free-slots") && req.method === "GET") {
      const id = path.split("/")[2];
      if (!calendars.has(id)) return json(404, { message: "Calendar not found" });
      const start = Number(url.searchParams.get("startDate"));
      const day = new Date(start + 86_400_000);
      const d = day.toISOString().slice(0, 10);
      return json(200, { [d]: { slots: [`${d}T17:30:00-07:00`, `${d}T17:00:00-07:00`] }, traceId: "t1" });
    }
    if (path === "/calendars/events/appointments" && req.method === "POST") {
      const cal = calendars.get(String(body.calendarId));
      if (!cal) return json(400, { message: "calendarId invalid" });
      if (!body.contactId || !body.startTime) return json(422, { message: ["contactId should not be empty"] });
      const id = `appt${String(++n).padStart(16, "0")}`;
      appts.set(id, { id, calendarId: cal.id, contactId: String(body.contactId), startTime: String(body.startTime), status: String(body.appointmentStatus), toNotify: body.toNotify });
      // As GoHighLevel does: the Zoom meeting is made a moment later, so the create reply has no link yet.
      return json(201, { id, calendarId: cal.id, appointmentStatus: body.appointmentStatus });
    }
    const appt = path.match(/^\/calendars\/events\/appointments\/([^/]+)$/);
    if (appt) {
      const a = appts.get(appt[1]);
      if (!a) return json(404, { message: "Appointment not found" });
      if (req.method === "GET") {
        const zoomOn = (calendars.get(a.calendarId)?.teamMembers as { locationConfigurations?: { kind?: string }[] }[] | undefined)?.[0]?.locationConfigurations?.some((l) => l.kind === "zoom_conf");
        if (zoomOn) a.address ??= `https://us02web.zoom.us/j/8123456${String(n).padStart(4, "0")}?pwd=walkonly`;
        return json(200, { appointment: { ...a, appointmentStatus: a.status } });
      }
      if (req.method === "PUT") {
        a.status = String(body.appointmentStatus ?? a.status);
        a.toNotify = body.toNotify;
        return json(200, { ...a, appointmentStatus: a.status });
      }
    }
    const one = path.match(/^\/calendars\/([^/]+)$/);
    if (one) {
      const cal = calendars.get(one[1]);
      if (!cal) return json(400, { statusCode: 400, message: "Calendar not found" });
      if (req.method === "GET") return json(200, { calendar: cal });
      if (req.method === "PUT") {
        const bad = unknown(body);
        if (bad.length) return json(400, { message: bad.map((k) => `property ${k} should not exist`) });
        if ("locationId" in body) return json(400, { message: ["property locationId should not exist"] });
        Object.assign(cal, body);
        writes.push({ method: "PUT", id: cal.id, body });
        return json(200, { calendar: cal });
      }
    }
    return json(404, { message: "not found" });
  });
}).listen(port, () => console.log(`mock GoHighLevel calendars on ${port}`));
