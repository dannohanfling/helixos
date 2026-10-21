"use client";

import { useActionState, useState } from "react";
import { importFrameworksAction, type ImportState } from "@/lib/actions/frameworks";
import { SubmitButton } from "@/components/submit-button";
import { FilePicker } from "@/components/file-picker";

/** Paste or choose the file, dry-run, then save (H-1262). The file is read in the browser into the box, so one path serves both. */
export function FrameworksImport() {
  const [state, action] = useActionState<ImportState, FormData>(importFrameworksAction, null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const onFiles = async (next: File[]) => {
    setFiles(next);
    if (next[0]) setText(await next[0].text());
  };
  const names = (list: string[]) => (list.length ? ` (${list.slice(0, 6).join("; ")}${list.length > 6 ? "; …" : ""})` : "");
  return (
    <form action={action} className="space-y-3" data-testid="frameworks-import">
      <FilePicker kind="file" files={files} onChange={(next) => void onFiles(next)} accept=".md,.markdown,.txt,text/markdown,text/plain" testId="frameworks-file" labels={{ upload: "Choose the file" }} />
      <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} rows={10} className="field font-mono text-xs" placeholder={"## The name of the framework\nPillar: …\nThe idea: …\nThe steps:\n1. …\n2. …"} data-testid="frameworks-text" />
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-ghost btn-sm" name="mode" value="dry" pendingText="Reading…" data-testid="frameworks-dry">
          Dry run
        </SubmitButton>
        <SubmitButton className="btn btn-primary btn-sm" name="mode" value="save" pendingText="Saving…" data-testid="frameworks-save">
          Save
        </SubmitButton>
      </div>
      {state?.error ? (
        <p className="text-sm text-danger" role="alert" data-testid="frameworks-import-error">{state.error}</p>
      ) : null}
      {state?.dry ? (
        <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="frameworks-dry-result" data-added={state.dry.added.length} data-changed={state.dry.changed.length} data-unchanged={state.dry.unchanged.length} data-flagged={state.dry.flagged.length} data-unreadable={state.dry.unreadable.length}>
          <b>Dry run, nothing saved:</b> {state.dry.added.length} new{names(state.dry.added)}, {state.dry.changed.length} changed{names(state.dry.changed)}, {state.dry.unchanged.length} unchanged
          {state.dry.flagged.length ? `, ${state.dry.flagged.length} name a price and will stay drafts${names(state.dry.flagged)}` : ""}
          {state.dry.unreadable.length ? `, ${state.dry.unreadable.length} couldn't be read${names(state.dry.unreadable)}` : ""}.
        </div>
      ) : null}
      {state?.saved ? (
        <div className="rounded-lg bg-good-soft p-3 text-sm" role="status" data-testid="frameworks-saved" data-added={state.saved.added} data-changed={state.saved.changed} data-unchanged={state.saved.unchanged} data-flagged={state.saved.flagged}>
          <b>Saved:</b> {state.saved.added} new, {state.saved.changed} updated, {state.saved.unchanged} unchanged
          {state.saved.flagged ? `, ${state.saved.flagged} name a price and stay drafts` : ""}
          {state.saved.unreadable.length ? `, ${state.saved.unreadable.length} couldn't be read${names(state.saved.unreadable)}` : ""}. Publish each one below when it&apos;s ready.
        </div>
      ) : null}
    </form>
  );
}
