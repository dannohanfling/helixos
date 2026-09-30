/**
 * Community Loyalty web chat and SSO (revs 241, 243, 247), the pure parts: the identifier hash the widget needs to trust a
 * signed-in member, the widget's script address, and the state of a "Tap to confirm it's you" link. No database, no secrets
 * held: the secret comes in as an argument and leaves nothing behind.
 */
import { createHmac } from "node:crypto";
import { CHAT_CHANNELS } from "@/db/schema";

export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** A link is good for ten minutes, once. */
export const LINK_TTL_MS = 10 * 60 * 1000;

export const CHANNEL_LABELS: Record<ChatChannel, string> = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp", telegram: "Telegram", webchat: "Web chat" };

export const isChatChannel = (s: string): s is ChatChannel => (CHAT_CHANNELS as readonly string[]).includes(s);

/**
 * What the widget's `setUser` takes as `identifier_hash`: HMAC-SHA256 of the member's user id under the workspace's web chat
 * secret, hex. It proves the id came from HelixOS; it reveals nothing about the secret.
 */
export function identifierHash(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId, "utf8").digest("hex");
}

/** A widget id is a short lowercase token; anything else is refused before it can reach a script tag. */
export const isWidgetId = (id: string): boolean => /^[a-z0-9]{6,40}$/.test(id);

export const CHAT_HOST = "https://communityloyalty.io";
export const widgetSrc = (widgetId: string): string => `${CHAT_HOST}/js/widget/${widgetId}/float.js`;

/** A sub flow id as Community Loyalty shows it (f<bot>s<flow>), letters and digits only. */
export const isFlowNs = (ns: string): boolean => /^[a-z0-9]{4,40}$/.test(ns);

export type LinkState = "ok" | "expired" | "used" | "wrong_workspace";

/** Whether a link may still be confirmed by this member, and if not, why, in the order the member would want to hear it. */
export function linkState(row: { workspaceId: string; usedAt: string | null; expiresAt: string }, viewerWorkspaceId: string, nowMs: number): LinkState {
  if (row.workspaceId !== viewerWorkspaceId) return "wrong_workspace";
  if (row.usedAt) return "used";
  if (Date.parse(row.expiresAt) <= nowMs) return "expired";
  return "ok";
}

export const LINK_MESSAGES: Record<Exclude<LinkState, "ok">, string> = {
  expired: "This link has expired. Ask the assistant for a new one in the chat.",
  used: "This link was already used. If that wasn't you, ask the assistant for a new one.",
  wrong_workspace: "This link is for a different HelixOS. Sign in to the account the chat belongs to.",
};

/** The event names HelixOS posts to the coach's bot. */
export type ChatEvent = "link" | "unlink" | "progress";

/* ───────── Progress pushes (rev 241, addition 2 of rev 247) ───────── */

/** Community Loyalty's inbound webhook limit, per workspace per day, and where the Integrations card starts to warn. */
export const DAILY_CAP = 500;
export const WARN_AT = 400;
/** One push per member per hour; a change inside the hour waits for the next one. */
export const PUSH_GAP_MS = 60 * 60 * 1000;

export type ProgressReason = "intention_set" | "pathway_verified" | "goal_changed" | "offer_changed" | "first_sign_in";

/** The exact keys of a `progress` post, and nothing else: the bot's five helixos_* fields read these (rev 247). */
export const PROGRESS_KEYS = ["event", "email", "name", "pathway_stage", "goal", "week_313", "main_offer", "reason", "at"] as const;

export type ProgressInput = { email: string; name: string; pathwayStage: string | null; goal: string | null; week313: string | null; mainOffer: string | null; reason: ProgressReason; at: string };

/** Builds the post from named fields only, so nothing a caller has in hand (Body, keys, notes) can ride along. */
export function progressPayload(p: ProgressInput): { event: "progress" } & Record<Exclude<(typeof PROGRESS_KEYS)[number], "event">, string> {
  return { event: "progress", email: p.email.toLowerCase(), name: p.name, pathway_stage: p.pathwayStage ?? "", goal: p.goal ?? "", week_313: p.week313 ?? "", main_offer: p.mainOffer ?? "", reason: p.reason, at: p.at };
}

export const withinPushGap = (lastAt: string | null, nowMs: number): boolean => Boolean(lastAt) && nowMs - Date.parse(lastAt!) < PUSH_GAP_MS;

/** The member's main offer: the one on the bot (core, else entry), else the newest live one. The bot's short name when set. */
export function mainOfferName(offers: { name: string; botName: string | null; botRole: string; status: string; createdAt: string }[]): string | null {
  const pick = offers.find((o) => o.botRole === "core") ?? offers.find((o) => o.botRole === "entry") ?? [...offers].filter((o) => o.status === "live").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  return pick ? pick.botName?.trim() || pick.name : null;
}

export const goalLine = (g: { title: string; target: number; unit: string; period: string } | null): string | null => (g ? `${g.title}: ${g.unit === "$" ? `$${g.target.toLocaleString("en-US")}` : `${g.target.toLocaleString("en-US")} ${g.unit}`}, ${g.period.toLowerCase()}` : null);

/** This week's 3-1-3 in one line, capped so a long one never overruns a bot field. */
export function week313Line(w: { word: string; keyResults: { text: string }[]; initiative: string; tasks: { title: string }[] } | null): string | null {
  if (!w) return null;
  const line = [w.word ? `Word: ${w.word}.` : "", w.keyResults.length ? `Key results: ${w.keyResults.map((k) => k.text).join("; ")}.` : "", w.initiative ? `Initiative: ${w.initiative}.` : "", w.tasks.length ? `Tasks: ${w.tasks.map((t) => t.title).join("; ")}.` : ""].filter(Boolean).join(" ");
  return line.length > 600 ? `${line.slice(0, 597)}...` : line;
}
