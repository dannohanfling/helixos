"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import { recordMagnetUploadAction } from "@/lib/actions/magnets";
import { capLabel, publicMagnetKey, uploadRefusal } from "@/lib/engine/storage-policy";

/**
 * A file made elsewhere (Canva, a designer) goes from the browser straight to the bucket on a token this app issues, under
 * the magnet's own public folder, and is recorded once the bytes are in. The cap and the refusals are the policy's, so
 * every message names the current cap and never a literal.
 */
export function MagnetUpload({ magnetId, slug, enabled, why }: { magnetId: string; slug: string; enabled: boolean; why?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = () => {
    if (!file) return setError("Choose a file first.");
    const refused = uploadRefusal(file);
    if (refused) return setError(refused);
    setError(null);
    start(async () => {
      try {
        const key = publicMagnetKey(slug, crypto.randomUUID(), file.name);
        const blob = await upload(key, file, { access: "public", contentType: file.type, handleUploadUrl: "/api/magnets/upload", clientPayload: JSON.stringify({ magnetId }), onUploadProgress: (p) => setProgress(p.percentage) });
        const r = await recordMagnetUploadAction(magnetId, blob.pathname, blob.url, file.name);
        if (!r.ok) return setError(r.error);
        router.push(`/magnets/${magnetId}?uploaded=1`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The upload did not finish.");
      } finally {
        setProgress(null);
      }
    });
  };
  return (
    <div className="mt-2 space-y-2" data-testid="magnet-upload-form">
      <p className="text-xs text-ink-2">Made in Canva or by a designer. Goes straight to storage and is served at its own public address. Up to {capLabel()}.</p>
      {enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className="text-sm" type="file" data-testid="magnet-file" disabled={pending} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
          <button className="btn btn-soft btn-sm" type="button" disabled={pending || !file} aria-busy={pending} onClick={send} data-testid="magnet-upload">
            {pending ? (progress !== null ? `Uploading ${Math.round(progress)}%` : "Uploading…") : "Upload"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-warn" data-testid="magnet-upload-off">{why}</p>
      )}
      {error ? (
        <p className="text-xs text-danger" role="alert" data-testid="magnet-upload-error">{error}</p>
      ) : null}
    </div>
  );
}
