/**
 * HelixOS → Community Loyalty (uChat) bot fields, the pure part: which of the template's ten names the Stage 1 push writes,
 * which names it must never touch because the client or the bot's own agent writes them, and how each value is composed
 * from the record. The push is a named subset, never "all fields": a re-push after an unrelated edit must leave the calendar
 * the client chose and the appointment the agent booked exactly as they were. (code-essence-to-botfields.md §2.3, §3a.)
 */
import { formatPrice } from "./offer-score";
import { agentReadsFields, type AgentInfo } from "./faq";

/**
 * The offers field, by the template's current name, and the name bots made before the rename still carry. The push writes the
 * new name when the bot has it and falls back to the old one only when it has no field by the new name; the Coach page and the
 * preview name the fallback whenever it is in use.
 */
export const PRODUCT_FIELD = "ai_product_&_service_information_cbf";
export const PRODUCT_FIELD_OLD = "ai_product_&_service_cbf";

/** The Book 'em Danno template's ten custom bot fields, read in Third Eye on 20 Sep, the offers field by its current name. The prompts reference these names. */
export const TEMPLATE_BOT_FIELDS = ["business_name_cbf", "business_time_zone_cbf", PRODUCT_FIELD, "ai_persona_role_cbf", "ai_skills_cbf", "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3", "calendar_id"] as const;

/** Stage 1: facts with one right answer, plus the house constraints block and the three qualifying questions with their defaults. */
export const STAGE1_FIELDS = ["business_name_cbf", "business_time_zone_cbf", "ai_persona_role_cbf", PRODUCT_FIELD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3"] as const;
export type Stage1Field = (typeof STAGE1_FIELDS)[number];
/** A Stage 1 field's older name, tried only when the bot has no field by the current one. */
export const FIELD_FALLBACKS: Partial<Record<Stage1Field, string>> = { [PRODUCT_FIELD]: PRODUCT_FIELD_OLD };

/**
 * Written on the Community Loyalty side and never by this push: the calendar the client chose during Book 'em Danno onboarding,
 * and what the agent writes when it books. The last two are the agent's names as reported (21 Sep); confirm against the template.
 */
export const BOT_WRITTEN_FIELDS = ["calendar_id", "appointment_id", "booked_time"] as const;

/**
 * Stage 2, held until the Essence intake stops handing clients somebody else's words. The persona left Stage 2 on 24 Sep (rev
 * 80): it is the coach's own "Who your bot speaks as", sent verbatim, not drafted prose.
 */
export const STAGE2_FIELDS = ["ai_skills_cbf"] as const;

for (const f of STAGE1_FIELDS) if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(f)) throw new Error(`bot-fields: ${f} is written by the bot and cannot be pushed`);

/** The length rule, the same on Danno's bot and in the house default for every client's (rev 101): Danno's house rule 2, word for word. */
export const LENGTH_RULE = "Two sentences max. Only when you need it to handle an objection, up to four: acknowledge them, a story if one fits, the answer, then one question. One question at a time. No jargon.";
/**
 * The house default for ai_constraints_cbf: the length rule and the claims discipline, shipped to every client bot so nothing ships
 * with the brakes off. The client's own prohibitions and ethics are appended when Stage 2 ships. Provisional wording, on the
 * sentence list.
 */
export const HOUSE_CONSTRAINT_LINES = [
  LENGTH_RULE,
  "Never invent a statistic, a result or a testimonial. If a number is not in your fields, you do not have it.",
  "Never state a price, a discount or a payment plan that is not in your product and service field.",
  "Never claim a client's result without the number and the permission to say it.",
  "Never promise a booking before it is confirmed. Say you are booking it, then say it is booked only when it is.",
  "When you do not know, say so and offer the next step. Never guess a deadline, a policy or a medical, legal or financial answer.",
  "If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be {business_name_cbf}.",
];
/** The block with the business name written in: a bot field's value is plain text, so the name is filled here, not by the bot. No name, no block: the push refuses instead. */
export const houseConstraints = (businessName: string): string => HOUSE_CONSTRAINT_LINES.map((l) => l.replace("{business_name_cbf}", businessName.trim())).join("\n");

/** Provisional questions the bot asks before booking, until the coach writes their own. On the sentence list. */
export const QUALIFYING_DEFAULTS: [string, string, string] = [
  "What are you working towards right now, in a sentence?",
  "What have you already tried, and what happened?",
  "If we found a fit, when would you want to start?",
];

/*
 * How the bot sells (handoff rev 90 to 109; the "Bot flow (rev 4)" tab): the offers field is facts the bot knows, how the coach
 * talks about money, short examples in the coach's words, and two banks of true stories, the coach's own and their partners'.
 * The wording around the coach's data is the house's and is fixed by the golden fixture (scripts/fixtures/golden-bot-danno.json,
 * approved in the handoff at rev 110/111): Danno's record composes to it byte for byte, and a unit test holds it there. "Say
 * exactly" is gone everywhere except the guarantee promise, which is a commitment.
 */
export type BotRole = "entry" | "core" | "one_on_one" | "not_on_bot";
export const BOT_ROLES: BotRole[] = ["not_on_bot", "entry", "core", "one_on_one"];
export const BOT_ROLE_LABEL: Record<BotRole, string> = {
  not_on_bot: "Not on your bot",
  entry: "Entry offer: sold in chat with a payment link",
  core: "Core offer: a deposit link for buyers who say they're ready",
  one_on_one: "One-on-one: call only, never a link",
};
export type DefaultPath = "call" | "link";
export const DEFAULT_PATHS: DefaultPath[] = ["call", "link"];
export const DEFAULT_PATH_LABEL: Record<DefaultPath, string> = { call: "The call", link: "Your first entry offer's link" };

export type OfferFacts = {
  id?: string;
  name: string;
  promise: string | null;
  container: string;
  price: number;
  currency: string;
  length: string | null;
  status: string;
  botRole?: BotRole | null;
  botName?: string | null;
  /** When to offer it, one sentence in the money flow ("Get started comes up when they ask how to start, or after we have talked budget."). */
  botFor?: string | null;
  botTerms?: string | null;
  botTermsWhen?: string | null;
  botCancelLine?: string | null;
  depositAmount?: number | null;
  refundableIfNotFit?: boolean | null;
  botRefundLine?: string | null;
  guaranteeCovered?: boolean | null;
  paymentLink?: string | null;
};
export type BotExample = { id: string; moment: string; them?: string | null; me: string; kind: "normal" | "objection" };
export type BotStory = { id: string; text: string; when?: string | null; kind: "plain" | "belief"; belief?: string | null };
/** A partner story: an approved Proof Bank row the coach put on their bot. First name, what happened, when it fits. */
export type PartnerStory = { id: string; who: string; happened: string; fits?: string | null };
/** The coach-level lines, all the coach's own words. */
export type CoachBot = {
  whatIDo?: string | null;
  /** The early price answer, with no numbers. Blank means PRICE_ANSWER_DEFAULT. */
  priceAnswer?: string | null;
  defaultPath?: DefaultPath | null;
  /** Prices on the bot (rev 121). Off composes the no-prices rules; blank or true is on, as every bot was before the switch. */
  pricesOn?: boolean | null;
  callMinutes?: number | null;
  oneOnOneRange?: string | null;
  paymentPlanLine?: string | null;
  guaranteeLine?: string | null;
  guaranteeLeadIn?: string | null;
  peopleWord?: string | null;
  examples?: BotExample[] | null;
  stories?: BotStory[] | null;
  partnerStories?: PartnerStory[] | null;
  houseRules?: string[] | null;
  persona?: string | null;
  questions?: (string | null | undefined)[];
};
export type Stage1Input = { businessName: string | null | undefined; workspaceName: string; timezone: string; offers: OfferFacts[]; coach?: CoachBot };
export type BotFieldPayload = Record<Stage1Field, string>;

/** The early price answer when the coach has written none: no numbers, then a question. On the sentence list. */
export const PRICE_ANSWER_DEFAULT = "We have multiple services for different business needs, and I'd be happy to go over all of that on a call. But first, it might make more sense to find out what you're needing support with exactly.";
export const priceAnswerFor = (line: string | null | undefined): string => line?.trim() || PRICE_ANSWER_DEFAULT;
/** Suggested when an offer is refundable and the coach has not written its line. Get started has no deposit (rev 105). */
export const REFUND_LINE_DEFAULT = "their first payment comes back if our call shows it is not a fit.";
/** When the terms are shared, when the coach has not said. */
export const TERMS_WHEN_DEFAULT = "Share when recommending it.";

const clean = (v: string | null | undefined): string => (v ?? "").trim();
/** A line that ends a sentence: a full stop added unless it already ends in one, a question mark or an exclamation. */
export const asSentence = (v: string): string => (/[.?!]["”')]*$/.test(v) ? v : `${v}.`);
/** "A", "A and B", "A, B and C". */
export const joinNames = (names: string[]): string => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
/** The offers that feed the bot: a bot role, whatever their live or draft state elsewhere. Entry first, then core, then one-on-one. */
export const botOffers = (offers: OfferFacts[]): OfferFacts[] => (["entry", "core", "one_on_one"] as const).flatMap((r) => offers.filter((o) => o.botRole === r));
/** The offers the bot can send a link for. */
const linkOffers = (offers: OfferFacts[]): OfferFacts[] => botOffers(offers).filter((o) => o.botRole === "entry" || o.botRole === "core");
/** Prices are off on this bot (rev 121): no amounts, ranges, terms or links, no entry or core offer named, everyone to the call. */
export const pricesOff = (c: CoachBot | undefined): boolean => c?.pricesOn === false;
/** What prices-off leaves out of an example or a line: any "$", or the bot name of an entry or core offer. */
const pricedText = (text: string, offers: OfferFacts[]): boolean =>
  text.includes("$") || linkOffers(offers).some((o) => new RegExp(`\\b${botNameOf(o).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
export const botNameOf = (o: OfferFacts): string => clean(o.botName) || clean(o.name);
export const refundLineOf = (o: OfferFacts): string => (o.refundableIfNotFit ? clean(o.botRefundLine) || REFUND_LINE_DEFAULT : "");
export const peopleWordOf = (c: CoachBot): string => clean(c.peopleWord).toLowerCase() || "clients";

/**
 * Each fact the bot knows, as it is composed under THE FACTS, keyed for Needs your eyes: each offer's terms, link and cancelling;
 * the one-on-one range; the refund; payment plans; the call; the guarantee promise and, when some offer on the bot is not covered,
 * what it covers (composed from the flags). `text` is the line without its bullet, exactly as sent.
 */
export type Fact = { key: string; label: string; text: string; eyes: boolean };
export function botFacts(input: Stage1Input): Fact[] {
  const c = input.coach ?? {};
  const off = pricesOff(c);
  const out: Fact[] = [];
  // Prices off: no offer's terms, link or cancelling, no one-on-one range, no payment plans and no coverage line (it names the
  // offers). The refund stays when it is one line for every offer and carries no amount; the call and the promise stay.
  for (const o of off ? [] : linkOffers(input.offers)) {
    const id = o.id ?? botNameOf(o);
    const name = botNameOf(o);
    if (clean(o.botTerms)) out.push({ key: `offer:${id}.terms`, label: `${name}: the terms`, text: `${name}: ${asSentence(clean(o.botTerms))} ${asSentence(clean(o.botTermsWhen) || TERMS_WHEN_DEFAULT)}`, eyes: true });
    if (clean(o.paymentLink)) out.push({ key: `offer:${id}.link`, label: `${name}: the link`, text: `${name} link: ${clean(o.paymentLink)}. Send it only when they say yes.`, eyes: true });
    if (clean(o.botCancelLine)) out.push({ key: `offer:${id}.cancel`, label: `${name}: cancelling`, text: `${asSentence(clean(o.botCancelLine))} Only if asked.`, eyes: true });
  }
  const one = botOffers(input.offers).filter((o) => o.botRole === "one_on_one");
  if (!off && one.length && clean(c.oneOnOneRange)) out.push({ key: "oneonone.range", label: "The one-on-one range", text: `One-on-one: ${clean(c.oneOnOneRange).replace(/[.]$/, "")}, call only. Use it as the contrast when recommending, or if they ask about one-on-one.`, eyes: true });
  // One refund line when every refundable offer says the same; otherwise one per offer, named.
  const refunds = linkOffers(input.offers).filter((o) => refundLineOf(o));
  const distinct = [...new Set(refunds.map((o) => asSentence(refundLineOf(o))))];
  if (off) {
    if (distinct.length === 1 && !pricedText(distinct[0], input.offers)) out.push({ key: "refund", label: "The refund", text: `Refund: ${distinct[0]} Say it only if they hesitate to pay.`, eyes: true });
  } else if (distinct.length === 1) out.push({ key: "refund", label: "The refund", text: `Refund: ${distinct[0]} Say it only if they hesitate to pay.`, eyes: true });
  else for (const o of refunds) out.push({ key: `offer:${o.id ?? botNameOf(o)}.refund`, label: `${botNameOf(o)}: the refund`, text: `Refund on ${botNameOf(o)}: ${asSentence(refundLineOf(o))} Say it only if they hesitate to pay.`, eyes: true });
  if (!off && clean(c.paymentPlanLine)) out.push({ key: "price.plan", label: "Payment plans", text: `Payment plans, only if asked: ${asSentence(clean(c.paymentPlanLine))}`, eyes: true });
  out.push({ key: "call", label: "The call", text: `The call: ${c.callMinutes ? `${c.callMinutes} minutes, no pressure` : "no pressure"}. When inviting.`, eyes: true });
  if (clean(c.guaranteeLine)) {
    const lead = clean(c.guaranteeLeadIn);
    out.push({ key: "guarantee.line", label: "Your guarantee, the promise word for word", text: `The guarantee, the first time they ask, this sentence word for word: "${clean(c.guaranteeLine)}"${lead ? ` You can lead in with "${lead}"` : ""} The details come on the call. Say nothing else about results.`, eyes: true });
    const coverage = !off && botOffers(input.offers).some((o) => !o.guaranteeCovered) ? suggestCoverageLine(input.offers) : "";
    if (coverage) out.push({ key: "guarantee.coverage", label: "What the guarantee covers", text: coverage, eyes: true });
  }
  return out;
}

/** A story line as MY STORIES lists it: the story, then when it fits or the belief it answers. */
export const storyLine = (s: BotStory): string => {
  const tail = s.kind === "belief" && clean(s.belief) ? `Belief: "${asSentence(clean(s.belief))}"` : clean(s.when) ? asSentence(clean(s.when)) : "";
  return `${clean(s.text)}${tail ? ` (${tail})` : ""}`;
};
/** A partner story as the bot reads it: first name, what happened, when it fits. */
export const partnerLine = (p: PartnerStory): string => `${clean(p.who)}: ${clean(p.happened)}${clean(p.fits) ? ` (${asSentence(clean(p.fits))})` : ""}`;
const storiesOf = (c: CoachBot) => (c.stories ?? []).filter((s) => clean(s.text));
const partnersOf = (c: CoachBot) => (c.partnerStories ?? []).filter((p) => clean(p.who) && clean(p.happened));
const examplesOf = (c: CoachBot) => (c.examples ?? []).filter((e) => clean(e.moment) && clean(e.me));
/** Payment terms in a reply, with or without an amount ("it's month to month"). */
const TERMS = /\b(?:month[- ]to[- ]month|a month|per month|monthly|payment plans?|deposit|instal(?:l)?ments?|cancel anytime)\b/i;
/**
 * An example left out while prices are off: a "$" or an entry or core offer's name in any of its lines, or payment terms in the
 * reply (only the reply: a lead may ask about payment plans, and an answer with no terms still goes).
 */
export const pricedExample = (e: BotExample, offers: OfferFacts[]): boolean => [e.moment, e.them ?? "", e.me].some((t) => pricedText(t, offers)) || TERMS.test(e.me);
/** The examples that are sent: with prices off, none that is priced. */
const sentExamples = (c: CoachBot, offers: OfferFacts[]) => examplesOf(c).filter((e) => !pricesOff(c) || !pricedExample(e, offers));

export type ProductSection = { key: string; title: string; text: string };
/** The offers field, section by section, in the fixture's order. Empty when there is no WHAT I DO and no offer on the bot. */
export function productSections(input: Stage1Input): ProductSection[] {
  const c = input.coach ?? {};
  const offers = botOffers(input.offers);
  if (!clean(c.whatIDo) && !offers.length) return [];
  const out: ProductSection[] = [];
  if (clean(c.whatIDo)) out.push({ key: "what", title: "What I do", text: ["WHAT I DO", clean(c.whatIDo)].join("\n") });

  // Money comes up inside the conversation: no numbers early, then the path by what they said, each offer's own "when".
  const one = offers.some((o) => o.botRole === "one_on_one") && clean(c.oneOnOneRange);
  const linkFirst = linkOffers(input.offers).find((o) => clean(o.paymentLink));
  const call = `the ${c.callMinutes ? `${c.callMinutes}-minute ` : ""}call`;
  if (pricesOff(c)) {
    // Prices off (rev 121): the no-prices rules. Only the one-on-one "when" lines stay; an entry or core one names that offer.
    const oneWhens = [...new Set(offers.filter((o) => o.botRole === "one_on_one").map((o) => clean(o.botFor)).filter(Boolean).map(asSentence))];
    out.push({
      key: "money",
      title: "How I talk about money",
      text: [
        "HOW I TALK ABOUT MONEY",
        "No prices for now. Never give an amount, a range or payment terms, never send a checkout link, and never name a program.",
        `If someone asks about price, answer with no numbers: "${priceAnswerFor(c.priceAnswer)}" Then ask a question.`,
        [`After my questions, everyone who is a fit gets ${call}.`, ...oneWhens].join(" "),
      ].join("\n"),
    });
  } else {
    const path = c.defaultPath === "link" && linkFirst ? `After my questions, most people get ${botNameOf(linkFirst)}, and the link when they say yes.` : `After my questions, most people get ${call}.`;
    const whens = [...new Set(offers.map((o) => clean(o.botFor)).filter(Boolean).map(asSentence))];
    out.push({
      key: "money",
      title: "How I talk about money",
      text: [
        "HOW I TALK ABOUT MONEY",
        "Money comes up inside the conversation, never as a price sheet.",
        `If someone asks about price before I know their situation, answer with no numbers: "${priceAnswerFor(c.priceAnswer)}" Then ask a question.`,
        `Numbers come only once I know enough to recommend something.${one ? " Never answer a price question with the one-on-one range and a start price in one breath." : ""}`,
        [path, ...whens].join(" "),
      ].join("\n"),
    });
  }

  out.push({ key: "facts", title: "The facts", text: ["THE FACTS", "Know these. Never recite them as a list. Share one only when the conversation gets there or they ask.", ...botFacts(input).map((f) => `- ${f.text}`)].join("\n") });

  const examples = sentExamples(c, input.offers);
  if (examples.length)
    out.push({
      key: "examples",
      title: "How I say it",
      text: ["HOW I SAY IT\nExamples from my own chats. Match the tone and the order, never copy word for word.", ...examples.map((e) => [clean(e.moment), clean(e.them) && `Them: ${clean(e.them)}`, `Me: ${clean(e.me)}`].filter(Boolean).join("\n"))].join("\n\n"),
    });

  const stories = storiesOf(c);
  if (stories.length) {
    const plain = stories.filter((s) => s.kind !== "belief");
    const belief = stories.filter((s) => s.kind === "belief");
    out.push({
      key: "stories",
      title: "My stories",
      text: [
        "MY STORIES",
        "True stories from my life. Tell only these, never make one up, and never add numbers or results to one. You can shorten one, never add to it. At most one plain story per chat. A belief story is always told when its belief comes up, even if a plain story was already told. Never more than two stories in a chat, and never the same one twice.",
        ...(plain.length ? ["Plain stories:", ...plain.map((s) => `- ${storyLine(s)}`)] : []),
        ...(belief.length ? ["Belief stories:", ...belief.map((s) => `- ${storyLine(s)}`)] : []),
      ].join("\n"),
    });
  }

  const partners = partnersOf(c);
  if (partners.length) {
    const word = peopleWordOf(c);
    out.push({
      key: "partners",
      title: `${word[0].toUpperCase()}${word.slice(1, -1)} stories`,
      text: [`${word.replace(/s$/, "").toUpperCase()} STORIES`, `Real results my ${word} gave me permission to share. Tell one only inside an objection, at most one per chat, as that person's own result, never as what they'll get. Never change a number.`, ...partners.map((p) => `- ${partnerLine(p)}`)].join("\n"),
    });
  }

  if (offers.some((o) => o.botRole === "one_on_one")) out.push({ key: "one_on_one", title: "One-on-one", text: "ONE-ON-ONE\nCall only. Never send a link for one-on-one." });
  return out;
}

/**
 * What the guarantee covers, built from the offers' "covered" flags and roles alone (rev 104: coverage composes from the flags).
 * A role with more than one offer on the bot is named in the plural (offer by offer when only some of them are covered), and the
 * deposit named for the entry path is the offer's own amount (rev 88), or "their deposit" when the uncovered entry offers differ.
 * Sent only when some offer on the bot is not covered; with every one covered there is nothing to say.
 */
export function suggestCoverageLine(offers: OfferFacts[]): string {
  const on = botOffers(offers);
  const covered = on.filter((o) => o.guaranteeCovered);
  if (!covered.length) return "";
  const ROLE_NOUN: Record<Exclude<BotRole, "not_on_bot">, string> = { entry: "the entry offer", core: "the core offer", one_on_one: "one-on-one programs" };
  // A role wholly on one side is named by its noun (plural when it has more than one offer); a role split across both sides is
  // named offer by offer, so the line never says it covers "the entry offers" and not "the entry offers".
  const nouns = (list: OfferFacts[]) =>
    joinNames(
      (["entry", "core", "one_on_one"] as const).flatMap((role) => {
        const mine = list.filter((o) => o.botRole === role);
        if (!mine.length) return [];
        const all = on.filter((o) => o.botRole === role);
        if (mine.length < all.length) return mine.map(botNameOf);
        return [role !== "one_on_one" && all.length > 1 ? `${ROLE_NOUN[role]}s` : ROLE_NOUN[role]];
      }),
    );
  const not = on.filter((o) => !o.guaranteeCovered);
  let line = not.length ? `The guarantee covers ${nouns(covered)} only, not ${nouns(not)}.` : `The guarantee covers ${nouns(covered)}.`;
  const refunded = not.filter((o) => o.botRole === "entry" && o.refundableIfNotFit && o.depositAmount);
  if (refunded.length) {
    const amounts = [...new Set(refunded.map((o) => formatPrice(o.depositAmount ?? 0, o.currency)))];
    line += ` If someone on the entry offer path asks, say the guarantee is for the programs it covers, and that ${amounts.length === 1 ? `their ${amounts[0]}` : "their deposit"} is refunded if our call shows it's not a fit.`;
  }
  return line;
}

/**
 * The house rules as the bot gets them: the coach's own list, numbered in their order, exactly as written (a number typed at the
 * start of a line is not doubled). An empty list means the six house lines, as before; those are only ever a new coach's
 * starting text, never prepended to a coach's own.
 */
export const houseRuleSeed = (businessName: string): string[] => HOUSE_CONSTRAINT_LINES.map((l) => l.replace("{business_name_cbf}", businessName.trim()));
export function houseRulesText(rules: string[] | null | undefined, businessName: string): string {
  const own = (rules ?? []).map((r) => r.replace(/^\s*\d+[.)]\s+/, "").trim()).filter(Boolean);
  return own.length ? own.map((r, i) => `${i + 1}. ${r}`).join("\n") : houseConstraints(businessName);
}

/** The three questions: the coach's own when written, the house default when blank. */
export function qualifyingQuestions(questions: (string | null | undefined)[] | undefined): [string, string, string] {
  return [0, 1, 2].map((i) => clean(questions?.[i]) || QUALIFYING_DEFAULTS[i]) as [string, string, string];
}
const QUESTION_FIELDS = ["qualifying_question_1", "qualifying_question_2", "qualifying_question_3"] as const;
/**
 * The fields whose value is only a house default, because the member has not written their own: the questions left blank, and
 * the house rules when the list is empty (the six house lines). The plan sends a house default only where the bot's field is
 * empty or holds what HelixOS last sent, never over the bot's own text (rev 83: Danno's own questions on his bot would have been
 * replaced by the defaults on his first push; rev 87: the same for the house rules).
 */
export function houseDefaultFields(input: Stage1Input): Stage1Field[] {
  const q = input.coach?.questions;
  const ownRules = (input.coach?.houseRules ?? []).some((r) => clean(r));
  return [...(ownRules ? [] : (["ai_constraints_cbf"] as const)), ...QUESTION_FIELDS.filter((_, i) => !clean(q?.[i]))];
}
/** What the row says when a house default is held back because the bot has its own text there. */
export const OWN_TEXT_LINE: Partial<Record<Stage1Field, string>> = {
  ai_constraints_cbf: "Your bot has its own house rules here. Write yours in Essence to manage them from HelixOS.",
  qualifying_question_1: "Your bot has its own question here. Type yours under Settings to manage it from HelixOS.",
  qualifying_question_2: "Your bot has its own question here. Type yours under Settings to manage it from HelixOS.",
  qualifying_question_3: "Your bot has its own question here. Type yours under Settings to manage it from HelixOS.",
};

/**
 * The Stage 1 payload: exactly STAGE1_FIELDS, every one present, composed from the record. A source the client has not filled
 * composes empty here, and the plan leaves it out of what is sent (or sends its nothing-current sentence where HelixOS wrote
 * the field last): Community Loyalty refuses an empty value.
 */
export function stage1Payload(input: Stage1Input): BotFieldPayload {
  const businessName = clean(input.businessName) || input.workspaceName.trim();
  const c = input.coach ?? {};
  const [q1, q2, q3] = qualifyingQuestions(c.questions);
  return {
    business_name_cbf: businessName,
    business_time_zone_cbf: input.timezone,
    ai_persona_role_cbf: clean(c.persona),
    [PRODUCT_FIELD]: productSections(input).map((s) => s.text).join("\n\n"),
    ai_constraints_cbf: houseRulesText(c.houseRules, businessName),
    qualifying_question_1: q1,
    qualifying_question_2: q2,
    qualifying_question_3: q3,
  } as BotFieldPayload;
}

/** Community Loyalty's limit on one bot field. */
export const BOT_FIELD_BUDGET = 20000;

/**
 * What stops a push, each in a sentence the coach can act on: no business name, an entry or core offer with no payment link, or a
 * field over the platform's limit (named by its longest section; nothing is dropped).
 */
export function stage1Problems(input: Stage1Input, p: BotFieldPayload = stage1Payload(input)): string[] {
  const out: string[] = [];
  if (!p.business_name_cbf.trim()) out.push("No business name on the record: set it on the member's profile or the workspace.");
  // With prices off no link is sent, so a missing one holds nothing.
  for (const o of pricesOff(input.coach) ? [] : linkOffers(input.offers)) {
    if (!clean(o.paymentLink)) out.push(`${botNameOf(o)} is ${o.botRole === "entry" ? "an entry" : "a core"} offer on your bot with no payment link. Add the link on the Offer, or change its role.`);
  }
  for (const f of STAGE1_FIELDS) {
    const n = p[f].length;
    if (n <= BOT_FIELD_BUDGET) continue;
    if (f === PRODUCT_FIELD) {
      const longest = [...productSections(input)].sort((a, b) => b.text.length - a.text.length)[0];
      out.push(`The offers field is ${n.toLocaleString()} characters, over the ${BOT_FIELD_BUDGET.toLocaleString()} Community Loyalty holds. The longest section is ${longest.title} (${longest.text.length.toLocaleString()}). Shorten it; nothing is dropped.`);
    } else out.push(`${f} is ${n.toLocaleString()} characters, over the ${BOT_FIELD_BUDGET.toLocaleString()} Community Loyalty holds. Shorten it; nothing is dropped.`);
  }
  return out;
}

const WEEKDAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i;
/** Sentences in a reply: each run of . ? or ! that ends a word, a closing quote allowed ("$1,200" and "30-second" are not ends). */
export const sentenceCount = (text: string): number => (clean(text).match(/[.?!]+["”')]*(?=\s|$)/g) ?? []).length || (clean(text) ? 1 : 0);
/** A line's words, lowercased, for comparing a reply with what the lead said. */
const wordsOf = (t: string): string[] => clean(t).toLowerCase().replace(/[‘’]/g, "'").match(/[a-z0-9$']+/g) ?? [];
/**
 * The longest run of three or more words a reply repeats from the lead's own line, or "". The bot copies a reply's opening to a
 * lead who never said it (rev 119: "After two programs that didn't deliver…" to a lead who had said nothing of the kind).
 */
export function repeatedRun(them: string | null | undefined, me: string): string {
  const said = ` ${wordsOf(them ?? "").join(" ")} `;
  const mw = wordsOf(me);
  let best = "";
  for (let i = 0; i + 3 <= mw.length; i++) {
    let j = i + 3;
    if (!said.includes(` ${mw.slice(i, j).join(" ")} `)) continue;
    while (j < mw.length && said.includes(` ${mw.slice(i, j + 1).join(" ")} `)) j++;
    const run = mw.slice(i, j).join(" ");
    if (run.length > best.length) best = run;
  }
  return best;
}
/** A lead's name in a reply: "Hey Jess", "Thanks, Jess". The bot may greet every lead by it. */
const GREETED = /\b(?:[Hh]ey|[Hh]i|[Hh]ello|[Tt]hanks|[Tt]hank you),?\s+([A-Z][a-z]+)\b/;
const NOT_A_NAME = new Set(["There", "Friend", "Everyone", "All", "Again"]);
/**
 * The checks on one example (rev 101): a normal message is at most two sentences, an objection at most four, one question, no
 * weekday names. Rev 121 adds two: a reply that repeats three or more words of the lead's own line, and a reply that names a
 * person. Warnings only, never a block, and nothing here changes what is composed.
 */
export function exampleWarnings(e: BotExample): string[] {
  const out: string[] = [];
  const me = clean(e.me);
  const moment = clean(e.moment);
  const max = e.kind === "objection" ? 4 : 2;
  const n = sentenceCount(me);
  if (n > max) out.push(`"${moment}": ${n} sentences, and ${e.kind === "objection" ? "an objection" : "a normal message"} is at most ${max}.`);
  if ((me.match(/\?/g) ?? []).length > 1) out.push(`"${moment}": more than one question.`);
  if (WEEKDAYS.test(me)) out.push(`"${moment}": names a weekday; say a date instead.`);
  const run = repeatedRun(e.them, me);
  if (run) out.push(`"${moment}": this reply repeats what they said ("${run}"). Your bot may say it to someone who never did.`);
  const name = me.match(GREETED)?.[1];
  if (name && !NOT_A_NAME.has(name)) out.push(`"${moment}": names ${name}. Your bot may call every lead ${name}.`);
  return out;
}

/** Worth saying before a push, never a block. */
export function stage1Warnings(input: Stage1Input): string[] {
  const c = input.coach ?? {};
  const out: string[] = [];
  if (clean(c.guaranteeLine) && !botOffers(input.offers).some((o) => o.guaranteeCovered)) out.push("Your guarantee is on, but no offer on your bot is marked as covered by it.");
  for (const e of examplesOf(c)) out.push(...exampleWarnings(e));
  // A digit in one of the coach's own stories may be a results claim; numbers belong in a partner story, approved as proof.
  for (const s of storiesOf(c)) if (/\d/.test(s.text)) out.push(`Your story "${clean(s.text).slice(0, 60)}" has a number in it. If it's a result, it belongs in your Proof Bank, not in your stories.`);
  for (const p of partnersOf(c)) if (/\s/.test(clean(p.who))) out.push(`"${clean(p.who)}" on your bot: first names only, and no business names.`);
  return out;
}

/**
 * The lines a person must read and approve one at a time before a push (Needs your eyes): every fact (prices, terms, links,
 * cancelling, the one-on-one range, the refund, payment plans, the call, the guarantee promise and what it covers), each of the
 * coach's own stories and each partner story. The examples, the money flow and the guarantee's lead-in are outside it. Each is
 * keyed so an approval of its exact text can be recorded; a changed line needs approving again. Only lines that will be sent.
 */
export type EyesLine = { key: string; label: string; text: string };
export function needsEyes(input: Stage1Input): EyesLine[] {
  const c = input.coach ?? {};
  if (!productSections(input).length) return [];
  return [
    ...botFacts(input).filter((f) => f.eyes).map(({ key, label, text }) => ({ key, label, text })),
    ...storiesOf(c).map((s) => ({ key: `story:${s.id}`, label: `${s.kind === "belief" ? "Your belief story" : "Your story"} “${clean(s.text).split(" ").slice(0, 8).join(" ")}…”`, text: storyLine(s) })),
    ...partnersOf(c).map((p) => ({ key: `proof:${p.id}`, label: `${clean(p.who)}'s story, from your Proof Bank`, text: partnerLine(p) })),
  ];
}

/** Nothing has changed since the last push: the bot already holds exactly this. */
export function samePayload(last: Record<string, string> | null | undefined, next: BotFieldPayload): boolean {
  if (!last) return false;
  const keys = Object.keys(next) as Stage1Field[];
  return Object.keys(last).length === keys.length && keys.every((k) => last[k] === next[k]);
}

/**
 * What a field says when HelixOS wrote it and now has nothing for it: the offer retired, the question removed. Leaving the field
 * out would leave the bot selling the retired offer, so the field is told there is none, in words an agent reading it mid-prompt
 * acts on safely. Only a value HelixOS itself last sent is replaced this way; text anyone else wrote is left out, as before.
 * Proposed wording, on the sentence list: Danno or Claude may reword any of these here, and nothing else needs to change,
 * because every check compares against this table.
 */
export const STAGE1_NOTHING_CURRENT: Record<Stage1Field, string> = {
  business_name_cbf: "No business name is set. Do not name a business; say you are an assistant and offer a call with the coach.",
  business_time_zone_cbf: "No time zone is set. Do not state a time without saying which time zone it is in.",
  ai_persona_role_cbf: "No persona is set. Speak plainly, as the coach's assistant, and offer a call with the coach.",
  [PRODUCT_FIELD]: "There is no offer open right now. Do not describe or price any product; offer a call with the coach instead.",
  ai_constraints_cbf: "No extra rules are set. Never invent a statistic, a result, a price or a testimonial.",
  qualifying_question_1: "No question set.",
  qualifying_question_2: "No question set.",
  qualifying_question_3: "No question set.",
} as Record<Stage1Field, string>;
/** A field holding exactly its nothing-current sentence is HelixOS's own empty: never foreign text, and the next real value goes straight over it. */
export const isNothingCurrent = (field: Stage1Field, held: string | null | undefined): boolean => (held ?? "").trim() === STAGE1_NOTHING_CURRENT[field];
/** How the Brief and the preview say it, never quoting the sentence back. */
export const NOTHING_CURRENT_LABEL: Record<Stage1Field, string> = {
  business_name_cbf: "No business name",
  business_time_zone_cbf: "No time zone",
  ai_persona_role_cbf: "No persona",
  [PRODUCT_FIELD]: "No current offer",
  ai_constraints_cbf: "No extra rules",
  qualifying_question_1: "No question set",
  qualifying_question_2: "No question set",
  qualifying_question_3: "No question set",
} as Record<Stage1Field, string>;

/**
 * What a Stage 1 push would do on one bot, field by field, before anything is sent (the ruling of 21 Sep: "Before any Stage 1
 * push, show the coach what will change on the bot: current value against new value, per field"). Each field resolves to the
 * name the bot actually has (the current one, else its older name). Bot fields belong to the whole bot, so a field is read when
 * any agent on the bot reads it (23 Sep: the FAQ agent reads only the FAQ field; the business facts are read by another agent on
 * the same bot), through the same id-aware check the FAQ uses, and each row names the agents that read it. Then:
 * - missing: the bot has no field by either name, so there is nothing to write into;
 * - unread: no agent on the bot reads it, so it gets the plain line and is not sent, and its values are not shown;
 * - empty: HelixOS has nothing for it and the bot holds text HelixOS did not last send, so it is left out rather than sent as ""
 *   and the bot keeps what it holds; likewise a house default (`houseDefaults`: a question the member left blank, or the house
 *   lines when they have written no rules) over the bot's own text;
 * - same: the bot already holds exactly this (or already says there is none);
 * - change: sent, with the bot's current value beside the new one. That includes a field HelixOS last wrote and now has nothing
 *   for: it is sent its nothing-current sentence (`nothing` is set), so a retired offer stops being sold.
 * Only "change" rows are sent, and the read-back covers only those. `lastSent` is what HelixOS last confirmed on this bot, by name.
 */
export type PlanStatus = "change" | "same" | "empty" | "missing" | "unread";
export type PlanRow = { field: Stage1Field; name: string | null; fallback: boolean; current: string | null; next: string; status: PlanStatus; line: string; readBy: string[]; nothing: boolean };
export function stage1Plan(payload: BotFieldPayload, held: { name: string; value: string; ns: string }[], agents: AgentInfo[], lastSent: Record<string, string> = {}, houseDefaults: readonly Stage1Field[] = []): PlanRow[] {
  const byName = new Map(held.map((h) => [h.name, h]));
  const nsByName = Object.fromEntries(held.filter((h) => h.ns).map((h) => [h.name, h.ns]));
  return STAGE1_FIELDS.map((field) => {
    const older = FIELD_FALLBACKS[field];
    const readers = (n: string) => agents.filter((a) => agentReadsFields(a, [n], nsByName).reads.length).map((a) => a.name);
    // The current name when the bot has it, the older one when it has only that. With both on the bot, the one an agent actually
    // reads (rev 80): writing the name nobody reads would change nothing the bot says.
    const both = byName.has(field) && older && byName.has(older);
    const name = both ? (!readers(field).length && readers(older).length ? older : field) : byName.has(field) ? field : older && byName.has(older) ? older : null;
    const fallback = Boolean(name && name !== field);
    const readBy = name ? readers(name) : [];
    const current = name ? (byName.get(name)?.value ?? null) : null;
    const row = { field, name, fallback, current, next: payload[field], readBy, nothing: false };
    const written = fallback ? `Written to ${name}, this bot's older name for ${field}.` : "";
    if (!name) return { ...row, status: "missing" as const, line: `Your bot has no ${field} field${older ? ` (nor the older ${older})` : ""}, so nothing is sent to it.` };
    if (!readBy.length) return { ...row, current: null, next: "", status: "unread" as const, line: `No agent on this bot reads ${name} yet, so nothing is sent to it.` };
    if (!row.next.trim()) {
      const sentence = STAGE1_NOTHING_CURRENT[field];
      if (isNothingCurrent(field, current)) return { ...row, next: sentence, nothing: true, status: "same" as const, line: `Your bot already says: ${NOTHING_CURRENT_LABEL[field].toLowerCase()}.` };
      const ours = Boolean(current?.trim()) && current === lastSent[name];
      if (ours) return { ...row, next: sentence, nothing: true, status: "change" as const, line: `HelixOS wrote this and now has nothing for it, so your bot is told: ${NOTHING_CURRENT_LABEL[field].toLowerCase()}.${written ? ` ${written}` : ""}` };
      return { ...row, status: "empty" as const, line: "HelixOS has nothing for this yet, and your bot holds text HelixOS did not send, so nothing is sent; your bot keeps what it holds." };
    }
    if (current === row.next) return { ...row, status: "same" as const, line: "Your bot already holds this." };
    // A house default goes only where the bot's field is empty or holds what HelixOS last sent (or its own "none" sentence).
    const own = Boolean(current?.trim()) && current !== lastSent[name] && !isNothingCurrent(field, current);
    if (houseDefaults.includes(field) && own) return { ...row, status: "empty" as const, line: OWN_TEXT_LINE[field] ?? "Your bot has its own text here, so the house default is not sent." };
    return { ...row, status: "change" as const, line: written };
  });
}

/**
 * The line under a plan with nothing to send, counted from the five states rather than one blanket sentence (23 Sep: "the bot
 * already holds everything" was shown when no agent read any field).
 */
export function nothingToPushLine(rows: PlanRow[]): string {
  const n = (s: PlanStatus) => rows.filter((r) => r.status === s).length;
  if (rows.length && n("unread") === rows.length) return "Nothing to push: no agent on this bot reads these fields yet.";
  if (rows.length && n("same") === rows.length) return "Nothing to push: the bot already holds everything HelixOS would send.";
  const parts = [
    [n("same"), "unchanged"],
    [n("unread"), "not read by any agent"],
    [n("empty"), "with nothing in HelixOS"],
    [n("missing"), "not on the bot"],
  ] as const;
  return `Nothing to push: ${parts.filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(", ")}.`;
}

/** The fields a plan sends, by the name on the bot, with the new value: only the ones that change. */
export const planPayload = (rows: PlanRow[]): Record<string, string> => Object.fromEntries(rows.filter((r) => r.status === "change" && r.name && r.next.trim()).map((r) => [r.name as string, r.next]));

/**
 * The record of what was pushed holds field names and values from the business record and nothing from the transport. A value
 * that carries the token or a webhook address is a bug upstream, so it refuses rather than stores.
 */
export function assertStorable(payload: Record<string, string>, forbidden: string[]): void {
  const marks = [...forbidden.filter(Boolean), "/api/iwh/", "/api/webhooks/"];
  for (const [k, v] of Object.entries(payload)) for (const m of marks) if (v.includes(m)) throw new Error(`bot-fields: ${k} carries a credential and cannot be pushed or stored`);
}

/**
 * The request body for PUT /flow/set-bot-fields-by-name, read off the published UChat API OpenAPI document (1.0.0), quoted in
 * code-addendum-uchat-spec.md: `{ "data": [ { "name": string, "value": string } ] }`, `data` required, "up to 20 bot fields".
 * Every value is a string, serialised deliberately here (a business name, an IANA zone name, newline-joined lines, three
 * questions), and more than the spec's limit refuses loudly rather than truncating.
 */
export const MAX_BOT_FIELDS_PER_CALL = 20;
export type BotFieldsRequest = { data: { name: string; value: string }[] };
export function botFieldsRequest(payload: Record<string, string>): BotFieldsRequest {
  const data = Object.entries(payload).map(([name, value]) => {
    if (typeof value !== "string") throw new Error(`bot-fields: ${name} is not a string and cannot be pushed as one`);
    return { name, value };
  });
  if (data.length > MAX_BOT_FIELDS_PER_CALL) throw new Error(`bot-fields: ${data.length} fields in one call; the API takes ${MAX_BOT_FIELDS_PER_CALL}`);
  if (!data.length) throw new Error("bot-fields: nothing to push");
  return { data };
}

/**
 * A 200 from the push is `{ "status": "ok" }` and carries no per-field result, so it does not prove a field was written. The
 * read-back compares what the bot now holds against what was sent: the names whose value differs or is missing.
 */
export function readBackMismatches(sent: Record<string, string>, held: Record<string, string | undefined>): string[] {
  return Object.keys(sent).filter((k) => held[k] !== sent[k]);
}

/**
 * GET /flow/bot-fields answers BotFieldResource, `{ "data": [ BotField ] }`, where BotField requires `name`, `var_type` and
 * `value` (a string) and takes `limit` and `page` (1 to 100) with no total. One shape is parsed and nothing else: a body that
 * is not that shape is nothing held, which fails the match on the safe side. Pages are read until one comes back shorter
 * than the limit sent.
 */
export const READ_BACK_LIMIT = 100;
export const BOT_FIELD_TYPES = ["text", "number", "boolean", "date", "datetime", "array", "longtext"] as const;
export function parseBotFields(body: unknown): { name: string; value: string; varType: string; ns: string }[] {
  const b = body as { data?: unknown };
  if (!b || typeof b !== "object" || !Array.isArray(b.data)) return [];
  const out: { name: string; value: string; varType: string; ns: string }[] = [];
  for (const r of b.data as { name?: unknown; var_type?: unknown; value?: unknown; var_ns?: unknown }[]) {
    if (typeof r?.name !== "string" || typeof r.var_type !== "string" || typeof r.value !== "string") continue;
    // var_ns is the field's variable id: what a prompt's chip stores in place of the name, so the agent-reads check looks for it.
    out.push({ name: r.name, value: r.value, varType: r.var_type, ns: typeof r.var_ns === "string" ? r.var_ns : "" });
  }
  return out;
}
/** Another page follows only while a page came back full. */
export const morePages = (received: number, limit: number): boolean => received >= limit;
