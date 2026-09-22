import { describe, expect, it } from "vitest";
import { FAQ_FIELD_BUDGET, agentReadsFields, composeField, countEntries, diffSinceSync, entryBlock, fromAirtable, needsEyes, normaliseCategory, notReadWarning, parseAgentInfo, parseAgents, parseKnowledgeBase, rankEntries } from "../faq";

/** The Knowledge Base Builder's output as the template writes it, header block included: what a client pastes back from their own AI. */
const FIXTURE = `# Knowledge Base — Torres Nutrition Coaching
Voice: Warm & encouraging
Generated for: Maya Torres

### Q: How much does the 90-Day Reset cost?
**Also asked:** What's the price? / Is there a payment plan?
**Keywords:** price, cost, payment plan, 90-day reset
**Answer:** The 90-Day Reset is USD $1,500, and you can split it over three months. Book a call and we'll walk through what fits.
**Category:** Pricing

### Q: What happens after I join?
**Also asked:** What's the process?, What do I get first?
**Keywords:** onboarding, process, first week
**Answer:** You'll get a welcome call in your first week, then a plan you'll actually run.
We check in every Monday.
**Category:** Process

### Q: Where are you based?
Also asked: Are you online?
Keywords: location, online, remote
Answer: Fully online, on your schedule.
Category: Logistics
`;

describe("the Knowledge Base Builder format, parsed deterministically", () => {
  it("keeps everything before the first ### Q: as the header block, never as an entry", () => {
    const kb = parseKnowledgeBase(FIXTURE);
    expect(kb.header).toContain("Knowledge Base — Torres Nutrition Coaching");
    expect(kb.header).toContain("Voice: Warm & encouraging");
    expect(kb.entries.length).toBe(3);
    expect(countEntries(FIXTURE)).toBe(3);
  });

  it("reads the five fields, with or without the template's bold markers, and a multi-line answer whole", () => {
    const [a, b, c] = parseKnowledgeBase(FIXTURE).entries;
    expect(a.question).toBe("How much does the 90-Day Reset cost?");
    expect(a.alsoAsked).toEqual(["What's the price?", "Is there a payment plan?"]);
    expect(a.keywords).toEqual(["price", "cost", "payment plan", "90-day reset"]);
    expect(a.category).toBe("Pricing");
    expect(b.answer).toBe("You'll get a welcome call in your first week, then a plan you'll actually run.\nWe check in every Monday.");
    expect(b.alsoAsked).toEqual(["What's the process?", "What do I get first?"]);
    expect(c.question).toBe("Where are you based?");
    expect(c.alsoAsked).toEqual(["Are you online?"]);
    expect(c.category).toBe("Logistics");
  });

  it("is deterministic and drops nothing silently: an entry without an answer is not an entry", () => {
    expect(parseKnowledgeBase(FIXTURE)).toEqual(parseKnowledgeBase(FIXTURE));
    const kb = parseKnowledgeBase("### Q: A question with no answer\n**Category:** Contact\n\n### Q: Real\n**Answer:** Yes.");
    expect(kb.entries.map((e) => e.question)).toEqual(["Real"]);
  });

  it("a known category keeps the template's spelling; an unknown one keeps its own word", () => {
    expect(normaliseCategory("pricing")).toBe("Pricing");
    expect(normaliseCategory("what's included")).toBe("What's Included");
    expect(normaliseCategory("Community")).toBe("Community");
  });
});

describe("Needs your eyes: a price, a guarantee, a result or a number", () => {
  it("pins an answer that mentions a price, a number, a guarantee or a result", () => {
    expect(needsEyes({ answer: "It's USD $1,500 over three months." })).toBe(true);
    expect(needsEyes({ answer: "Most clients see results in 30 days." })).toBe(true);
    expect(needsEyes({ answer: "There's a 14-day guarantee." })).toBe(true);
    expect(needsEyes({ answer: "We guarantee it." })).toBe(true);
  });
  it("leaves a plain answer alone", () => {
    expect(needsEyes({ answer: "Fully online, on your schedule." })).toBe(false);
    expect(needsEyes({ answer: "Book a call and we'll talk it through." })).toBe(false);
  });
});

describe("rank, compose under the budget, and the diff since the last sync", () => {
  const e = (id: string, timesAsked: number | null, createdAt: string, answer = "A short answer.") => ({ id, question: `Q${id}`, answer, timesAsked, createdAt });

  it("ranks by Times Asked when the source carried it, else by recency (Airtable's drafts have it empty)", () => {
    const ranked = rankEntries([e("old", null, "2026-01-01"), e("asked", 12, "2025-01-01"), e("new", null, "2026-06-01")]);
    expect(ranked.map((x) => x.id)).toEqual(["asked", "new", "old"]);
  });

  it("breaks a tie the same way whatever order the rows arrive in, so the Brief and the push agree on what drops", () => {
    const same = "2026-09-22 10:00:00"; // a batch import stamps every entry with the same second
    const a = rankEntries([e("c", null, same), e("a", null, same), e("b", null, same)]).map((x) => x.id);
    const b = rankEntries([e("b", null, same), e("c", null, same), e("a", null, same)]).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["a", "b", "c"]);
  });

  it("composes whole entries in rank order and drops the lowest-ranked whole past the budget, listing them", () => {
    const long = "x".repeat(60);
    const ranked = [e("1", 3, "2026-01-01", long), e("2", 2, "2026-01-01", long), e("3", 1, "2026-01-01", long)];
    const one = entryBlock(ranked[0]).length;
    const c = composeField(ranked, one * 2 + 2); // room for two, not three
    expect(c.included.map((x) => x.id)).toEqual(["1", "2"]);
    expect(c.dropped.map((x) => x.id)).toEqual(["3"]);
    expect(c.chars).toBeLessThanOrEqual(c.budget);
    expect(c.text.startsWith("Q: Q1\nA: ")).toBe(true);
    // A cut never lands mid-entry: the text is exactly the included blocks and nothing of the dropped one.
    expect(c.text.includes("Q3")).toBe(false);
  });

  it("the default budget is the single configurable limit, 20,000 characters", () => {
    expect(FAQ_FIELD_BUDGET).toBe(20000);
    expect(composeField([e("a", null, "2026-01-01")]).budget).toBe(20000);
  });

  it("diffs added, edited and removed against the last sync's snapshot; before any sync everything is added", () => {
    const now = [{ id: "a", question: "Qa", answer: "new words" }, { id: "b", question: "Qb", answer: "same" }, { id: "d", question: "Qd", answer: "fresh" }];
    const last = [{ id: "a", question: "Qa", answer: "old words" }, { id: "b", question: "Qb", answer: "same" }, { id: "c", question: "Qc", answer: "gone" }];
    const d = diffSinceSync(now, last);
    expect(d.added.map((x) => x.id)).toEqual(["d"]);
    expect(d.edited.map((x) => x.id)).toEqual(["a"]);
    expect(d.removed.map((x) => x.id)).toEqual(["c"]);
    expect(diffSinceSync(now, null).added.length).toBe(3);
  });
});

describe("push only what the agent reads: ai-agent-info parsed without assuming its shape", () => {
  const info = { data: { ai_agent_ns: "f1a2b3", name: "Booking Agent", prompts: [{ section: "Persona", text: "You are {ai_persona_role_cbf}." }, { section: "Products", text: "Offers: {{ ai_product_&_service_information_cbf }}" }] } };

  it("harvests every string under data and finds a field's token in either brace style", () => {
    const parsed = parseAgentInfo(info)!;
    expect(parsed.ns).toBe("f1a2b3");
    const r = agentReadsFields(parsed, ["ai_persona_role_cbf", "ai_product_&_service_information_cbf", "ai_skills_cbf"]);
    expect(r.reads).toEqual(["ai_persona_role_cbf", "ai_product_&_service_information_cbf"]);
    expect(r.notRead).toEqual(["ai_skills_cbf"]);
    expect(notReadWarning("ai_skills_cbf")).toBe("your bot does not use ai_skills_cbf yet");
  });

  it("a reply with no data is no agent; the agent list parses ns and name and nothing else", () => {
    expect(parseAgentInfo({})).toBeNull();
    expect(parseAgentInfo({ data: "x" })).toBeNull();
    expect(parseAgents({ data: [{ ai_agent_ns: "a1", name: "One", extra: 1 }, { name: "no ns" }] })).toEqual([{ ns: "a1", name: "One" }]);
  });
});

describe("Danno's Airtable rows, mapped by the field names the report listed", () => {
  it("takes Bot Answer as the answer, Answer as the fallback, only a Published row, Times Asked when present", () => {
    const r = fromAirtable({ id: "recA", fields: { Question: "How do I start?", "Bot Answer": "Book a call.", Answer: "Longer.", "Alt Phrasings": "How to begin, Where to start", Keywords: "start, begin", Category: "getting started", "Times Asked": 7, Status: "Published" } })!;
    expect(r.answer).toBe("Book a call.");
    expect(r.alsoAsked).toEqual(["How to begin", "Where to start"]);
    expect(r.category).toBe("Getting Started");
    expect(r.timesAsked).toBe(7);
    expect(r.published).toBe(true);
    expect(r.sourceRef).toBe("recA");
    const draft = fromAirtable({ id: "recB", fields: { Question: "Q", Answer: "A", Status: "Draft" } })!;
    expect(draft.published).toBe(false);
    expect(draft.timesAsked).toBeNull();
    expect(fromAirtable({ id: "recC", fields: { Question: "no answer" } })).toBeNull();
  });
});
