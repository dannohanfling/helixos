"use server";

/**
 * The Setup card's writes (H-270 §1): a member's tick on a step (or the coach's for them), the Start Here video played to the
 * end, and the coach's edits to the step list and the video slot.
 */
import { requireCoach } from "@/lib/auth";
import { ctx, num, refresh, str } from "@/lib/action-helpers";
import { markStartHereWatched, saveSetupStep, setStartHereVideo, tickSetup } from "@/lib/setup-card";
import { SETUP_GROUPS, SETUP_SIGNALS } from "@/lib/engine/setup";

/** Tick a step, or clear the tick. While switched in, the coach ticks it for the client, marked as the coach's. */
export async function tickSetupAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await tickSetup({ workspaceId, userId }, str(formData, "key"), str(formData, "on") === "1", v.actor.id, Boolean(v.switchedInto) || v.role === "coach");
  refresh();
}

/** The Start Here video reached its end: the member's own stamp, never a coach's. */
export async function startHereWatchedAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto || v.team) return;
  await markStartHereWatched(v.membership.id);
  refresh();
}

export type SetupFormState = { error?: string; ok?: true } | null;
/** The coach edits one step: label, group, order, link, what it reads, what it needs first (keys, comma separated), minutes. */
export async function saveSetupStepAction(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  await requireCoach();
  const key = str(formData, "key");
  const label = str(formData, "label");
  const group = str(formData, "group");
  const signal = str(formData, "signal");
  if (!key) return { error: "Which step?" };
  if (!label) return { error: "Give the step a name." };
  if (!SETUP_GROUPS.some((g) => g.key === group)) return { error: "Pick a group." };
  if (!SETUP_SIGNALS.some((s) => s.key === signal)) return { error: "Pick what it reads." };
  const href = str(formData, "href") || "/today";
  if (!href.startsWith("/")) return { error: "The link is a page in HelixOS, starting with /." };
  const needs = str(formData, "needs").split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  try {
    await saveSetupStep({ key, group, order: Math.max(1, Math.round(num(formData, "order") || 1)), label: label.slice(0, 120), href, signal, needs, minutes: Math.max(0, Math.min(600, Math.round(num(formData, "minutes") || 0))) });
  } catch (e) {
    return { error: (e as Error).message };
  }
  refresh();
  return { ok: true };
}

export type VideoFormState = { error?: string; ok?: true } | null;
/** The Start Here video slot: a link HelixOS can play (mp4, webm) or open (a Recordings share link), or cleared. */
export async function setStartHereVideoAction(_prev: VideoFormState, formData: FormData): Promise<VideoFormState> {
  const coach = await requireCoach();
  const url = str(formData, "url");
  if (url && !/^https?:\/\/\S+$/i.test(url) && !url.startsWith("/")) return { error: "Paste a link that starts with https://." };
  await setStartHereVideo(coach.workspace.id, url ? url.slice(0, 600) : null);
  refresh();
  return { ok: true };
}
