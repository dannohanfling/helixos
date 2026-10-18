/**
 * The Evolve Omega pass (H-622), the pure parts: whether a member may get a pass on the coach's own program, and what the
 * Rewards card says. Nothing here calls anything. A pass is created once per member, by the program's template, and only
 * when the coach's own program is connected and checked; clients only once the coach has switched "Issue passes" on.
 */

export type PassProgram = { ready: boolean; issuePasses: boolean } | null;
export type PassOffer =
  | { kind: "has"; installed: boolean }
  | { kind: "get" }
  | { kind: "closed"; why: string };

/** What the member's Rewards card offers. */
export function passOffer(m: { role: "coach" | "client"; hasPass: boolean; installed: boolean }, program: PassProgram): PassOffer {
  if (m.hasPass) return { kind: "has", installed: m.installed };
  if (!program?.ready) return { kind: "closed", why: "Your Evolve Omega pass is on its way: the program is being set up." };
  if (m.role === "coach" || program.issuePasses) return { kind: "get" };
  return { kind: "closed", why: "Your Evolve Omega pass is on its way: your coach opens it to members soon." };
}

/** First and last name for the pass from the member's one name field ("Ana Sofia Reyes" → "Ana Sofia", "Reyes"). */
export function passNames(full: string): { firstName: string; lastName: string } {
  const parts = full.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Only a real https address from eLoyalty is ever kept as the add-to-wallet link. */
export const safePassUrl = (u: string | null | undefined): string | null => (u && /^https:\/\/[\w.-]+(:\d+)?\/[^\s"'<>]*$/.test(u) ? u.slice(0, 500) : null);
