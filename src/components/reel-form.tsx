"use client";

/**
 * Reel to Post, PR B (H-1948, plan H-1953): New from a reel, with the video. Choose the reel; "Write it out on this device"
 * listens to it here, in the browser, and puts the words in the box to fix; or paste the words as before. "Attach this video
 * to the post" uploads it to the member's private storage when they press Create post, and only then. The listening model
 * comes from HelixOS's own model store (REEL_MODELS_URL) and is kept by the browser after the first time.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { upload } from "@vercel/blob/client";
import { createReelAction, recordReelVideoAction } from "@/lib/actions/ladders";
import { Field, Progress } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { SubmitButton } from "@/components/submit-button";
import { chunkBounds, cleanTranscript, fileNotes, heardAlmostNothing, parseManifest, pickTier, reelVideoKey, REEL_ACCEPT, REEL_MAX_SECONDS, REEL_VIDEO_MAX_BYTES, sizeLabel, smallerTier, type ReelModelManifest, type Tier } from "@/lib/engine/reel-listen";
import { deviceFacts, mediaSeconds, modelKept, reelSound } from "@/lib/reel-audio";
import { redactUrls } from "@/lib/engine/storage-policy";

type Keyword = { keyword: string; label: string };
type Listen = { phase: "idle" } | { phase: "sound"; pct: number } | { phase: "download"; pct: number } | { phase: "listening"; pct: number } | { phase: "done"; silent: boolean } | { phase: "error"; message: string };

const mbText = (n: number) => `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} MB`;
/** Only a video goes with a post; a sound file can be written out but not attached. */
const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(f.name);
const timeText = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function ReelForm({ keywords, modelsUrl, canAttach, owner, aiStatus, noAiNote }: { keywords: Keyword[]; modelsUrl: string | null; canAttach: boolean; owner: { workspaceId: string; userId: string }; aiStatus: ReactNode; noAiNote: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [manifest, setManifest] = useState<ReelModelManifest | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [device, setDevice] = useState<"webgpu" | "wasm">("wasm");
  const [kept, setKept] = useState(false);
  const [listen, setListen] = useState<Listen>({ phase: "idle" });
  const [transcript, setTranscript] = useState("");
  const [attach, setAttach] = useState(true);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sendAfterUpload = useRef(false);

  // The store's own description: which models it carries and their real sizes. No store, or no answer, means paste only.
  useEffect(() => {
    if (!modelsUrl) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${modelsUrl}manifest.json`, { cache: "no-cache" });
        const m = parseManifest(res.ok ? await res.json() : null);
        if (!m || !live) return;
        const facts = await deviceFacts();
        const t = pickTier(facts, Object.keys(m.tiers) as Tier[]);
        setManifest(m);
        setTier(t);
        setDevice(facts.webgpu && t === "small" ? "webgpu" : "wasm");
        setKept(await modelKept(`${modelsUrl}${m.models}`, m.tiers[t]!.model));
      } catch {
        // No listening on this device; pasting still works.
      }
    })();
    return () => {
      live = false;
    };
  }, [modelsUrl]);

  // A video id recorded for this file is sent with the form; then the form goes.
  useEffect(() => {
    if (videoId && sendAfterUpload.current) {
      sendAfterUpload.current = false;
      formRef.current?.requestSubmit();
    }
  }, [videoId]);

  const choose = async (files: File[]) => {
    const f = files[0] ?? null;
    setFile(f);
    setVideoId("");
    setError(null);
    setListen({ phase: "idle" });
    setSeconds(f ? await mediaSeconds(f) : null);
    if (f) setAttach(canAttach && isVideo(f) && !fileNotes({ bytes: f.size, seconds: null }).tooLargeToAttach);
  };

  const notes = file ? fileNotes({ bytes: file.size, seconds }) : null;
  const canListen = Boolean(file && manifest && tier && modelsUrl && !notes?.tooLong);

  const run = async () => {
    if (!file || !manifest || !tier || !modelsUrl) return;
    setError(null);
    setListen({ phase: "sound", pct: 0 });
    let sound: Float32Array;
    try {
      sound = (await reelSound(file, (f) => setListen({ phase: "sound", pct: Math.round(f * 100) }))).samples;
    } catch {
      setListen({ phase: "error", message: "This video's sound couldn't be read on this device. Paste the words below instead." });
      return;
    }
    const secs = sound.length / 16_000;
    if (secs > REEL_MAX_SECONDS + 0.5) {
      setListen({ phase: "error", message: "This reel is longer than 10 minutes. Paste the words below instead." });
      return;
    }
    const chunks = chunkBounds(sound);
    const available = Object.keys(manifest.tiers) as Tier[];
    const attempt = (t: Tier, dev: "webgpu" | "wasm"): Promise<string> =>
      new Promise((resolve, reject) => {
        const w = new Worker("/reel-listen.worker.js", { type: "module" });
        w.onerror = () => {
          w.terminate();
          reject(new Error("the listener didn't start"));
        };
        w.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; loaded?: number; total?: number; done?: number; text?: string; message?: string };
          if (m.type === "download" && m.total) setListen({ phase: "download", pct: Math.round(((m.loaded ?? 0) / m.total) * 100) });
          else if (m.type === "device") setListen({ phase: "listening", pct: 0 });
          else if (m.type === "chunk" && m.total) setListen({ phase: "listening", pct: Math.round(((m.done ?? 0) / m.total) * 100) });
          else if (m.type === "done") {
            w.terminate();
            resolve(m.text ?? "");
          } else if (m.type === "error") {
            w.terminate();
            reject(new Error(m.message ?? "the listener stopped"));
          }
        };
        const audio = sound.slice();
        w.postMessage({ type: "run", runtimeUrl: `${modelsUrl}${manifest.runtime}`, modelsUrl: `${modelsUrl}${manifest.models}`, model: manifest.tiers[t]!.model, device: dev, options: manifest.options ?? {}, audio, chunks }, [audio.buffer]);
      });
    let t: Tier | null = tier;
    let dev = device;
    while (t) {
      try {
        const raw = await attempt(t, dev);
        const words = cleanTranscript(raw);
        const silent = heardAlmostNothing(words, secs);
        setTranscript(words);
        setListen({ phase: "done", silent });
        // The browser keeps the model now: the next reel says so instead of the download size.
        setKept(await modelKept(`${modelsUrl}${manifest.models}`, manifest.tiers[t]!.model));
        if (silent) textRef.current?.focus();
        return;
      } catch (e) {
        console.error("[reel-listen]", redactUrls(e instanceof Error ? e.message : String(e)).slice(0, 300));
        // A smaller model next, on the plain path: an older phone that ran out of memory still finishes.
        t = smallerTier(t, available);
        dev = "wasm";
        if (t) setTier(t);
      }
    }
    setListen({ phase: "error", message: "Writing it out didn't work on this device. Paste the words below instead." });
  };

  /** Create post: with a video to attach and not yet uploaded, upload and record it first, then send the form with its id. */
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!file || !attach || !canAttach || !isVideo(file) || videoId || notes?.tooLargeToAttach) return;
    e.preventDefault();
    if (!transcript.trim()) {
      textRef.current?.reportValidity();
      return;
    }
    setError(null);
    setUploading(0);
    try {
      const id = crypto.randomUUID();
      const ext = /\.mov$/i.test(file.name) || file.type === "video/quicktime" ? "mov" : "mp4";
      const blob = await upload(reelVideoKey(owner.workspaceId, owner.userId, id, ext), file, { access: "private", contentType: ext === "mov" ? "video/quicktime" : "video/mp4", handleUploadUrl: "/api/reel-videos/upload", multipart: file.size > 20 * 1024 * 1024, onUploadProgress: (p) => setUploading(Math.round(p.percentage)) });
      const r = await recordReelVideoAction({ key: blob.pathname, seconds, filename: file.name });
      setUploading(null);
      if (!r.ok) return setError(r.error);
      sendAfterUpload.current = true;
      setVideoId(r.id);
    } catch (err) {
      console.error("[reel-upload]", redactUrls(err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300));
      setUploading(null);
      setError("The video didn't upload. Untick Attach to create the post without it, or try again in a minute.");
    }
  };

  const busy = listen.phase === "sound" || listen.phase === "download" || listen.phase === "listening";
  const size = manifest && tier ? manifest.tiers[tier]?.bytes ?? 0 : 0;

  return (
    <form ref={formRef} action={createReelAction} onSubmit={onSubmit} className="grid gap-3" data-testid="reel-form">
      <input type="hidden" name="videoId" value={videoId} />
      <section className="grid gap-2 rounded-xl border p-3" data-testid="reel-video">
        <div className="text-sm font-semibold">Your reel&apos;s video (optional)</div>
        <FilePicker kind="file" accept={REEL_ACCEPT} testId="reel-file" labels={{ upload: file ? "Choose another video" : "Choose your reel" }} onChange={choose} hideChosen disabled={busy || uploading !== null} />
        {file ? (
          <p className="text-xs text-ink-2" data-testid="reel-file-chosen">
            {file.name} · {mbText(file.size)}
            {seconds ? ` · ${timeText(seconds)}` : ""}
          </p>
        ) : null}
        {notes?.tooLong ? (
          <p className="rounded-lg bg-warn-soft p-2 text-xs" role="alert" data-testid="reel-too-long">
            This reel is longer than 10 minutes, too long to write out here. Paste the words below instead.
          </p>
        ) : null}
        {file && !manifest ? (
          <p className="text-xs text-ink-3" data-testid="reel-listen-off">
            Writing it out on this device isn&apos;t switched on yet. Paste the words below.
          </p>
        ) : null}
        {canListen ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-soft btn-sm min-h-11!" onClick={run} disabled={busy || uploading !== null} data-testid="reel-listen">
                {listen.phase === "done" ? "Write it out again" : "Write it out on this device"}
              </button>
              <span className="text-xs text-ink-3" data-testid="reel-model-size">
                {kept ? "Ready on this device." : `First time only: downloads the listening model, ${sizeLabel(size)}. Use Wi-Fi.`}
              </span>
            </div>
            {busy ? (
              <div className="grid gap-1" data-testid="reel-listen-progress" aria-live="polite">
                <Progress value={listen.pct} />
                <span className="text-xs text-ink-2">
                  {listen.phase === "sound" ? `Reading your reel's sound… ${listen.pct}%` : listen.phase === "download" ? `Getting the listening model ready… ${listen.pct}%` : `Listening to your reel… ${listen.pct}%`}
                </span>
              </div>
            ) : null}
            {listen.phase === "done" && !listen.silent ? (
              <p className="text-xs text-good" data-testid="reel-listen-done" role="status">
                Done. Read it through below and fix any word it misheard.
              </p>
            ) : null}
            {listen.phase === "done" && listen.silent ? (
              <p className="rounded-lg bg-warn-soft p-2 text-xs" data-testid="reel-silent" role="status">
                We heard almost no talking. If the reel is music or shows something, describe what&apos;s on screen or what you&apos;re teaching in the box below instead.
              </p>
            ) : null}
            {listen.phase === "error" ? (
              <p className="rounded-lg bg-warn-soft p-2 text-xs" role="alert" data-testid="reel-listen-error">
                {listen.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {file && canAttach && isVideo(file) ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={attach && !notes?.tooLargeToAttach} disabled={Boolean(notes?.tooLargeToAttach) || uploading !== null} onChange={(e) => setAttach(e.currentTarget.checked)} data-testid="reel-attach" />
            <span>
              Attach this video to the post
              <span className="block text-xs text-ink-3">{notes?.tooLargeToAttach ? `It's over ${REEL_VIDEO_MAX_BYTES / 1_000_000} MB, the most a post can carry, so it stays on your device.` : "It uploads to your private storage when you press Create post, and goes out with the post when you publish."}</span>
            </span>
          </label>
        ) : null}
        <p className="text-xs text-ink-3" data-testid="reel-privacy">
          Writing it out happens on your device: your video isn&apos;t uploaded for that. It&apos;s uploaded only if you attach it to the post.
        </p>
      </section>
      <Field label="Transcript" hint="What you say in the reel. No talking, only music? Describe what's on screen or what you're teaching instead.">
        <textarea ref={textRef} className="field" name="transcript" rows={10} required value={transcript} onChange={(e) => setTranscript(e.currentTarget.value)} data-testid="reel-transcript-input" placeholder="I used to spend Sunday afternoons planning every meal for the week…" />
      </Field>
      <Field label="Keyword (optional)" hint="Goes in the last rung only, never the caption.">
        <select className="field" name="keyword" defaultValue="SAID" data-testid="reel-keyword">
          <option value="SAID">The one I say on camera, if it&apos;s on my facts</option>
          {keywords.map((k) => (
            <option key={k.keyword} value={k.keyword}>
              {k.label}
            </option>
          ))}
          <option value="NONE">No keyword, end on a question</option>
        </select>
      </Field>
      <Field label="What it's about (optional)" hint="A few words for your list. Blank: taken from your first sentence.">
        <input className="field" name="topic" />
      </Field>
      {uploading !== null ? (
        <div className="grid gap-1" data-testid="reel-upload-progress" aria-live="polite">
          <Progress value={uploading} />
          <span className="text-xs text-ink-2">Uploading your video… {uploading}%</span>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-warn-soft p-2 text-sm" role="alert" data-testid="reel-upload-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn btn-accent min-h-11!" pendingText="Writing your post…" disabled={busy || uploading !== null} data-testid="reel-create">
          Create post
        </SubmitButton>
        {aiStatus}
        {noAiNote}
      </div>
      <p className="text-xs text-ink-3">Numbers, prices and people&apos;s names you say on camera stay out of the copy unless they&apos;re in your verified stats or approved proof; you&apos;ll see each one listed to check.</p>
    </form>
  );
}
