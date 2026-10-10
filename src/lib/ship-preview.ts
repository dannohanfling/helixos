/**
 * The preview token (Voice to Ship, rev 638): ladder_ship_preview hands one back and ladder_ship needs it. Signed with the same
 * key as the seals, so no table holds it. It names the member, the ladder, the channels and the ladder's fingerprint, and lasts
 * fifteen minutes: a Ship after an edit, on other channels, for another ladder or member, or too late, is refused.
 */
import { signValue, verifyValue } from "@/lib/crypto";
import { channelSet, type ShipTarget } from "@/lib/engine/voice-ship";

export const PREVIEW_TTL_MS = 15 * 60 * 1000;
type Claims = { u: string; l: string; c: ShipTarget[]; f: string; exp: number };

export function issuePreviewToken(c: { userId: string; ladderId: string; channels: readonly string[]; fingerprint: string }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: c.userId, l: c.ladderId, c: channelSet(c.channels), f: c.fingerprint, exp: now + PREVIEW_TTL_MS } satisfies Claims)).toString("base64url");
  return `${body}.${signValue(`ship-preview:${body}`)}`;
}

export type TokenCheck = { ok: true } | { ok: false; why: string };
/** Whether this token was given for exactly this Ship, still in time. The reason is said to the member in plain words. */
export function checkPreviewToken(token: string, want: { userId: string; ladderId: string; channels: readonly string[]; fingerprint: string }, now = Date.now()): TokenCheck {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig || !verifyValue(`ship-preview:${body}`, sig)) return { ok: false, why: "That preview isn't one HelixOS gave. Preview the ship again, read it back, then ship." };
  let c: Claims;
  try {
    c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
  } catch {
    return { ok: false, why: "That preview can't be read. Preview the ship again." };
  }
  if (c.u !== want.userId || c.l !== want.ladderId) return { ok: false, why: "That preview was for another ladder. Preview this one, read it back, then ship." };
  if (c.exp < now) return { ok: false, why: "That preview is more than 15 minutes old. Preview again so the member hears what will post now." };
  if (c.c.join(",") !== channelSet(want.channels).join(",")) return { ok: false, why: "That preview was for other channels. Preview again with these channels." };
  if (c.f !== want.fingerprint) return { ok: false, why: "The ladder changed after the preview. Preview again and read back what will post now." };
  return { ok: true };
}
