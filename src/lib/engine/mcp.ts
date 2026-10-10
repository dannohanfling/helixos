/**
 * The HelixOS MCP server (rev 224, approved rev 247), the pure parts: the scopes and their plain words, PKCE, what a
 * redirect URI may be, the token lifetimes, and the tool-name rule Claude's API enforces. No database, no request.
 */
import { createHash } from "node:crypto";
import { MCP_SCOPES } from "@/db/schema";

export type Scope = (typeof MCP_SCOPES)[number];

/** One scope per area, read and draft-write together (rev 247, B2). The line is what the consent screen says. */
export const SCOPE_WORDS: Record<Scope, { label: string; line: string }> = {
  today: { label: "Today", line: "What's on your Today: the lock-in, your top 3, tasks due, your streak and points. Lock in your day and close it." },
  tasks: { label: "Tasks", line: "List your tasks, add one, tick one off or back, move one to another day." },
  goals: { label: "Goals", line: "Read your goal and key results, update the numbers." },
  offers: { label: "Offers", line: "Read your offers; create and edit drafts. Never publish." },
  content: { label: "Content", line: "Read your content and ladders, and find your images." },
  // Voice to Ship (rev 638): writing a ladder is its own tick, and publishing another, never pre-ticked.
  "content:write": { label: "Content: write", line: "Write a comment ladder, change a part of one, and make its graphic. Nothing is posted." },
  "content:publish": { label: "Content: publish", line: "Ship a ladder to your Facebook Page and Instagram, only after reading back exactly what will post and hearing your yes. Never pre-ticked." },
  library: { label: "Library", line: "Search your library and assets." },
  webinars: { label: "Webinars", line: "Read your webinars and proofs." },
  essence: { label: "Essence", line: "Read your Essence and propose edits you accept in the app." },
  body: { label: "HumanOS", line: "Your HumanOS numbers and meal log. Only with HumanOS's own AI switch on, and never pre-ticked." },
};

export const SCOPE_NAMES: readonly Scope[] = MCP_SCOPES;
/** Never pre-ticked on the consent screen: HumanOS (rev 247, B3) and publishing (rev 638). */
export const OPT_IN_SCOPES: readonly Scope[] = ["body", "content:publish"];
export const isScope = (s: string): s is Scope => (MCP_SCOPES as readonly string[]).includes(s);

/** A space-separated scope string, as OAuth sends it, into known scopes and the rest. */
export function parseScopes(raw: string | null | undefined): { scopes: Scope[]; unknown: string[] } {
  const parts = (raw ?? "").split(/[\s,]+/).filter(Boolean);
  const scopes = [...new Set(parts.filter(isScope))];
  return { scopes, unknown: parts.filter((p) => !isScope(p)) };
}

export const MCP_PATH = "/api/mcp";
export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** PKCE, S256 only: the challenge is base64url(sha256(verifier)); the verifier is 43 to 128 unreserved characters. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier, "ascii").digest("base64url") === challenge;
}

export const isChallenge = (c: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(c);

/** A redirect URI must be https, with no fragment. Development allows plain http on the local machine only. */
export function redirectUriOk(uri: string, dev: boolean): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return dev && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** Registered URIs match exactly, character for character (no prefix, no query games). */
export const redirectMatches = (registered: string[], uri: string): boolean => registered.includes(uri);

/** Claude's API accepts tool names of letters, digits, underscores and hyphens only, so no dots. */
export const isToolName = (name: string): boolean => /^[a-zA-Z0-9_-]{1,64}$/.test(name);

/** The redirect back to the app, with the code or the error and the state exactly as it came. */
export function backToApp(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export const hostOf = (uri: string): string => {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
};
