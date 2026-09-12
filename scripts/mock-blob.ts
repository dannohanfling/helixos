/**
 * A stand-in for the Vercel Blob API for local walks: the SDK is pointed here with VERCEL_BLOB_API_URL (server) and
 * NEXT_PUBLIC_VERCEL_BLOB_API_URL (browser). Implements what the app uses: PUT /?pathname= (an upload, from a server put or a
 * browser upload on a client token), GET /?url= (head), POST /delete, and serving an object at its URL. Two stores live here,
 * told apart by the token's store id (vercel_blob_rw_<STORE>_…): as in Vercel, access is a property of the store, not of the
 * object. A store whose id contains PROOF is private: every object in it answers 403 at its URL without the token, and a PUT
 * asking for public access there is refused. Any other store is public. /__list names each object's store and access. Objects
 * live in memory. /__reset clears.
 *
 *   npx tsx scripts/mock-blob.ts 4050
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2] ?? 4050);
type Obj = { bytes: Buffer; contentType: string; access: "public" | "private"; store: string; uploadedAt: string };
/** Keyed by store and pathname: two stores may hold the same pathname, as two real stores would. */
const objects = new Map<string, Obj>();
const keyOf = (store: string, pathname: string) => `${store}\u0000${pathname}`;
const urlOf = (pathname: string, access: "public" | "private") => `http://localhost:${port}/${access === "private" ? "private/" : ""}${pathname}`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, POST, OPTIONS", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
};
const describe = (pathname: string, o: Obj) => ({ url: urlOf(pathname, o.access), downloadUrl: `${urlOf(pathname, o.access)}?download=1`, pathname, size: o.bytes.length, contentType: o.contentType, contentDisposition: `inline; filename="${pathname.split("/").pop()}"`, cacheControl: o.access === "private" ? "private, no-store" : "public, max-age=2592000", uploadedAt: o.uploadedAt, etag: createHash("md5").update(o.bytes).digest("hex") });
// The real store infers a type from the extension when the upload names none.
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const typeOf = (pathname: string, header: string | string[] | undefined) => (header ? String(header) : TYPES[pathname.split(".").pop()?.toLowerCase() ?? ""]) ?? "application/octet-stream";
/** The store a request is for, from its token: vercel_blob_rw_<STORE>_<secret> or a client token minted from one. */
const storeOf = (auth: string | undefined): string | null => {
  const m = (auth ?? "").match(/^Bearer vercel_blob_(?:rw|client)_([A-Za-z0-9]+)_/);
  return m ? m[1] : null;
};
const storeAccess = (store: string): "public" | "private" => (/PROOF/i.test(store) ? "private" : "public");
/** A URL's pathname, with the private marker stripped: the marker is the mock's way of making the two stores' URLs look different. */
const pathnameOf = (u: string) => (u.startsWith("http") ? new URL(u).pathname.slice(1) : u).replace(/^private\//, "");

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/__reset") {
    objects.clear();
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/__list") return json(res, 200, { objects: Array.from(objects.entries()).map(([k, o]) => ({ pathname: k.split("\u0000")[1], access: o.access, store: o.store, size: o.bytes.length })) });
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const store = storeOf(req.headers.authorization);
    const authed = store !== null;
    // The API: an upload
    if (req.method === "PUT" && url.pathname === "/") {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      let pathname = url.searchParams.get("pathname") ?? "";
      if (!pathname) return json(res, 400, { error: { code: "bad_request", message: "pathname required" } });
      if (req.headers["x-add-random-suffix"] === "1") pathname = pathname.replace(/(\.[^.]+)?$/, `-${Math.random().toString(36).slice(2, 8)}$1`);
      if (objects.has(keyOf(store!, pathname)) && req.headers["x-allow-overwrite"] !== "1") return json(res, 409, { error: { code: "blob_already_exists", message: "exists" } });
      // Access is the store's, not the object's: a private store refuses a public put, a public store refuses a private one.
      const access = storeAccess(store!);
      const asked = req.headers["x-vercel-blob-access"] === "private" ? "private" : "public";
      if (asked !== access) return json(res, 400, { error: { code: "bad_request", message: `this store is ${access}; access ${asked} is not available in it` } });
      const o: Obj = { bytes: body, contentType: typeOf(pathname, req.headers["x-content-type"]), access, store: store!, uploadedAt: new Date().toISOString() };
      objects.set(keyOf(store!, pathname), o);
      return json(res, 200, describe(pathname, o));
    }
    // The API: list by prefix (one page; the app never holds more than it can page through)
    if (req.method === "GET" && url.pathname === "/" && !url.searchParams.has("url")) {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      const prefix = url.searchParams.get("prefix") ?? "";
      const blobs = Array.from(objects.entries())
        .filter(([k, o]) => o.store === store && k.split("\u0000")[1].startsWith(prefix))
        .map(([k, o]) => ({ ...describe(k.split("\u0000")[1], o) }));
      return json(res, 200, { blobs, cursor: null, hasMore: false });
    }
    // The API: head
    if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("url")) {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      const pathname = pathnameOf(url.searchParams.get("url")!);
      const o = objects.get(keyOf(store!, pathname));
      return o ? json(res, 200, describe(pathname, o)) : json(res, 404, { error: { code: "not_found", message: "no such blob" } });
    }
    // The API: delete
    if (req.method === "POST" && url.pathname === "/delete") {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      const { urls } = JSON.parse(body.toString() || "{}") as { urls?: string[] };
      for (const u of urls ?? []) objects.delete(keyOf(store!, pathnameOf(u)));
      return json(res, 200, null);
    }
    // The CDN: a public object at its URL; a private one needs its own store's token, as the real store does. Range is honoured.
    if (req.method === "GET") {
      // The URL says which store (the mock's private/ marker); a private object needs its own store's token.
      const priv = url.pathname.startsWith("/private/");
      const pathname = pathnameOf(url.pathname.slice(1));
      const o = Array.from(objects.entries()).find(([k, x]) => k.split("\u0000")[1] === pathname && (x.access === "private") === priv)?.[1];
      if (!o) return json(res, 404, { error: { code: "not_found", message: "no such blob" } });
      if (o.access === "private" && store !== o.store) return json(res, 403, { error: { code: "forbidden", message: "private" } });
      const cache = o.access === "private" ? "private, no-store" : "public, max-age=2592000";
      const range = (req.headers.range ?? "").match(/^bytes=(\d*)-(\d*)$/);
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, o.bytes.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), o.bytes.length - 1) : o.bytes.length - 1;
        const part = o.bytes.subarray(start, end + 1);
        res.writeHead(206, { "content-type": o.contentType, "content-length": String(part.length), "content-range": `bytes ${start}-${end}/${o.bytes.length}`, "accept-ranges": "bytes", "cache-control": cache, ...cors });
        return res.end(part);
      }
      res.writeHead(200, { "content-type": o.contentType, "content-length": String(o.bytes.length), "accept-ranges": "bytes", "cache-control": cache, ...cors });
      return res.end(o.bytes);
    }
    json(res, 404, { error: { code: "not_found", message: "unknown route" } });
  });
}).listen(port, () => console.log(`mock blob on :${port}`));
