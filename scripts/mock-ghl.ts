/**
 * A tiny stand-in for the GoHighLevel API (the calls HelixOS makes), for smoke tests. `npx tsx scripts/mock-ghl.ts 4010`
 * Tokens: `pit-<locationId>` works for that location; `pit-noscope` is valid but lacks Social Planner scopes; anything else is 401.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4010);
const posts = new Map<string, Record<string, unknown>>();
const drips: { path: string; body: Record<string, unknown>; at: string }[] = [];
const contacts = new Map<string, Record<string, unknown>>();
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
    if (url.startsWith("/__drips") && req.method === "GET") return json(200, { drips }); // walk introspection
    if (url.startsWith("/__delete/") && req.method === "POST") {
      posts.delete(url.slice("/__delete/".length)); // a post deleted by hand in the planner
      return json(200, { ok: true });
    }
    // A Community Loyalty inbound webhook (the Rung Dripper's): no auth, the URL is the credential; answers {"status":"ok"}.
    if (url.startsWith("/api/iwh/") && req.method === "POST") {
      drips.push({ path: url, body: JSON.parse(Buffer.concat(chunks).toString() || "{}"), at: new Date().toISOString() });
      return json(200, { status: "ok" });
    }
    if (!auth.startsWith("Bearer ") || version !== "2021-07-28") return json(401, { message: "Invalid JWT" });
    const token = auth.slice(7);
    if (url.startsWith("/__posts") && req.method === "GET") return json(200, { posts: [...posts.values()] }); // walk introspection, not a GHL route
    if (url.startsWith("/__reset") && req.method === "POST") {
      posts.clear();
      drips.length = 0;
      contacts.clear();
      return json(200, { ok: true });
    }
    if (url.startsWith("/__contacts") && req.method === "GET") return json(200, { contacts: [...contacts.values()] }); // walk introspection
    if (url.startsWith("/contacts/upsert") && req.method === "POST") {
      if (!token.startsWith("pit-") || token === "pit-noscope") return json(401, { message: "Invalid JWT" });
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>;
      // As the real endpoint: matched on email or phone under the location's duplicate setting, else created; `new` says which.
      const match = [...contacts.values()].find((c) => (body.email && c.email === body.email) || (body.phone && c.phone === body.phone));
      if (match) {
        Object.assign(match, body, { updates: Number(match.updates ?? 0) + 1 });
        return json(200, { new: false, contact: { id: match.id }, traceId: "t" });
      }
      const id = `contact_${++n}`;
      contacts.set(id, { id, ...body, updates: 0 });
      return json(200, { new: true, contact: { id }, traceId: "t" });
    }
    const cm = url.match(/^\/contacts\/([^/?]+)$/);
    if (cm && req.method === "PUT") {
      if (!token.startsWith("pit-") || token === "pit-noscope") return json(401, { message: "Invalid JWT" });
      const c = contacts.get(cm[1]);
      if (!c) return json(404, { message: "Contact not found" });
      Object.assign(c, JSON.parse(Buffer.concat(chunks).toString() || "{}"), { updates: Number(c.updates ?? 0) + 1 });
      return json(200, { succeded: true, contact: { id: c.id } });
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
            { id: `${loc}_threads_1_profile`, name: "@torresnutrition on Threads", platform: "threads", type: "profile", isExpired: false },
          ],
          groups: [],
        },
      });
    }
    if (kind === "posts" && req.method === "POST" && !id) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (!Array.isArray(body.accountIds) || !body.accountIds.length || !body.type) return json(422, { statusCode: 422, message: ["accountIds must contain at least 1 elements", "type must be one of the following values: post, story, reel"], error: "Unprocessable Entity" });
      if (typeof body.userId !== "string" || !body.userId) return json(422, { statusCode: 422, message: ["userId must be a string", "userId should not be empty"], error: "Unprocessable Entity" });
      // A walk hook: this user id is refused as GoHighLevel refuses one it does not know.
      if (body.userId === "user_refused") return json(422, { statusCode: 422, message: ["userId must be a valid user id"], error: "Unprocessable Entity" });
      const _id = `post_${++n}`;
      posts.set(_id, { _id, ...body, error: null, postId: null, createdAt: new Date().toISOString() });
      // A walk hook: seen live 15 Sep, a 2xx whose body carries no id. The post exists all the same.
      if (String(body.summary ?? "").includes("[noid]")) return json(201, { success: true, statusCode: 201, message: "Post created", results: {} });
      return json(201, { success: true, statusCode: 201, message: "Post created", results: { post: posts.get(_id) } });
    }
    if (kind === "posts" && req.method === "POST" && id === "list") {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const all = [...posts.values()];
      const list = body.type && body.type !== "all" && body.type !== "recent" ? all.filter((p) => p.status === body.type) : all;
      return json(200, { success: true, statusCode: 200, message: "Fetched Posts", results: { posts: list, count: list.length } });
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
      // The planner "publishes" a post whose time has come (within two days, so a walk's "tomorrow" is due at any hour of
      // the day it runs); one scheduled further out stays scheduled.
      const due = !p.scheduleDate || new Date(String(p.scheduleDate)).getTime() <= Date.now() + 2 * 86400000;
      const flipped = due ? { ...p, status: "published", postId: `fb_${id}`, publishedAt: new Date().toISOString() } : p;
      return json(200, { success: true, statusCode: 200, message: "Fetched Post", results: { post: flipped } });
    }
    return json(404, { message: "Not found" });
  });
}).listen(port, () => console.log(`mock GHL on http://localhost:${port}`));
