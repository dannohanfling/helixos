/**
 * Handing a finished comment ladder to Community Loyalty's Rung Dripper (HelixOS_RUNG_DRIPPER.md, proven live 31 Aug and
 * 15 Sep 2026). HelixOS is a caller: it never touches the Graph API, never holds a page token, never runs the timer. Pure.
 *
 * The split that is live, with no change to the Community Loyalty flow: HelixOS publishes the Facebook page and Instagram
 * posts; Community Loyalty publishes Threads and drips the rungs onto the newest Facebook and Instagram posts. So
 * `first_comment` rides on the Threads post and `rungs` starts at rung 1 (both were sent on 15 Sep; rung 1 appeared once).
 * If Community Loyalty is ever the Facebook/Instagram publisher again, `first_comment` is rung 1 there too and `rungs`
 * starts at rung 2, or rung 1 lands twice. The choice is encoded, not hard-coded.
 */
import { LIVE_POSTING_HOUR } from "./ladder";
export type Publisher = "helixos" | "community_loyalty";
export type DripPayload = { user_ns: string; post: string; first_comment: string; schedule_at: string; rungs: string };

/** A line holding only --- separates rungs; the flow splits on /\r?\n\s*-{3,}\s*\r?\n/ and strips a leading "1\." or "2.". */
export const RUNG_SEPARATOR = "\n\n---\n\n";
export const joinRungs = (rungs: string[]): string => rungs.map((r) => r.trim()).filter(Boolean).join(RUNG_SEPARATOR);
/** The flow's own splitter, verbatim, so the join is tested against what will read it. */
export const splitRungs = (ladder: string): string[] =>
  ladder
    .split(/\r?\n\s*-{3,}\s*\r?\n/)
    .map((r) => r.replace(/^\s*\d+\s*\\?\.\s*/, "").trim())
    .filter(Boolean);

export function dripPayload(input: { userNs: string; post: string; rungs: string[]; fbIgPublisher: Publisher; scheduleAt?: string | null }): DripPayload {
  const rungs = input.rungs.map((r) => r.trim()).filter(Boolean);
  const first = rungs[0] ?? "";
  const dripped = input.fbIgPublisher === "helixos" ? rungs : rungs.slice(1);
  return { user_ns: input.userNs, post: input.post, first_comment: first, schedule_at: input.scheduleAt ?? "", rungs: joinRungs(dripped) };
}

/** GoHighLevel refuses a scheduled Threads post less than fifteen minutes out; the form says so before anything is sent. */
export const MIN_SCHEDULE_LEAD_MINUTES = 15;
export function scheduleAtProblem(iso: string | null | undefined, nowIso: string): string | null {
  const v = (iso ?? "").trim();
  if (!v) return null;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return "That time couldn't be read. Pick it again, or leave it blank to ask Community Loyalty for Threads now.";
  if (t - new Date(nowIso).getTime() < MIN_SCHEDULE_LEAD_MINUTES * 60_000) return `A Threads time has to be at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes from now, or leave it blank to ask Community Loyalty for it now.`;
  return null;
}

/** One drip per coach at a time: the state lives on one Community Loyalty contact and a second drip would clobber the queue. */
export function estimateDripEnd(handedAtIso: string, rungCount: number): string {
  return new Date(new Date(handedAtIso).getTime() + (5 + Math.max(rungCount, 1) * 12) * 60_000).toISOString();
}
export function dripLock(handoffs: { expiresAt: string }[], nowIso: string): { active: true; until: string } | { active: false } {
  const now = new Date(nowIso).getTime();
  const live = handoffs.filter((h) => new Date(h.expiresAt).getTime() > now).sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
  return live ? { active: true, until: live.expiresAt } : { active: false };
}

/** Channel ownership is exclusive: while the handoff is on, Threads is Community Loyalty's and the composer does not push it. */
export const THREADS_EXCLUSIVE = "Threads belongs to Community Loyalty while the comment ladder runs. Untick it here; Community Loyalty handles it.";
export function threadsRefusal(targets: { channel: string; groupId?: string | null }[], dripOn: boolean): string | null {
  if (!dripOn) return null;
  return targets.some((t) => t.channel === "threads" && !t.groupId) ? THREADS_EXCLUSIVE : null;
}

/** A ladder post's first comment is rung 1, and the drip supplies rung 1: a first comment typed here would land it twice. */
export const FIRST_COMMENT_LOCKED = "Comments on this post come from the ladder. Anything typed here would repeat rung 1.";
export function firstCommentRefusal(input: { ladderPost: boolean; dripOn: boolean; firstComment: string | null | undefined }): string | null {
  if (!input.ladderPost || !input.dripOn) return null;
  return (input.firstComment ?? "").trim() ? FIRST_COMMENT_LOCKED : null;
}

/** The two words the handoff row may use; neither means posted, because HelixOS has no confirmation that any rung landed. */
export const HANDOFF_WORDS = { handed: "Comments: handed to Community Loyalty", unhanded: "Comments: not handed off" } as const;
export const HANDED_NOTE = "Community Loyalty is set to add the rungs over the next hour or two. HelixOS isn't told whether each one landed.";
/** Said with a refusal once a post is public: the rungs are ready in the ladder page's card, where each is ticked by hand. */
export const HANDOFF_FALLBACK = `The rungs are ready to post by hand in ${LIVE_POSTING_HOUR}.`;
/** Words that would assert an outcome HelixOS cannot see; a test pins that no handoff word contains one. */
export const PUBLISH_WORDS = ["published", "posted", "live", "sent", "went out", "goes out", "go out", "posts on", "post on their own", "delivered", "commented"];

export type HandoffGate = { webhook: boolean; webhookHttps?: boolean; userNs: boolean; ladder: boolean; rungs: number; blockers: number; fbPublished: boolean; igPublished: boolean; lockedUntil: string | null; threadsWithPlanner?: boolean };
/** Why the ladder cannot be handed off right now, each a sentence shown where the button would be. Empty means it can. */
export function handoffReasons(g: HandoffGate): string[] {
  const out: string[] = [];
  if (!g.webhook || !g.userNs) out.push("Community Loyalty isn't connected for comment ladders yet. Evolve Omega sets that up.");
  else if (g.webhookHttps === false) out.push("The Community Loyalty webhook address has to start with https. Evolve Omega sets that up.");
  if (!g.ladder) out.push("This post didn't come from a comment ladder.");
  else if (g.rungs === 0) out.push("The ladder has no rungs.");
  if (g.blockers > 0) out.push(`The ladder's checklist has ${g.blockers} thing${g.blockers === 1 ? "" : "s"} to fix first.`);
  if (!g.fbPublished || !g.igPublished) out.push("Facebook page and Instagram have to be confirmed by GoHighLevel first: the rungs land on the newest one on each.");
  if (g.threadsWithPlanner) out.push("A Threads version of this is already with the Social Planner. Remove it there first; Community Loyalty handles Threads with the ladder.");
  if (g.lockedUntil) out.push(`A ladder is already dripping until about ${g.lockedUntil}. One at a time: two would tangle.`);
  return out;
}
