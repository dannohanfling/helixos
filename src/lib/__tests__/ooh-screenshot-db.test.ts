import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Office Hours screenshot (H-1706): checked by size and by its bytes, stored under ooh/, replaced and removed with the old
 * picture deleted, the request kept when the store refuses; and the private link answers only the coach, the owner and a team
 * member on the request, with the same 404 for everyone else.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-oohshot-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});
const viewer = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth", () => ({ apiViewer: async () => viewer.current }));
vi.mock("@/lib/proof-storage", () => ({
  proofStorageConfigured: () => true,
  putOohObject: async () => ({ key: "", url: "", size: 0, contentType: "" }),
  deleteProofObject: async () => undefined,
  readProofObject: async () => new Response("PICTURE", { status: 200 }),
}));

const { db, schema } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { applyOohScreenshot, oohScreenshotKey } = await import("@/lib/ooh-screenshot");
const { checkScreenshot, dataUrlBytes } = await import("@/lib/engine/reports");
const { GET } = await import("@/app/api/office-hours/[id]/screenshot/route");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const row = async (id: string) => db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.id, id) });
function fakeStore(opts: { configured?: boolean; refuse?: boolean } = {}) {
  const puts: string[] = [];
  const dels: string[] = [];
  return {
    puts,
    dels,
    store: {
      configured: () => opts.configured ?? true,
      put: async (key: string, bytes: Buffer, contentType: string) => {
        if (opts.refuse) throw new Error("store said no");
        puts.push(key);
        return { key, url: `https://store.test/${key}`, size: bytes.length, contentType };
      },
      del: async (url: string) => {
        dels.push(url);
      },
    },
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values([
    { id: "w1", name: "One", slug: "one", clientInviteCode: "C1", coachInviteCode: "K1" },
    { id: "w2", name: "Two", slug: "two", clientInviteCode: "C2", coachInviteCode: "K2" },
  ]);
  await db.insert(schema.users).values(["coach", "owner", "helper", "bystander", "other", "stranger"].map((id) => ({ id, email: `${id}@example.com`, name: id, passwordHash: "x" })));
  const req = (id: string, extra: Record<string, unknown> = {}) => ({ id, workspaceId: "w1", userId: "owner", friday: "2026-10-30", description: "d", triedSelf: "t", goal: "g", category: "Other", ...extra });
  await db.insert(schema.officeHoursRequests).values([
    req("r1"),
    req("r2"),
    req("r3"),
    req("r4"),
    req("shown", { screenshotKey: "ooh/w1/shown-a.png", screenshotUrl: "https://store.test/ooh/w1/shown-a.png", screenshotType: "image/png", submittedByUserId: "helper" }),
    req("bare"),
  ]);
});

describe("checkScreenshot", () => {
  it("takes a real picture and refuses one too large or not a picture at all", () => {
    expect(checkScreenshot(PNG)).toMatchObject({ ok: true, mime: "image/png", ext: "png" });
    expect(checkScreenshot(Buffer.alloc(2_000_000, 0x89))).toEqual({ ok: false, error: "That picture is too large. Try a smaller one, or send it without." });
    expect(checkScreenshot(Buffer.from("this is a text file renamed .png"))).toEqual({ ok: false, error: "The screenshot has to be a picture (PNG, JPEG, WebP or GIF)." });
  });
});

describe("dataUrlBytes", () => {
  it("reads a picture sent as a data address, and nothing else", () => {
    const sent = dataUrlBytes(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(sent && "bytes" in sent ? sent.bytes.equals(PNG) : false).toBe(true);
    expect(dataUrlBytes("")).toBeNull();
    expect(dataUrlBytes("https://example.com/a.png")).toBeNull();
    expect(dataUrlBytes("data:image/png;base64,<script>")).toBeNull();
    expect(dataUrlBytes(`data:image/png;base64,${"A".repeat(1_400_000)}`)).toEqual({ tooLarge: true });
  });
});

describe("applyOohScreenshot", () => {
  it("stores a new picture under ooh/ and points the request at it", async () => {
    const s = fakeStore();
    expect(await applyOohScreenshot("w1", "r1", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, s.store)).toBe("kept");
    expect(s.puts[0]).toMatch(/^ooh\/w1\/r1-[0-9a-f]{8}\.png$/);
    expect(await row("r1")).toMatchObject({ screenshotKey: s.puts[0], screenshotUrl: `https://store.test/${s.puts[0]}`, screenshotType: "image/png" });
  });

  it("replaces a picture and deletes the old one once the request no longer points at it", async () => {
    const first = fakeStore();
    await applyOohScreenshot("w1", "r2", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, first.store);
    const oldUrl = (await row("r2"))!.screenshotUrl;
    const second = fakeStore();
    expect(await applyOohScreenshot("w1", "r2", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, second.store)).toBe("kept");
    expect((await row("r2"))!.screenshotUrl).not.toBe(oldUrl);
    expect(second.dels).toEqual([oldUrl]);
  });

  it("removes a picture and deletes it from the store", async () => {
    const s = fakeStore();
    await applyOohScreenshot("w1", "r3", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, s.store);
    const oldUrl = (await row("r3"))!.screenshotUrl;
    expect(await applyOohScreenshot("w1", "r3", { kind: "remove" }, s.store)).toBe("removed");
    expect(await row("r3")).toMatchObject({ screenshotKey: null, screenshotUrl: null, screenshotType: null });
    expect(s.dels).toEqual([oldUrl]);
  });

  it("keeps the request as it was when the store isn't set up or refuses", async () => {
    expect(await applyOohScreenshot("w1", "r4", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, fakeStore({ configured: false }).store)).toBe("not-stored");
    expect(await applyOohScreenshot("w1", "r4", { kind: "new", bytes: PNG, mime: "image/png", ext: "png" }, fakeStore({ refuse: true }).store)).toBe("not-stored");
    expect((await row("r4"))!.screenshotUrl).toBeNull();
  });

  it("never touches a request in another workspace", async () => {
    expect(await applyOohScreenshot("w2", "r1", { kind: "remove" }, fakeStore().store)).toBe("unchanged");
    expect((await row("r1"))!.screenshotUrl).toBeTruthy();
  });

  it("keys a picture in its own workspace's tree", () => {
    expect(oohScreenshotKey("w1", "r9", "abcd1234", "jpg")).toBe("ooh/w1/r9-abcd1234.jpg");
  });
});

describe("the private link", () => {
  const as = (o: { user: string; role?: "coach" | "client"; actor?: string; team?: boolean; switchedInto?: boolean; ws?: string }) => {
    viewer.current = { user: { id: o.user }, actor: { id: o.actor ?? o.user }, role: o.role ?? "client", workspace: { id: o.ws ?? "w1" }, team: o.team ? { teamMemberId: "t" } : null, switchedInto: o.switchedInto ? { membershipId: "m" } : null };
  };
  const get = async (id: string) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

  it("shows the picture to the coach, the owner and the team member on the request", async () => {
    for (const who of [{ user: "coach", role: "coach" as const }, { user: "owner" }, { user: "owner", actor: "helper", team: true }]) {
      as(who);
      const r = await get("shown");
      expect(r.status, JSON.stringify(who)).toBe(200);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("answers everyone else, and a request with no picture, with the same 404", async () => {
    const answers: string[] = [];
    for (const who of [{ user: "other" }, { user: "owner", actor: "bystander", team: true }, { user: "coach", role: "coach" as const, ws: "w2" }, { user: "other", role: "client" as const, switchedInto: true }]) {
      as(who);
      const r = await get("shown");
      expect(r.status, JSON.stringify(who)).toBe(404);
      answers.push(await r.text());
    }
    as({ user: "owner" });
    const none = await get("bare");
    expect(none.status).toBe(404);
    answers.push(await none.text());
    viewer.current = null;
    answers.push(await (await get("shown")).text());
    expect(new Set(answers).size).toBe(1);
  });
});
