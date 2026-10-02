import { describe, expect, it } from "vitest";
import { DECK_IMAGE_MAX_BYTES, NO_PEOPLE, consentRecord, consentRequired, consentSatisfied, deckImageKey, deckImageRefusal, deckImageSniff, deckKeyOwner } from "../deck-image";
import { DECK_IMAGE_KINDS } from "@/db/schema";

const bytesOf = (...b: number[]) => new Uint8Array(b);
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const GIF = new Uint8Array([...Array.from("GIF89a").map((c) => c.charCodeAt(0)), 0, 0]);
const WEBP = new Uint8Array([...Array.from("RIFF").map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...Array.from("WEBP").map((c) => c.charCodeAt(0))]);
const svg = new Uint8Array(Array.from("<svg xmlns='...'>").map((c) => c.charCodeAt(0)));
const html = new Uint8Array(Array.from("<!DOCTYPE html>").map((c) => c.charCodeAt(0)));

describe("deck image, the pure rules", () => {
  it("a key lands under the coach's own deck folder, and its owner reads back off the key", () => {
    const key = deckImageKey("ws1", "u1", "abc-123", "PNG");
    expect(key).toBe("deck/ws1/u1/abc-123.png");
    expect(deckKeyOwner(key)).toEqual({ workspaceId: "ws1", userId: "u1" });
  });

  it("a key that is not a deck key, or that reaches up a level, has no owner", () => {
    expect(deckKeyOwner("proofs/ws1/p1/x.jpg")).toBeNull();
    expect(deckKeyOwner("deck/ws1/x.png")).toBeNull(); // no user segment
    expect(deckKeyOwner("deck/ws1/u1/../other/x.png")).toBeNull(); // the file segment can hold no slash
  });

  it("only a screenshot or a proof affirms consent; a photo, logo, graphic or diagram does not", () => {
    expect(consentRequired("screenshot")).toBe(true);
    expect(consentRequired("proof")).toBe(true);
    expect(consentRequired("photo")).toBe(false);
    expect(consentRequired("logo")).toBe(false);
    expect(consentRequired("graphic")).toBe(false);
    expect(consentRequired("diagram")).toBe(false);
    expect(DECK_IMAGE_KINDS).toEqual(["photo", "screenshot", "proof", "logo", "graphic", "diagram"]);
  });

  it("§5: a screenshot is satisfied by the tick with a name, or by the word that no people are in it, never by the tick alone", () => {
    expect(consentSatisfied("screenshot", true, "Dana R.", false)).toBe(true);
    expect(consentSatisfied("screenshot", false, "", true)).toBe(true);
    expect(consentSatisfied("screenshot", true, "  ", false)).toBe(false);
    expect(consentSatisfied("screenshot", false, "Dana R.", false)).toBe(false);
    expect(consentSatisfied("proof", false, "", false)).toBe(false);
    expect(consentSatisfied("diagram", false, "", false)).toBe(true);
    expect(consentSatisfied("graphic", false, "", false)).toBe(true);
  });

  it("§5: what is stored: nothing for a photo; the name, or No people in this, with the time, for a screenshot", () => {
    expect(consentRecord("photo", "x", true, "2026-10-02T10:00:00.000Z")).toEqual({ consentTick: false, consentName: null, consentAt: null });
    expect(consentRecord("screenshot", " Dana R. ", false, "2026-10-02T10:00:00.000Z")).toEqual({ consentTick: true, consentName: "Dana R.", consentAt: "2026-10-02T10:00:00.000Z" });
    expect(consentRecord("proof", "ignored", true, "2026-10-02T10:00:00.000Z")).toEqual({ consentTick: true, consentName: NO_PEOPLE, consentAt: "2026-10-02T10:00:00.000Z" });
  });

  it("sniffs the four raster types by their bytes, not their name", () => {
    expect(deckImageSniff(PNG)?.mime).toBe("image/png");
    expect(deckImageSniff(JPEG)?.mime).toBe("image/jpeg");
    expect(deckImageSniff(GIF)?.mime).toBe("image/gif");
    expect(deckImageSniff(WEBP)?.mime).toBe("image/webp");
  });

  it("refuses a web page or a vector graphic disguised as an image", () => {
    expect(deckImageSniff(svg)).toBeNull();
    expect(deckImageSniff(html)).toBeNull();
    expect(deckImageRefusal(svg, 100)).toEqual({ error: expect.stringContaining("isn't an image") });
  });

  it("refuses a real image that is over the cap, and accepts one under it", () => {
    expect(deckImageRefusal(PNG, DECK_IMAGE_MAX_BYTES + 1)).toEqual({ error: expect.stringContaining("over") });
    expect(deckImageRefusal(PNG, 1000)).toEqual({ sniffed: { mime: "image/png", ext: "png" } });
  });
});
