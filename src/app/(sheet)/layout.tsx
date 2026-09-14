import type { ReactNode } from "react";

/** The call sheet's own frame: no nav, no header, nothing between the client and the sheet on a screen or a printer. */
export default function SheetLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-5 py-6 print:max-w-none print:px-0">{children}</div>;
}
