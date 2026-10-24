import { describe, expect, it } from "vitest";
import { chunkBounds, cleanTranscript, fileNotes, heardAlmostNothing, parseManifest, pickTier, reelVideoKey, reelVideoKeyOwner, sizeLabel, smallerTier, sniffReelVideo, spokenWords, REEL_VIDEO_MAX_BYTES } from "../reel-listen";
import { reelModelsOrigin, reelModelsUrl } from "@/lib/reel-models";

const manifest = { runtime: "runtime/", models: "models/", tiers: { small: { model: "onnx-community/whisper-small.en", bytes: 250_000_000 }, base: { model: "onnx-community/whisper-base.en", bytes: 80_000_000 }, tiny: { model: "onnx-community/whisper-tiny.en", bytes: 41_000_000 } } };

describe("Reel to Post PR B: listening on the device (H-1948)", () => {
  it("picks the model by device: small with WebGPU on a computer, base on a phone, tiny on a small phone (note 3)", () => {
    expect(pickTier({ webgpu: true, mobile: false, memoryGb: 16 })).toBe("small");
    expect(pickTier({ webgpu: false, mobile: false, memoryGb: null })).toBe("base");
    expect(pickTier({ webgpu: true, mobile: true, memoryGb: 8 })).toBe("base");
    expect(pickTier({ webgpu: false, mobile: true, memoryGb: 2 })).toBe("tiny");
    expect(pickTier({ webgpu: true, mobile: false, memoryGb: 16 }, ["base", "tiny"])).toBe("base");
    expect(pickTier({ webgpu: false, mobile: false, memoryGb: null }, ["tiny"])).toBe("tiny");
    expect(smallerTier("small", ["small", "base", "tiny"])).toBe("base");
    expect(smallerTier("base", ["small", "tiny"])).toBe("tiny");
    expect(smallerTier("tiny", ["small", "base", "tiny"])).toBeNull();
  });

  it("reads the store's manifest, and refuses one that points outside the store or names no tiny model", () => {
    expect(parseManifest(manifest)?.tiers.small?.model).toBe("onnx-community/whisper-small.en");
    expect(parseManifest({ ...manifest, runtime: "runtime" })?.runtime).toBe("runtime/");
    expect(parseManifest({ ...manifest, runtime: "../x/" })).toBeNull();
    expect(parseManifest({ ...manifest, models: "https://elsewhere.example/" })).toBeNull();
    expect(parseManifest({ ...manifest, tiers: { base: manifest.tiers.base } })).toBeNull();
    expect(parseManifest({ ...manifest, tiers: { tiny: { model: "../../evil", bytes: 1 } } })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ ...manifest, options: { language: "english", n: 3 } })?.options).toEqual({ language: "english" });
  });

  it("says the download size in plain words", () => {
    expect(sizeLabel(41_000_000)).toBe("about 40 MB");
    expect(sizeLabel(247_000_000)).toBe("about 250 MB");
    expect(sizeLabel(4_200_000)).toBe("about 4 MB");
  });

  it("cuts long sound into pieces of at most 30 seconds, at the quietest moment near the end of each", () => {
    const rate = 16_000;
    const loud = (secs: number) => Float32Array.from({ length: secs * rate }, (_, i) => Math.sin(i / 3) * 0.5);
    const s = loud(70);
    // A quiet tenth of a second at 27 s: the first cut lands there.
    s.fill(0, 27 * rate, 27 * rate + rate / 10);
    const b = chunkBounds(s, rate, 30);
    expect(b[0][0]).toBe(0);
    expect(Math.abs(b[0][1] - (27 * rate + rate / 20))).toBeLessThan(rate / 10);
    expect(b.every(([a, z]) => z - a <= 30 * rate)).toBe(true);
    expect(b.at(-1)![1]).toBe(s.length);
    for (let i = 1; i < b.length; i++) expect(b[i][0]).toBe(b[i - 1][1]);
    expect(chunkBounds(loud(12), rate)).toEqual([[0, 12 * rate]]);
    expect(chunkBounds(new Float32Array(0), rate)).toEqual([]);
  });

  it("knows a reel with almost no talking (test case 3), not counting [Music] and notes", () => {
    expect(spokenWords("[Music] ♪ (applause) Okay so")).toEqual(["Okay", "so"]);
    expect(heardAlmostNothing("[Music] [Music] ♪", 30)).toBe(true);
    expect(heardAlmostNothing("You", 20)).toBe(true);
    expect(heardAlmostNothing("I used to plan every Sunday and by Tuesday the whole plan was gone again", 30)).toBe(false);
    expect(heardAlmostNothing("I used to plan every Sunday and by Tuesday the plan was gone", 240)).toBe(true);
    expect(cleanTranscript(" [Music] Hello , world . (laughs)  Yes ")).toBe("Hello, world. Yes");
  });

  it("knows an MP4 and a QuickTime file by their first bytes, and nothing else", () => {
    const head = (tag: string, brand: string) => Uint8Array.from([0, 0, 0, 0x20, ...Buffer.from(tag), ...Buffer.from(brand), 0, 0, 0, 0]);
    expect(sniffReelVideo(head("ftyp", "isom"))).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(sniffReelVideo(head("ftyp", "qt  "))).toEqual({ mime: "video/quicktime", ext: "mov" });
    expect(sniffReelVideo(head("ftyp", "M4V "))).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(sniffReelVideo(head("moov", "xxxx"))).toEqual({ mime: "video/quicktime", ext: "mov" });
    expect(sniffReelVideo(Uint8Array.from(Buffer.from("%PDF-1.7 something long")))).toBeNull();
    expect(sniffReelVideo(new Uint8Array(4))).toBeNull();
  });

  it("keeps a video under the member's own folder, and reads the owner back from the key", () => {
    const k = reelVideoKey("ws1", "u-1", "0f8e-11", "mov");
    expect(k).toBe("reels/ws1/u-1/0f8e-11.mov");
    expect(reelVideoKeyOwner(k)).toEqual({ workspaceId: "ws1", userId: "u-1", videoId: "0f8e-11" });
    expect(reelVideoKeyOwner("reels/ws1/u-1/../x.mov")).toBeNull();
    expect(reelVideoKeyOwner("reels/ws1/x.mov")).toBeNull();
    expect(reelVideoKeyOwner("proofs/ws1/u/x.mp4")).toBeNull();
    expect(reelVideoKeyOwner("reels/ws1/u/x.exe")).toBeNull();
  });

  it("says when a video is too long to listen to or too large to attach", () => {
    expect(fileNotes({ bytes: 10, seconds: 601 })).toEqual({ tooLong: true, tooLargeToAttach: false });
    expect(fileNotes({ bytes: REEL_VIDEO_MAX_BYTES + 1, seconds: 30 })).toEqual({ tooLong: false, tooLargeToAttach: true });
    expect(fileNotes({ bytes: 10, seconds: null })).toEqual({ tooLong: false, tooLargeToAttach: false });
  });

  it("takes the model store's address only over https (http on this machine for walks)", () => {
    expect(reelModelsUrl({ REEL_MODELS_URL: "https://abc.public.blob.vercel-storage.com/reel-models/v1" })).toBe("https://abc.public.blob.vercel-storage.com/reel-models/v1/");
    expect(reelModelsOrigin({ REEL_MODELS_URL: "https://abc.public.blob.vercel-storage.com/reel-models/v1/" })).toBe("https://abc.public.blob.vercel-storage.com");
    expect(reelModelsUrl({ REEL_MODELS_URL: "http://localhost:4095/", NODE_ENV: "development" })).toBe("http://localhost:4095/");
    expect(reelModelsUrl({ REEL_MODELS_URL: "http://localhost:4095/", NODE_ENV: "production" })).toBeNull();
    expect(reelModelsUrl({ REEL_MODELS_URL: "http://models.example.com/" })).toBeNull();
    expect(reelModelsUrl({ REEL_MODELS_URL: "not a url" })).toBeNull();
    expect(reelModelsUrl({})).toBeNull();
  });
});
