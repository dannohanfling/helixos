/**
 * Reel to Post, PR B (H-1948, plan H-1953): the rules for listening to a reel on the member's own device and for the video
 * they attach. Pure, so it is tested without a browser: which speech model a device gets, where a long reel is cut into the
 * model's 30-second pieces, whether the words heard are too few for the reel's length, and what a reel video may be.
 */

/** A reel longer than this is too long to listen to here (H-1948 step 1). */
export const REEL_MAX_SECONDS = 10 * 60;
/** The largest video a post can carry: the Social Planner's own cap (plan H-1953, Approve H-1959 kept the default). */
export const REEL_VIDEO_MAX_BYTES = 200_000_000;
export const REEL_VIDEO_TYPES = [
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/quicktime", ext: "mov" },
] as const;
export const REEL_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov,.m4v";
/** The speech model hears 16 kHz mono. */
export const SAMPLE_RATE = 16_000;

export type Tier = "small" | "base" | "tiny";
export type TierEntry = { model: string; bytes: number };
/**
 * The model store's own description of itself, written by scripts/reel-models.ts when the models are uploaded: where the
 * runtime and the models sit under the store's address, each tier's model and its real download size, and any options the
 * model needs (a multilingual model is told the language).
 */
export type ReelModelManifest = {
  runtime: string;
  models: string;
  tiers: Partial<Record<Tier, TierEntry>> & { tiny: TierEntry };
  options?: Record<string, string>;
};

/** A manifest read from the store, or null when it isn't one: the page then offers paste only. */
export function parseManifest(raw: unknown): ReelModelManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const tiers = m.tiers as Record<string, unknown> | undefined;
  const ok = (t: unknown): t is TierEntry => Boolean(t && typeof t === "object" && typeof (t as TierEntry).model === "string" && /^[\w.-]+\/[\w.-]+$/.test((t as TierEntry).model) && Number.isFinite((t as TierEntry).bytes));
  if (typeof m.runtime !== "string" || typeof m.models !== "string" || !tiers || !ok(tiers.tiny)) return null;
  const rel = (p: string) => /^[\w./-]*$/.test(p) && !p.includes("..") && !p.startsWith("/");
  if (!rel(m.runtime) || !rel(m.models)) return null;
  const out: ReelModelManifest = { runtime: m.runtime.replace(/\/?$/, "/"), models: m.models.replace(/\/?$/, "/"), tiers: { tiny: tiers.tiny } };
  if (ok(tiers.base)) out.tiers.base = tiers.base;
  if (ok(tiers.small)) out.tiers.small = tiers.small;
  if (m.options && typeof m.options === "object") out.options = Object.fromEntries(Object.entries(m.options as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  return out;
}

/**
 * Which model a device gets (Scriba's note 3): a computer with WebGPU gets the small model, a phone the base model, and a
 * phone that says it has under 4 GB of memory the tiny one. A tier the store doesn't carry steps down.
 */
export function pickTier(d: { webgpu: boolean; mobile: boolean; memoryGb: number | null }, available: Tier[] = ["small", "base", "tiny"]): Tier {
  const want: Tier = d.mobile ? (d.memoryGb !== null && d.memoryGb < 4 ? "tiny" : "base") : d.webgpu ? "small" : "base";
  const order: Tier[] = ["small", "base", "tiny"];
  return order.slice(order.indexOf(want)).find((t) => available.includes(t)) ?? "tiny";
}

/** The next tier down after one that failed to load or run, or null after the tiny one. */
export const smallerTier = (t: Tier, available: Tier[]): Tier | null => (["small", "base", "tiny"] as Tier[]).slice((["small", "base", "tiny"] as Tier[]).indexOf(t) + 1).find((x) => available.includes(x)) ?? null;

/** "about 80 MB": the download size people see before the first run. */
export function sizeLabel(bytes: number): string {
  const mbs = bytes / 1_000_000;
  return mbs >= 10 ? `about ${Math.round(mbs / 10) * 10} MB` : `about ${Math.max(1, Math.round(mbs))} MB`;
}

/**
 * Where to cut the sound into pieces of at most `maxSeconds` (the model hears 30 seconds at a time). Each cut lands in the
 * quietest tenth of a second within the last 6 seconds of the piece, so a word is rarely split in two.
 */
export function chunkBounds(samples: ArrayLike<number>, rate = SAMPLE_RATE, maxSeconds = 30): [number, number][] {
  const n = samples.length;
  const max = Math.floor(maxSeconds * rate);
  const window = Math.floor(rate / 10);
  const out: [number, number][] = [];
  let start = 0;
  while (start < n) {
    if (n - start <= max) {
      out.push([start, n]);
      break;
    }
    let best = start + max;
    let bestEnergy = Infinity;
    for (let w = start + max - 6 * rate; w + window <= start + max; w += window) {
      let e = 0;
      for (let i = w; i < w + window; i++) e += samples[i] * samples[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = w + Math.floor(window / 2);
      }
    }
    out.push([start, best]);
    start = best;
  }
  return out;
}

/** The words a listener would count: without "[Music]", "(applause)" and music notes, which Whisper writes for sound that isn't speech. */
export function spokenWords(text: string): string[] {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, " ")
    .split(/\s+/)
    .filter((w) => /[a-z]{2,}/i.test(w));
}

/**
 * Too few words for the reel's length (H-1948 test case 3): music only, or a reel with no talking. Under 15 words a minute,
 * and under 8 words at all for a short one, means show the "describe what's on screen" box.
 */
export function heardAlmostNothing(text: string, seconds: number): boolean {
  const words = spokenWords(text).length;
  return words < Math.max(8, (seconds / 60) * 15);
}

/** The words as written into the transcript box: the non-speech markers dropped, the spacing tidied. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A video's type from its first bytes: an MP4 or QuickTime file carries "ftyp" at byte 4. Null when it's neither. */
export function sniffReelVideo(head: Uint8Array): { mime: "video/mp4" | "video/quicktime"; ext: "mp4" | "mov" } | null {
  if (head.length < 12) return null;
  const tag = String.fromCharCode(...head.slice(4, 8));
  if (tag !== "ftyp" && tag !== "moov" && tag !== "wide" && tag !== "mdat") return null;
  const brand = tag === "ftyp" ? String.fromCharCode(...head.slice(8, 12)) : "qt  ";
  return brand === "qt  " ? { mime: "video/quicktime", ext: "mov" } : { mime: "video/mp4", ext: "mp4" };
}

/** Where a member's reel video is kept in the private store: under their workspace and their own folder, so erasing them finds it. */
export const reelVideoKey = (workspaceId: string, userId: string, videoId: string, ext: string): string => `reels/${workspaceId}/${userId}/${videoId}.${ext}`;
/** The workspace and member a reel video key belongs to, or null when the key isn't one. */
export function reelVideoKeyOwner(key: string): { workspaceId: string; userId: string; videoId: string } | null {
  const m = key.match(/^reels\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.(mp4|mov)$/);
  return m ? { workspaceId: m[1], userId: m[2], videoId: m[3] } : null;
}

/** What the picker says about a file before anything happens to it: too long to listen to, or too large to attach. */
export function fileNotes(f: { bytes: number; seconds: number | null }): { tooLong: boolean; tooLargeToAttach: boolean } {
  return { tooLong: f.seconds !== null && f.seconds > REEL_MAX_SECONDS + 0.5, tooLargeToAttach: f.bytes > REEL_VIDEO_MAX_BYTES };
}
