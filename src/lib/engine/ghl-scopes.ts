/**
 * The one list of GoHighLevel scopes a client ticks when they create their Private Integration. Every screen, check and
 * document that names a scope reads it from here. Scopes are granted once: adding one later means every client creating a
 * new integration and pasting a new token, so the list is a superset of what the app calls now and what it will call within
 * the next two releases, and nothing is dropped from it without the same reckoning. Each entry says which endpoint needs it
 * (from GoHighLevel's own OpenAPI specs) and whether the app calls that endpoint today.
 */
export type ScopeUse = "now" | "next";
export type GhlScope = { scope: string; why: string; use: ScopeUse };

export const GHL_SCOPES: GhlScope[] = [
  { scope: "socialplanner/account.readonly", why: "GET /social-media-posting/{locationId}/accounts: the connected pages and profiles, the connection check itself", use: "now" },
  { scope: "socialplanner/account.write", why: "account changes on the Social Planner; kept so a future connect-from-HelixOS step never needs a new token", use: "next" },
  { scope: "socialplanner/oauth.readonly", why: "the OAuth start endpoints; not called today, kept because GoHighLevel does not document every endpoint's scope and a missing one costs every client a new token", use: "next" },
  { scope: "socialplanner/oauth.write", why: "same as oauth.readonly", use: "next" },
  { scope: "socialplanner/post.readonly", why: "GET /posts/{id} (Check status) and POST /posts/list (the coach's planner audit)", use: "now" },
  { scope: "socialplanner/post.write", why: "POST /posts (schedule) and PUT /posts/{id} (edit in place)", use: "now" },
  { scope: "socialplanner/statistics.readonly", why: "POST /social-media-posting/statistics: reactions, comments and shares read back into the app", use: "next" },
  { scope: "socialplanner/comment.readonly", why: "the comments endpoints: reading the author comments under a ladder post", use: "next" },
  { scope: "socialplanner/comment.write", why: "the comments endpoints: posting a rung as a comment", use: "next" },
  { scope: "medias.readonly", why: "GET /medias/files: the client's own Media Storage, where rendered graphics would live in their account", use: "next" },
  { scope: "medias.write", why: "POST /medias/upload-file: putting a rendered graphic into the client's Media Storage for the Social Planner to reference", use: "next" },
  { scope: "emails/builder.readonly", why: "GET /emails/builder: the client's email templates", use: "next" },
  { scope: "emails/builder.write", why: "POST /emails/builder and /emails/builder/data: HelixOS writes the client's marketing email template", use: "next" },
  { scope: "contacts.write", why: "POST /contacts/upsert: booked calls and new clients become contacts in the sub-account", use: "now" },
  { scope: "conversations/message.write", why: "POST /conversations/messages: sending an email to one contact from the client's own account, the send path the email template work will need", use: "next" },
];

/** The scope names, in the order the client ticks them. */
export const REQUIRED_SCOPES: readonly string[] = GHL_SCOPES.map((s) => s.scope);

/** The scope GoHighLevel named in a 403 body ("The token does not have access to this scope: socialplanner/post.write"), or null. */
export function scopeNamedIn(detail: string): string | null {
  const m = detail.match(/(socialplanner\/[a-z]+\.[a-z]+|medias\.[a-z]+|emails\/[a-z]+\.[a-z]+|contacts\.[a-z]+|conversations\/[a-z]+\.[a-z]+)/i);
  return m ? m[1] : null;
}

/** What Disconnect asks before it acts: what stops, and that the token itself is still alive until it is deleted in GoHighLevel. */
export const DISCONNECT_MESSAGE = "Disconnect GoHighLevel? Publishing, contact sync and the planner audit stop for this account. This removes HelixOS's copy of the token only: the token stays alive until the Private Integration is deleted in GoHighLevel, and until then a leaked copy can write the CRM and send email. Delete it there too.";
