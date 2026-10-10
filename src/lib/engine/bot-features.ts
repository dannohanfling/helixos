/**
 * Bot Features (Danno, 9 Oct; answers at rev 618): the eight skills a member's bot can unlock, with Danno's approved names, card
 * copy, phone lines, steps, setup fields and GoHighLevel tags, word for word. Pure: the catalogue, the default unlock rules and
 * how a rule reads against what HelixOS knows of a member. Bot Features never spend points.
 */
export const BOT_FEATURE_KEYS = ["no_show_rescue", "freebie_delivery", "seat_filler", "proof_collector", "win_back_nudge", "referral_engine", "regulars_club", "ladder_dripper"] as const;
export type BotFeatureKey = (typeof BOT_FEATURE_KEYS)[number];

export type SetupField = { key: string; label: string; type: "text" | "url" | "number" | "textarea"; placeholder?: string; defaultValue?: string; required: boolean };
export type BotFeature = {
  key: BotFeatureKey;
  name: string;
  description: string;
  shortLine: string;
  icon: "calendar-check" | "gift" | "ticket" | "star" | "undo" | "users" | "award" | "ladder";
  steps: [string, string, string];
  setup: SetupField[];
  /** The GoHighLevel box: "Build your ___ on this tag" and the tags; none for the Ladder Dripper. */
  ghl: { build: string; tags: string[] } | null;
  comingSoon?: boolean;
};

export const BOT_FEATURES: BotFeature[] = [
  {
    key: "no_show_rescue",
    name: "No-Show Rescue",
    description: "When someone misses a booked call, your bot says sorry we missed you and helps them pick a new time.",
    shortLine: "Rebooks people who miss a call.",
    icon: "calendar-check",
    steps: ["Someone misses a call booked with you.", "Your bot messages them: sorry we missed you.", "It helps them pick a new time."],
    setup: [],
    ghl: { build: "rebook texts", tags: ["EO No Show"] },
  },
  {
    key: "freebie_delivery",
    name: "Freebie Delivery",
    description: "People comment or message FREE. Your bot gets their email and sends your free guide.",
    shortLine: "Sends your free guide to anyone who messages FREE.",
    icon: "gift",
    steps: ["Someone comments or messages FREE.", "Your bot asks for their email.", "It sends your guide and tags them in GoHighLevel."],
    setup: [
      { key: "guideName", label: "Name of your free guide", type: "text", placeholder: "e.g. 5-Day Content Plan", required: true },
      { key: "guideUrl", label: "Link to your free guide", type: "url", required: true },
    ],
    ghl: { build: "nurture emails", tags: ["EO Lead Magnet"] },
  },
  {
    key: "seat_filler",
    name: "Seat Filler",
    description: "People comment or message EVENT. Your bot signs them up for your workshop and sends the join link.",
    shortLine: "Signs people up for your workshop.",
    icon: "ticket",
    steps: ["Someone comments or messages EVENT.", "Your bot asks for their email.", "It signs them up, sends the join link and tags them in GoHighLevel."],
    setup: [
      { key: "eventName", label: "Event name", type: "text", required: true },
      { key: "eventWhen", label: "Day, date and time (with time zone)", type: "text", required: true },
      { key: "eventUrl", label: "Join or registration link", type: "url", required: true },
    ],
    ghl: { build: "event reminders", tags: ["EO Event Registered"] },
  },
  {
    key: "proof_collector",
    name: "Proof Collector",
    description: "Your bot asks happy clients what changed for them, saves their words with permission, and sends your review link.",
    shortLine: "Collects testimonials from happy clients.",
    icon: "star",
    steps: ["Your bot asks a happy client what has changed for them.", "It asks permission to share their words with their first name.", "It saves the testimonial and sends your review link."],
    setup: [{ key: "reviewUrl", label: "Your public review link (Google or Facebook)", type: "url", required: true }],
    ghl: { build: "thank-you", tags: ["EO Testimonial"] },
  },
  {
    key: "win_back_nudge",
    name: "Win-Back Nudge",
    description: "Your bot sends a friendly check-in to people who have gone quiet. Replies go to your AI.",
    shortLine: "Checks in with people who went quiet.",
    icon: "undo",
    steps: ["Someone goes quiet.", "Your bot sends one friendly check-in.", "Any reply goes to your AI."],
    setup: [],
    ghl: { build: "longer win-back sequence", tags: ["EO Win Back"] },
  },
  {
    key: "referral_engine",
    name: "Referral Engine",
    description: "Clients message REFER to hear your thank-you. Friends message FRIEND and say who sent them.",
    shortLine: "Turns happy clients into referrals.",
    icon: "users",
    steps: ["A client messages REFER and hears your thank-you.", "Their friend messages FRIEND and says who sent them.", "Both are tagged in GoHighLevel so you can reward the referrer."],
    setup: [{ key: "referrerGets", label: "What a referrer gets (e.g. a free session)", type: "text", required: true }],
    ghl: { build: "referrer reward", tags: ["EO Referrer", "EO Referred"] },
  },
  {
    key: "regulars_club",
    name: "Regulars Club",
    description: "Customers message CHECKIN to earn points and POINTS to see their balance. They get your reward at the target.",
    shortLine: "Rewards customers who keep coming back.",
    icon: "award",
    steps: ["A customer messages CHECKIN when they visit (once a day).", "They message POINTS to see their balance.", "At your target, your bot sends your reward."],
    setup: [
      { key: "pointsPerCheckin", label: "Points per check-in", type: "number", defaultValue: "10", required: true },
      { key: "pointsNeeded", label: "Points needed for the reward", type: "number", defaultValue: "100", required: true },
      { key: "reward", label: "The reward", type: "text", required: true },
    ],
    ghl: { build: "reward follow-up", tags: ["EO Reward Ready"] },
  },
  {
    key: "ladder_dripper",
    name: "Ladder Dripper",
    description: "Posts your comment-ladder rungs under your latest Facebook or Instagram post, a few minutes apart.",
    shortLine: "Posts your ladder rungs for you.",
    icon: "ladder",
    steps: ["You add your rungs.", "Your bot posts them under your latest Facebook or Instagram post.", "A few minutes apart, until the list runs out."],
    setup: [{ key: "rungs", label: "Your rungs", type: "textarea", required: true }],
    ghl: null,
    comingSoon: true,
  },
];
export const featureOf = (key: string): BotFeature | undefined => BOT_FEATURES.find((f) => f.key === key);

/** One rule per feature (data, so Danno changes it without code): free, a behavior HelixOS sees or the coach toggles, a tier, points reached. */
export const UNLOCK_TYPES = ["free", "behavior", "tier", "points"] as const;
export type UnlockType = (typeof UNLOCK_TYPES)[number];
export const BEHAVIORS = ["guide_link", "event_scheduled", "first_client", "contacts_25", "first_testimonial", "first_ladder_post"] as const;
export type Behavior = (typeof BEHAVIORS)[number];
export type UnlockRule = { type: UnlockType; value: string };
/** The milestone in plain words, after "Unlocks when you": bold in the card's footer. */
export const BEHAVIOR_WORDS: Record<Behavior, string> = {
  guide_link: "add your free guide link",
  event_scheduled: "schedule your first event",
  first_client: "book your first client",
  contacts_25: "have 25 contacts in your bot",
  first_testimonial: "collect your first testimonial",
  first_ladder_post: "publish your first ladder post",
};
export const DEFAULT_RULES: Record<BotFeatureKey, UnlockRule> = {
  no_show_rescue: { type: "free", value: "" },
  freebie_delivery: { type: "behavior", value: "guide_link" },
  seat_filler: { type: "behavior", value: "event_scheduled" },
  proof_collector: { type: "behavior", value: "first_client" },
  win_back_nudge: { type: "behavior", value: "contacts_25" },
  referral_engine: { type: "behavior", value: "first_testimonial" },
  regulars_club: { type: "tier", value: "Sage" },
  ladder_dripper: { type: "behavior", value: "first_ladder_post" },
};

/**
 * How each behavior is known (rev 618 answers): HelixOS sees it, or only the coach's toggle on the client says so. A toggle
 * always counts, so it overrides what HelixOS can't see (Proof Collector's override included).
 */
export const BEHAVIOR_SOURCE: Record<Behavior, string> = {
  guide_link: "a published lead magnet",
  event_scheduled: "a webinar with a date",
  first_client: "the first evening close with cash collected",
  contacts_25: "your toggle only",
  first_testimonial: "any Proof Bank entry",
  first_ladder_post: "a ladder marked live or done, or shipped",
};
export const REQUEST_STATES = ["requested", "on"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const ruleOf = (rules: Partial<Record<BotFeatureKey, UnlockRule>>, key: BotFeatureKey): UnlockRule => rules[key] ?? DEFAULT_RULES[key];
/** A rule as written on the coach's rules page; null when it can't stand (an unknown behavior or tier, points that aren't a number). */
export function readRule(type: string, value: string, tierNames: string[]): UnlockRule | null {
  const v = value.trim();
  if (type === "free") return { type, value: "" };
  if (type === "behavior") return (BEHAVIORS as readonly string[]).includes(v) ? { type, value: v } : null;
  if (type === "tier") return tierNames.includes(v) ? { type, value: v } : null;
  if (type === "points") return /^\d{1,7}$/.test(v) ? { type, value: String(Number(v)) } : null;
  return null;
}

/** What HelixOS knows of a member, for the rules: the behaviors it sees (or the coach toggled), their points and tier. */
export type MemberFacts = { behaviors: Set<Behavior>; points: number; tierName: string; tierMin: (name: string) => number | null };

/** Whether a rule is met, and the line a locked card shows. Points are a threshold reached, never spent. */
export function unlockState(rule: UnlockRule, facts: MemberFacts): { unlocked: boolean; line: string; progress: number | null } {
  switch (rule.type) {
    case "free":
      return { unlocked: true, line: "", progress: null };
    case "behavior": {
      const b = rule.value as Behavior;
      return { unlocked: facts.behaviors.has(b), line: BEHAVIOR_WORDS[b] ?? "reach your next milestone", progress: null };
    }
    case "tier": {
      const min = facts.tierMin(rule.value);
      const got = min !== null && facts.points >= min;
      return { unlocked: got, line: `reach ${rule.value} tier`, progress: min ? Math.min(100, Math.round((facts.points / min) * 100)) : null };
    }
    case "points": {
      const need = Number(rule.value) || 0;
      return { unlocked: facts.points >= need, line: `reach ${need.toLocaleString("en-US")} points`, progress: need ? Math.min(100, Math.round((facts.points / need) * 100)) : null };
    }
  }
}

export type FeatureState = "locked" | "unlocked" | "requested" | "on" | "coming_soon";
/** The card's state: Coming soon over everything; then On, Requested, Unlocked, Locked. */
export function featureState(f: BotFeature, unlocked: boolean, request: { state: "requested" | "on" } | null): FeatureState {
  if (f.comingSoon) return "coming_soon";
  if (request?.state === "on") return "on";
  if (request?.state === "requested") return "requested";
  return unlocked ? "unlocked" : "locked";
}
/** The setup form read back: every required field filled, a link a link, a number a whole number. */
export function readSetup(f: BotFeature, raw: Record<string, string>): { value: Record<string, string> } | { error: string; field: string } {
  const out: Record<string, string> = {};
  for (const s of f.setup) {
    const v = (raw[s.key] ?? s.defaultValue ?? "").trim();
    if (s.required && !v) return { error: `Fill in "${s.label}".`, field: s.key };
    if (v && s.type === "url" && !/^https?:\/\/\S+\.\S+/.test(v)) return { error: `"${s.label}" needs a full link, starting https://.`, field: s.key };
    if (v && s.type === "number" && !/^\d{1,6}$/.test(v)) return { error: `"${s.label}" needs a whole number.`, field: s.key };
    out[s.key] = v.slice(0, 4000);
  }
  return { value: out };
}
