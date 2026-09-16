/**
 * Read-only: how the Social Planner orders its list. One call, first and last createdAt of the reply, and whether the
 * sequence is newest-first, oldest-first or neither. Prints ids and timestamps only, never a post's text, never the token.
 *   npx tsx scripts/ghl-list-order.ts <private-integration-token> <locationId>
 */
const [token, locationId] = process.argv.slice(2);
if (!token || !locationId) {
  console.error("usage: npx tsx scripts/ghl-list-order.ts <private-integration-token> <locationId>");
  process.exit(2);
}
const base = process.env.GHL_API_BASE ?? "https://services.leadconnectorhq.com";
(async () => {
  const now = Date.now();
  const body = { type: "all", skip: "0", limit: "100", fromDate: new Date(now - 120 * 86400000).toISOString(), toDate: new Date(now + 400 * 86400000).toISOString(), includeUsers: "false" };
  const res = await fetch(`${base}/social-media-posting/${locationId}/posts/list`, { method: "POST", headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.log(`${res.status} ${text.replace(/pit-[A-Za-z0-9_-]+/g, "pit-[redacted]").slice(0, 200)}`);
    return;
  }
  const data = JSON.parse(text) as { results?: { posts?: Record<string, unknown>[]; count?: number } | Record<string, unknown>[]; posts?: Record<string, unknown>[] };
  const posts = (Array.isArray(data.results) ? data.results : (data.results?.posts ?? data.posts ?? [])) as Record<string, unknown>[];
  const count = Array.isArray(data.results) ? "(no count field)" : String(data.results?.count ?? "(no count field)");
  const stamps = posts.map((p) => String(p.createdAt ?? p.scheduleDate ?? ""));
  const times = stamps.map((s) => new Date(s).getTime());
  const desc = times.every((t, i) => i === 0 || !Number.isFinite(t) || !Number.isFinite(times[i - 1]) || t <= times[i - 1]);
  const asc = times.every((t, i) => i === 0 || !Number.isFinite(t) || !Number.isFinite(times[i - 1]) || t >= times[i - 1]);
  console.log(`returned ${posts.length}, planner count ${count}`);
  console.log(`first: ${String(posts[0]?._id ?? posts[0]?.id ?? "")} ${stamps[0] ?? ""}`);
  console.log(`last:  ${String(posts.at(-1)?._id ?? posts.at(-1)?.id ?? "")} ${stamps.at(-1) ?? ""}`);
  console.log(`order by createdAt: ${desc && !asc ? "newest-first" : asc && !desc ? "oldest-first" : posts.length < 2 ? "too few to tell" : "neither"}`);
  console.log(`keys on a post: ${Object.keys(posts[0] ?? {}).join(", ")}`);
})();

export {};
