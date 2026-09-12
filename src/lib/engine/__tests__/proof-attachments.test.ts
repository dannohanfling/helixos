import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTED, ACCEPT_ATTRIBUTE, DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, MAX_PER_PROOF, OWN_SCREEN_TICK, PERSON_QUESTION, RESULT_QUESTION, VIDEO_MAX_BYTES, WORKSPACE_QUOTA_BYTES, admission, attachmentsBlockApproval, cleanFilename, consentAnswered, contentDisposition, displayKeyFor, likenessSentence, looksLikeMarkup, mb, moveFirst, needsOwnScreenTick, parseRecordInput, proofKey, proofKeyWorkspace, quotaState, refusal, sniff } from "../proof-attachments";

const SRC = join(__dirname, "..", "..", "..");
const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? Array.from(p).map((c) => c.charCodeAt(0)) : p)));
// [size][ftyp][major brand][minor version][compatible brands...], as every real file is laid out.
const box = (brands: string[]) => bytes([0, 0, 0, 16 + 4 * (brands.length - 1)], "ftyp", brands[0], [0, 0, 0, 0], ...brands.slice(1));

describe("proof attachments: what a file is, from its bytes", () => {
  it("sniffs the eight accepted types and nothing the browser said", () => {
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(sniff(bytes("RIFF", [0, 0, 0, 0], "WEBP"))?.mime).toBe("image/webp");
    expect(sniff(bytes("%PDF-1.7"))?.kind).toBe("document");
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.mime).toBe("video/webm");
    expect(sniff(box(["heic", "mif1"]))).toEqual({ kind: "image", mime: "image/heic", ext: "heic", heic: true });
    expect(sniff(box(["mif1", "heic"]))?.heic).toBe(true);
    // The minor-version bytes are never read as a brand, and a video naming a HEIC brand among its compatible brands is a video.
    expect(sniff(bytes([0, 0, 0, 20], "ftyp", "isom", "heic", "mp42"))?.mime).toBe("video/mp4");
    expect(sniff(bytes([0, 0, 0, 24], "ftyp", "isom", [0, 0, 2, 0], "isom", "heic"))?.mime).toBe("video/mp4");
    expect(sniff(box(["qt  "]))?.mime).toBe("video/quicktime");
    expect(sniff(box(["isom", "iso2", "avc1", "mp41"]))?.mime).toBe("video/mp4");
    expect(sniff(bytes("GIF89a"))).toBeNull();
    expect(sniff(bytes("<svg xmlns"))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });
  it("refuses markup outright, whatever it is called", () => {
    expect(looksLikeMarkup(bytes('<?xml version="1.0"?><svg'))).toBe(true);
    expect(looksLikeMarkup(bytes("  \n<svg xmlns='http://www.w3.org/2000/svg'>"))).toBe(true);
    expect(looksLikeMarkup(bytes("<!DOCTYPE html><html>"))).toBe(true);
    expect(looksLikeMarkup(bytes([0xff, 0xd8, 0xff]))).toBe(false);
    const r = refusal(bytes("<svg>"), 10);
    expect("error" in r && r.error).toMatch(/web page or a vector graphic/);
  });
  it("caps by the sniffed kind, and the sentence names the cap from the constant", () => {
    expect(refusal(bytes([0xff, 0xd8, 0xff]), IMAGE_MAX_BYTES)).toHaveProperty("sniffed");
    const over = refusal(bytes([0xff, 0xd8, 0xff]), IMAGE_MAX_BYTES + 1);
    expect("error" in over && over.error).toContain(mb(IMAGE_MAX_BYTES));
    expect("error" in refusal(box(["isom"]), VIDEO_MAX_BYTES + 1)).toBe(true);
    expect("error" in refusal(bytes("%PDF-"), DOCUMENT_MAX_BYTES + 1)).toBe(true);
    expect(VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(ACCEPT_ATTRIBUTE).toContain("image/heic");
    expect(ACCEPT_ATTRIBUTE).not.toContain("svg");
    expect(ACCEPTED.some((a) => a.mime.includes("svg"))).toBe(false);
  });
});

describe("proof attachments: the two questions and the consent they trigger", () => {
  it("the questions and the tick are the brief's words", () => {
    expect(RESULT_QUESTION).toBe("Does this show a result — money, weight, followers, or any number someone could read as a promise?");
    expect(PERSON_QUESTION).toBe("Is an identifiable person in this file?");
    expect(OWN_SCREEN_TICK).toBe("This is my own screen. Any other person's name, email or photo in it has been removed, or I have their permission.");
    expect(likenessSentence("Maya T.", "image")).toBe("Maya T. has given me permission to use this photo of them in my marketing.");
    expect(likenessSentence("Maya T.", "video")).toBe("Maya T. has given me permission to use this video of them in my marketing.");
    expect(likenessSentence("", "document")).toBe("[Name] has given me permission to use this document of them in my marketing.");
    expect(needsOwnScreenTick("image")).toBe(true);
    expect(needsOwnScreenTick("document")).toBe(true);
    expect(needsOwnScreenTick("video")).toBe(false);
  });
  it("the approval gate, extended: a person without recorded permission holds the proof; no person needs nothing", () => {
    expect(consentAnswered({ showsAPerson: false, consentRecordedAt: null, consentName: null })).toBe(true);
    expect(consentAnswered({ showsAPerson: true, consentRecordedAt: null, consentName: null })).toBe(false);
    expect(consentAnswered({ showsAPerson: true, consentRecordedAt: "2026-09-11T00:00:00Z", consentName: " " })).toBe(false);
    expect(consentAnswered({ showsAPerson: true, consentRecordedAt: "2026-09-11T00:00:00Z", consentName: "Maya T." })).toBe(true);
    expect(attachmentsBlockApproval([])).toBeNull();
    expect(attachmentsBlockApproval([{ showsAPerson: true, consentRecordedAt: null, consentName: null }])).toMatch(/^One attachment shows a person/);
    expect(attachmentsBlockApproval([{ showsAPerson: true, consentRecordedAt: null, consentName: null }, { showsAPerson: true, consentRecordedAt: null, consentName: "" }])).toMatch(/^2 attachments/);
  });
});

describe("proof attachments: quota, count and keys", () => {
  it("2 GB to start, warns at 80%, blocks at 100% with the number named", () => {
    expect(WORKSPACE_QUOTA_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(quotaState(0).line).toBe("0 KB of 2 GB used.");
    const warn = quotaState(Math.ceil(WORKSPACE_QUOTA_BYTES * 0.8));
    expect(warn.warn).toBe(true);
    expect(warn.blocked).toBe(false);
    expect(warn.line).toMatch(/^Storage is 80% used/);
    const full = quotaState(WORKSPACE_QUOTA_BYTES);
    expect(full.blocked).toBe(true);
    expect(full.line).toContain("2 GB of 2 GB");
    expect(admission(0, 1, MAX_PER_PROOF)).toMatch(/up to 10 attachments/);
    expect(admission(WORKSPACE_QUOTA_BYTES - 5, 10, 0)).toMatch(/past 2 GB/);
    expect(admission(0, 10, 0)).toBeNull();
  });
  it("keys sit in the client's own tree, never a file name or a person's name; the display rendition sits beside the original", () => {
    expect(proofKey("ws1", "p1", "u1", "heic")).toBe("proofs/ws1/p1/u1.heic");
    expect(displayKeyFor("proofs/ws1/p1/u1.heic")).toBe("proofs/ws1/p1/u1-display.jpg");
    expect(proofKeyWorkspace("proofs/ws1/p1/u1.jpg")).toBe("ws1");
    expect(proofKeyWorkspace("proofs/ws1/p1/u1.jpg/extra")).toBeNull();
    expect(proofKeyWorkspace("public/magnets/x/y.pdf")).toBeNull();
    expect(proofKeyWorkspace("proofs/../ws1/p1/u1.jpg")).toBeNull();
    expect(() => proofKey("ws/1", "p1", "u1", "jpg")).toThrow();
    expect(() => proofKey("ws1", "p1", "u1", "JPG!")).toThrow();
  });
  it("a file's name is kept for the client and made safe for a header; nothing the browser sends is trusted as a type", () => {
    expect(cleanFilename("C:\\Users\\dana\\Dana’s screenshot.png", "image.png")).toBe("Dana’s screenshot.png");
    expect(cleanFilename("../../\u0000x\"y.png", "image.png")).toBe("xy.png");
    expect(cleanFilename("   ", "image.png")).toBe("image.png");
    expect(contentDisposition("Dana’s screenshot.png", false)).toBe(`inline; filename="Dana_s screenshot.png"; filename*=UTF-8''${encodeURIComponent("Dana’s screenshot.png")}`);
    expect(contentDisposition("📸.png", true)).toMatch(/^attachment; filename="_+\.png"; filename\*=UTF-8''/);
    // RFC 5987: the apostrophe is the delimiter, and ( ) * are not attr-chars; each is escaped.
    expect(contentDisposition("Dana's (win)*.png", false)).toBe(`inline; filename="Dana's (win)*.png"; filename*=UTF-8''Dana%27s%20%28win%29%2A.png`);
    expect(contentDisposition("写真.png", false)).toContain("filename*=UTF-8''%E5%86%99%E7%9C%9F.png");
    const ok = parseRecordInput({ proofId: "p", key: "k", originalFilename: "f.png", showsAResult: true, showsAPerson: false, ownScreen: true, consentTick: false, consentName: null, altText: undefined, width: 99999999, height: 2, durationSeconds: -1 });
    expect(ok).toEqual({ proofId: "p", key: "k", originalFilename: "f.png", showsAResult: true, showsAPerson: false, ownScreen: true, consentTick: false, consentName: "", altText: "", width: null, height: 2, durationSeconds: null });
    expect(parseRecordInput({ proofId: "p", key: 123, originalFilename: "f", showsAResult: true, showsAPerson: false, ownScreen: true, consentTick: false })).toBeNull();
    expect(parseRecordInput({ proofId: "p", key: "k", originalFilename: null, showsAResult: true, showsAPerson: false, ownScreen: true, consentTick: false })).toBeNull();
    expect(parseRecordInput(null)).toBeNull();
  });
  it("the first attachment is the thumbnail; moving one first is the whole ordering feature", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveFirst(items, "c").map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(moveFirst(items, "a")).toBe(items);
    expect(moveFirst(items, "zz")).toBe(items);
  });
});

describe("proof attachments: two stores, and the private one's token is explicit on every call", () => {
  // Code only: the module's own comment names the public token to say why it must never be used.
  const proofStorage = readFileSync(join(SRC, "lib", "proof-storage.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  it("every SDK call in the private store's module carries the proof token, and the public token is never named there", () => {
    const calls = proofStorage.match(/\b(put|del|head|list)\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c, c).toMatch(/token:\s*proofToken\(\)/);
    expect(proofStorage).not.toMatch(/(?<!PROOF_)\bBLOB_READ_WRITE_TOKEN\b/);
    expect(proofStorage).toMatch(/process\.env\.PROOF_BLOB_READ_WRITE_TOKEN/);
    expect(proofStorage).toMatch(/access:\s*"private"/);
    expect(proofStorage).not.toMatch(/access:\s*"public"/);
    // The authenticated read carries the token too, and never asks for a cache.
    expect(proofStorage).toMatch(/authorization: `Bearer \$\{proofToken\(\)\}`/);
    expect(proofStorage).toMatch(/cache: "no-store"/);
  });
  it("the browser's door for proofs mints its client token from the proof store's token, explicitly", () => {
    const route = readFileSync(join(SRC, "app", "api", "proofs", "upload", "route.ts"), "utf8");
    expect(route).toMatch(/handleUpload\(\{[\s\S]*\.\.\.proofTokenOptions\(\)/);
    expect(route).not.toMatch(/\bBLOB_READ_WRITE_TOKEN\b/);
  });
  it("the proxy never lists the proof routes as public: a session is required before the handler even runs", () => {
    const proxy = readFileSync(join(SRC, "proxy.ts"), "utf8");
    expect(proxy).not.toMatch(/"\/api\/proofs/);
  });
  it("the read route checks membership in the handler and never lets a CDN cache a private object", () => {
    const route = readFileSync(join(SRC, "app", "api", "proofs", "attachments", "[id]", "route.ts"), "utf8");
    expect(route).toMatch(/getViewer\(\)/);
    expect(route).toMatch(/workspaceId !== v\.workspace\.id/);
    expect(route).toMatch(/"cache-control": "private, no-store"/);
    expect(route).not.toMatch(/max-age/);
  });
});
