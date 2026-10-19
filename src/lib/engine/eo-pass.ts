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

/**
 * eLoyalty's reason for refusing a request, safe to show the coach and to log (H-923): the error text only, with anything that
 * could be a member's detail taken out (emails, links, quoted values, long numbers), at most 160 characters. Null when the
 * answer carries no reason.
 */
export function refusalReason(json: unknown): string | null {
  const pick = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(pick);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const field = typeof o.field === "string" ? o.field : typeof o.path === "string" ? o.path : typeof o.param === "string" ? o.param : null;
      const msg = pick(o.message ?? o.msg ?? o.error ?? o.detail ?? o.errors ?? null);
      return msg.length ? msg.map((m) => (field && !m.includes(field) ? `${field}: ${m}` : m)) : field ? [field] : [];
    }
    return [];
  };
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const raw = o ? pick(o.errors ?? o.error ?? o.message ?? o.detail ?? null) : typeof json === "string" ? [json] : [];
  const text = raw
    .join("; ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "(an email)")
    .replace(/https?:\/\/\S+/g, "(a link)")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "(a value)")
    .replace(/\d{6,}/g, "(a number)")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 160) : null;
}

/** What to tell the member when the pass could not be made, by eLoyalty's status: only a busy or failing eLoyalty says to wait. */
export function createFailureWords(status: number, reason: string | null): string {
  const why = reason ? `: ${reason}` : "";
  if (status === 429 || status === 0 || status >= 500) return `Your pass could not be made just now (eLoyalty is busy or not answering${status ? `, ${status}` : ""}). Try again in a minute.`;
  if (status === 401 || status === 403) return `eLoyalty refused the program's key (${status})${why}. Check the key and its allowed templates in eLoyalty.`;
  if (status === 404) return `eLoyalty could not find the pass template (404)${why}. Check the template id on Coach.`;
  return `eLoyalty refused the pass (${status})${why}.`;
}
