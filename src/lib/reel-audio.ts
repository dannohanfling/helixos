/**
 * Reel to Post, PR B (H-1948, plan H-1953): the reel's sound, read on the member's own device. Nothing here sends anything
 * anywhere. The usual way is the browser's own decoder (decodeAudioData), resampled to 16 kHz mono for the speech model. A
 * file the decoder can't open but the video player can (an iPhone .mov in some browsers) is played, silently and at double
 * speed, and its sound captured as it plays: slower, but it needs nothing downloaded. Browser-only.
 */
import { SAMPLE_RATE } from "@/lib/engine/reel-listen";

/** The video's length in seconds from the player's own metadata, or null when the player can't read it. */
export function mediaSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (s: number | null) => {
      URL.revokeObjectURL(url);
      resolve(s);
    };
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

type Ctx = typeof AudioContext;
const AudioCtx = (): Ctx => (window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctx }).webkitAudioContext) as Ctx;

/** Any decoded sound to 16 kHz mono: the channels mixed by the offline renderer, which resamples as it goes. */
async function toMono16k(decoded: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

/** The browser's decoder. Throws when it can't open the file. */
async function decode(file: File): Promise<Float32Array> {
  const Ctor = AudioCtx();
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return await toMono16k(decoded);
  } finally {
    void ctx.close();
  }
}

/**
 * The fallback: plays the video muted to the speakers at double speed and records what the player hears, then resamples it.
 * `onProgress` gets 0 to 1 as it plays.
 */
async function captureByPlaying(file: File, onProgress: (f: number) => void): Promise<Float32Array> {
  const Ctor = AudioCtx();
  const ctx = new Ctor();
  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.src = url;
  el.playsInline = true;
  el.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error("the player can't open this file"));
    });
    const source = ctx.createMediaElementSource(el);
    // Captured into a buffer through a processor; the gain at zero keeps the speakers quiet while the graph still runs.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const quiet = ctx.createGain();
    quiet.gain.value = 0;
    const parts: Float32Array[] = [];
    proc.onaudioprocess = (e) => {
      parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      if (el.duration) onProgress(Math.min(1, el.currentTime / el.duration));
    };
    source.connect(proc);
    proc.connect(quiet);
    quiet.connect(ctx.destination);
    el.playbackRate = 2;
    await ctx.resume();
    await el.play();
    await new Promise<void>((resolve, reject) => {
      el.onended = () => resolve();
      el.onerror = () => reject(new Error("the player stopped"));
    });
    proc.disconnect();
    const total = parts.reduce((n, p) => n + p.length, 0);
    const raw = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      raw.set(p, at);
      at += p.length;
    }
    // Played at double speed, the captured sound runs at twice the context's rate: rendered back at the true rate.
    const buf = new AudioBuffer({ length: Math.max(1, raw.length), numberOfChannels: 1, sampleRate: ctx.sampleRate / 2 });
    buf.copyToChannel(raw, 0);
    return await toMono16k(buf);
  } finally {
    URL.revokeObjectURL(url);
    void ctx.close();
  }
}

/** The reel's sound as 16 kHz mono, by decoding, or by playing it when decoding fails. Which way it went is reported. */
export async function reelSound(file: File, onProgress: (f: number) => void = () => {}): Promise<{ samples: Float32Array; how: "decoded" | "played" }> {
  try {
    return { samples: await decode(file), how: "decoded" };
  } catch {
    return { samples: await captureByPlaying(file, onProgress), how: "played" };
  }
}

/** What the device offers the speech model: WebGPU, a phone, and its memory when the browser says. */
export async function deviceFacts(): Promise<{ webgpu: boolean; mobile: boolean; memoryGb: number | null }> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> }; deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  let webgpu = false;
  try {
    webgpu = Boolean(nav.gpu && (await nav.gpu.requestAdapter()));
  } catch {
    webgpu = false;
  }
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  return { webgpu, mobile, memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null };
}

/** Whether this browser already keeps a model's files (Transformers.js keeps them in its own cache), so no download is shown. */
export async function modelKept(modelsUrl: string, model: string): Promise<boolean> {
  try {
    if (!("caches" in window)) return false;
    const cache = await caches.open("transformers-cache");
    return Boolean(await cache.match(`${modelsUrl}${model}/config.json`));
  } catch {
    return false;
  }
}
