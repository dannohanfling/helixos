"use client";

/**
 * Approve selected (H-1394): the toolbar over the Proof Bank's Draft and Permission given views. The rows' checkboxes
 * (name="ids", form="proof-bulk") are server-rendered beside each proof; this toolbar ticks them (Select all shown, the
 * clean list), counts them, and opens the confirm step: the count, the names, how many the list corrects first (H-1414),
 * the permission statement ticked once for the batch, then Approve, which posts the form. The list file goes to its own
 * action and comes back as ids to tick and their corrections; nothing of it is stored.
 */
import { useActionState, useEffect, useState } from "react";
import { FilePicker } from "@/components/file-picker";
import { SubmitButton } from "@/components/submit-button";
import { approveProofsAction, selectFromListAction, type SelectFromListState } from "@/lib/actions/proof-bulk";

const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[name="ids"][form="proof-bulk"]')];

export function ProofBulk({ status, permissionLine }: { status: string; permissionLine: string }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [listFiles, setListFiles] = useState<File[]>([]);
  const [listState, selectFromList, listing] = useActionState<SelectFromListState, FormData>(selectFromListAction, null);
  const recount = () => {
    const now: Record<string, string> = {};
    for (const b of boxes()) if (b.checked) now[b.value] = b.dataset.who || "(no name)";
    setPicked(now);
  };
  useEffect(() => {
    const list = document.querySelector('[data-testid="proof-list"]');
    list?.addEventListener("change", recount);
    // After the paint: a back navigation can bring ticked boxes with it.
    const t = setTimeout(recount, 0);
    return () => {
      clearTimeout(t);
      list?.removeEventListener("change", recount);
    };
  }, []);
  // The clean list's matches tick their rows; the rest stay as they were.
  useEffect(() => {
    if (!listState || listState.error) return;
    const want = new Set(listState.ids);
    for (const b of boxes()) b.checked = want.has(b.value);
    const t = setTimeout(recount, 0);
    return () => clearTimeout(t);
  }, [listState]);
  const all = (on: boolean) => {
    for (const b of boxes()) b.checked = on;
    recount();
    setConfirming(false);
  };
  const count = Object.keys(picked).length;
  const names = [...new Set(Object.values(picked))];
  // The list's corrections for the drafts still ticked: the ones Approve carries.
  const corrections = (listState?.corrections ?? []).filter((c) => c.id in picked);
  const correctedNames = [...new Set(corrections.map((c) => picked[c.id]))];
  return (
    <div className="mb-3 rounded-lg border border-line p-3 text-sm" data-testid="proof-bulk" data-count={count}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => all(true)} data-testid="proof-select-all">Select all shown</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => all(false)} data-testid="proof-select-none">Clear</button>
        <span className="text-ink-2" data-testid="proof-selected-count">{count} selected</span>
        <button type="button" className="btn btn-primary btn-sm" disabled={!count} onClick={() => setConfirming(true)} data-testid="proof-approve-selected">Approve selected</button>
      </div>
      <form action={selectFromList} className="mt-2 flex flex-wrap items-center gap-2" data-testid="proof-list-form">
        <span className="text-xs text-ink-3">Select the clean drafts from a list file:</span>
        <FilePicker kind="file" files={listFiles} onChange={setListFiles} accept="application/json,.json" name="list" testId="proof-list-file" labels={{ upload: "Choose the list file" }} />
        <SubmitButton className="btn btn-soft btn-sm" pendingText="Matching…" data-testid="proof-list-select">Select from the list</SubmitButton>
        {listing ? null : listState?.error ? (
          <span className="text-danger" data-testid="proof-list-error">{listState.error}</span>
        ) : listState ? (
          <span className="text-ink-2" data-testid="proof-list-result">
            {listState.matched} matched, {listState.notFound} not found{listState.corrections.length ? `, ${listState.corrections.length} with a correction` : ""}. The file is read for this once and not kept.
          </span>
        ) : null}
      </form>
      {confirming && count ? (
        <form id="proof-bulk" action={approveProofsAction} className="mt-3 rounded-lg bg-surface-2 p-3" data-testid="proof-confirm">
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="corrections" value={JSON.stringify(corrections)} />
          <p className="font-medium">Approve {count} proof{count === 1 ? "" : "s"}?</p>
          <p className="mt-1 text-xs text-ink-3" data-testid="proof-confirm-names">{names.slice(0, 40).join(", ")}{names.length > 40 ? ` and ${names.length - 40} more` : ""}</p>
          {corrections.length ? (
            <p className="mt-1 text-xs text-ink-2" data-testid="proof-confirm-corrected">
              {corrections.length} will be corrected first, from the list (the name or the words, as checked against the transcript): {correctedNames.slice(0, 40).join(", ")}{correctedNames.length > 40 ? ` and ${correctedNames.length - 40} more` : ""}
            </p>
          ) : null}
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" name="permission" className="mt-1" data-testid="proof-bulk-permission" />
            <span>{permissionLine}</span>
          </label>
          <p className="mt-1 text-xs text-ink-3">Each one is recorded as if approved on its own page. A draft whose picture shows a person waits for its likeness permission on its own page and stays a draft.</p>
          <div className="mt-2 flex gap-2">
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Approving…" data-testid="proof-bulk-approve">Approve</SubmitButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Not now</button>
          </div>
        </form>
      ) : (
        <form id="proof-bulk" action={approveProofsAction} className="hidden" aria-hidden="true">
          <input type="hidden" name="status" value={status} />
        </form>
      )}
    </div>
  );
}
