"use client";

import { useEffect, useState } from "react";
import { FilePicker } from "@/components/file-picker";
import { SCREENSHOT_MAX_BYTES } from "@/lib/engine/reports";

/** A chosen picture, already shrunk: what is sent, its local preview address, and the file itself. */
export type Shot = { blob: Blob; url: string; file: File };

/** A picture shrunk in the browser to at most 1600 px wide and re-encoded as JPEG, so it fits a form's send. */
export async function shrinkPicture(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (out && out.size <= SCREENSHOT_MAX_BYTES) return out;
  }
  throw new Error("too large");
}

/**
 * An optional screenshot, shared by "I have an issue or a suggestion" and the Office Hours request (H-1706): upload a picture
 * or capture this screen where the browser allows it, shrunk to fit before it goes. Controlled: the form holds the picture.
 * With `name`, a hidden field carries the shrunk picture in a plain form post; the picker's own inputs never post.
 * `beforeCapture` and `afterCapture` let a dialog step aside so the capture shows the page, then come back.
 */
export function ScreenshotPicker({
  idPrefix,
  shot,
  onShot,
  error,
  onError,
  name,
  beforeCapture,
  afterCapture,
  previewAlt = "The screenshot that will be sent",
}: {
  idPrefix: string;
  shot: Shot | null;
  onShot: (next: Shot | null) => void;
  error: string | null;
  onError: (message: string | null) => void;
  name?: string;
  beforeCapture?: () => void;
  afterCapture?: () => void;
  previewAlt?: string;
}) {
  // Read after mounting: the server can't know the browser's features, and a button only the browser draws would make its HTML
  // differ from the server's (a hydration error on every page).
  const [canCapture, setCanCapture] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser feature read once after mounting, never during render
    setCanCapture(Boolean(navigator.mediaDevices?.getDisplayMedia));
  }, []);
  // For a plain form post, the shrunk picture rides in a hidden field as a data address (the app's one file input stays the
  // shared picker's); the server reads its bytes and checks them like any upload.
  const [carried, setCarried] = useState("");
  useEffect(() => {
    if (!name) return;
    if (!shot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the carried copy when the picture goes
      setCarried("");
      return;
    }
    let live = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (live) setCarried(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(shot.blob);
    return () => {
      live = false;
    };
  }, [shot, name]);

  const replace = (next: Shot | null) => {
    if (shot) URL.revokeObjectURL(shot.url);
    onShot(next);
  };
  const take = async (blob: Blob) => {
    try {
      const small = await shrinkPicture(blob);
      // The picker shows the shrunk picture as the one chosen, named for what it is.
      replace({ blob: small, url: URL.createObjectURL(small), file: new File([small], "screenshot.jpg", { type: "image/jpeg" }) });
      onError(null);
    } catch {
      onError("That picture couldn't be read. Try another, or send without one.");
    }
  };
  const capture = async () => {
    beforeCapture?.();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) await take(blob);
    } catch {
      onError("The capture was cancelled or isn't allowed here. You can upload a picture instead.");
    } finally {
      afterCapture?.();
    }
  };

  return (
    <>
      <FilePicker
        kind="image"
        accept="image/png,image/jpeg,image/webp,image/gif"
        files={shot ? [shot.file] : []}
        testId={`${idPrefix}-screenshot`}
        labels={{ take: "Take photo", upload: "Upload picture" }}
        hint={
          canCapture ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void capture()} data-testid={`${idPrefix}-capture`}>
              Capture this screen
            </button>
          ) : null
        }
        onChange={(fs) => {
          if (fs[0]) void take(fs[0]);
          else replace(null);
        }}
      />
      {name ? <input type="hidden" name={name} value={carried} data-testid={`${idPrefix}-carrier`} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the member's own picture, never a remote one */}
      {shot ? <img src={shot.url} alt={previewAlt} className="max-h-40 rounded-lg border" data-testid={`${idPrefix}-preview`} /> : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </>
  );
}
