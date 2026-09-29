/**
 * What's new (rev 193): what changed for members and coaches, newest first, in plain words. Kept here as data and reviewed like
 * code, never edited in the app. Every commit that changes what someone sees adds its entry in the same commit (the gate
 * checks, src/lib/engine/whats-new.ts); refactors, tests and internal fixes don't.
 *
 * `n` only ever grows: the next entry takes the highest `n` plus one. It is how the menu's dot knows what a member hasn't seen.
 * `version` is the commit it arrived in when known; an entry written in the same commit as its change can't name that commit,
 * so it shows the day's version instead.
 */
export type Audience = "everyone" | "coach";
export type WhatsNewEntry = { n: number; date: string; title: string; lines: string[]; audience: Audience; version?: string };

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    n: 14,
    date: "2026-09-29",
    title: "Body: choose whether AI can help you",
    lines: ["The first step of Body asks whether HelixOS's AI may use your Body numbers (targets, what you logged, your saved meals) to support you. Yes or Not now; it stays off unless you say Yes.", "Never your photos or notes, and always on your own AI key. You can change it any time in Body settings, and every change is logged."],
    audience: "coach",
  },
  {
    n: 13,
    date: "2026-09-29",
    title: "Body (beta), just for you for now",
    lines: ["Nutrition targets and fast meal logging: day types with their own bands, your foods and saved meals, a mark on each macro, and \"What fits tonight?\".", "Switch it on in Settings under Body (beta). It starts empty, with a short checklist to fill it in. Your Body data is private: nobody else sees it unless you share it."],
    audience: "coach",
    version: "b9ed9be",
  },
  {
    n: 12,
    date: "2026-09-29",
    title: "@everyone in the Monday post is a real tag",
    lines: ["The Monday post's @everyone now shows as a tag in the community, the way it does when you post by hand. Test posts keep it as plain words, so they never ping the group."],
    audience: "coach",
  },
  {
    n: 11,
    date: "2026-09-29",
    title: "What's new, and the version you're on",
    lines: ["This page lists what changed in HelixOS, newest first. The menu shows a small dot when there's something you haven't seen.", "The version you're using is at the bottom of the menu and of Settings."],
    audience: "everyone",
  },
  {
    n: 10,
    date: "2026-09-29",
    title: "The Monday post keeps its layout and can notify everyone",
    lines: ["The Monday 3-1-3 post keeps its paragraphs and line breaks.", "\"Send the Monday text as a test\" shows the layout in your test channel first.", "\"Notify all members\" (on by default) tells the whole group when the Monday post goes out. Tests never notify anyone."],
    audience: "coach",
    version: "7fa6b38",
  },
  {
    n: 9,
    date: "2026-09-29",
    title: "You choose who gets emails from HelixOS",
    lines: ["Each client's page has an \"Emails from HelixOS\" switch. Nobody gets an automated email before their first sign-in.", "A client you import starts with emails off, so they hear nothing until you've introduced HelixOS."],
    audience: "coach",
    version: "1f411b4",
  },
  {
    n: 8,
    date: "2026-09-28",
    title: "Share to the thread is one big button",
    lines: ["Once your week is set, one tap copies your 3-1-3 and opens this week's post. Paste it as a comment and press Post.", "\"This week's thread →\" at the top of Intentions takes you to the post any time, even before your week is set."],
    audience: "everyone",
    version: "63da340",
  },
  {
    n: 7,
    date: "2026-09-28",
    title: "The Monday post goes to your community by itself",
    lines: ["Community posts (under Grow) posts the \"Set Your Intentions\" thread every Monday, shows each week's post, and who has shared to it."],
    audience: "coach",
    version: "e3ee339",
  },
  {
    n: 6,
    date: "2026-09-28",
    title: "Add several tasks before you lock in",
    lines: ["On Today, add new tasks one after another with Add or Enter, then tick your top 3 and lock in."],
    audience: "everyone",
    version: "06fe2ca",
  },
  {
    n: 5,
    date: "2026-09-28",
    title: "A green \"Saved ✓\" on every save, and nothing you type is lost",
    lines: ["Every save shows a short green confirmation.", "If something needs fixing, what you typed stays in the form and the field to fix is marked."],
    audience: "everyone",
    version: "06fe2ca",
  },
  {
    n: 4,
    date: "2026-09-28",
    title: "Your week and month live on Intentions",
    lines: ["Setting your week, your month and the monthly feedback moved from Today to Intentions. A small dot on Intentions tells you when one is due."],
    audience: "everyone",
    version: "06fe2ca",
  },
  {
    n: 3,
    date: "2026-09-27",
    title: "Import a client from Airtable",
    lines: ["Coach → Import from Airtable reads a client's base, shows you everything it found first, and brings it in once you approve."],
    audience: "coach",
    version: "af265f4",
  },
  {
    n: 2,
    date: "2026-09-26",
    title: "Your monthly intention",
    lines: ["From the 1st, set your month: your word, your season, and what you're building toward. Your past months stay on Intentions."],
    audience: "everyone",
    version: "bbb8636",
  },
  {
    n: 1,
    date: "2026-09-25",
    title: "The weekly 3-1-3",
    lines: ["Each week: one word, three key results you can count, one initiative and three tasks. Your tasks land on your list, due Friday."],
    audience: "everyone",
    version: "47c33b9",
  },
];
