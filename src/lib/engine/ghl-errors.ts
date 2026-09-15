/**
 * What GoHighLevel's reply means to a client, by the call that was made. Pure: no fetch, no database, so it is unit-tested
 * against the shapes GoHighLevel actually sends. The vendor's words never reach the sentence; they are in the server log.
 *
 * The one rule that was wrong before: a 422 is GoHighLevel refusing the REQUEST BODY (its validation error), never the
 * location. On a post it means a field in the post (the user id, the account, the time), and the sentence names that field.
 * "The location doesn't match" is only ever true of the accounts call, where a 404 is exactly that.
 */
export type GhlCall = "accounts" | "post" | "contact";
export type GhlFailure = { error: string; status?: number; detail?: string };

import { REQUIRED_SCOPES, scopeNamedIn } from "./ghl-scopes";
export { REQUIRED_SCOPES };

const LOCATION = "GoHighLevel says that location ID doesn't match this token (it belongs to a different sub-account, or has a typo). Copy the Location ID from Settings → Business Profile in the same sub-account where you created the token.";

/** Which field of a post GoHighLevel named in its validation reply, from the words it uses; null when none is recognisable. */
export function refusedField(detail: string): "userId" | "accountIds" | "scheduleDate" | "content" | null {
  const d = detail.toLowerCase();
  if (/\buserid\b|\bcreatedby\b/.test(d)) return "userId";
  if (/\baccountids?\b|\baccount\b/.test(d)) return "accountIds";
  if (/\bscheduledate\b|\bschedule\b|\bdate\b/.test(d)) return "scheduleDate";
  if (/\bsummary\b|\bmedia\b|\bcontent\b|\btype\b/.test(d)) return "content";
  return null;
}

export function explainGhl(r: GhlFailure, call: GhlCall): string {
  const lower = (r.detail ?? "").toLowerCase();
  if (r.status === 401) return "GoHighLevel rejected the token (401). It was pasted incompletely, or it was deleted in GoHighLevel. Create a new Private Integration and paste the new token.";
  if (r.status === 403 || lower.includes("scope")) {
    // GoHighLevel names the scope it refused; the client fixes that one alone. Without a name, the whole list.
    const named = scopeNamedIn(r.detail ?? "");
    if (named) return `The token is valid but ${named} was not granted (403). Edit the Private Integration in GoHighLevel, tick it, and paste the new token.`;
    return `The token is valid but is missing Social Planner permissions (403). Edit the Private Integration in GoHighLevel and tick every scope on the list: ${REQUIRED_SCOPES.join(", ")}.`;
  }
  if (r.status === 429) return "GoHighLevel is rate-limiting requests (429). Wait a minute and try again.";
  if (lower.includes("abort") || lower.includes("fetch failed") || lower.includes("econn")) return "Couldn't reach GoHighLevel. Check the API base URL on Integrations, or try again in a minute.";
  if (call === "accounts") {
    if (r.status === 404 || r.status === 422 || lower.includes("location")) return LOCATION;
  }
  if (call === "post") {
    if (r.status === 422) {
      switch (refusedField(r.detail ?? "")) {
        case "userId":
          return "GoHighLevel refused the post (422): it doesn't accept the GHL user ID on Settings → Publishing. Use the ID of the user who owns the connected accounts (Settings → My Staff in GoHighLevel).";
        case "accountIds":
          return "GoHighLevel refused the post (422): the account chosen for this channel isn't one the Social Planner will post to. On Settings → Publishing, press \"Check again\" and re-pick the channel.";
        case "scheduleDate":
          return "GoHighLevel refused the post (422): it didn't accept the schedule time. Pick a time in the future and schedule again.";
        case "content":
          return "GoHighLevel refused the post (422): the text or media didn't pass its checks for this channel. Shorten the text or change the media and try again.";
        default:
          return "GoHighLevel refused the post's details (422). Ask your coach; the reason is in the log.";
      }
    }
    if (r.status === 404) return "GoHighLevel couldn't find what this post refers to (404): the post was deleted in the Social Planner, or the account chosen for this channel is gone. Press \"Check again\" on Settings → Publishing.";
  }
  if (call === "contact" && (r.status === 404 || r.status === 422)) return `GoHighLevel didn't accept the contact (${r.status}). Check the location ID on Settings → Publishing.`;
  // The fallthrough keeps the case and drops the vendor's words: they are in the log under [ghl].
  return `GoHighLevel didn't accept the request${r.status ? ` (${r.status})` : ""}. Try again in a minute.`;
}

/**
 * What the Social Planner's readback said went wrong at the platform, as a client sentence. The vendor's text is classified
 * by pattern and never repeated: an expired page token, a revoked permission, a media rule, a time already passed. Anything
 * else is the honest fallback. `platform` is the outside service the client has their own relationship with.
 */
export function explainPlatformError(raw: string | null | undefined, platform: string): string | null {
  const r = (raw ?? "").trim();
  if (!r) return null;
  const d = r.toLowerCase();
  if (/token|expired|reconnect|permission|revoked|unauthori|re-authenticate|reauth|session/.test(d)) return `${platform} needs reconnecting in GoHighLevel.`;
  if (/scope/.test(d)) return "This needs a permission your GoHighLevel connection doesn't have yet. Check the list on Settings → Publishing.";
  if (/media|image|video|photo|aspect|resolution|file/.test(d)) return `${platform} needs a photo or video on every post, in a size it accepts.`;
  if (/past|already passed|in the past|elapsed/.test(d)) return "That time had already passed when we sent it.";
  if (/character|too long|length|limit|exceed/.test(d)) return `${platform} wouldn't accept this post: it is longer than ${platform} allows.`;
  if (/duplicate|same content|identical/.test(d)) return `${platform} wouldn't accept this post: it is the same as one already posted.`;
  if (/rate|throttl|429|try again later|temporar|timeout|timed out|5\d\d/.test(d)) return "GoHighLevel didn't answer. Nothing was posted — try again.";
  return "This didn't send. We've logged why and it isn't something you did.";
}
