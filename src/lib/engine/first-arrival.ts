/**
 * The first arrival (H-472): a short Roman welcome that plays once, the first time a person signs in to HelixOS. Two faces:
 * the client (the account owner) and the team member. Pure: who it is comes in, the words, the tiles and the geometry come
 * out. The design (docs/first-arrival/Main.dc.html and Team.dc.html) is the source of the motion and the copy.
 */
export type ArrivalKind = "client" | "team";
export type ArrivalTile = { href: string; label: string; line: string; numeral?: string; icon?: string; wide?: boolean };

/** The client's three marble tablets. */
export const CLIENT_STEPS: ArrivalTile[] = [
  { numeral: "I", href: "/today#checkin", label: "Lock in today", line: "Pick the one thing that moves you forward." },
  { numeral: "II", href: "/my-board", label: "Meet your Board", line: "Ask your advisors anything about your business." },
  { numeral: "III", href: "/settings#you", label: "Set your time zone", line: "So Office Hours and reminders show in your time." },
];
/** The team member's tiles: only pages a team member can open (src/lib/engine/__tests__/team.test.ts); Office Hours follows the owner's access (H-470). */
export const TEAM_TILES: ArrivalTile[] = [
  { href: "/content", label: "Content", line: "Draft and schedule posts.", icon: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" },
  { href: "/conversations", label: "DMs", line: "Reply and log chats.", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" },
  { href: "/tasks", label: "Tasks", line: "Pick up what is yours.", icon: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" },
  { href: "/webinars", label: "Webinars", line: "Help with sign-ups.", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
  { href: "/office-hours", label: "Office Hours", line: "Join the calls {owner} books you on, shown in your time.", icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", wide: true },
];
export const teamTiles = (owner: string, oohOn: boolean): ArrivalTile[] => TEAM_TILES.filter((t) => t.href !== "/office-hours" || oohOn).map((t) => ({ ...t, line: t.line.replace("{owner}", owner) }));

/** Whether the ceremony is due: never seen, never while a coach is switched into a client, never on /coach pages. */
export function arrivalDue(a: { seenAt: string | null; switchedInto: boolean; path: string }): boolean {
  if (a.switchedInto) return false;
  if (a.path === "/coach" || a.path.startsWith("/coach/")) return false;
  return !a.seenAt;
}

export type ArrivalCard = {
  kind: ArrivalKind;
  first: string;
  nameUp: string;
  owner: string | null;
  initial: string;
  eyebrow: string;
  title: string;
  lead: string;
  chip: string;
  tiles: ArrivalTile[];
  button: string;
  /** A replay from Settings: plays again, stamps nothing. */
  replay: boolean;
  summary: string;
};

/** The words and the tiles for one person. */
export function arrivalCard(a: { kind: ArrivalKind; first: string; owner?: string | null; oohOn?: boolean; replay?: boolean }): ArrivalCard {
  const first = a.first.trim() || "there";
  const owner = (a.owner ?? "").trim() || null;
  if (a.kind === "team") {
    const who = owner ?? "the owner";
    return {
      kind: "team",
      first,
      nameUp: first.toUpperCase(),
      owner: who,
      initial: who.charAt(0).toUpperCase(),
      eyebrow: "Ave · You've joined the team",
      title: `Welcome to ${who}'s team, ${first}`,
      lead: `You're here to help ${who}'s business grow. Here's what you can do.`,
      chip: `Invited by ${who}`,
      tiles: teamTiles(who, a.oohOn ?? true),
      button: "Start helping",
      replay: Boolean(a.replay),
      summary: `Welcome to ${who}'s team, ${first}. You're here to help ${who}'s business grow.`,
    };
  }
  return {
    kind: "client",
    first,
    nameUp: first.toUpperCase(),
    owner: null,
    initial: first.charAt(0).toUpperCase(),
    eyebrow: "Ave · Welcome to HelixOS",
    title: `Your seat is ready, ${first}`,
    lead: "You start as an Artisan. Every day you show up, your fire grows.",
    chip: "Day 1 · Your first ember",
    tiles: CLIENT_STEPS,
    button: "Take my seat",
    replay: Boolean(a.replay),
    summary: `Your seat is ready, ${first}. You start as an Artisan. Every day you show up, your fire grows.`,
  };
}

/** The sequence's length: the gate to 2.2 s, the wreath and the lines to 4 s, the shine at 4.7 s. */
export const ARRIVAL_MS = 5200;
/** When the doors open: the applause, softly. */
export const ARRIVAL_DOORS_MS = 800;

const rnd = (i: number, k: number): number => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
/** The wreath's 24 leaves around the aureus, as the design places them: twelve a side, growing one by one from 2.45 s. */
export function wreathLeaves(): { x: number; y: number; r: number; delay: number }[] {
  const out: { x: number; y: number; r: number; delay: number }[] = [];
  const cx = 84;
  const cy = 84;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = 100 + i * (150 / (n - 1));
    const r = i % 2 === 0 ? 66 : 76;
    const tilt = i % 2 === 0 ? 18 : -18;
    const delay = Number((2.45 + i * 0.05).toFixed(2));
    for (const side of [1, -1]) {
      const ang = side === 1 ? a : 180 - a;
      const rad = (ang * Math.PI) / 180;
      out.push({ x: Number((cx + r * Math.cos(rad) - 5).toFixed(1)), y: Number((cy + r * Math.sin(rad) - 12).toFixed(1)), r: Number((side === 1 ? a + tilt : -(a + tilt)).toFixed(1)), delay });
    }
  }
  return out;
}
/** The 22 gold flakes and leaves falling from 2.3 s, deterministic so the server and the client agree. */
export function goldFlakes(): { leaf: boolean; left: number; w: number; h: number; delay: number; dur: number }[] {
  return Array.from({ length: 22 }, (_, j) => {
    const leaf = j % 3 === 0;
    const w = leaf ? 8 + Math.round(rnd(j, 1) * 4) : 4 + Math.round(rnd(j, 1) * 3);
    return { leaf, left: Number((rnd(j, 2) * 100).toFixed(1)), w, h: Math.round(w * (leaf ? 1.8 : 1.5)), delay: Number((2.3 + rnd(j, 3) * 2).toFixed(2)), dur: Number((3.8 + rnd(j, 4) * 2.4).toFixed(2)) };
  });
}
