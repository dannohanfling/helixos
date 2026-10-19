import { describe, expect, it } from "vitest";
import { CALENDARS, CAL_LOCATION, COPY_FIELDS, bookingLinks, calendarBody, cleanContactId, conflictFields, fieldRows, firstSlot, maskZoom, zoomLink } from "@/lib/hermes/calendars";

const template = {
  id: "nntnynKtR00uxmgnrivj",
  name: "Evolve Omega Booking",
  calendarType: "round_robin",
  eventType: "RoundRobin_OptimizeForAvailability",
  slotDuration: 45,
  slotInterval: 15,
  slotBuffer: 15,
  preBuffer: 15,
  allowBookingFor: 2,
  allowBookingForUnit: "weeks",
  openHours: [{ daysOfTheWeek: [1], hours: [{ openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }] }],
  lookBusyConfig: { enabled: true },
  formId: null,
  workflows: ["wf1"],
  teamMembers: [{ userId: "someoneElse" }],
};

describe("the booking calendars (H-892)", () => {
  it("copies the template's settings and changes only what the brief lists", () => {
    const b = calendarBody(CALENDARS.elite, template, "usrDanno", true);
    expect(b).toMatchObject({ name: "Elite Conversation", slug: "elite-conversation", widgetSlug: "elite-conversation", calendarType: "personal", slotDuration: 30, slotInterval: 30, lookBusyConfig: { enabled: false }, locationId: CAL_LOCATION });
    expect(b.teamMembers).toEqual([{ userId: "usrDanno", priority: 1, isPrimary: true, locationConfigurations: [{ kind: "zoom_conf", location: "" }] }]);
    for (const k of ["slotBuffer", "preBuffer", "allowBookingFor", "allowBookingForUnit", "openHours"] as const) expect(b[k]).toEqual(template[k]);
    expect(b).not.toHaveProperty("workflows");
    expect(b).not.toHaveProperty("eventType");
    expect(b).not.toHaveProperty("id");
    expect(b).not.toHaveProperty("formId");
    expect(String(b.description)).toBe("A private 30-minute conversation with Danno about joining Elite. You earned this invitation by showing up and doing the work.");
  });
  it("leaves the location off an update, and Academy has its own words", () => {
    const b = calendarBody(CALENDARS.academy, template, "usrDanno", false);
    expect(b).not.toHaveProperty("locationId");
    expect(b.name).toBe("Academy Conversation");
    expect(b.slug).toBe("academy-conversation");
    expect(String(b.description)).toContain("joining Academy.");
  });
  it("never copies a workflow or an id", () => {
    expect(COPY_FIELDS as readonly string[]).not.toContain("workflows");
    expect(COPY_FIELDS as readonly string[]).not.toContain("id");
    expect(COPY_FIELDS as readonly string[]).not.toContain("teamMembers");
  });
  it("marks the changed rows for Step 1", () => {
    const rows = fieldRows(calendarBody(CALENDARS.elite, template, "u", true), template);
    expect(rows.find((r) => r.key === "slotDuration")).toMatchObject({ template: "45", written: "30", changed: true });
    expect(rows.find((r) => r.key === "preBuffer")?.changed).toBe(false);
    expect(rows.some((r) => r.key === "locationId")).toBe(false);
  });
  it("finds conflict fields when the API has them", () => {
    expect(conflictFields(template)).toEqual([]);
    expect(conflictFields({ ...template, conflictCalendarIds: ["g1"] })).toEqual([{ key: "conflictCalendarIds", value: '["g1"]' }]);
  });
  it("finds the Zoom link and shows it without the passcode", () => {
    const url = zoomLink({ appointment: { address: "https://us02web.zoom.us/j/81234567890?pwd=secret" } });
    expect(url).toBe("https://us02web.zoom.us/j/81234567890?pwd=secret");
    expect(maskZoom(url!)).toBe("us02web.zoom.us/…7890");
    expect(zoomLink({ address: "https://meet.google.com/abc" })).toBeNull();
  });
  it("takes the earliest free slot", () => {
    expect(firstSlot({ "2026-10-21": { slots: ["2026-10-21T10:00:00-07:00"] }, "2026-10-20": { slots: ["2026-10-20T15:00:00-07:00", "2026-10-20T09:30:00-07:00"] }, traceId: "x" })).toBe("2026-10-20T09:30:00-07:00");
    expect(firstSlot({ traceId: "x" })).toBeNull();
  });
  it("lets only an id-shaped contact through", () => {
    expect(cleanContactId(" TestContact0000000001 ")).toBe("TestContact0000000001");
    for (const bad of ["", "short", "has space in it 123", "a/b/c/d/e/f/g", "x".repeat(41), null]) expect(cleanContactId(bad)).toBeNull();
  });
  it("gives the public links", () => {
    expect(bookingLinks("abc123", "elite-conversation")).toEqual({ byId: "https://api.leadconnectorhq.com/widget/booking/abc123", bySlug: "https://api.leadconnectorhq.com/widget/bookings/elite-conversation" });
  });
});
