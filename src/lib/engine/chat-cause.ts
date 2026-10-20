/**
 * Who the chat was told (H-1199, plan H-1203), the pure parts the Ask page and its report route share. No imports, so the
 * client widget can use it without pulling in the server's crypto.
 */
/**
 * What the Ask page reports about telling the chat who the member is, once a page: told on the SDK's ready event, told because
 * it had already loaded, never loaded within a minute, or the browser's CSP blocked one of its hosts. No id, name or email:
 * the cause alone, so the sync log shows which of these happens on production.
 */
export const CHAT_CAUSES = ["identified-ready", "identified-loaded", "sdk-never-loaded", "csp-blocked"] as const;
export type ChatCause = (typeof CHAT_CAUSES)[number];
export const isChatCause = (s: unknown): s is ChatCause => typeof s === "string" && (CHAT_CAUSES as readonly string[]).includes(s);

/** A blocked host as the report may carry it: an https origin's host name, letters, digits, dots and dashes, or nothing. */
export function cleanHost(s: unknown): string | null {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return /^[a-z0-9.-]{1,100}$/.test(u.hostname) ? u.hostname : null;
  } catch {
    return null;
  }
}

/** How long after `setUser` the chat is opened, when the SDK gives nothing to wait on: its own request has time to land first. */
export const IDENTIFY_SETTLE_MS = 1500;
