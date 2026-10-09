"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FilePicker } from "@/components/file-picker";

/** The largest side a photo is sent at: a phone's 12 MP photo is cut down in the browser so the upload stays under 4 MB. */
const MAX_SIDE = 2000;
async function shrink(file: File): Promise<Blob> {
  if (file.size <= 3.5 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9));
}

/**
 * The member's own photo (client headshots, rule 5): take or pick one with the shared file control, and it replaces whatever
 * is there, the coach's import included; no import ever overwrites it. Sent to the private store through the upload route.
 */
export function HeadshotUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = () =>
    start(async () => {
      setError(null);
      const file = files[0];
      if (!file) return;
      const body = new FormData();
      body.append("photo", await shrink(file), file.name || "photo.jpg");
      const res = await fetch("/api/headshots/upload", { method: "POST", body });
      if (!res.ok) {
        setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "That photo couldn't be saved. Try again.");
        return;
      }
      setFiles([]);
      router.refresh();
    });
  return (
    <div className="space-y-2" data-testid="headshot-upload">
      <FilePicker kind="image" files={files} onChange={setFiles} accept="image/jpeg,image/png,image/webp" testId="headshot-file" />
      {error ? <p className="rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="headshot-error">{error}</p> : null}
      <button type="button" className="btn btn-primary btn-sm" disabled={pending || !files.length} onClick={send} data-testid="headshot-save">
        {pending ? "Saving…" : "Use this photo"}
      </button>
    </div>
  );
}
