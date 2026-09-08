/**
 * Planner audit, pure. Finds posts in a client's GoHighLevel Social Planner that HelixOS created but no longer tracks
 * (the old re-schedule path left a second copy behind each time) and says how sure it is about each one.
 * Nothing here changes anything: it only names what is there. Deleting is a person's decision, in GoHighLevel.
 */

export type PlannerPostLike = { id: string; status: string | null; summary: string | null; scheduleDate: string | null; accountIds: string[] };
export type TrackedLike = { variantId: string; externalId: string; channel: string; body: string; itemTitle: string; postAt: string | null };
export type LoggedLike = { ghlPostId: string; channel: string | null; accountId: string | null; loggedAt: string };
export type Candidate = { ghlPostId: string; seenIn: ("log" | "planner")[]; channel: string | null; accountId: string | null; loggedAt: string | null };
export type Verdict = "duplicate" | "orphan" | "published" | "gone" | "unknown";
export type Twin = { variantId: string; itemTitle: string; externalId: string; channel: string; sameText: boolean; sameTime: boolean };
export type AuditRow = Candidate & { live: PlannerPostLike | null; liveError: string | null; twin: Twin | null; verdict: Verdict; why: string };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const minute = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

/** Every planner post id HelixOS knows of (from its sync log, or from the planner's own scheduled list) that no variant tracks. */
export function candidates(tracked: TrackedLike[], logged: LoggedLike[], planner: PlannerPostLike[] | null): Candidate[] {
  const trackedIds = new Set(tracked.map((t) => t.externalId));
  const out = new Map<string, Candidate>();
  for (const l of logged) {
    if (trackedIds.has(l.ghlPostId)) continue;
    const cur = out.get(l.ghlPostId);
    if (cur) {
      if (!cur.seenIn.includes("log")) cur.seenIn.push("log");
      if (!cur.loggedAt || l.loggedAt < cur.loggedAt) cur.loggedAt = l.loggedAt;
      cur.channel ??= l.channel;
      cur.accountId ??= l.accountId;
      continue;
    }
    out.set(l.ghlPostId, { ghlPostId: l.ghlPostId, seenIn: ["log"], channel: l.channel, accountId: l.accountId, loggedAt: l.loggedAt });
  }
  for (const p of planner ?? []) {
    if (trackedIds.has(p.id)) continue;
    const cur = out.get(p.id);
    if (cur) {
      if (!cur.seenIn.includes("planner")) cur.seenIn.push("planner");
      cur.accountId ??= p.accountIds[0] ?? null;
      continue;
    }
    out.set(p.id, { ghlPostId: p.id, seenIn: ["planner"], channel: null, accountId: p.accountIds[0] ?? null, loggedAt: null });
  }
  return [...out.values()].sort((a, b) => (a.loggedAt ?? "9").localeCompare(b.loggedAt ?? "9"));
}

/**
 * The verdict for one untracked post. "duplicate" is the only certain case: still scheduled, and a tracked post for the
 * same account carries the same text. Anything less certain is named as such and left to a person.
 */
export function classify(c: Candidate, live: PlannerPostLike | null, liveError: string | null, tracked: TrackedLike[], mapping: Record<string, string>, plannerById: Map<string, PlannerPostLike>): AuditRow {
  const base = { ...c, live, liveError, twin: null as Twin | null };
  if (liveError) return { ...base, verdict: "unknown", why: `GoHighLevel did not answer for this post: ${liveError}` };
  if (!live) return { ...base, verdict: "gone", why: "Not in the planner any more. Nothing left to remove." };
  const status = (live.status ?? "").toLowerCase();
  if (status === "published") return { ...base, verdict: "published", why: "Already went out. It cannot be unscheduled; if it doubled a post, that happened in the past." };
  // The tracked post for the same account: text compared against the planner's own copy when it is listed, else against what HelixOS sent.
  const account = c.accountId ?? live.accountIds[0] ?? null;
  const sameAccount = tracked.filter((t) => {
    const mapped = mapping[t.channel];
    const trackedPost = plannerById.get(t.externalId);
    return (mapped && (mapped === account || live.accountIds.includes(mapped))) || (trackedPost && account && trackedPost.accountIds.includes(account));
  });
  const twins: Twin[] = sameAccount.map((t) => {
    const trackedPost = plannerById.get(t.externalId);
    const trackedText = trackedPost?.summary ?? t.body;
    const trackedTime = trackedPost?.scheduleDate ?? t.postAt;
    return { variantId: t.variantId, itemTitle: t.itemTitle, externalId: t.externalId, channel: t.channel, sameText: norm(trackedText) === norm(live.summary) && norm(live.summary) !== "", sameTime: Boolean(trackedTime && live.scheduleDate) && minute(trackedTime) === minute(live.scheduleDate) };
  });
  const twin = twins.find((t) => t.sameText && t.sameTime) ?? twins.find((t) => t.sameText) ?? twins[0] ?? null;
  if (status !== "scheduled" && status !== "") return { ...base, twin, verdict: "unknown", why: `The planner reports it as "${live.status}". Look at it there.` };
  if (twin?.sameText) return { ...base, twin, verdict: "duplicate", why: `Still scheduled, same account and the same text as the post HelixOS tracks for "${twin.itemTitle}"${twin.sameTime ? ", at the same time" : ""}. A second copy from the old re-schedule path.` };
  return { ...base, twin, verdict: "orphan", why: twin ? `Still scheduled for the same account, but its text differs from the tracked post for "${twin.itemTitle}". It may be an older version or a different post; read it there before deciding.` : "Still scheduled, but no tracked HelixOS post matches its account. Read it in the planner before deciding." };
}

export const VERDICT_LABEL: Record<Verdict, string> = { duplicate: "duplicate", orphan: "untracked, different", published: "already published", gone: "gone from the planner", unknown: "could not tell" };
