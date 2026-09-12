import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_ATTACHMENT_PREFIX, PUBLIC_MAGNET_PREFIX, UPLOAD_MAX_BYTES, capLabel, keyIsPublic, privateAttachmentKey, publicFolderOf, publicMagnetKey, publicUrlFor, safeName, uploadRefusal } from "../storage-policy";
import { HIT_SOURCES, QUESTION_WARNING, canvaHandoff, contentToText, endsWithQuestion, hitSource, keywordOf, magnetText, parseContent, parseGenerated, primaryTarget, scaffoldContent, slugify } from "../lead-magnet";
import { SECTION_TASKS, sectionCountLine } from "../pathway";

const SRC = join(__dirname, "..", "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe("storage policy: two prefixes, two writers", () => {
  it("a proof attachment never resolves to a public URL, whatever is recorded about it", () => {
    const key = privateAttachmentKey("ws1", "id1", "screenshot.png");
    expect(key.startsWith(PRIVATE_ATTACHMENT_PREFIX)).toBe(true);
    expect(keyIsPublic(key)).toBe(false);
    expect(publicUrlFor(key)).toBeNull();
  });
  it("a magnet key is public, and only under its prefix", () => {
    const key = publicMagnetKey("the-guide", "id1", "guide.pdf");
    expect(key).toBe(`${PUBLIC_MAGNET_PREFIX}the-guide/id1-guide.pdf`);
    expect(keyIsPublic(key)).toBe(true);
    expect(publicUrlFor(key)).toBe(`/files/${key}`);
  });
  it("a public-looking key that is malformed is not public", () => {
    for (const k of ["public/magnets/../private/attachments/ws/x", "public/magnets/ws", "public/magnets/ws/a/b", "public/magnets//x", "public/magnets/ws/../x", "public/magnetsX/ws/x", "/public/magnets/ws/x", "private/attachments/ws/id-x"]) {
      expect(keyIsPublic(k), k).toBe(false);
      expect(publicUrlFor(k), k).toBeNull();
    }
  });
  it("a file name never carries a path, and a bad segment is refused", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("My Guide (final).PDF")).toBe("My-Guide-final-.PDF");
    expect(() => publicMagnetKey("slug/1", "id", "x")).toThrow();
    expect(() => privateAttachmentKey("ws", "../id", "x")).toThrow();
  });
  it("only the magnet writers ever mark an object public, only storage.ts writes the index, and the bucket SDK stays behind three doors", () => {
    const hits: string[] = [];
    const sdk: string[] = [];
    for (const f of walk(join(SRC, "lib")).concat(walk(join(SRC, "app")), walk(join(SRC, "components")))) {
      if (f.includes("__tests__")) continue;
      const text = readFileSync(f, "utf8");
      const rel = f.slice(SRC.length + 1).replace(/\\/g, "/");
      if (/isPublic:\s*true/.test(text)) hits.push(rel);
      if (/insert\(schema\.files\)/.test(text) && rel !== "lib/storage.ts") throw new Error(`${rel} writes the object index directly; only src/lib/storage.ts may`);
      if (/from "@vercel\/blob/.test(text)) sdk.push(rel);
    }
    expect(hits).toEqual(["lib/storage.ts"]);
    // Two stores, two thin modules, two browser doors and two token routes: nothing else touches the SDK.
    expect(sdk.sort()).toEqual(["app/api/magnets/upload/route.ts", "app/api/proofs/upload/route.ts", "components/magnet-upload.tsx", "components/proof-upload.tsx", "lib/proof-storage.ts", "lib/storage.ts"]);
    const storage = readFileSync(join(SRC, "lib", "storage.ts"), "utf8");
    const fnOf = (name: string) => {
      const start = storage.indexOf(`export async function ${name}`);
      const next = storage.indexOf("export ", start + 1);
      return storage.slice(start, next === -1 ? undefined : next);
    };
    expect(fnOf("putPublicMagnet")).toMatch(/isPublic:\s*true/);
    expect(fnOf("putPublicMagnet")).toMatch(/access:\s*"public"/);
    expect(fnOf("recordPublicMagnet")).toMatch(/isPublic:\s*true/);
    // Access is a property of the store: the public store's module never writes private, and the private store's never writes public.
    expect(storage).not.toMatch(/access:\s*"private"/);
    expect(storage).not.toMatch(/PROOF_BLOB/);
    const proofStorage = readFileSync(join(SRC, "lib", "proof-storage.ts"), "utf8");
    expect(proofStorage).not.toMatch(/access:\s*"public"/);
    // Every public writer refuses a key outside the prefix before it touches the bucket.
    for (const name of ["putPublicMagnet", "recordPublicMagnet"]) expect(fnOf(name)).toMatch(/keyIsPublic\(key\)\) throw/);
    // The browser's door pins the folder to the magnet's slug and the cap and the types to the policy's.
    const route = readFileSync(join(SRC, "app", "api", "magnets", "upload", "route.ts"), "utf8");
    expect(route).toMatch(/publicFolderOf\(pathname\) !== m\.slug/);
    expect(route).toMatch(/maximumSizeInBytes: UPLOAD_MAX_BYTES/);
    expect(route).toMatch(/allowedContentTypes: \[\.\.\.UPLOAD_TYPES\]/);
  });
  it("the cap is one number and every message that names it derives from it", () => {
    expect(capLabel(UPLOAD_MAX_BYTES)).toBe(`${UPLOAD_MAX_BYTES / (1024 * 1024)} MB`);
    expect(uploadRefusal({ size: UPLOAD_MAX_BYTES + 1, type: "application/pdf" })).toContain(capLabel());
    expect(uploadRefusal({ size: 10, type: "application/x-msdownload" })).toMatch(/can't be served/);
    expect(uploadRefusal({ size: 10, type: "image/png" })).toBeNull();
    for (const f of walk(join(SRC, "lib")).concat(walk(join(SRC, "app")), walk(join(SRC, "components")))) {
      if (f.includes("__tests__")) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/Up to \d+ MB|over \d+ MB/);
    }
    expect(publicFolderOf("public/magnets/the-guide/id-x.pdf")).toBe("the-guide");
    expect(publicFolderOf("private/attachments/ws/id-x.png")).toBeNull();
  });
});

describe("lead magnet: the record and its outputs", () => {
  it("keyword: upper case letters and digits only; slug: from the title, letters, digits and dashes only", () => {
    expect(keywordOf("plan!")).toBe("PLAN");
    expect(keywordOf("12 minute plan")).toBe("12MINUTEPLAN");
    expect(slugify("The 12-Minute Content Plan")).toBe("the-12-minute-content-plan");
    expect(slugify("Émilie's guide for maya@example.com")).toMatch(/^[a-z0-9-]+$/);
    expect(slugify("")).toBe("magnet");
  });
  it("the tracked link's source is a closed list; anything else is 'other'", () => {
    expect(HIT_SOURCES).toEqual(["chatbot", "dm", "email", "rung", "page", "other"]);
    expect(hitSource("chatbot")).toBe("chatbot");
    expect(hitSource("maya@example.com")).toBe("other");
    expect(hitSource("<script>")).toBe("other");
    expect(hitSource(null)).toBe("other");
  });
  it("content round-trips through the editor's plain shape", () => {
    const c = { intro: "Three things first.", sections: [{ heading: "Why this matters", items: ["One.", "Two."], why: "Because.", how: "Like this." }, { heading: "The list", items: ["Do it."] }], closing: "See you inside." };
    expect(parseContent(contentToText(c))).toEqual(c);
    expect(parseContent("")).toEqual({ intro: "", sections: [], closing: "" });
  });
  it("the scaffold is the type's shape with the promise as the intro and nothing else", () => {
    const s = scaffoldContent("guide", "Post daily in twelve minutes.");
    expect(s.intro).toBe("Post daily in twelve minutes.");
    expect(s.sections.map((x) => x.heading)).toEqual(["Why this matters", "Step one", "Step two", "Step three", "What to do next"]);
    expect(s.sections.every((x) => x.items.length === 0)).toBe(true);
  });
  it("the copy-outs carry the content; a checklist ticks, a guide bullets", () => {
    const content = { intro: "", sections: [{ heading: "The list", items: ["Do it."] }], closing: "" };
    expect(magnetText({ title: "T", promise: "P", type: "checklist", content })).toContain("[ ] Do it.");
    expect(magnetText({ title: "T", promise: "P", type: "guide", content })).toContain("• Do it.");
    const canva = canvaHandoff({ title: "T", promise: "P", type: "checklist", content, businessName: "Maya's Studio" });
    expect(canva).toContain("PAGE 1 — COVER");
    expect(canva).toContain("PAGE 2 — THE LIST");
    expect(canva).toContain("Brand: Maya's Studio.");
  });
  it("the tracked link opens what the client nominated, and a format that is off is never the target", () => {
    const url = (k: string) => `/files/${k}`;
    const base = { slug: "s", pdfKey: "public/magnets/ws/id-s.pdf", fileKey: null, formats: { page: true, pdf: true, copy: false, canva: false } } as const;
    expect(primaryTarget({ ...base, primary: "page" }, url)).toBe("/m/s");
    expect(primaryTarget({ ...base, primary: "pdf" }, url)).toBe("/files/public/magnets/ws/id-s.pdf");
    expect(primaryTarget({ ...base, primary: "pdf", formats: { ...base.formats, pdf: false } }, url)).toBe("/m/s");
    expect(primaryTarget({ ...base, primary: "page", formats: { ...base.formats, page: false } }, url)).toBe("/files/public/magnets/ws/id-s.pdf");
    expect(primaryTarget({ ...base, primary: "page", pdfKey: null, formats: { page: false, pdf: false, copy: true, canva: false } }, url)).toBeNull();
    expect(primaryTarget({ ...base, primary: "file", fileKey: "public/magnets/ws/id-c.png" }, url)).toBe("/files/public/magnets/ws/id-c.png");
  });
  it("the DM and the chatbot answer end in a question: a warning, never a block", () => {
    expect(endsWithQuestion("Here it is. What are you working on right now?")).toBe(true);
    expect(endsWithQuestion('Here it is. "What next?"')).toBe(true);
    expect(endsWithQuestion("Here it is, enjoy.")).toBe(false);
    expect(endsWithQuestion("")).toBe(false);
    expect(QUESTION_WARNING).toMatch(/nothing to do next/);
  });
  it("the pathway's lead magnet task links to the section and shows the count, never ticking itself", () => {
    expect(SECTION_TASKS.recA3OidbU8gUYW8x.href).toBe("/magnets");
    expect(sectionCountLine("recA3OidbU8gUYW8x", 0)).toBe("You have no lead magnets yet.");
    expect(sectionCountLine("recA3OidbU8gUYW8x", 1)).toBe("You have 1 lead magnet.");
    expect(sectionCountLine("recA3OidbU8gUYW8x", 2)).toBe("You have 2 lead magnets.");
    expect(sectionCountLine("rec-other", 2)).toBeNull();
    const pathway = readFileSync(join(SRC, "lib", "engine", "pathway.ts"), "utf8");
    expect(pathway).not.toMatch(/recA3OidbU8gUYW8x.*done:/);
  });
  it("what the model returns is parsed and a blacklisted claim comes out of every string, with a note", () => {
    const g = parseGenerated(`Here you go: ${JSON.stringify({ intro: "Hi.", sections: [{ heading: "The list", items: ["Write the hook first.", "It takes 21 days to form a habit, so start today."] }], closing: "Bye.", personalReply: "Sent.", personalDm: "Here.", chatbotAnswer: "Yes.", chatbotDelivery: "Link.", chatbotQuestions: ["One?", "Two?", "3", "4", "5", "6"] })}`);
    expect(g).not.toBeNull();
    expect(g!.content.sections[0].items).toEqual(["Write the hook first."]);
    expect(g!.note).toMatch(/came out of the draft/);
    expect(g!.chatbotQuestions).toHaveLength(5);
    expect(parseGenerated("not json")).toBeNull();
    expect(parseGenerated(JSON.stringify({ intro: "x", sections: [] }))).toBeNull();
  });
});
