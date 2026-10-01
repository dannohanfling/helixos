/**
 * The two food services (rev 237 phase 13, B8): USDA FoodData Central for a search by words (needs USDA_API_KEY, a free
 * api.data.gov key Danno sets on the server; never stored elsewhere, never logged, never in an error) and Open Food Facts
 * for a barcode (no key). USDA_API_URL and OFF_API_URL point the walk at scripts/mock-foods.ts. Both request shapes are from
 * memory of the docs (the hosts are blocked from the build container) and are checked on the first real search.
 */
import { fromOff, fromUsda, type FoundFood, type OffProduct, type UsdaFood } from "@/lib/engine/body-find";

const USDA = () => process.env.USDA_API_URL || "https://api.nal.usda.gov/fdc/v1";
const OFF = () => process.env.OFF_API_URL || "https://world.openfoodfacts.org/api/v2";

export type FoodSearchProblem = "no_key" | "unreachable" | "key" | "busy" | "other" | "not_found";
export class FoodSearchError extends Error {
  constructor(readonly problem: FoodSearchProblem) {
    super(`food search ${problem}`);
  }
}
const SAYS: Record<FoodSearchProblem, string> = {
  no_key: "Food search isn't set up on this server yet. A barcode still works, and you can add the food by hand.",
  unreachable: "Couldn't reach the food database. Try again in a minute, or add the food by hand.",
  key: "The food database didn't accept this server's key. Add the food by hand for now.",
  busy: "The food database asked us to slow down. Wait a minute and try again.",
  other: "The food database couldn't answer just now. Try again in a minute, or add the food by hand.",
  not_found: "No product with that barcode. Check the digits, or add the food by hand.",
};
export const foodSearchProblem = (e: FoodSearchError): string => SAYS[e.problem];
export const usdaConfigured = (): boolean => !!process.env.USDA_API_KEY;

async function get(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new FoodSearchError("unreachable");
  }
  if (res.status === 401 || res.status === 403) throw new FoodSearchError("key");
  if (res.status === 429) throw new FoodSearchError("busy");
  if (res.status === 404) throw new FoodSearchError("not_found");
  if (!res.ok) throw new FoodSearchError("other");
  return res;
}

/** Up to `limit` foods matching the words, generic foods first as USDA ranks them. The key rides the query string, never a log. */
export async function searchFoods(query: string, limit = 12): Promise<FoundFood[]> {
  const key = process.env.USDA_API_KEY;
  if (!key) throw new FoodSearchError("no_key");
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  const params = new URLSearchParams({ query: q, pageSize: String(limit), dataType: "Foundation,SR Legacy,Branded", api_key: key });
  const res = await get(`${USDA()}/foods/search?${params}`);
  const data = (await res.json().catch(() => ({}))) as { foods?: UsdaFood[] };
  return (Array.isArray(data.foods) ? data.foods : []).map(fromUsda).filter((f): f is FoundFood => !!f).slice(0, limit);
}

/** The product behind a barcode, or a not_found error. */
export async function lookupBarcode(code: string): Promise<FoundFood> {
  const res = await get(`${OFF()}/product/${encodeURIComponent(code)}.json?fields=code,product_name,product_name_en,brands,categories,nutriments`);
  const data = (await res.json().catch(() => ({}))) as { status?: number; product?: OffProduct };
  const found = data.status === 1 && data.product ? fromOff(data.product, code) : null;
  if (!found) throw new FoodSearchError("not_found");
  return found;
}
