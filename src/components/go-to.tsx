"use client";

import { useEffect } from "react";

/** Sends the browser on to an address the server already checked and signed. A script navigation, not a form's redirect. */
export function GoTo({ href }: { href: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(href), 300);
    return () => clearTimeout(t);
  }, [href]);
  return null;
}
