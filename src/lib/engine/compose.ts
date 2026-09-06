/** Composer helpers shared by the client editor and the server actions. Pure. */
import type { Channel } from "./repurpose";
import { CHANNEL_SPECS, repurpose, type SourceContent } from "./repurpose";
import { alignPost, type GroupProfile } from "./groups";

export type TargetKey = `ch:${Channel}` | `grp:${string}`;

export type GroupTarget = GroupProfile & { id: string; rank: number };

export type Target = {
  key: TargetKey;
  channel: Channel;
  groupId: string;
  label: string;
  icon: string;
  maxChars: number;
  group?: GroupTarget;
};

export type Draft = { body: string; subject?: string; checks?: { key: string; label: string; ok: boolean; note: string }[] };

export function channelTargets(): Target[] {
  return CHANNEL_SPECS.filter((c) => c.key !== "other_groups").map((c) => ({ key: `ch:${c.key}` as TargetKey, channel: c.key, groupId: "", label: c.label, icon: c.icon, maxChars: c.maxChars }));
}

export function groupTargets(groups: GroupTarget[]): Target[] {
  return groups.map((g) => ({ key: `grp:${g.id}` as TargetKey, channel: g.kind === "own" ? "fb_group" : "other_groups", groupId: g.id, label: g.name, icon: g.kind === "own" ? "🏠" : g.kind === "prospect" && g.rank ? `🎯${g.rank}` : "👥", maxChars: 1800, group: g }));
}

/** The channel-native draft for one target. Groups get the mission/rules-aligned version. */
export function draftFor(src: SourceContent, t: Target): Draft {
  if (t.group) {
    const a = alignPost({ title: src.title, hook: src.hook, body: src.body, hasCta: src.hasCta, firstName: src.firstName }, t.group);
    return { body: a.body, checks: a.checks };
  }
  return repurpose(src, t.channel);
}

/** Posting order that favors conversation first, reach second, long-form last. */
const ORDER: string[] = ["grp:own", "ch:fb_personal", "ch:instagram", "ch:threads", "ch:stories", "ch:fb_page", "ch:linkedin", "ch:skool", "ch:email", "grp:prospect"];

function rank(t: Target): number {
  if (t.group) return ORDER.indexOf(t.group.kind === "own" ? "grp:own" : "grp:prospect") + (t.group.rank || 9) / 10;
  const i = ORDER.indexOf(t.key);
  return i === -1 ? ORDER.length : i;
}

/** Spreads posts across the day from a start time, 45 minutes apart, in the recommended order. */
export function staggerSchedule(targets: Target[], startIso: string, stepMinutes = 45): Map<TargetKey, string> {
  const sorted = targets.slice().sort((a, b) => rank(a) - rank(b));
  const start = new Date(startIso);
  const out = new Map<TargetKey, string>();
  sorted.forEach((t, i) => {
    const d = new Date(start.getTime() + i * stepMinutes * 60000);
    out.set(t.key, d.toISOString().slice(0, 16));
  });
  return out;
}

export function overLimit(body: string, max: number): boolean {
  return body.length > max;
}

/** Turns "2026-09-06T09:00" typed in the workspace timezone into a plain local ISO string the app stores. */
export function localIso(date: string, time: string): string {
  return `${date}T${time || "09:00"}:00`;
}
