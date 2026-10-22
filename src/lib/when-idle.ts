/**
 * Runs `fn` once the browser is idle (at most 2 s on), or after 1 s where there is no idle callback (Safari). Speed 1 (H-1623):
 * a scene's loop or the streak flame starts loading only once the page's own content has had the connection. Client only.
 */
export function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1000);
  return () => window.clearTimeout(id);
}
