/**
 * Push notifications for the HelixOS apps (H-877, the list approved in H-767 and H-771). The pure rules: which notifications
 * exist, their words, what is due at a member's local time, the daily cap and quiet hours. The sender (src/lib/push/) and the
 * cron (src/app/api/cron/push) read these; nothing here touches the database or the network.
 *
 * Rules (H-767): opt-in only; at most 3 a day across all types and 1 of each type; quiet hours 9 PM to 7 AM in the member's
 * own time zone, with the evening close at the member's own chosen time as the only exception; never health data; nothing
 * promotional. Live call reminders (H-771) sit outside the cap of 3.
 */

export type PushType =
  | "call"
  | "morning"
  | "evening"
  | "streak"
  | "bot_call"
  | "rank_up"
  | "coach_answer"
  | "intentions"
  | "colosseum"
  | "webinar";

/** Each type, in the order Settings lists it, with its default and an example line for Settings. */
export const PUSH_TYPES: { type: PushType; label: string; example: string; defaultOn: boolean; ready: boolean }[] = [
  { type: "call", label: "Live call reminders", example: "We start in 15 minutes. Tap to join.", defaultOn: true, ready: true },
  { type: "morning", label: "Morning lock-in", example: "Your three moves for today are ready.", defaultOn: true, ready: true },
  { type: "evening", label: "Evening close", example: "Close out the day. Your +20 is waiting.", defaultOn: true, ready: true },
  { type: "streak", label: "Streak waiting on you", example: "Your 12-day streak is waiting on you.", defaultOn: true, ready: true },
  { type: "bot_call", label: "A call booked with one of your contacts", example: "A call was booked for Tuesday at 2:00 PM.", defaultOn: true, ready: true },
  { type: "rank_up", label: "Rank up", example: "You've risen to Sentinel. Come see your seat.", defaultOn: false, ready: true },
  { type: "coach_answer", label: "Your Office Hours question covered", example: "Danno covered your Office Hours question.", defaultOn: false, ready: true },
  { type: "intentions", label: "Weekly intentions", example: "Set this week's intentions. Two minutes.", defaultOn: false, ready: true },
  { type: "colosseum", label: "Colosseum top 3", example: "You finished in the top 3 last week.", defaultOn: false, ready: true },
  { type: "webinar", label: "Your webinar starts soon", example: "Your webinar starts in 15 minutes.", defaultOn: false, ready: true },
];

/** At most this many pushes a day across all types; call reminders don't count (H-771). */
export const DAILY_CAP = 3;
/** The permission card asks after the first close, and once more after the 7th if the answer was Not now (H-767). */
export const ASK_AGAIN_AFTER_CLOSES = 7;

export type Prefs = { enabled: boolean; types: Record<string, boolean>; quietStart: number; quietEnd: number };
export const DEFAULT_PREFS: Prefs = { enabled: true, types: {}, quietStart: 21, quietEnd: 7 };

/** Whether this member wants this type: the main switch, then their own choice, then the type's default. */
export function wants(prefs: Prefs, type: PushType): boolean {
  if (!prefs.enabled) return false;
  const own = prefs.types[type];
  if (typeof own === "boolean") return own;
  return PUSH_TYPES.find((t) => t.type === type)?.defaultOn ?? false;
}

/** Inside quiet hours at this local hour (0 to 23). A window that crosses midnight (21 to 7) is the usual case. */
export function isQuiet(hour: number, prefs: Pick<Prefs, "quietStart" | "quietEnd">): boolean {
  const { quietStart: s, quietEnd: e } = prefs;
  if (s === e) return false;
  return s > e ? hour >= s || hour < e : hour >= s && hour < e;
}

/** The words of each push. Plain and warm, no em dashes, no exclamation marks, never health data (H-767). */
export function pushCopy(
  type: PushType,
  v: { streak?: number; time?: string; day?: string; rank?: string; coach?: string; step?: "morning" | "soon" | "live"; arena?: string | null } = {},
): { title: string; body: string } {
  const title = "HelixOS";
  switch (type) {
    case "morning":
      return { title, body: "Your three moves for today are ready." };
    case "evening":
      // 30 Days in the Arena (PR C): the Arena line in place of the usual one, only when the coach has turned the nudge on.
      return { title, body: v.arena ? v.arena : "Close out the day. Your +20 is waiting." };
    case "streak":
      return { title, body: `Your ${v.streak ?? 0}-day streak is waiting on you.` };
    case "call":
      if (v.step === "live") return { title, body: "We're live now. Tap to join." };
      if (v.step === "soon") return { title, body: "We start in 15 minutes. Tap to join." };
      return { title, body: `Live call today at ${v.time ?? "the usual time"}. Bring one question.` };
    case "bot_call":
      return { title, body: v.day ? `A call was booked for ${v.day}${v.time ? ` at ${v.time}` : ""}.` : "A call was booked with one of your contacts." };
    case "rank_up":
      return { title, body: `You've risen to ${v.rank ?? "a new rank"}. Come see your seat.` };
    case "coach_answer":
      return { title, body: `${v.coach ?? "Your coach"} covered your Office Hours question.` };
    case "intentions":
      return { title, body: "Set this week's intentions. Two minutes." };
    case "colosseum":
      return { title, body: "You finished in the top 3 last week." };
    case "webinar":
      return { title, body: "Your webinar starts in 15 minutes." };
  }
}

/** Where a tap on each push opens in the app. */
export const PUSH_PATH: Record<PushType, string> = {
  call: "/calls",
  morning: "/today#checkin",
  evening: "/today#close",
  streak: "/today",
  bot_call: "/conversations",
  rank_up: "/rewards",
  coach_answer: "/office-hours",
  intentions: "/intentions",
  colosseum: "/colosseum",
  webinar: "/webinars",
};

/**
 * A coach's test series (H-1967, Approve H-1968): one push of each type to their own phones, TEST_GAP_MINUTES apart, with
 * the real words and the real page a tap opens. Titled "Test: HelixOS"; outside the cap and quiet hours, and never counted.
 */
export const TEST_GAP_MINUTES = 3;
export const TEST_KEY_PREFIX = "test:";

/** The series in order, with when each is due after the start and its words (sample details where a real one has them). */
export function testSeries(start: Date): { type: PushType; dueAt: Date; title: string; body: string; path: string }[] {
  const sample = { streak: 12, step: "soon" as const, day: "Tuesday", time: "2:00 PM", rank: "Sentinel", coach: "Your coach" };
  return PUSH_TYPES.map((t, i) => ({
    type: t.type,
    dueAt: new Date(start.getTime() + i * TEST_GAP_MINUTES * 60000),
    title: "Test: HelixOS",
    body: pushCopy(t.type, sample).body,
    path: PUSH_PATH[t.type],
  }));
}

/** What the cron knows about one member right now, in their own time zone. */
export type DailyState = {
  hour: number;
  today: string;
  morningHour: number;
  eveningHour: number;
  lockedIn: boolean;
  closed: boolean;
  /** Anything counted for today already (a task, a post, a lock-in): the streak isn't waiting then. */
  activeToday: boolean;
  streak: number;
};

/** The streak push goes at 6 PM, for a streak of 7 days or more, unless the evening close is due within 3 hours (H-767). */
export const STREAK_HOUR = 18;
export const STREAK_MIN_DAYS = 7;
/** A daily push can still go in the hour after its own, so one missed cron run doesn't lose the day's reminder. */
const CATCH_UP_HOURS = 2;

const inWindow = (hour: number, at: number) => hour >= at && hour < at + CATCH_UP_HOURS;

/**
 * The daily pushes due for one member now, before prefs, caps and quiet hours (send decides those). The key makes each one
 * once a day: the unique (member, type, key) row in push_sends.
 */
export function dueDaily(s: DailyState): { type: PushType; key: string; streak?: number }[] {
  const out: { type: PushType; key: string; streak?: number }[] = [];
  if (inWindow(s.hour, s.morningHour) && !s.lockedIn) out.push({ type: "morning", key: s.today });
  const eveningNow = inWindow(s.hour, s.eveningHour) && !s.closed;
  if (eveningNow) out.push({ type: "evening", key: s.today });
  // The evening push already says it: no streak push when the close is due now or within 3 hours.
  const eveningSoon = s.eveningHour >= STREAK_HOUR && s.eveningHour - STREAK_HOUR <= 3;
  if (inWindow(s.hour, STREAK_HOUR) && s.streak >= STREAK_MIN_DAYS && !s.activeToday && !s.closed && !eveningSoon && !eveningNow) {
    out.push({ type: "streak", key: s.today, streak: s.streak });
  }
  return out;
}

/** The three live call reminders (H-771): the morning of the call, 15 minutes before, and the moment it goes live. */
export type CallStep = "morning" | "soon" | "live";
/** The morning reminder goes from 8 AM in the member's own zone, and only for a call more than an hour away. */
export const CALL_MORNING_HOUR = 8;
/** "We start in 15 minutes" goes in the cron run that lands 15 to 5 minutes before; "We're live" in the first 10 minutes. */
export const CALL_SOON_MINUTES = 15;
const CALL_SOON_LATEST = 5;
const CALL_LIVE_MINUTES = 10;

/**
 * Which call reminder is due now for one call, if any. `memberToday` and `memberHour` are the member's own date and hour;
 * `callDate` is the call's date in the member's zone. The three windows never overlap, and each send is recorded once per
 * (member, call start, step), so a cron run every 5 minutes sends each step at most once.
 */
export function dueCallStep(startIso: string, now: Date, member: { today: string; hour: number; callDate: string }): CallStep | null {
  const min = (Date.parse(startIso) - now.getTime()) / 60_000;
  if (min <= 0 && min > -CALL_LIVE_MINUTES) return "live";
  if (min <= CALL_SOON_MINUTES && min > CALL_SOON_LATEST) return "soon";
  if (min > 60 && member.callDate === member.today && inWindow(member.hour, CALL_MORNING_HOUR)) return "morning";
  return null;
}

/** A call's start as the member reads it: "10 AM" on the hour, "10:30 AM" otherwise, in their own zone. */
export function callTimeLabel(startIso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(startIso));
  return parts.replace(":00 ", " ");
}

/** Weekly intentions (H-767): Monday from 9 AM in the member's zone, only while this week's intentions aren't set. */
export const INTENTIONS_HOUR = 9;
export function dueIntentions(s: { weekday: number; hour: number; weekDue: boolean }): boolean {
  return s.weekday === 1 && s.weekDue && inWindow(s.hour, INTENTIONS_HOUR);
}

/** "Your webinar starts in 15 minutes": the member's own scheduled webinar, in the run that lands 15 to 5 minutes before. */
export function dueWebinar(scheduledIso: string, now: Date): boolean {
  const min = (Date.parse(scheduledIso) - now.getTime()) / 60_000;
  return min <= CALL_SOON_MINUTES && min > CALL_SOON_LATEST;
}

/**
 * Colosseum top 3 (H-767, H-1151): Monday from 9 AM, for last week's final standings (Monday to Sunday), among the members
 * the arena shows. Ties share a place; a week with no points puts no one on the podium. Returns the member's place, or null.
 */
export function lastWeekPlace(weekPoints: { userId: string; points: number }[], userId: string): number | null {
  const mine = weekPoints.find((r) => r.userId === userId)?.points ?? 0;
  if (mine <= 0) return null;
  const place = 1 + weekPoints.filter((r) => r.points > mine).length;
  return place <= 3 ? place : null;
}

/**
 * Whether a push may go now, given what was already sent to this member today (types, call pushes excluded from the count).
 * The evening close is the one exception to quiet hours, and only at the member's own chosen time.
 */
export function mayPush(type: PushType, hour: number, prefs: Prefs, sentToday: PushType[]): { ok: true } | { ok: false; why: string } {
  if (!wants(prefs, type)) return { ok: false, why: "switched off" };
  if (type !== "call") {
    if (sentToday.includes(type)) return { ok: false, why: "one of each a day" };
    if (sentToday.filter((t) => t !== "call").length >= DAILY_CAP) return { ok: false, why: "daily cap" };
  }
  const quietExempt = type === "evening";
  if (!quietExempt && isQuiet(hour, prefs)) return { ok: false, why: "quiet hours" };
  return { ok: true };
}

/** Whether to show the HelixOS permission card (H-767): after the first close in the app, once more after the 7th. */
export function shouldAsk(p: { closes: number; askedCount: number; answer: "yes" | "not_now" | null }): boolean {
  if (p.answer === "yes") return false;
  if (p.askedCount === 0) return p.closes >= 1;
  if (p.askedCount === 1 && p.answer === "not_now") return p.closes >= ASK_AGAIN_AFTER_CLOSES;
  return false;
}
