import { describe, expect, it } from "vitest";
import { BOT_TOOLS, LIMITS, MAX, bookedOnIso, cleanCustom, cleanText, faqMatches, isBotKeyShape, isContactId, isEmail, isTimezone, isWrite, nextStage, nextWebinar, offerFacts, whenLine, withNote, type OfferRow } from "@/lib/engine/bot-mcp";

describe("Bot connection: the six tools and nothing else (rev 696)", () => {
  it("lists exactly the six, two of them writes, and no never-list area has a tool", () => {
    expect([...BOT_TOOLS]).toEqual(["offer_info", "faq_answer", "booking_info", "webinar_next", "lead_log", "webinar_register"]);
    expect(BOT_TOOLS.filter(isWrite)).toEqual(["lead_log", "webinar_register"]);
    for (const never of ["essence_read", "scoreboard_read", "tasks_list", "proofs_list", "contacts_list", "pathway_read", "body_today", "teaching_search", "story_bank", "dm_send", "contact_delete"]) expect((BOT_TOOLS as readonly string[]).includes(never), never).toBe(false);
    expect(LIMITS).toEqual({ readsPerMinute: 60, writesPerMinute: 10, writesPerDay: 200 });
  });
  it("a bot key has its own shape, never the member connector's", () => {
    expect(isBotKeyShape(`hxb_${"a".repeat(43)}`)).toBe(true);
    expect(isBotKeyShape(`mcpa_${"a".repeat(43)}`)).toBe(false);
    expect(isBotKeyShape("hxb_short")).toBe(false);
  });
});

describe("Bot connection: a stranger's input", () => {
  it("cleans control and zero-width characters, markup brackets and runs of space", () => {
    expect(cleanText("  Ann\u0000​  <b>Lee</b>\n\n ")).toBe("Ann bLee/b");
  });
  it("checks emails, contact ids and time zones", () => {
    expect(isEmail("ann@example.com")).toBe(true);
    expect(isEmail("not an email")).toBe(false);
    expect(isEmail(`${"a".repeat(250)}@x.co`)).toBe(false);
    expect(isContactId("12345678")).toBe(true);
    expect(isContactId("1; drop table")).toBe(false);
    expect(isContactId("x".repeat(MAX.contactId + 1))).toBe(false);
    expect(isTimezone("America/New_York")).toBe(true);
    expect(isTimezone("Mars/Base")).toBe(false);
  });
  it("custom fields for the Magic funnel: known and custom keys, cleaned, at most 12 and 300 characters each", () => {
    expect(cleanCustom({ Industry: " Fitness ", pain: "No time\u0000 at all", favourite_tool: "Canva" })).toEqual({ ok: true, fields: { industry: "Fitness", pain: "No time at all", favourite_tool: "Canva" } });
    expect(cleanCustom({ "bad key!": "x" }).ok).toBe(false);
    expect(cleanCustom({ pain: "x".repeat(301) }).ok).toBe(false);
    expect(cleanCustom(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, "x"]))).ok).toBe(false);
    expect(cleanCustom({ pain: 5 as unknown as string }).ok).toBe(false);
  });
});

describe("Bot connection: lead_log", () => {
  it("maps the bot's stages to DMs (rev 808) and never moves a person back", () => {
    expect(nextStage(null, "new")).toBe("new");
    expect(nextStage(null, "qualified")).toBe("conversation");
    expect(nextStage(null, "booked")).toBe("call_booked");
    expect(nextStage(null, "no_show")).toBe("no_show");
    expect(nextStage("client", "new")).toBe("client");
    expect(nextStage("call_booked", "qualified")).toBe("call_booked");
    expect(nextStage("call_booked", "no_show")).toBe("no_show");
    expect(nextStage("no_show", "booked")).toBe("call_booked");
    expect(nextStage("cold", "qualified")).toBe("conversation");
  });
  it("booked_on: a date or a date and time, else now; nothing absurdly far off", () => {
    const now = new Date("2026-10-12T15:00:00Z");
    expect(bookedOnIso("2026-10-15", now)).toBe("2026-10-15T12:00:00.000Z");
    expect(bookedOnIso("2026-10-15T09:30:00Z", now)).toBe("2026-10-15T09:30:00.000Z");
    expect(bookedOnIso("next tuesday", now)).toBe(now.toISOString());
    expect(bookedOnIso("2099-01-01", now)).toBe(now.toISOString());
    expect(bookedOnIso(undefined, now)).toBe(now.toISOString());
  });
  it("a note is a new dated line under what's there, never a replacement", () => {
    expect(withNote(null, "Wants the 6-week plan", "2026-10-12")).toBe("2026-10-12 (bot): Wants the 6-week plan");
    expect(withNote("Met at the expo", "Booked", "2026-10-12")).toBe("Met at the expo\n2026-10-12 (bot): Booked");
  });
});

describe("Bot connection: offer_info honours prices", () => {
  const base: OfferRow = { name: "Coaching", botName: null, botRole: "core", status: "live", createdAt: "2026-01-01", promise: "Ten clients in 90 days", botFor: "Coaches", forYouIf: null, container: "12 weeks", price: 3000, currency: "USD", neverQuotePrice: false };
  const rules = { pricesOn: true, priceMode: "full", priceAnswer: "It depends on where you are; a call sorts it." };
  it("the main offer first, only offers with a bot role", () => {
    const out = offerFacts([{ ...base, name: "Entry", botRole: "entry", price: 97 }, { ...base, name: "Hidden", botRole: "not_on_bot" }, base], rules);
    expect(out.map((o) => [o.name, o.main])).toEqual([["Coaching", true], ["Entry", false]]);
    expect(out[0].price).toContain("3,000");
  });
  it("never quote prices, prices off, or never mode: the owner's answer, no numbers", () => {
    for (const [o, r] of [[{ ...base, neverQuotePrice: true }, rules], [base, { ...rules, pricesOn: false }], [base, { ...rules, priceMode: "never" }]] as const) {
      const [f] = offerFacts([o], r);
      expect(f.price).toBeNull();
      expect(f.price_answer).toBe(rules.priceAnswer);
      expect(JSON.stringify(f)).not.toMatch(/3,?000/);
    }
  });
});

describe("Bot connection: faq_answer and webinar_next", () => {
  it("the best matches by shared words, keywords counting double, none when nothing matches", () => {
    const rows = [
      { question: "How long is the program?", alsoAsked: ["How many weeks?"], keywords: ["length"], answer: "Twelve weeks." },
      { question: "Do you offer refunds?", alsoAsked: [], keywords: ["refund", "money back"], answer: "Yes, in 14 days." },
    ];
    expect(faqMatches("Can I get a refund?", rows)[0].answer).toBe("Yes, in 14 days.");
    expect(faqMatches("how many weeks is it", rows)[0].answer).toBe("Twelve weeks.");
    expect(faqMatches("what's the weather", rows)).toEqual([]);
  });
  it("the next webinar: not an example, not delivered, starting after now in the member's zone; shown in the asker's", () => {
    const now = new Date("2026-10-12T15:00:00Z");
    const toUtc = (wall: string) => new Date(`${wall}:00Z`).toISOString();
    const w = (id: string, at: string | null, extra: object = {}) => ({ id, title: id, status: "scheduled", isExample: false, scheduledAt: at, registrationUrl: null, joinUrl: null, ...extra });
    const next = nextWebinar([w("past", "2026-10-01T18:00"), w("example", "2026-10-13T18:00", { isExample: true }), w("later", "2026-11-01T18:00"), w("soon", "2026-10-20T18:00"), w("none", null)], now, toUtc);
    expect(next?.id).toBe("soon");
    expect(whenLine("2026-10-20T23:00:00.000Z", "America/New_York")).toMatch(/^Tuesday, October 20.* 7:00 PM EDT$/);
  });
});
