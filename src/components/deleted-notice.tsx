"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DELETED_MESSAGES, isDeletedKind } from "@/lib/deleted";

/**
 * The one short line after a delete ("Post deleted."), on the list the person was sent back to. It is read off `?deleted=` and
 * the parameter is then taken back off the address, so a reload or a shared link does not say it again; the line stays until
 * the person moves to another page.
 */
export function DeletedNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const kind = params.get("deleted");
  const [shown, setShown] = useState<{ path: string; text: string } | null>(null);
  // Latched during render (React's way to adjust state when an input changes), so the line survives the parameter coming off.
  if (isDeletedKind(kind) && (shown?.path !== pathname || shown.text !== DELETED_MESSAGES[kind])) setShown({ path: pathname, text: DELETED_MESSAGES[kind] });
  useEffect(() => {
    if (!isDeletedKind(kind)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("deleted");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [kind]);
  if (!shown || shown.path !== pathname) return null;
  return (
    <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="deleted-notice">
      {shown.text}
    </p>
  );
}
