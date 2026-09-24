/**
 * Danno's bot, entered the way the pages take it (handoff rev 110/111, the "Bot flow (rev 4)" tab): his offers on the bot, the
 * coach-level facts, his examples, his eight stories and the eleven partner stories from his Proof Bank. The unit test and the
 * botsales walk both compose this to golden-bot-danno.json byte for byte. The examples are read from the fixture itself, each
 * with the type the tab gives it; everything else is typed here as Danno would type it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const golden = JSON.parse(readFileSync(join(__dirname, "golden-bot-danno.json"), "utf8")) as Record<string, string>;
const PRODUCT = "ai_product_&_service_information_cbf";

export const WHAT_I_DO = golden[PRODUCT].split("\n\n")[0].split("\n")[1];
export const ENTRY_LINK = "evolveomega.com/partner";
export const SCHOLARSHIP_LINK = "evolveomega.com/scholarship";

/** The coach-level lines on "Your bot". */
export const COACH = {
  priceAnswer: "I have different ways I help depending on what each business needs.",
  defaultPath: "call" as const,
  callMinutes: 15,
  oneOnOneRange: "$25,000 to $50,000 a year",
  paymentPlanLine: "never say 'yes, there are options' or 'yes, there are payment plans'. Say we can find a way to make it work for qualified business owners, then ask a question to see if they're a fit, with the call as the goal.",
  guaranteeLine: "Do the work with me, and if you haven't doubled your investment within 12 months, I keep working with you at no extra cost until you do.",
  guaranteeLeadIn: "If you're putting skin in the game, I put skin in the game too.",
  peopleWord: "partners",
};

/** His offers on the bot, in the order he made them. Academy is off the bot (rev 88); Elite and Luxe are one-on-one. */
export const OFFERS = {
  getStarted: { name: "Evolve Omega Accelerator", botName: "Get started", botRole: "entry" as const, price: 6000, botFor: "Get started comes up when they ask how to start, or after we have talked budget.", botTerms: "$500 today, then $500 a month.", botTermsWhen: "Share when recommending it.", botCancelLine: "Get started is month to month. Cancel anytime.", refundableIfNotFit: true, botRefundLine: "their first payment comes back if our call shows it is not a fit.", guaranteeCovered: true },
  scholarship: { name: "Scholarship", botRole: "entry" as const, price: 1200, botFor: "The Scholarship comes up only when Get started is too much.", botTerms: "$1,200 covers the whole year.", botTermsWhen: "Only when Get started is too much.", guaranteeCovered: true },
  academy: { name: "Evolve Omega Academy", botName: "Academy", botRole: "not_on_bot" as const, price: 12000 },
  elite: { name: "Elite", botRole: "one_on_one" as const, price: 25000, botFor: "Bigger businesses, and anyone who wants one-on-one, get the call.", guaranteeCovered: true },
  luxe: { name: "Luxe", botRole: "one_on_one" as const, price: 50000, guaranteeCovered: true },
};

/** The type of each example in the tab, in order: (N) normal or (O) objection. */
const KINDS = "NOONNONOOONONONNOOOOONN".split("").map((k) => (k === "O" ? ("objection" as const) : ("normal" as const)));
/** HOW I SAY IT, one example per block: the moment, what they say (optional), what Danno says. */
export const EXAMPLES = golden[PRODUCT].split("\n\nMY STORIES")[0]
  .split("HOW I SAY IT\n")[1]
  .split("\n\n")
  .slice(1)
  .map((block, i) => {
    const [moment, ...rest] = block.split("\n");
    const them = rest.find((l) => l.startsWith("Them: "))?.slice(6) ?? null;
    const me = rest.find((l) => l.startsWith("Me: "))!.slice(4);
    return { id: `ex${i + 1}`, moment, them, me, kind: KINDS[i] };
  });

/** His eight stories: 1 to 4 plain, with when each fits; 5 to 8 answer a belief. */
export const STORIES = [
  { id: "s1", kind: "plain" as const, text: "When I started my business, before I had a system, so many leads slipped through the cracks.", when: "When they lose leads, rely on referrals, or have no system", belief: null },
  { id: "s2", kind: "plain" as const, text: "When I started, I didn't have a lot of people helping me, and I wanted to be that light for other business owners.", when: "When they're just starting out, on a tight budget, or doing it alone", belief: null },
  { id: "s3", kind: "plain" as const, text: "I've had those days where my whole calendar gets rescheduled.", when: "Reschedules", belief: null },
  { id: "s4", kind: "plain" as const, text: "I run the same systems in my own business.", when: "Is this a course, is this a bot, what makes you different", belief: null },
  { id: "s5", kind: "belief" as const, text: "When I started, I had something impactful to give, but no system around it, so I was working way harder than I should have.", when: null, belief: "I don't have a system" },
  { id: "s6", kind: "belief" as const, text: "When I started, I paid for a whole year of software and froze every time I logged into the dashboard, for six months. I didn't need to be a tech wizard, just a clear plan to follow, step by step.", when: null, belief: "I'm not techy" },
  { id: "s7", kind: "belief" as const, text: "When I started, it felt like a dozen people were sharing my exact message, with bigger budgets and bigger teams. Then I realized winning isn't about being louder than your competition, it's about connecting deeper with the people you're called to serve.", when: null, belief: "My market is too saturated" },
  { id: "s8", kind: "belief" as const, text: "When I started, I tried ads, cold DMs, funnels and email sequences, and every new process that was supposed to be the key fell flat. What worked was a system built for my audience, not someone else's blueprint.", when: null, belief: "I've tried systems before" },
];

/** The eleven partner stories, as Proof Bank rows: first name (who), what happened (the short version), when it fits. */
export const PARTNERS = [
  { who: "Candy", happened: "stuck at about 35 members in her community for eight months, and within 48 hours of setting up the system she had 57.", fits: "Not techy, stuck, been at this a while" },
  { who: "Thaddeus", happened: "was cynical and didn't think it would work, tried it for a month, set it up imperfectly, and got 10 email subscribers that first week.", fits: "Tried systems before, skeptical" },
  { who: "Jenny", happened: "had no community, no offer, no chatbot and no funnel when she joined, and six months later she launched and did $40,000 in a week.", fits: "No system, starting from zero" },
  { who: "David", happened: "came in with zero clients, zero offers and zero funnels, selling a low-ticket offer, and closed three clients in one week and collected $4,750.", fits: "No system, starting from zero" },
  { who: "Bryce", happened: "has a community of about 100 people, and one person signed up with him for $19,800.", fits: "Too saturated, small audience" },
  { who: "Flavie", happened: "got her first 100 people into her group, and brought in eight clients in three days.", fits: "Too saturated, small audience" },
  { who: "Terri", happened: "ran a five-day challenge with the system and sold out on day three, $50,000. Another campaign 45 days later took her total to $114,400.", fits: "Will this actually make me money?" },
  { who: "Braxton", happened: "launched his agency a year ago and brought in just under $100,000 in new business.", fits: "Further along, agency owners" },
  { who: "Jessica", happened: "set up an AI agent that asks people who respond for a 30-second video, and now has video testimonials across her funnel, webinar and emails.", fits: "I don't have testimonials or proof" },
  { who: "Dan", happened: "brought 20 new members into his wine club.", fits: "Local or product business" },
  { who: "Jacob", happened: "brought in $15,000 using the system.", fits: "Will this actually make me money?" },
];
