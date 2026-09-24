import { describe, expect, it } from "vitest";
import { COACH, ENTRY_LINK, EXAMPLES, OFFERS, PARTNERS, SCHOLARSHIP_LINK, STORIES, WHAT_I_DO, golden } from "../../../../scripts/fixtures/danno-bot";
import { LENGTH_RULE, PRICE_ANSWER_DEFAULT, PRODUCT_FIELD, QUALIFYING_DEFAULTS, STAGE1_FIELDS, exampleWarnings, houseConstraints, needsEyes, productSections, sentenceCount, stage1Payload, stage1Problems, stage1Warnings, suggestCoverageLine, type OfferFacts, type Stage1Input } from "../bot-fields";

/**
 * The golden test (handoff rev 110/111): Danno's data, entered the way the "Your bot" page, the Offers and the Proof Bank take
 * it, composes to the fixture byte for byte. The fixture is the approved text from the handoff, verbatim.
 */
const offer = (o: Partial<OfferFacts> & { name: string }): OfferFacts => ({ promise: null, container: "Group program", price: 0, currency: "USD", length: null, status: "draft", ...o });
const danno = (links = { entry: ENTRY_LINK, scholarship: SCHOLARSHIP_LINK }): Stage1Input => ({
  businessName: "Evolve Omega",
  workspaceName: "Evolve Omega Academy",
  timezone: "America/Los_Angeles",
  offers: [
    // A client's offer on his own Offers page, live and priced: no bot role, so it never reaches his bot.
    offer({ id: "epic", name: "The Epic Voice Immersion", status: "live", price: 4997 }),
    offer({ id: "gs", ...OFFERS.getStarted, paymentLink: links.entry }),
    offer({ id: "schol", ...OFFERS.scholarship, paymentLink: links.scholarship }),
    offer({ id: "acad", ...OFFERS.academy }),
    offer({ id: "elite", ...OFFERS.elite }),
    offer({ id: "luxe", ...OFFERS.luxe }),
  ],
  coach: {
    whatIDo: WHAT_I_DO,
    ...COACH,
    examples: EXAMPLES.map((e) => ({ ...e })),
    stories: STORIES.map((s) => ({ ...s })),
    partnerStories: PARTNERS.map((p, i) => ({ id: `p${i + 1}`, ...p })),
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
  it("the time zone is unchanged, every field is under the platform's 20,000, and nothing blocks", () => {
    expect(p.business_time_zone_cbf).toBe("America/Los_Angeles");
    for (const f of STAGE1_FIELDS) expect(p[f].length, f).toBeLessThan(20000);
    expect(stage1Problems(danno())).toEqual([]);
  });
  it("his examples pass the checks and his stories carry no digit: no warnings at all", () => {
    expect(stage1Warnings(danno())).toEqual([]);
  });
  it("a real link replaces the link in its fact and nowhere else", () => {
    const real = stage1Payload(danno({ entry: "https://pay.example.com/get-started", scholarship: SCHOLARSHIP_LINK }))[PRODUCT_FIELD];
    expect(real).toBe(golden[PRODUCT_FIELD].replace(`Get started link: ${ENTRY_LINK}.`, "Get started link: https://pay.example.com/get-started."));
  });
  it("the sections are in the fixture's order", () => {
    expect(productSections(danno()).map((s) => s.key)).toEqual(["what", "money", "facts", "examples", "stories", "partners", "one_on_one"]);
  });
});

describe("Needs your eyes: facts, his stories and partner stories; never examples, the money flow or the lead-in", () => {
  const keys = needsEyes(danno()).map((e) => e.key);
  it("every fact, one line each, in the order they are sent", () => {
    expect(keys.slice(0, 10)).toEqual(["offer:gs.terms", "offer:gs.link", "offer:gs.cancel", "offer:schol.terms", "offer:schol.link", "oneonone.range", "refund", "price.plan", "call", "guarantee.line"]);
  });
  it("then the eight stories and the eleven partner stories", () => {
    expect(keys.slice(10)).toEqual([...STORIES.map((s) => `story:${s.id}`), ...PARTNERS.map((_, i) => `proof:p${i + 1}`)]);
  });
  it("each line's text is in the field exactly as sent; no example, money-flow line or lead-in alone is a line", () => {
    const sent = stage1Payload(danno())[PRODUCT_FIELD];
    for (const e of needsEyes(danno())) expect(sent).toContain(e.text);
    const texts = needsEyes(danno()).map((e) => e.text).join("\n");
    expect(texts).not.toContain("Money comes up inside the conversation");
    expect(texts).not.toContain("Hey Jess");
    // The lead-in reaches the eyes only inside the guarantee fact, never as its own line.
    expect(needsEyes(danno()).filter((e) => e.text.includes(COACH.guaranteeLeadIn)).map((e) => e.key)).toEqual(["guarantee.line"]);
  });
  it("a changed number in a partner story changes that line's text, so it needs approving again", () => {
    const input = danno();
    input.coach!.partnerStories![3].happened = input.coach!.partnerStories![3].happened.replace("$4,750", "$4,700");
    const before = needsEyes(danno()).find((e) => e.key === "proof:p4")!.text;
    const after = needsEyes(input).find((e) => e.key === "proof:p4")!.text;
    expect(after).not.toBe(before);
  });
});

describe("the rules around it", () => {
  it("a client offer with no bot role, and an offer taken off the bot, never appear", () => {
    const text = stage1Payload(danno())[PRODUCT_FIELD];
    expect(text).not.toMatch(/Epic Voice|4,997|Academy|12,000|Elite|Luxe/);
  });
  it("an entry offer with no payment link blocks the push, in a plain sentence", () => {
    expect(stage1Problems(danno({ entry: "", scholarship: SCHOLARSHIP_LINK }))).toEqual(["Get started is an entry offer on your bot with no payment link. Add the link on the Offer, or change its role."]);
  });
  it("no one-on-one range: no range fact and no 'one breath' line; no lead-in: the promise alone", () => {
    const input = danno();
    input.coach!.oneOnOneRange = null;
    input.coach!.guaranteeLeadIn = null;
    const text = stage1Payload(input)[PRODUCT_FIELD];
    expect(text).not.toContain("one breath");
    expect(text).not.toContain("- One-on-one:");
    expect(text).toContain(`this sentence word for word: "${COACH.guaranteeLine}" The details come on the call.`);
  });
  it("the early price answer defaults to the house line; the default path can be the first entry offer's link", () => {
    const input = danno();
    input.coach!.priceAnswer = null;
    input.coach!.defaultPath = "link";
    const money = productSections(input).find((s) => s.key === "money")!.text;
    expect(money).toContain(`answer with no numbers: "${PRICE_ANSWER_DEFAULT}" Then ask a question.`);
    expect(money).toContain("After my questions, most people get Get started, and the link when they say yes. Get started comes up when");
  });
  it("an offer not covered by the guarantee puts what it covers in the facts, composed from the flags, and in Needs your eyes", () => {
    const input = danno();
    input.offers = input.offers.map((o) => (o.id === "schol" ? { ...o, guaranteeCovered: false } : o));
    const line = "The guarantee covers Get started and one-on-one programs only, not Scholarship.";
    expect(suggestCoverageLine(input.offers)).toBe(line);
    expect(stage1Payload(input)[PRODUCT_FIELD]).toContain(`Say nothing else about results.\n- ${line}\n\nHOW I SAY IT`);
    expect(needsEyes(input).find((e) => e.key === "guarantee.coverage")!.text).toBe(line);
  });
  it("two refundable offers with different lines are each named; the same line is said once", () => {
    const input = danno();
    input.offers = input.offers.map((o) => (o.id === "schol" ? { ...o, refundableIfNotFit: true, botRefundLine: "the $1,200 comes back if the call shows it's not a fit." } : o));
    const keys = needsEyes(input).map((e) => e.key);
    expect(keys).toContain("offer:gs.refund");
    expect(keys).toContain("offer:schol.refund");
    expect(stage1Payload(input)[PRODUCT_FIELD]).toContain("- Refund on Scholarship: the $1,200 comes back if the call shows it's not a fit. Say it only if they hesitate to pay.");
  });
  it("a coach who calls them clients gets CLIENT STORIES", () => {
    const input = danno();
    input.coach!.peopleWord = null;
    expect(stage1Payload(input)[PRODUCT_FIELD]).toContain("CLIENT STORIES\nReal results my clients gave me permission to share.");
  });
  it("a coach with nothing entered gets the house rules (with the length rule), the house questions and no persona or offers", () => {
    const bare: Stage1Input = { businessName: "Torres Nutrition Coaching", workspaceName: "W", timezone: "UTC", offers: [offer({ name: "90-Day Reset", status: "live", price: 1500 })] };
    const p = stage1Payload(bare);
    expect(p.ai_constraints_cbf).toBe(houseConstraints("Torres Nutrition Coaching"));
    expect(p.ai_constraints_cbf.split("\n")[0]).toBe(LENGTH_RULE);
    expect([p.qualifying_question_1, p.qualifying_question_2, p.qualifying_question_3]).toEqual(QUALIFYING_DEFAULTS);
    expect(p.ai_persona_role_cbf).toBe("");
    expect(p[PRODUCT_FIELD]).toBe("");
    expect(needsEyes(bare)).toEqual([]);
  });
  it("Danno's rule 2 is the house length rule, word for word", () => {
    expect(golden.ai_constraints_cbf.split("\n")[1]).toBe(`2. ${LENGTH_RULE}`);
  });
  it("house rules typed with their own numbers are not numbered twice", () => {
    const input = danno();
    input.coach!.houseRules = ["1. First rule.", "2) Second rule.", "  Third rule. "];
    expect(stage1Payload(input).ai_constraints_cbf).toBe("1. First rule.\n2. Second rule.\n3. Third rule.");
  });
  it("a field over the platform's limit blocks and names its longest section; nothing is dropped", () => {
    const input = danno();
    input.coach!.whatIDo = "x".repeat(20001);
    expect(stage1Problems(input)[0]).toMatch(/^The offers field is [\d,]+ characters, over the 20,000 Community Loyalty holds\. The longest section is What I do \(20,011\)\. Shorten it; nothing is dropped\.$/);
  });
});

describe("the checks: warnings only", () => {
  it("counts sentences, not prices or hyphens", () => {
    expect(sentenceCount("There's a scholarship where $1,200 covers the whole year. Want me to send that one instead?")).toBe(2);
    expect(sentenceCount("Set up a 30-second video.")).toBe(1);
    expect(sentenceCount("Totally fair. We can talk first. Which would you rather do?")).toBe(3);
  });
  it("a normal example over two sentences, an objection over four, two questions, a weekday: each warned", () => {
    const n = { id: "x", moment: "Price", them: null, me: "One. Two. Three.", kind: "normal" as const };
    expect(exampleWarnings(n)).toEqual(['"Price": 3 sentences, and a normal message is at most 2.']);
    expect(exampleWarnings({ ...n, kind: "objection" })).toEqual([]);
    expect(exampleWarnings({ ...n, kind: "objection", me: "A. B. C. D. E." })).toEqual(['"Price": 5 sentences, and an objection is at most 4.']);
    expect(exampleWarnings({ ...n, me: "Is it you? Or me?" })).toEqual(['"Price": more than one question.']);
    expect(exampleWarnings({ ...n, me: "Want Tuesday?" })).toEqual(['"Price": names a weekday; say a date instead.']);
  });
  it("a digit in one of his stories is a warning; a full name on a partner story is a warning; neither blocks", () => {
    const input = danno();
    input.coach!.stories![0].text = "My first $5,000 week.";
    input.coach!.partnerStories![0].who = "Candy Smith";
    expect(stage1Warnings(input)).toEqual(['Your story "My first $5,000 week." has a number in it. If it\'s a result, it belongs in your Proof Bank, not in your stories.', '"Candy Smith" on your bot: first names only, and no business names.']);
    expect(stage1Problems(input)).toEqual([]);
  });
});
