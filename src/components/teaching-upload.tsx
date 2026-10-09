"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FilePicker } from "@/components/file-picker";

/** Cut a file's text into parts under ~2.5 MB, each at an entry's start (a heading line), so no entry is split in two. */
export function parts(text: string, max = 2_500_000): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf("\n### "), window.lastIndexOf("\n## "));
    const at = cut > 0 ? cut + 1 : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

type Row = { file: string; kind?: string; added: number; updated: number; unchanged: number; priced: number; unreadable: string[]; error?: string };

/**
 * The coach uploads the story bank and the library files together (rev 615 plan): each file read in the browser and sent in
 * parts, then one line per file with what was added, updated, unchanged, held back for a price, and what couldn't be read.
 */
export function TeachingUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [runs, setRuns] = useState(0);
  const [pending, start] = useTransition();
  const router = useRouter();
  const send = () =>
    start(async () => {
      setRows([]);
      const done: Row[] = [];
      for (const f of files) {
        const row: Row = { file: f.name, added: 0, updated: 0, unchanged: 0, priced: 0, unreadable: [] };
        for (const text of parts(await f.text())) {
          const res = await fetch("/api/teaching/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: f.name, text }) });
          const json = (await res.json().catch(() => null)) as (Partial<Row> & { error?: string; kind?: string }) | null;
          if (!res.ok || !json) {
            row.error = json?.error ?? "That file couldn't be uploaded. Try again.";
            break;
          }
          row.kind = json.kind;
          row.added += json.added ?? 0;
          row.updated += json.updated ?? 0;
          row.unchanged += json.unchanged ?? 0;
          row.priced += json.priced ?? 0;
          row.unreadable.push(...(json.unreadable ?? []));
        }
        done.push(row);
        setRows([...done]);
      }
      setFiles([]);
      setRuns((n) => n + 1);
      router.refresh();
    });
  return (
    <div className="space-y-3" data-testid="teaching-upload" data-runs={runs}>
      <FilePicker kind="file" files={files} onChange={setFiles} accept=".md,.markdown,.txt,text/markdown,text/plain" multiple testId="teaching-files" labels={{ upload: "Choose the files" }} />
      <button type="button" className="btn btn-primary btn-sm" disabled={pending || !files.length} onClick={send} data-testid="teaching-send">
        {pending ? "Uploading…" : files.length ? `Upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Upload"}
      </button>
      {rows.length ? (
        <ul className="space-y-1 text-sm" data-testid="teaching-results">
          {rows.map((r) => (
            <li key={r.file} data-testid="teaching-result" data-file={r.file}>
              <b>{r.file}</b>{" "}
              {r.error ? (
                <span className="text-danger" role="alert">{r.error}</span>
              ) : (
                <span className="text-ink-2">
                  {r.kind === "stories" ? "Story bank" : "Library"}: {r.added} added, {r.updated} updated, {r.unchanged} unchanged
                  {r.priced ? `, ${r.priced} name a price and are never given to the writer` : ""}
                  {r.unreadable.length ? `, ${r.unreadable.length} couldn't be read (${r.unreadable.slice(0, 3).join("; ")}${r.unreadable.length > 3 ? "; …" : ""})` : ""}.
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
