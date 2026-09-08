/**
 * A tiny stand-in for the GoHighLevel API (the calls HelixOS makes), for smoke tests. `npx tsx scripts/mock-ghl.ts 4010`
 * Tokens: `pit-<locationId>` works for that location; `pit-noscope` is valid but lacks Social Planner scopes; anything else is 401.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4010);
const posts = new Map<string, Record<string, unknown>>();
let n = 0;

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    const auth = req.headers.authorization ?? "";
    const version = req.headers.version;
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!auth.startsWith("Bearer ") || version !== "2021-07-28") return json(401, { message: "Invalid JWT" });
    const token = auth.slice(7);
    if (url.startsWith("/__posts") && req.method === "GET") return json(200, { posts: [...posts.values()] }); // walk introspection, not a GHL route
    if (url.startsWith("/contacts/upsert") && req.method === "POST") {
      if (!token.startsWith("pit-") || token === "pit-noscope") return json(401, { message: "Invalid JWT" });
      return json(200, { contact: { id: `contact_${++n}` } });
    }
    const m = url.match(/^\/social-media-posting\/([^/]+)\/(accounts|posts)(?:\/([^/?]+))?/);
    if (!m) return json(404, { message: "Not found" });
    const [, loc, kind, id] = m;
    if (token === "pit-noscope") return json(403, { message: "The token does not have access to this scope: socialplanner/account.readonly" });
    if (!token.startsWith("pit-")) return json(401, { message: "Invalid JWT" });
    if (token !== `pit-${loc}`) return json(404, { message: `Location not found: ${loc}` });
    if (kind === "accounts" && req.method === "GET") {
      return json(200, {
        success: true,
        statusCode: 200,
        message: "Fetched Accounts",
        results: {
          accounts: [
            { id: `${loc}_fbpage_1`, name: "Torres Nutrition Coaching", platform: "facebook", type: "page", isExpired: false },
            { id: `${loc}_fbgroup_1`, name: "Busy Moms Who Actually Lose It", platform: "facebook", type: "group", isExpired: false },
            { id: `${loc}_ig_1`, name: "@torresnutrition", platform: "instagram", type: "business", isExpired: false },
            { id: `${loc}_li_1`, name: "Maya Torres", platform: "linkedin", type: "profile", isExpired: false },
            { id: `${loc}_li_old`, name: "Old LinkedIn", platform: "linkedin", type: "page", isExpired: true },
          ],
          groups: [],
        },
      });
    }
    if (kind === "posts" && req.method === "POST" && !id) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (!Array.isArray(body.accountIds) || !body.accountIds.length || !body.type) return json(422, { message: "accountIds and type are required" });
      const _id = `post_${++n}`;
      posts.set(_id, { _id, ...body, error: null, postId: null });
      return json(201, { success: true, statusCode: 201, message: "Post created", results: { post: posts.get(_id) } });
    }
    if (kind === "posts" && req.method === "PUT" && id) {
      const p = posts.get(id);
      if (!p) return json(404, { message: "Post not found" });
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      posts.set(id, { ...p, ...body, _id: id, edits: Number(p.edits ?? 0) + 1 });
      return json(200, { success: true, statusCode: 200, message: "Post updated", results: { post: posts.get(id) } });
    }
    if (kind === "posts" && req.method === "GET" && id) {
      const p = posts.get(id);
      if (!p) return json(404, { message: "Post not found" });
      const flipped = { ...p, status: "published", postId: `fb_${id}`, publishedAt: new Date().toISOString() };
      return json(200, { success: true, statusCode: 200, message: "Fetched Post", results: { post: flipped } });
    }
    return json(404, { message: "Not found" });
  });
}).listen(port, () => console.log(`mock GHL on http://localhost:${port}`));
