"use client";

import { useState } from "react";
import type { ProofAttachmentKind } from "@/db/schema";
import { recordAttachmentConsentAction } from "@/lib/actions/proof-attachments";
import { likenessSentence } from "@/lib/engine/proof-attachments";

/** The likeness permission, recorded later: the sentence carries the name as it is typed, so what is ticked is what is recorded. */
export function AttachmentConsentForm({ id, kind, initialName }: { id: string; kind: ProofAttachmentKind; initialName: string }) {
  const [name, setName] = useState(initialName);
  return (
    <form action={recordAttachmentConsentAction} className="mt-2 space-y-1" data-testid="attachment-consent-form">
      <input type="hidden" name="id" value={id} />
      <input className="field text-xs" name="consentName" placeholder="Their name" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={120} data-testid="attachment-consent-name" />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="consentTick" className="mt-0.5" required data-testid="attachment-consent-tick" />
        <span>{likenessSentence(name, kind)}</span>
      </label>
      <button className="btn btn-soft btn-xs" type="submit" data-testid="attachment-consent-save">Record permission</button>
    </form>
  );
}
