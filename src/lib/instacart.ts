/**
 * Instacart's developer platform (rev 237 phase 10): one call, "create shopping list page", which answers with a link. On that
 * page the member picks a store, reviews the items, adds them to their cart and pays in Instacart with their own saved method.
 * HelixOS never places or pays for an order and never sees a card. The key is INSTACART_API_KEY on the server, never stored
 * elsewhere, never logged, never in an error; INSTACART_API_URL points the walk at scripts/mock-instacart.ts. The request shape
 * is from memory of the docs (they're blocked from the build container) and is checked against Danno's development key on the
 * first real push; the last step is pluggable so auto-ordering (rev 232) can follow without rework.
 */
import type { InstacartLine } from "@/lib/engine/body-shopping";

/**
 * Instacart isn't taking new partners and has no waitlist (Danno, rev 429), so there is no key to be had: every "Push to Instacart"
 * reads "Instacart: coming soon" and nothing is sent, whether or not INSTACART_API_KEY is set. Flip this to true once a key exists.
 */
export const INSTACART_OPEN = false;
export const INSTACART_SOON = "Instacart: coming soon";
export const INSTACART_SOON_LINE = "Instacart isn't taking new partners yet; your list works without it.";

const API = () => process.env.INSTACART_API_URL || "https://connect.instacart.com";

export type InstacartProblem = "no_key" | "unreachable" | "key" | "refused" | "busy" | "other";
export class InstacartError extends Error {
  constructor(readonly problem: InstacartProblem) {
    super(`instacart ${problem}`);
  }
}
const SAYS: Record<InstacartProblem, string> = {
  no_key: "Instacart isn't set up on this server yet (no key). Nothing was sent.",
  unreachable: "Couldn't reach Instacart. Nothing was sent; try again in a minute.",
  key: "Instacart didn't accept this server's key. Nothing was sent.",
  refused: "Instacart refused the list as sent. Nothing was sent to a cart; the list is still here.",
  busy: "Instacart asked us to slow down. Wait a minute and try again.",
  other: "Instacart couldn't answer just now. Nothing was sent; try again in a minute.",
};
export const instacartProblem = (e: InstacartError): string => SAYS[e.problem];

/** The shopping-list page's link for these lines. Throws an InstacartError with a code; the key never leaves this function. */
export async function createShoppingListLink(title: string, lines: InstacartLine[], linkbackUrl: string | null): Promise<string> {
  const key = process.env.INSTACART_API_KEY;
  if (!key) throw new InstacartError("no_key");
  if (!lines.length) throw new InstacartError("refused");
  const body = {
    title: title.slice(0, 80),
    link_type: "shopping_list",
    line_items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit })),
    ...(linkbackUrl ? { landing_page_configuration: { partner_linkback_url: linkbackUrl, enable_pantry_items: true } } : {}),
  };
  let res: Response;
  try {
    res = await fetch(`${API()}/idp/v1/products/products_link`, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new InstacartError("unreachable");
  }
  if (res.status === 401 || res.status === 403) throw new InstacartError("key");
  if (res.status === 400 || res.status === 422) throw new InstacartError("refused");
  if (res.status === 429) throw new InstacartError("busy");
  if (!res.ok) throw new InstacartError("other");
  const data = (await res.json().catch(() => ({}))) as { products_link_url?: unknown };
  const url = typeof data.products_link_url === "string" ? data.products_link_url : "";
  if (!/^https:\/\//.test(url)) throw new InstacartError("other");
  return url;
}
