/**
 * Funnel 1 (H-674, plan H-721, Danno's answers H-841): the public page that sells starting with Danno, HelixOS included, at
 * /start. One call to action, Start with me, to the existing checkout. Every word on the page lives here, so a test can hold the
 * rules: no price, no figure but the approved audience line, no member's name.
 */

import { cleanPixelId } from "@/lib/hermes/rules";

/** The existing checkout (H-841). Buyers land on GoHighLevel's /welcome afterwards, as today. */
export const CHECKOUT_URL = "https://evolveomega.com/partner";

/** The one audience figure Danno approved (H-674). */
export const AUDIENCE_LINE = "Built by Danno Hanfling. About 101,000 people follow along across my two communities.";

export const FUNNEL_TITLE = "HelixOS: your whole business, in your pocket.";
export const FUNNEL_DESCRIPTION =
  "HelixOS tells you the three moves that matter today, shows you where your leads are leaking, and gives you a board of advisors to think with.";

export const BAR = "HelixOS is coming to iPhone and Android. Members get it first.";

export const HERO = {
  eyebrow: "For coaches and service businesses",
  title: "Your whole business, in your pocket.",
  lead: "HelixOS tells you the three moves that matter today, shows you where your leads are leaking, and gives you a board of advisors to think with. You open it with your coffee and close the day before bed.",
  imageAlt: "HelixOS on two iPhones: the Today screen and the Colosseum",
};

export const PROBLEM = {
  title: "You don't need another course. You need to know what to do next.",
  body: "Most of the coaches I work with already know a lot. What they're missing is a daily rhythm, a clear view of where the business is stuck, and someone to think it through with. That's what HelixOS is for.",
};

export type Feature = { key: string; eyebrow: string; title: string; body: string; image: string; alt: string };

export const FEATURES: readonly Feature[] = [
  {
    key: "today",
    eyebrow: "Today",
    title: "Three moves a day. Then close it out.",
    body: "Every morning HelixOS hands you the three things that move your business forward: a post, the leads to answer, the call to prepare. Lock them in, do them, and close the day. Your streak and points keep you honest.",
    image: "phone-today.webp",
    alt: "The Today screen: three moves, points and a Close the day button",
  },
  {
    key: "aqueduct",
    eyebrow: "The Aqueduct",
    title: "See exactly where your leads leak.",
    body: "Your pipeline is drawn as an aqueduct, from first message to closed client. The arch that's losing water lights up, so you fix the one step that matters instead of guessing.",
    image: "phone-aqueduct.webp",
    alt: "The Aqueduct screen: the pipeline with the step that is leaking",
  },
  {
    key: "board",
    eyebrow: "My Board",
    title: "A board of advisors, any time you're stuck.",
    body: "Ask the hard question: raise your price, take the client, change the offer. Your Board meets around one table: a strategist, an operator, a customer champion, an antagonist and my own chair. Each answers from their angle, and the best answer goes straight onto your Today. You decide.",
    image: "phone-board.webp",
    alt: "My Board: the statues of the Council Chamber, with advisors answering a question",
  },
  {
    key: "colosseum",
    eyebrow: "The Colosseum",
    title: "You're not doing this alone.",
    body: "Everyone working with me is in the arena with you. Show up, close your days, and climb the ranks from Artisan to Olympian. It's the friendly pressure most of us need.",
    image: "phone-colosseum.webp",
    alt: "The Colosseum: members around the arena, with your place this week",
  },
];

export const CHAMBER = {
  eyebrow: "The Council Chamber",
  title: "Five seats. One decision. Yours.",
  alt: "The Council Chamber at night: five marble statues around a dark oval table",
};

export const DAY_STEPS: readonly { numeral: string; title: string; body: string }[] = [
  { numeral: "I", title: "Lock in", body: "In the morning, pick today's three moves. Two minutes." },
  { numeral: "II", title: "Do the work", body: "Tick them off as you go. Your bot handles the first replies to new leads." },
  { numeral: "III", title: "Close the day", body: "At night, close it out. The arena lights up, and tomorrow's ready." },
];

export const LETTER = {
  eyebrow: "From the desk of Danno Hanfling",
  title: "I don't sell courses.",
  paragraphs: [
    "I watched good people buy course after course and never finish one. They didn't want the course. They wanted the result: more leads, more calls booked, more clients.",
    "So I built the thing I wished my clients had. HelixOS is the system I run my own business on, put into an app that tells you what to do today and keeps you company while you do it.",
    "When you start with me, you get HelixOS, all my systems and the live group calls where we work on your business together. If it's not for you, tell me in the first 30 days and you get your money back.",
  ],
  signature: "Danno",
};

export const START = {
  eyebrow: "Start with me",
  title: "Everything you need to run it, every day.",
  included: [
    "HelixOS on your phone and computer: Today, the Aqueduct, My Board and the Colosseum",
    "Live group calls where we work on your business together",
    "All my systems: the lead bot, the webinar funnel, the content plan",
    "30-day money-back guarantee",
  ],
  button: "Start with me",
};

export const FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to be good with tech?", a: "No. If you can use Instagram, you can use HelixOS. It tells you what to tap next, and we set the rest up with you on the calls." },
  { q: "Is this a course?", a: "No. There's nothing to binge. You get today's three moves and the help to do them." },
  { q: "Does it work on my phone?", a: "Yes. It works in your phone's browser today, and the iPhone and Android apps are on the way. Members get them first." },
  // The bot's line for price questions (H-674): no figure on the page.
  { q: "What does it cost?", a: "It depends on what you need. I'll walk you through the options, or you can start straight away." },
  { q: "Is my business data private?", a: "Yes. Your numbers are yours. Other members see your rank in the Colosseum, never your clients or your money." },
];

export const CLOSING = { title: "Tomorrow, know exactly what to do." };

export const FOOTER = {
  owner: "© 2026 Eye To Eye Media LLC · Evolve Omega",
  links: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Support", href: "/support" },
  ],
};

/** Every visible word, for the rules test. */
export function funnelCopy(): string {
  return [
    BAR, HERO.eyebrow, HERO.title, HERO.lead, AUDIENCE_LINE, PROBLEM.title, PROBLEM.body,
    ...FEATURES.flatMap((f) => [f.eyebrow, f.title, f.body, f.alt]),
    CHAMBER.eyebrow, CHAMBER.title, CHAMBER.alt,
    ...DAY_STEPS.flatMap((s) => [s.title, s.body]),
    LETTER.eyebrow, LETTER.title, ...LETTER.paragraphs, LETTER.signature,
    START.eyebrow, START.title, ...START.included, START.button,
    ...FAQ.flatMap((f) => [f.q, f.a]),
    CLOSING.title, FOOTER.owner, FUNNEL_TITLE, FUNNEL_DESCRIPTION,
  ].join("\n");
}

/**
 * The Meta Pixel id for this page, from Vercel's FUNNEL_PIXEL_ID (Danno's to set). Unset or not a pixel id: no beacon at all.
 */
export function funnelPixelId(raw: string | undefined = process.env.FUNNEL_PIXEL_ID): string | null {
  return cleanPixelId(raw);
}
