import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_PLAN_LINE_DEFAULT, PRODUCT_FIELD, QUALIFYING_DEFAULTS, STAGE1_FIELDS, houseConstraints, needsEyes, priceDeflection, productSections, stage1Payload, stage1Problems, stage1Warnings, suggestCoverageLine, type OfferFacts, type Stage1Input } from "../bot-fields";

/**
 * The golden test (handoff rev 80): Danno's data, entered the way the "Your bot" page and the Offers take it, composes to the
 * fixture byte for byte. The fixture is copied verbatim from the bot sales rules brief; its two Link lines are placeholders
 * until Danno builds the GHL links, so the record's links here are the placeholders and a real link is substituted the same way.
 */
const golden = JSON.parse(readFileSync(join(process.cwd(), "scripts/fixtures/golden-bot-danno.json"), "utf8")) as Record<string, string>;
const linkOf = (label: string) => golden[PRODUCT_FIELD].split("\n").filter((l) => l.startsWith("Link: "))[label === "entry" ? 0 : 1].slice("Link: ".length);
const offer = (o: Partial<OfferFacts> & { name: string }): OfferFacts => ({ promise: null, container: "Group program", price: 0, currency: "USD", length: null, status: "draft", ...o });
const danno = (links = { entry: linkOf("entry"), core: linkOf("core") }): Stage1Input => ({
  businessName: "Evolve Omega",
  workspaceName: "Evolve Omega Academy",
  timezone: "America/Los_Angeles",
  offers: [
    // A client's offer on his own Offers page, live and priced: no bot role, so it never reaches his bot.
    offer({ id: "epic", name: "The Epic Voice Immersion", status: "live", price: 4997 }),
    offer({ id: "acc", name: "Evolve Omega Accelerator", botName: "Accelerator", botRole: "entry", price: 6000, botFor: "new businesses with a budget under $1,000 who want help.", botTerms: "$500 today, then $500 a month for the rest of the year. 12 payments in all.", paymentLink: links.entry, depositAmount: 500, refundableIfNotFit: true, botRefundLine: "The $500 is fully refunded if our call shows it's not a fit." }),
    offer({ id: "acad", name: "Evolve Omega Academy", botName: "Academy", botRole: "core", price: 12000, botFor: "established businesses who say plainly they are ready to buy now.", botTerms: "$1,000 deposit today. The next payment is 30 days later. I'll go over the rest on the call.", paymentLink: links.core, depositAmount: 1000, refundableIfNotFit: true, guaranteeCovered: true }),
    offer({ id: "elite", name: "Elite", botRole: "one_on_one", price: 25000, guaranteeCovered: true }),
    offer({ id: "luxe", name: "Luxe", botRole: "one_on_one", price: 50000, guaranteeCovered: true }),
  ],
  coach: {
    whatIDo: golden[PRODUCT_FIELD].split("\n\n")[0].split("\n")[1],
    priceMode: "range",
    rangeLine: "Sure. It depends on what you need. Some partners start at $1,000, and some work with me one-on-one for up to $50,000 a year.",
    paymentPlanLine: null,
    guaranteeLine: "Yes. On my partner programs, if you do the work with me and haven't doubled your investment in 12 months, I keep working with you at no extra cost until you do. I'll walk you through the full terms on the call.",
    guaranteeCoverageLine: "The guarantee covers the core offer and one-on-one programs only, not the entry offer. If someone on the entry offer path asks, say the guarantee is for the partner programs, and that their $500 is refunded if our call shows it's not a fit.",
    // His twelve rules as he would type them into Essence, one per line, unnumbered.
    houseRules: golden.ai_constraints_cbf.split("\n").map((l) => l.replace(/^\d+\.\s/, "")),
    persona: golden.ai_persona_role_cbf,
    questions: [golden.qualifying_question_1, golden.qualifying_question_2, golden.qualifying_question_3],
  },
});

describe("the golden fixture: Danno's data composes to it byte for byte", () => {
  const p = stage1Payload(danno());
  for (const field of ["ai_persona_role_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3", PRODUCT_FIELD, "ai_constraints_cbf"]) {
    it(`${field} (${golden[field].length} characters)`, () => expect(p[field as keyof typeof p]).toBe(golden[field]));
  }
  it("the time zone is unchanged, and every field is under the platform's 20,000", () => {
    expect(p.business_time_zone_cbf).toBe("America/Los_Angeles");
    for (const f of STAGE1_FIELDS) expect(p[f].length, f).toBeLessThan(20000);
    expect(stage1Problems(danno())).toEqual([]);
  });
  it("a real link replaces the placeholder in its Link line and nowhere else", () => {
    const real = stage1Payload(danno({ entry: "https://pay.example.com/accelerator", core: "https://pay.example.com/academy-deposit" }))[PRODUCT_FIELD];
    expect(real).toBe(golden[PRODUCT_FIELD].replace(linkOf("entry"), "https://pay.example.com/accelerator").replace(linkOf("core"), "https://pay.example.com/academy-deposit"));
  });
});

describe("the rules around it", () => {
  it("a client offer with no bot role never appears in the product field, whatever its status", () => {
    const text = stage1Payload(danno())[PRODUCT_FIELD];
    expect(text).not.toMatch(/Epic Voice|4,997/);
    // In range mode no offer's own price is composed at all.
    expect(text).not.toMatch(/USD \$/);
  });
  it("an entry or core offer with no payment link blocks the push, in a plain sentence", () => {
    const input = danno({ entry: "", core: linkOf("core") });
    expect(stage1Problems(input)).toEqual(["Accelerator is an entry offer on your bot with no payment link. Add the link on the Offer, or change its role."]);
  });
  it("price mode never still produces the old deflect line (the regression for other coaches)", () => {
    const input = danno();
    input.coach!.priceMode = "never";
    input.coach!.priceAnswer = "Happy to go over it on a call.";
    const price = productSections(input).find((s) => s.key === "price")!;
    expect(price.text).toBe(`PRICE\n${priceDeflection("Happy to go over it on a call.")}`);
    expect(priceDeflection(null)).toContain("We have multiple services");
  });
  it("price mode full states each bot offer's price and the payment plan line", () => {
    const input = danno();
    input.coach!.priceMode = "full";
    expect(productSections(input).find((s) => s.key === "price")!.text).toBe(["PRICE", "Accelerator: USD $6,000.", "Academy: USD $12,000.", "Elite: USD $25,000.", "Luxe: USD $50,000.", `If they ask about payment plans, say: "${PAYMENT_PLAN_LINE_DEFAULT}"`].join("\n"));
  });
  it("the guarantee line, the coverage line, every terms line, link and refund line need eyes; one per line, nothing in bulk", () => {
    const keys = needsEyes(danno()).map((e) => e.key);
    expect(keys).toEqual(["price.range", "price.plan", "guarantee.line", "guarantee.coverage", "offer:acc.terms", "offer:acc.link", "offer:acc.refund", "offer:acad.terms", "offer:acad.link", "offer:acad.refund"]);
    for (const e of needsEyes(danno())) expect(stage1Payload(danno())[PRODUCT_FIELD]).toContain(e.text);
  });
  it("a coach with nothing entered gets the house rules, the house questions and no persona or offers, as before", () => {
    const bare: Stage1Input = { businessName: "Torres Nutrition Coaching", workspaceName: "W", timezone: "UTC", offers: [offer({ name: "90-Day Reset", status: "live", price: 1500 })] };
    const p = stage1Payload(bare);
    expect(p.ai_constraints_cbf).toBe(houseConstraints("Torres Nutrition Coaching"));
    expect([p.qualifying_question_1, p.qualifying_question_2, p.qualifying_question_3]).toEqual(QUALIFYING_DEFAULTS);
    expect(p.ai_persona_role_cbf).toBe("");
    expect(p[PRODUCT_FIELD]).toBe("");
  });
  it("house rules typed with their own numbers are not numbered twice", () => {
    const input = danno();
    input.coach!.houseRules = ["1. First rule.", "2) Second rule.", "  Third rule. "];
    expect(stage1Payload(input).ai_constraints_cbf).toBe("1. First rule.\n2. Second rule.\n3. Third rule.");
  });
  it("the guarantee on with no covered offer is a warning; the coverage suggestion is built from the roles", () => {
    const input = danno();
    expect(stage1Warnings(input)).toEqual([]);
    for (const o of input.offers) o.guaranteeCovered = false;
    expect(stage1Warnings(input)).toEqual(["Your guarantee is on, but no offer on your bot is marked as covered by it."]);
    expect(suggestCoverageLine(danno().offers)).toBe("The guarantee covers the core offer and one-on-one programs only, not the entry offer. If someone on the entry offer path asks, say the guarantee is for the programs it covers, and that their USD $500 is refunded if our call shows it's not a fit.");
  });
  it("a field over the platform's limit blocks and names its longest section; nothing is dropped", () => {
    const input = danno();
    input.coach!.whatIDo = "x".repeat(20001);
    expect(stage1Problems(input)[0]).toMatch(/^The offers field is [\d,]+ characters, over the 20,000 Community Loyalty holds\. The longest section is What I do \(20,011\)\. Shorten it; nothing is dropped\.$/);
  });
});
