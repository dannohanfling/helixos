/**
 * Ship a ladder (rev 583 #1, commit 3): one press publishes the ladder's post to the Facebook Page and Instagram through the
 * member's GoHighLevel with the graphic attached, hands the rungs to Community Loyalty's drip with the two posts named, and
 * writes the keyword to the bot. Pure: what the press can do, what is done, what is held and why, so the card and the
 * action agree. Never the personal profile, never a group.
 */
export type ShipStepKey = "graphic" | "page" | "instagram" | "drip" | "keywords";
export type ShipState = "done" | "ready" | "held";
export type ShipStep = { key: ShipStepKey; label: string; state: ShipState; why: string | null };
export const SHIP_CHANNELS = ["fb_page", "instagram"] as const;

export type ShipFacts = {
  /** The checklist's failing checks. */
  blockers: number;
  hasGraphic: boolean;
  /** The public address exists (minted at Ship). */
  publicLink: boolean;
  /** GoHighLevel: connected with a user id, and the two channels mapped. */
  ghl: { connected: boolean; userId: boolean; page: boolean; instagram: boolean };
  /** The two posts as the Planner has them: nothing, sent (scheduled, in progress, accepted), published, or failed with its reason. */
  posts: { page: PostFact; instagram: PostFact };
  drip: { setUp: boolean; handed: boolean; locked: string | null };
  keyword: { set: boolean; token: boolean; pushed: boolean; blocked: string | null };
};
export type PostFact = { state: "none" | "sent" | "published" | "failed"; reason: string | null };

const GHL_FIX = "Connect your GoHighLevel sub-account on Settings → Publishing";

/** The steps in order, each done, ready to run, or held with the reason in plain words. */
export function shipSteps(f: ShipFacts): ShipStep[] {
  const steps: ShipStep[] = [];
  if (f.blockers > 0) {
    const why = `The checklist has ${f.blockers} thing${f.blockers === 1 ? "" : "s"} to fix first.`;
    return (["graphic", "page", "instagram", "drip", "keywords"] as ShipStepKey[]).map((key) => ({ key, label: LABEL[key], state: "held", why }));
  }
  steps.push(f.hasGraphic ? { key: "graphic", label: LABEL.graphic, state: "done", why: null } : { key: "graphic", label: LABEL.graphic, state: "held", why: "Make the graphic first: Instagram takes no post without a picture." });
  for (const key of ["page", "instagram"] as const) {
    const post = f.posts[key];
    if (post.state === "published") { steps.push({ key, label: LABEL[key], state: "done", why: null }); continue; }
    if (post.state === "sent") { steps.push({ key, label: LABEL[key], state: "done", why: "Sent to the Social Planner; Check status reads it back." }); continue; }
    if (!f.hasGraphic) { steps.push({ key, label: LABEL[key], state: "held", why: "Needs the graphic." }); continue; }
    if (!f.ghl.connected) { steps.push({ key, label: LABEL[key], state: "held", why: `${GHL_FIX}.` }); continue; }
    if (!f.ghl.userId) { steps.push({ key, label: LABEL[key], state: "held", why: "Add your GHL user ID on Settings → Publishing; the Social Planner won't take a post without it." }); continue; }
    if (!f.ghl[key]) { steps.push({ key, label: LABEL[key], state: "held", why: `No ${key === "page" ? "Facebook business page" : "Instagram account"} chosen for this channel on Settings → Publishing.` }); continue; }
    steps.push({ key, label: LABEL[key], state: "ready", why: post.state === "failed" ? post.reason : null });
  }
  if (f.drip.handed) steps.push({ key: "drip", label: LABEL.drip, state: "done", why: null });
  else if (!f.drip.setUp) steps.push({ key: "drip", label: LABEL.drip, state: "held", why: "Community Loyalty isn't connected for comment ladders yet. Evolve Omega sets that up." });
  else if (f.drip.locked) steps.push({ key: "drip", label: LABEL.drip, state: "held", why: `A ladder is already dripping until about ${f.drip.locked}. One at a time.` });
  else if (f.posts.page.state !== "published" || f.posts.instagram.state !== "published") steps.push({ key: "drip", label: LABEL.drip, state: "held", why: "Facebook page and Instagram have to be confirmed by GoHighLevel first: the rungs land on the newest one on each." });
  else steps.push({ key: "drip", label: LABEL.drip, state: "ready", why: null });
  if (!f.keyword.set) steps.push({ key: "keywords", label: LABEL.keywords, state: "held", why: "This ladder has no keyword (NONE): nothing to write to the bot." });
  else if (f.keyword.pushed) steps.push({ key: "keywords", label: LABEL.keywords, state: "done", why: null });
  else if (!f.keyword.token) steps.push({ key: "keywords", label: LABEL.keywords, state: "held", why: "No Community Loyalty API token on your membership yet: your coach adds it on the Coach page." });
  else if (f.keyword.blocked) steps.push({ key: "keywords", label: LABEL.keywords, state: "held", why: f.keyword.blocked });
  else steps.push({ key: "keywords", label: LABEL.keywords, state: "ready", why: null });
  return steps;
}
export const LABEL: Record<ShipStepKey, string> = { graphic: "The graphic", page: "Facebook Page post", instagram: "Instagram post", drip: "Rungs to Community Loyalty", keywords: "Keyword on your bot" };

/** What the Ship button does now: the ready steps, in order; nothing when none is ready. */
export const shipRuns = (steps: readonly ShipStep[]): ShipStepKey[] => steps.filter((s) => s.state === "ready").map((s) => s.key);
/** One line for the card: all done, what Ship will run, or why it is held. */
export function shipLine(steps: readonly ShipStep[]): string {
  const ready = shipRuns(steps);
  if (steps.every((s) => s.state === "done")) return "Shipped: every step is done.";
  if (ready.length) return `Ship runs: ${ready.map((k) => LABEL[k].toLowerCase()).join(", ")}.`;
  const held = steps.find((s) => s.state === "held");
  return held ? `Held: ${held.why}` : "Nothing to run.";
}
/** The public address of a shipped graphic, from its token: no workspace, member or record id in it. */
export const graphicPublicPath = (token: string): string => `/api/graphics/${token}.png`;
/** A token is 32 hex characters, as randomSecret makes them after its prefix is dropped. */
export const isGraphicToken = (t: string): boolean => /^[0-9a-f]{32}$/.test(t);
