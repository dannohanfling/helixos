"use client";

import { useSearchParams } from "next/navigation";

/** Why a write was refused while switched (rev 216), under the banner, announced. */
export function SwitchErrorLine() {
  const reason = useSearchParams().get("switchError");
  if (!reason) return null;
  return (
    <p className="mx-auto mt-1 max-w-5xl text-sm text-danger" role="alert" data-testid="switch-error">
      {reason}
    </p>
  );
}
