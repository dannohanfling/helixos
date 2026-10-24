/**
 * Reel to Post, PR B: where HelixOS's own model store is (REEL_MODELS_URL, set once the models are uploaded with
 * scripts/reel-models.ts). The browser reads the listening model and its runtime from there, never from a third party.
 * Unset, or not an https address (http on this machine only), means no listening on the device: pasting still works.
 */
export function reelModelsUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.REEL_MODELS_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:" && env.NODE_ENV !== "production")) return null;
    return `${u.origin}${u.pathname.replace(/\/?$/, "/")}`;
  } catch {
    return null;
  }
}

/** The store's origin, for the page's security policy: the worker imports the runtime from it and fetches the model files. */
export function reelModelsOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const url = reelModelsUrl(env);
  return url ? new URL(url).origin : null;
}
