"use client";

import { useState } from "react";

export type ProofImage = {
  id: string;
  proofId: string;
  displayKey: string | null;
  altText: string | null;
  showsAResult: boolean | null;
};

/**
 * The belief step's proof pick with the picked proof's images beside it, following the select as it changes rather than
 * one save behind it. Nothing goes into the deck on its own: the strip offers downloads, never attaches.
 */
export function ProofPicker({
  type,
  initialProofId,
  proofs,
  images,
}: {
  type: string;
  initialProofId: string;
  proofs: { id: string; name: string }[];
  images: ProofImage[];
}) {
  const [proofId, setProofId] = useState(initialProofId);
  const mine = images.filter((a) => a.proofId === proofId);
  return (
    <>
      <select
        className="field"
        name={`${type}_proofId`}
        value={proofId}
        onChange={(e) => setProofId(e.currentTarget.value)}
        data-testid={`belief-proof-${type}`}
      >
        <option value="">None picked</option>
        {proofs.map((pr) => (
          <option key={pr.id} value={pr.id}>
            {pr.name}
          </option>
        ))}
      </select>
      {mine.length ? (
        <div
          className="mt-2 rounded-lg bg-surface-2 p-2"
          data-testid={`belief-proof-images-${type}`}
        >
          <p className="text-xs text-ink-2">
            This proof&apos;s images, for a slide. Nothing goes into the deck on
            its own: download the one you want.
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {mine.map((a) => (
              <li key={a.id} className="w-20 text-center text-[11px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route; next/image would fetch it without the session */}
                <img
                  src={`/api/proofs/attachments/${a.id}${a.displayKey ? "?display=1" : ""}`}
                  alt={a.altText ?? ""}
                  className="h-14 w-20 rounded object-cover"
                />
                <a
                  className="underline"
                  href={`/api/proofs/attachments/${a.id}?download=1`}
                >
                  Download
                </a>
                {a.showsAResult ? (
                  <span className="block text-warn">shows a result</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
