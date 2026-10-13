import { describe, expect, it } from "vitest";
import { callWhen, countdown, dayTag, googleCalendarUrl, icsFile } from "@/lib/hermes/when";
import { cleanEmail, cleanPixelId, isPageCode, isWebinarId, pixelBeacon, youtubeEmbed } from "@/lib/hermes/rules";
import * as copy from "@/lib/hermes/copy";

const LA = "America/Los_Angeles";
// Danno's first Inner Circle call: Friday 23 October 2026, 10:00 in Los Angeles (PDT, UTC-7).
const OCT23 = "2026-10-23T17:00:00.000Z";

describe("the call's date and time", () => {
  const w = callWhen(OCT23, LA);
  it("names the date, Pacific and Eastern", () => {
    expect(w.day).toBe("Friday, October 23");
    expect(w.time).toBe("10:00 AM PT");
    expect(w.timeEt).toBe("1:00 PM ET");
    expect(w.line).toBe("Friday, October 23 at 10:00 AM PT");
    expect(w.full).toBe("Friday, October 23 · 10:00 AM Pacific · 1:00 PM Eastern");
    expect(w.banner).toBe("FRIDAY, OCT 23 · 10AM PT");
    expect(w.alarm).toBe("9:45 AM PT");
    expect(w.isoDay).toBe("2026-10-23");
    expect(dayTag(w)).toBe("ic-2026-10-23");
    expect(w.endsAt).toBe("2026-10-23T18:00:00.000Z");
  });
  it("keeps Eastern three hours ahead after daylight saving ends (1 Nov)", () => {
    const nov = callWhen("2026-11-06T18:00:00.000Z", LA);
    expect(nov.time).toBe("10:00 AM PT");
    expect(nov.timeEt).toBe("1:00 PM ET");
    expect(nov.isoDay).toBe("2026-11-06");
  });
  it("doesn't repeat the time for a member on Eastern", () => {
    const ny = callWhen(OCT23, "America/New_York");
    expect(ny.time).toBe("1:00 PM ET");
    expect(ny.timeEt).toBeNull();
    expect(ny.full).toBe("Friday, October 23 · 1:00 PM Eastern");
  });
  it("counts down, and stops at zero", () => {
    expect(countdown(OCT23, Date.parse("2026-10-21T15:58:30Z"))).toEqual({ d: "2", h: "01", m: "01", s: "30" });
    expect(countdown(OCT23, Date.parse("2026-10-24T00:00:00Z"))).toEqual({ d: "0", h: "00", m: "00", s: "00" });
  });
});

describe("calendar links and file", () => {
  const w = callWhen(OCT23, LA);
  it("Google Calendar: the template link with UTC times", () => {
    const u = new URL(googleCalendarUrl({ title: "Inner Circle Call with Danno", details: "x", when: w, location: null }));
    expect(u.hostname).toBe("calendar.google.com");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("dates")).toBe("20261023T170000Z/20261023T180000Z");
    expect(u.searchParams.has("location")).toBe(false);
  });
  it("the .ics: one event, CRLF lines folded at 75 octets, a 15-minute alarm, text escaped", () => {
    const ics = icsFile({ uid: "w-abc@helixos", title: "Inner Circle Call, with Danno; live", details: "A".repeat(200), when: w, location: "https://zoom.us/j/123", now: new Date("2026-10-13T00:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261023T170000Z\r\n");
    expect(ics).toContain("DTEND:20261023T180000Z\r\n");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics).toContain("SUMMARY:Inner Circle Call\\, with Danno\\; live");
    const lines = ics.split("\r\n");
    expect(lines.length).toBeGreaterThan(15);
    for (const l of lines) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
  });
});

describe("rules", () => {
  it("turns YouTube links into youtube-nocookie embeds and refuses the rest", () => {
    const id = "dQw4w9WgXcQ";
    const want = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://youtube.com/shorts/${id}`, `https://m.youtube.com/watch?v=${id}&t=3`, `https://www.youtube.com/embed/${id}`]) expect(youtubeEmbed(u)).toBe(want);
    for (const u of ["", "not a url", `http://youtu.be/${id}`, `https://vimeo.com/123`, "https://youtube.com/watch?v=short", `https://evil.example/${id}`]) expect(youtubeEmbed(u)).toBeNull();
  });
  it("keeps a Pixel ID as digits only", () => {
    expect(cleanPixelId(" 1234567890123456 ")).toBe("1234567890123456");
    expect(cleanPixelId("12345a")).toBeNull();
    expect(pixelBeacon("123456", "PageView")).toBe("https://www.facebook.com/tr?id=123456&ev=PageView&noscript=1");
  });
  it("checks codes, webinar ids and email", () => {
    expect(isPageCode("a".repeat(43))).toBe(true);
    expect(isPageCode("a".repeat(42))).toBe(false);
    expect(isPageCode("../" + "a".repeat(40))).toBe(false);
    expect(isWebinarId("d9f8a9ee-0a20-49a7-ba64-70007f1d02b4")).toBe(true);
    expect(isWebinarId("none")).toBe(false);
    expect(cleanEmail(" Sam@Example.COM ")).toBe("sam@example.com");
    expect(cleanEmail("sam@example")).toBeNull();
  });
});

describe("the fixed copy (Danno, 13 Oct)", () => {
  const w = callWhen(OCT23, LA);
  const text = JSON.stringify(copy) + JSON.stringify([copy.faq(w, 60), copy.ps(w), copy.LETTER.close(w), copy.COLD_HERO.subheader(w), copy.CONFIRM.asks(w), copy.CONFIRM.signoff(w), copy.CONFIRM.sub(w), copy.whenCard(w, 60)]);
  it("never says 'this Friday', a price, a seat count, a replay or 'weekly'", () => {
    expect(text).not.toMatch(/this friday|weekly|every friday|replay|\bfree\b|\bcost\b|\bprice\b|\$\d|spots? (are )?filling|seats? left/i);
    expect(text).not.toMatch(/\[[^\]]*(confirm|length|danno to)[^\]]*\]/i);
  });
  it("names the date and the 60 minutes", () => {
    expect(copy.whenCard(w, 60)).toBe("Friday, October 23 · 10:00 AM Pacific · 1:00 PM Eastern · 60 minutes, with time for questions at the end.");
    expect(copy.LETTER.close(w)).toContain("On Friday, October 23 ");
  });
  it("uses only the photos from ic-images.zip, the Dean Graziosi one only under Why listen to me", () => {
    const files = Object.values(copy.PHOTO).map((p) => p.src.replace("/hermes/", ""));
    expect(files.sort()).toEqual(["danno-coached-dean.jpg", "danno-headshot-lanyard.jpg", "danno-stage-summit.jpg", "danno-teaching-whiteboard.jpg", "danno-videowall.jpg", "danno-workshop-group.jpg", "evolve-omega-logo-320.png", "ic3-serving-future.jpg", "ic3-teach-edge.jpg", "ic3-teach-flow.jpg"]);
    expect(copy.WHY_LISTEN.map((x) => x.photo)).toContain(copy.PHOTO.dean);
    expect([copy.PHOTO.hero, ...copy.PART_PHOTOS]).not.toContain(copy.PHOTO.dean);
  });
});
