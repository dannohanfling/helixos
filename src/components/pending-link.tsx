"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactNode } from "react";

function Ring() {
  const { pending } = useLinkStatus();
  return pending ? <span className="spinner ml-1.5" aria-hidden="true" /> : null;
}

/** A link styled as a button that shows a ring while its navigation is in flight, so the tap is seen to have landed. */
export function PendingLink({ children, ...props }: ComponentProps<typeof Link> & { children: ReactNode }) {
  return (
    <Link {...props}>
      {children}
      <Ring />
    </Link>
  );
}
