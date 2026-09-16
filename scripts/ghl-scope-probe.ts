/**
 * The scope-ordering experiment, run by a person with a throwaway Private Integration that grants ONLY
 * socialplanner/account.readonly:  npx tsx scripts/ghl-scope-probe.ts <token> <locationId>
 * Six read-only probes, one per readable scope on the canonical list. If the five ungranted ones answer 401/403, GoHighLevel
 * checks the scope before it validates the body and a probe can be trusted; if any answers 400/422, it cannot, and the
 * connect flow must say "not checked" for that one. Nothing here writes anything. The token is never printed.
 */
const [token, locationId] = process.argv.slice(2);
if (!token || !locationId) {
  console.error("usage: npx tsx scripts/ghl-scope-probe.ts <private-integration-token> <locationId>");
  process.exit(2);
}
const base = process.env.GHL_API_BASE ?? "https://services.leadconnectorhq.com";
const probes: { scope: string; method: "GET" | "POST"; path: string; body?: unknown }[] = [
  { scope: "socialplanner/account.readonly", method: "GET", path: `/social-media-posting/${locationId}/accounts` },
  { scope: "socialplanner/post.readonly", method: "POST", path: `/social-media-posting/${locationId}/posts/list`, body: { type: "scheduled", skip: 0, limit: 1, fromDate: "2020-01-01T00:00:00.000Z", toDate: "2030-01-01T00:00:00.000Z", includeUsers: "false" } },
  { scope: "socialplanner/statistics.readonly", method: "POST", path: `/social-media-posting/statistics?locationId=${locationId}`, body: { accountIds: [] } },
  { scope: "socialplanner/comment.readonly", method: "POST", path: `/social-media-posting/comments/facebook/list?locationId=${locationId}`, body: { originIds: ["probe"], skip: 0, limit: 1 } },
  { scope: "medias.readonly", method: "GET", path: `/medias/files?altType=location&altId=${locationId}&sortBy=createdAt&sortOrder=desc&type=file&limit=1` },
  { scope: "emails/builder.readonly", method: "GET", path: `/emails/builder?locationId=${locationId}&limit=1` },
];
(async () => {
  for (const p of probes) {
    const res = await fetch(`${base}${p.path}`, { method: p.method, headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", ...(p.body ? { "content-type": "application/json" } : {}) }, body: p.body ? JSON.stringify(p.body) : undefined });
    const text = (await res.text()).replace(/pit-[A-Za-z0-9_-]+/g, "pit-[redacted]").slice(0, 160).replace(/\s+/g, " ");
    console.log(`${p.scope.padEnd(36)} ${res.status}  ${text}`);
  }
})();

export {};
