/**
 * The copy that is the same for everyone on Danno's gold pages (the canvas "Inner Circle Funnel", Look C), with Danno's answers
 * of 13 Oct: the call is 60 minutes with time for Q&A at the end; nothing about cost or a replay; the date is always named,
 * never "this Friday". The personal sections are not here: they come from the Magic funnel engine (the prospect's pitch, or the
 * webinar's default copy). Danno signs these lines off on the Preview.
 */
import type { CallWhen } from "@/lib/hermes/when";

export const HOST = "Danno Hanfling";
export const HOST_FIRST = "Danno";
export const BRAND = "Evolve Omega";

/** Every photo is from ic-images.zip, in public/hermes/. Alt text says what the photo shows, nothing more. */
export const PHOTO = {
  logo: { src: "/hermes/evolve-omega-logo-320.png", width: 320, height: 320, alt: "Evolve Omega" },
  hero: { src: "/hermes/ic3-teach-flow.jpg", width: 1050, height: 1400, alt: "Danno teaching an automation workflow on screen to a room of business owners" },
  headshot: { src: "/hermes/danno-headshot-lanyard.jpg", width: 675, height: 900, alt: "Danno Hanfling" },
  letter: { src: "/hermes/danno-teaching-whiteboard.jpg", width: 1195, height: 659, alt: "Danno teaching at a whiteboard beside the Evolve Omega logo" },
  part1: { src: "/hermes/ic3-teach-edge.jpg", width: 1400, height: 977, alt: "Danno teaching a room of business owners at The Edge" },
  part2: { src: "/hermes/danno-stage-summit.jpg", width: 900, height: 1200, alt: "Danno on stage at Summit of Greatness" },
  part3: { src: "/hermes/ic3-serving-future.jpg", width: 1400, height: 1050, alt: "Danno with a Serving the Future partner at his Grub n Chill event booth" },
  dean: { src: "/hermes/danno-coached-dean.jpg", width: 1100, height: 1100, alt: "Danno on stage with Dean Graziosi at The Edge" },
  videowall: { src: "/hermes/danno-videowall.jpg", width: 975, height: 1300, alt: "Danno in front of a video wall of online attendees" },
  workshop: { src: "/hermes/danno-workshop-group.jpg", width: 1300, height: 975, alt: "Danno with a workshop group" },
} as const;

export const MARQUEE = ["EVOLVE OMEGA ACADEMY", "COMMUNITY FIRST", "CHATBOTS THAT START REAL CONVERSATIONS", "BOOK 'EM DANNO", "CONNECTION OVER COMPETITION"];

/** The cold page's hero when the webinar's own default copy is empty: the canvas's cold version. */
export const COLD_HERO = {
  header: "If you are posting every day and still waiting for clients, this is how to turn the conversations you are already having into booked clients.",
  subheader: (w: CallWhen) => `No new funnels. No bigger ad budget. Just the system I use to start real conversations and turn them into booked calls, taught live on ${w.day}.`,
  cta: "Save my seat",
};

export const LETTER = {
  to: "To the business owner who is tired of posting and hoping",
  quote: { before: "You don't need a perfect system. You need a system that's perfect ", em: "for your audience", after: "." },
  close: (w: CallWhen) => `On ${w.day} I'm going to show you how I do that, live, and help you apply it to your business while we're together.`,
};

export const NOT_FOR_YOU = ["You're looking for a magic button or a get-rich-quick system", "You think the answer is just a bigger ad budget", "You'd rather blast people than talk to them"];
export const FOR_YOU = [
  "You're a coach, consultant or local business owner who wants more clients",
  "Your posts get attention but not enough conversations or bookings",
  `You're not "techy" and want a clear path, one step at a time`,
  "You'd rather build real relationships than shout louder",
];

/** The three parts as the canvas has them: the fallback when the webinar's Magic funnel setup has no pillars. */
export const PARTS = [
  { title: "Stop chasing the system. Start building yours.", shift: "Right message, right channel, right time. The 5-step lead campaign: attract, engage, respond, follow up, convert.", familiar: `"I've tried systems before. They didn't work. Why would this one?"` },
  { title: "Forget the fear. Focus on the formula.", shift: "You don't need to be a tech wizard. Six simple steps to your first bot, so the follow-up happens even when you're busy.", familiar: `"I'm not good with tech. Just thinking about setting this up wears me out."` },
  { title: "Connection over competition. Every time.", shift: "You don't have to outspend anyone. Go where your people are, talk to them like people, and turn a small audience into booked calls.", familiar: `"My market is too crowded. My audience is too small."` },
];
export const PART_PHOTOS = [PHOTO.part1, PHOTO.part2, PHOTO.part3];

export const BEFORE = [
  "Posting every day and hoping someone books",
  "Likes, views and comments that never turn into conversations",
  "Following up when you remember, and feeling pushy when you do",
  "Thinking you need to be techy, or spend more on ads, to compete",
];
export const AFTER = [
  "A clear path from first message to a time in your calendar",
  "The one question that turns a stranger into a conversation",
  "A follow-up that sounds like you and runs while you work",
  "A plan to grow from the audience you already have",
];

export const WHY_LISTEN = [
  { photo: PHOTO.dean, lead: "I keep learning from the best.", text: "Being coached on stage by Dean Graziosi at The Edge." },
  { photo: PHOTO.videowall, lead: "I teach live.", text: "Rooms full of business owners, in person and online." },
  { photo: PHOTO.workshop, lead: "Community first.", text: "Evolve Omega exists to help owners grow by treating people right." },
];

export const WHAT = "A live, hands-on Inner Circle call with Danno Hanfling. You bring your business, we work on it together.";
export const whenCard = (w: CallWhen, minutes: number) => `${w.full} · ${minutes} minutes, with time for questions at the end.`;
export const WHY = "So you leave with the next step that turns the conversations you're already having into booked clients.";

/** The FAQ, with Danno's answers: no line about cost or a replay. */
export const faq = (w: CallWhen, minutes: number) => [
  { q: "Is this a sales pitch?", a: "Fair question. I teach, live, and you leave with things you can use the same day. If it looks like we'd be a fit to keep going, I'll tell you how. If not, you keep everything from the call." },
  { q: "How long is it?", a: `${minutes} minutes, with time for your questions at the end.` },
  { q: "Is this relevant to my kind of business?", a: "If you sell a service and win clients through conversations (coaches, consultants, studios, trades, local businesses), yes." },
  { q: "I'm not techy. Can I still do this?", a: "Yes. Part 2 is exactly for you. Forget the fear, focus on the formula, one step at a time." },
  { q: "How do I join on the day?", a: `Your join link comes to you after you register, plus a reminder before we start on ${w.day}.` },
];

export const ps = (w: CallWhen) => `The best part of ${w.day} is working on your business together, live. Block the time and come with one real conversation you've had with a potential client.`;

export const FOOTER_META = "This site is not a part of the Facebook website or Meta Platforms, Inc., and is not endorsed by Facebook in any way. FACEBOOK is a trademark of Meta Platforms, Inc.";

/** The confirmation page. */
export const CONFIRM = {
  sub: (w: CallWhen) => `Your seat is saved for ${w.line}.`,
  subVideo: "Watch this short video so you know exactly how to get the most from the call.",
  asks: (w: CallWhen) => [
    { title: `Set an alarm for ${w.alarm}`, text: "Fifteen minutes before. Show-up is the whole game." },
    { title: "Keep our Messenger chat handy", text: "That's where I'll reach you before the call." },
    { title: "Camera on", text: "It's a working session. Come ready to work on your business." },
  ],
  noJoin: "Your join link comes to you in Messenger",
  signoff: (w: CallWhen) => `See you on ${w.date}. Something come up? Just reply to my message and I'll help you sort it out.`,
  bringCold: ["One real conversation you have had with a potential client this month.", "How people book a call or buy from you today.", "One client you'd love ten more of."],
};
