"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { FilePicker } from "@/components/file-picker";

/** The square the photo is saved at, and the preview's size. */
const OUT_PX = 1024;
const VIEW_PX = 288;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export type OwnMedia = { id: string; caption: string | null; kind: string };

/** A picture the browser can draw: HEIC decodes only where the browser can (Safari); elsewhere it says so plainly. */
async function decode(blob: Blob): Promise<{ bitmap: ImageBitmap } | { error: string }> {
  try {
    return { bitmap: await createImageBitmap(blob) };
  } catch {
    return { error: /hei[cf]/i.test(blob.type) || blob.type === "" ? "This browser can't read a HEIC photo. Pick a JPG or PNG, or use Safari." : "That file isn't a picture this browser can read." };
  }
}

/**
 * The member's own photo (client headshots, rule 5; H-94): Take photo or Upload photo with the shared file control, or
 * Choose from my media (their own Images only); then a square preview with zoom and drag; Use this photo saves the square to
 * the private store through the upload route. It replaces whatever is there, the coach's import included; no import ever
 * overwrites it. A failure shows one plain line and is logged.
 */
export function HeadshotUpload({ media = [], replace = false }: { media?: OwnMedia[]; replace?: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaQ, setMediaQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const router = useRouter();

  const load = (blob: Blob) =>
    start(async () => {
      setError(null);
      const r = await decode(blob);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setBitmap(r.bitmap);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setMediaOpen(false);
    });
  const choose = (fs: File[]) => {
    setFiles(fs);
    const f = fs[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      setError("Pick a photo under 10 MB.");
      return;
    }
    load(f);
  };

  // The preview: the picture covers the square at the zoom, moved by the drag, clamped so no edge shows.
  const place = (b: ImageBitmap, size: number, z: number, p: { x: number; y: number }) => {
    const base = size / Math.min(b.width, b.height);
    const s = base * z;
    const w = b.width * s;
    const h = b.height * s;
    const maxX = (w - size) / 2;
    const maxY = (h - size) / 2;
    const x = Math.max(-maxX, Math.min(maxX, p.x * (size / VIEW_PX)));
    const y = Math.max(-maxY, Math.min(maxY, p.y * (size / VIEW_PX)));
    return { dx: (size - w) / 2 + x, dy: (size - h) / 2 + y, w, h };
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap) return;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, VIEW_PX, VIEW_PX);
    const { dx, dy, w, h } = place(bitmap, VIEW_PX, zoom, pan);
    g.drawImage(bitmap, dx, dy, w, h);
  }, [bitmap, zoom, pan]);

  const send = () =>
    start(async () => {
      if (!bitmap) return;
      setError(null);
      const out = document.createElement("canvas");
      out.width = OUT_PX;
      out.height = OUT_PX;
      const { dx, dy, w, h } = place(bitmap, OUT_PX, zoom, pan);
      out.getContext("2d")!.drawImage(bitmap, dx, dy, w, h);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) {
        setError("That photo couldn't be prepared. Try another.");
        return;
      }
      const body = new FormData();
      body.append("photo", blob, "photo.jpg");
      const res = await fetch("/api/headshots/upload", { method: "POST", body });
      if (!res.ok) {
        const why = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "That photo couldn't be saved. Try again.";
        console.error("[headshots] upload failed", res.status, why);
        setError(why);
        return;
      }
      setFiles([]);
      setBitmap(null);
      router.refresh();
    });

  const q = mediaQ.trim().toLowerCase();
  const shown = media.filter((m) => !q || (m.caption ?? "").toLowerCase().includes(q) || m.kind.toLowerCase().includes(q));
  return (
    <div className="space-y-2" data-testid="headshot-upload">
      {bitmap ? (
        <div className="space-y-2" data-testid="headshot-crop">
          <canvas
            ref={canvas}
            width={VIEW_PX}
            height={VIEW_PX}
            className="h-72 w-72 max-w-full cursor-grab touch-none rounded-xl border bg-surface-2 active:cursor-grabbing"
            aria-label="Your photo, square: drag to move it"
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current) setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
          <label className="flex items-center gap-2 text-xs">
            Zoom
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-48" aria-label="Zoom" data-testid="headshot-zoom" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || !files.length} onClick={send} data-testid="headshot-save">
              {pending ? "Saving…" : "Use this photo"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { setBitmap(null); setFiles([]); }} data-testid="headshot-cancel">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <FilePicker kind="image" files={files} onChange={choose} accept={ACCEPT} testId="headshot-file" labels={replace ? { take: "Take a new photo", upload: "Upload a new photo" } : undefined} hideChosen />
          {media.length ? (
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setMediaOpen((o) => !o)} aria-expanded={mediaOpen} data-testid="headshot-media">
              <span aria-hidden>🖼️</span> Choose from my media
            </button>
          ) : null}
          {mediaOpen ? (
            <div className="space-y-2 rounded-xl border p-2" data-testid="headshot-media-grid">
              <input type="search" className="field" placeholder="Search your images" value={mediaQ} onChange={(e) => setMediaQ(e.target.value)} aria-label="Search your images" data-testid="headshot-media-search" />
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" role="group" aria-label="Your images">
                {shown.slice(0, 48).map((m) => (
                  <button key={m.id} type="button" className="overflow-hidden rounded-lg border focus-visible:outline focus-visible:outline-2" onClick={() => start(async () => { setError(null); const r = await fetch(`/api/deck-images/${m.id}`); if (!r.ok) { setError("That image couldn't be read."); return; } const b = await r.blob(); setFiles([new File([b], "from-my-media", { type: b.type })]); load(b); })} aria-label={m.caption?.trim() || m.kind} data-testid="headshot-media-pick">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it */}
                    <img src={`/api/deck-images/${m.id}?thumb=1`} alt="" className="aspect-square w-full object-cover" loading="lazy" decoding="async" />
                  </button>
                ))}
                {!shown.length ? <p className="col-span-full text-xs text-ink-3">Nothing by that name.</p> : null}
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="headshot-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
