/**
 * The one list of GoHighLevel scopes a client ticks when they create their Private Integration. Every screen, check and
 * document that names a scope reads it from here. Scopes are granted once: adding one later means every client creating a
 * new integration and pasting a new token, so the list is a superset of what the app calls now and what it will call within
 * the next two releases, and nothing is dropped from it without the same reckoning. Each entry says which endpoint needs it
 * (from GoHighLevel's own OpenAPI specs) and whether the app calls that endpoint today.
 */
export type ScopeUse = "now" | "next";
/** `noun` is the thing as GoHighLevel's own permissions picker names it ("Social Planner Posts"); the picker's name is View or Edit plus the noun. */
export type GhlScope = { scope: string; noun: string; why: string; use: ScopeUse };

export const GHL_SCOPES: GhlScope[] = [
  { scope: "socialplanner/account.readonly", noun: "Social Planner Accounts", why: "GET /social-media-posting/{locationId}/accounts: the connected pages and profiles, the connection check itself", use: "now" },
  { scope: "socialplanner/account.write", noun: "Social Planner Accounts", why: "account changes on the Social Planner; kept so a future connect-from-HelixOS step never needs a new token", use: "next" },
  { scope: "socialplanner/oauth.readonly", noun: "Social Planner OAuth", why: "the OAuth start endpoints; not called today, kept because GoHighLevel does not document every endpoint's scope and a missing one costs every client a new token", use: "next" },
  { scope: "socialplanner/oauth.write", noun: "Social Planner OAuth", why: "same as oauth.readonly", use: "next" },
  { scope: "socialplanner/post.readonly", noun: "Social Planner Posts", why: "GET /posts/{id} (Check status) and POST /posts/list (the coach's planner audit)", use: "now" },
  { scope: "socialplanner/post.write", noun: "Social Planner Posts", why: "POST /posts (schedule) and PUT /posts/{id} (edit in place)", use: "now" },
  { scope: "socialplanner/statistics.readonly", noun: "Social Planner Statistics", why: "POST /social-media-posting/statistics: reactions, comments and shares read back into the app", use: "next" },
  { scope: "socialplanner/comments.readonly", noun: "Social Planner Comments", why: "the comments endpoints: reading the author comments under a ladder post", use: "next" },
  { scope: "socialplanner/comments.write", noun: "Social Planner Comments", why: "the comments endpoints: posting a rung as a comment", use: "next" },
  { scope: "medias.readonly", noun: "Medias", why: "GET /medias/files: the client's own Media Storage, where rendered graphics would live in their account", use: "next" },
  { scope: "medias.write", noun: "Medias", why: "POST /medias/upload-file: a post's picture (a made graphic, a photo from Images or Proof) into the client's own Media Storage, so the post carries it (rev 840)", use: "now" },
  { scope: "emails/builder.readonly", noun: "Email Builder", why: "GET /emails/builder: the client's email templates", use: "next" },
  { scope: "emails/builder.write", noun: "Email Builder", why: "POST /emails/builder and /emails/builder/data: HelixOS writes the client's marketing email template", use: "next" },
  { scope: "contacts.readonly", noun: "Contacts", why: "GET /contacts/ (the search's total): a client's contact count for the 10 Million Lives tracker, pulled only when the member confirms it; not called today, on the list now while no client has connected (Danno, rev 464)", use: "next" },
  { scope: "contacts.write", noun: "Contacts", why: "POST /contacts/upsert: booked calls and new clients become contacts in the sub-account", use: "now" },
  { scope: "users.readonly", noun: "Users", why: "GET /users/?locationId=: the account's users, so \"Which user are you?\" is a pick from a list instead of a typed GHL user ID (rev 850). Keys made before it get the typed field", use: "now" },
  { scope: "locations.readonly", noun: "Locations", why: "GET /locations/{locationId}: the sub-account's name, shown in the green Connected state so the client sees which account is connected", use: "now" },
  { scope: "locations/customFields.write", noun: "Custom Fields", why: "POST /locations/{locationId}/customFields: creating the helixos_user_ns custom field that carries a chatbot lead's id; not called today, on the list so the Community Loyalty path never needs a new token", use: "next" },
  { scope: "locations/customFields.readonly", noun: "Custom Fields", why: "GET /locations/{locationId}/customFields: reading the sub-account's field definitions so the chatbot-lead path can see whether helixos_user_ns exists before creating it; not called today", use: "next" },
  { scope: "conversations/message.write", noun: "Conversation Messages", why: "POST /conversations/messages: sending an email to one contact from the client's own account, the send path the email template work will need", use: "next" },
  { scope: "opportunities.readonly", noun: "Opportunities", why: "GET /opportunities/pipelines and /opportunities/search: the member's own opportunity pipelines and their stages, read for the Aqueduct's pipeline picker (H-222); on the list now (H-233) so nobody makes a second key when that ships", use: "next" },
];

/** The permission's name as GoHighLevel's picker shows it: View for a readonly scope, Edit for a write one, then the thing. */
export const pickerName = (s: GhlScope): string => `${s.scope.endsWith(".readonly") ? "View" : "Edit"} ${s.noun}`;

/** The text to paste into the picker's search box: the noun without its plural s ("Social Planner Post"), which finds the View and the Edit entry alike; a noun ending in "ies" stays whole. */
export const searchText = (s: GhlScope): string => (/ies$/.test(s.noun) ? s.noun : s.noun.replace(/s$/, ""));

/** The one line above the rows (H-233): GoHighLevel's picker takes permissions one at a time, so the whole list pasted at once finds nothing. */
export const ONE_AT_A_TIME = "GoHighLevel adds permissions one at a time: copy one, paste it in the search box there, tick it, then the next.";

/** The scope names, in the order the client ticks them. */
export const REQUIRED_SCOPES: readonly string[] = GHL_SCOPES.map((s) => s.scope);

/** The scope GoHighLevel named in a 403 body ("The token does not have access to this scope: socialplanner/post.write"), or null. */
export function scopeNamedIn(detail: string): string | null {
  const m = detail.match(/(socialplanner\/[a-z]+\.[a-z]+|medias\.[a-z]+|opportunities\.[a-z]+|emails\/[a-z]+\.[a-z]+|contacts\.[a-z]+|conversations\/[a-z]+\.[a-z]+|locations\/[a-z]+\.[a-z]+|locations\.[a-z]+)/i);
  return m ? m[1] : null;
}

/** What Disconnect asks before it acts: what stops, and that the token itself is still alive until it is deleted in GoHighLevel. */
export const DISCONNECT_MESSAGE = "Disconnect GoHighLevel? Publishing, contact sync and the planner audit stop for this account. This removes HelixOS's copy of the token only: the token stays alive until the Private Integration is deleted in GoHighLevel, and until then a leaked copy can write the CRM and send email. Delete it there too.";
