"use client";

import { useRef, type ReactNode } from "react";
import { SubmitButton } from "./submit-button";

/**
 * A delete that asks first, in words: what will go and whether it can be undone, with Cancel and Delete, Cancel the default.
 * Sits inside the server-action form it guards, in place of that form's submit button: the trigger only opens the dialog, and
 * the dialog's own Delete is the form's submit, so the hidden fields beside it travel as before. Escape, the backdrop's cancel
 * and Cancel all close it with nothing sent. Focus goes to Cancel when it opens, so Enter never deletes by accident.
 */
export function ConfirmDelete({ what, undo = "This can't be undone.", label = "Delete", verb = "Delete", className = "btn btn-ghost btn-sm", testId, title, disabled, onConfirm }: { what: string; undo?: string; label?: ReactNode; verb?: string; className?: string; testId?: string; title?: string; disabled?: boolean; /** Outside a form (a row that runs its action from the client), Delete calls this instead of submitting. */ onConfirm?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        data-testid={testId}
        title={title}
        aria-label={title}
        disabled={disabled}
        aria-busy={disabled || undefined}
        onClick={() => {
          dialog.current?.showModal();
          cancel.current?.focus();
        }}
      >
        {label}
      </button>
      <dialog ref={dialog} className="confirm-delete" data-testid="confirm-delete" aria-label={`${verb} ${what}?`}>
        <p className="font-semibold" data-testid="confirm-delete-question">
          {verb} {what}?
        </p>
        <p className="mt-1 text-sm text-ink-2">{undo}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} type="button" className="btn btn-soft btn-sm" data-testid="confirm-delete-cancel" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          {onConfirm ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              data-testid="confirm-delete-yes"
              onClick={() => {
                dialog.current?.close();
                onConfirm();
              }}
            >
              {verb}
            </button>
          ) : (
            // The form's own submit: disabled from the press and saying so ("Deleting…") until the page comes back.
            <SubmitButton className="btn btn-danger btn-sm" data-testid="confirm-delete-yes" pendingText={`${verb.replace(/e$/, "")}ing…`}>
              {verb}
            </SubmitButton>
          )}
        </div>
      </dialog>
    </>
  );
}
