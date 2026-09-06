/** A tiny stand-in for the GoHighLevel API (the four calls HelixOS makes), for smoke tests. `npx tsx scripts/mock-ghl.ts 4010` */
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
    if (!auth.startsWith("Bearer ") || version !== "2021-07-28") return json(401, { message: "Unauthorized" });
    if (req.method === "POST" && url === "/oauth/locationToken") {
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      if (auth !== "Bearer agency-token") return json(401, { message: "Invalid agency token" });
      return json(200, { access_token: `loc-token-${form.get("locationId")}`, token_type: "Bearer", expires_in: 86399, scope: "socialplanner/post.write" });
    }
    const m = url.match(/^\/social-media-posting\/([^/]+)\/(accounts|posts)(?:\/([^/?]+))?/);
    if (!m) return json(404, { message: "Not found" });
    const [, loc, kind, id] = m;
    if (auth !== `Bearer loc-token-${loc}` && auth !== "Bearer pit-token") return json(401, { message: "Invalid location token" });
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
      if (!Array.isArray(body.accountIds) || !body.accountIds.length || !body.type || !body.userId) return json(422, { message: "accountIds, type and userId are required" });
      const _id = `post_${++n}`;
      posts.set(_id, { _id, ...body, error: null, postId: null });
      return json(201, { success: true, statusCode: 201, message: "Post created", results: { post: posts.get(_id) } });
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
