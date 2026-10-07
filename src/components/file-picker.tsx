"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Object URLs for the chosen images, keyed by name, size and date so a parent handing a fresh array each render makes no new
 * URL; the old set is let go when the set changes or the picker leaves.
 */
function useThumbs(chosen: File[]) {
  const sig = chosen.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` stands for `chosen`: the same files, whatever array carries them
  const thumbs = useMemo(() => new Map(chosen.filter((f) => f.type.startsWith("image/")).map((f) => [`${f.name}:${f.size}:${f.lastModified}`, URL.createObjectURL(f)] as const)), [sig]);
  useEffect(
    () => () => {
      for (const u of thumbs.values()) URL.revokeObjectURL(u);
    },
    [thumbs],
  );
  return (f: File): string | null => thumbs.get(`${f.name}:${f.size}:${f.lastModified}`) ?? null;
}

export type FilePickerProps = {
  kind: "image" | "file";
  files?: File[];
  onChange?: (files: File[]) => void;
  /** What the picker accepts; an image picker takes "image/*" unless told otherwise. */
  accept?: string;
  /** What the camera button accepts, when it differs (a proof takes a video too). */
  captureAccept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** For a plain form post: the chosen input carries this name into the form. */
  name?: string;
  testId: string;
  labels?: { take?: string; upload?: string };
  /** The caller shows the chosen files itself (a list with a kind and a caption per file). */
  hideChosen?: boolean;
  hint?: ReactNode;
  className?: string;
};

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function FilePicker({ kind, files, onChange, accept, captureAccept, multiple = false, disabled = false, name, testId, labels, hideChosen = false, hint, className = "" }: FilePickerProps) {
  const [own, setOwn] = useState<File[]>([]);
  const chosen = files ?? own;
  const set = (next: File[]) => {
    if (!files) setOwn(next);
    onChange?.(next);
  };
  // Which input holds the file for a plain form post: only that one carries the name, so the form never sends an empty part first.
  const [source, setSource] = useState<"capture" | "upload" | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const thumbFor = useThumbs(chosen);

  const take = (from: "capture" | "upload") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.currentTarget.files ?? []);
    if (!picked.length) return;
    setSource(from);
    set(multiple ? [...chosen, ...picked] : picked.slice(0, 1));
    // Without a name the input is only a door: cleared, so choosing the same file again still counts (the browser fires no change for an unchanged value).
    if (!name) e.currentTarget.value = "";
    else if (from === "capture" && uploadRef.current) uploadRef.current.value = "";
    else if (from === "upload" && captureRef.current) captureRef.current.value = "";
  };
  const clear = (f: File) => {
    set(chosen.filter((x) => x !== f));
    if (captureRef.current) captureRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
    setSource(null);
  };
  const btn = `btn btn-soft btn-sm w-full cursor-pointer sm:w-auto ${disabled ? "pointer-events-none opacity-60" : ""}`;
  const uploadLabel = labels?.upload ?? (kind === "image" ? "Upload photo" : "Upload file");

  return (
    <div className={`space-y-2 ${className}`} data-testid={`${testId}-picker`} data-count={chosen.length}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {kind === "image" ? (
          <label className={btn}>
            <span aria-hidden>📷</span> {labels?.take ?? "Take photo"}
            <input ref={captureRef} type="file" className="sr-only" accept={captureAccept ?? accept ?? "image/*"} capture="environment" multiple={multiple} disabled={disabled} name={name && source === "capture" ? name : undefined} data-testid={`${testId}-capture`} onChange={take("capture")} />
          </label>
        ) : null}
        <label className={btn}>
          {kind === "image" ? <span aria-hidden>🖼️</span> : null} {uploadLabel}
          <input ref={uploadRef} type="file" className="sr-only" accept={accept ?? (kind === "image" ? "image/*" : undefined)} multiple={multiple} disabled={disabled} name={name && source !== "capture" ? name : undefined} data-testid={testId} onChange={take("upload")} />
        </label>
        {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      </div>
      {!hideChosen && chosen.length ? (
        <ul className="space-y-1" data-testid={`${testId}-chosen`}>
          {chosen.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-sm" data-testid={`${testId}-name`}>
              {thumbFor(f) ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the member's own file, never a remote one
                <img src={thumbFor(f) ?? undefined} alt="" className="h-12 w-12 rounded-lg border object-cover" data-testid={`${testId}-thumb`} />
              ) : (
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-lg border bg-surface-2 text-lg">📄</span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {f.name} <span className="text-ink-3">· {mb(f.size)}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-xs" aria-label={`Clear ${f.name}`} title="Clear" disabled={disabled} onClick={() => clear(f)} data-testid={`${testId}-clear`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
