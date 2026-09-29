import { Suspense } from "react";
import type { Switched } from "@/lib/auth";
import { switchBackAction } from "@/lib/actions/switch";
import { SubmitButton } from "@/components/submit-button";
import { SwitchErrorLine } from "@/components/switch-error-line";

/**
 * "Switch to client" (rev 216): on every page while a coach is in a client's HelixOS, so it is never mistaken for their own.
 * Says whose it is and whether it's View or Work, with the way back. A refused write shows its reason here too.
 */
export function SwitchBanner({ sw }: { sw: Switched }) {
  const first = sw.clientName.split(" ")[0];
  return (
    <div className="sticky top-0 z-40 border-b border-accent bg-accent-soft px-4 py-2 text-sm" role="region" aria-label="Switched into a client" data-testid="switch-banner" data-mode={sw.mode}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">
          You&apos;re in {sw.clientName}&apos;s HelixOS as their coach ({sw.mode === "work" ? "Working" : "Viewing"}).
        </span>
        <span className="text-xs text-ink-2">{sw.mode === "work" ? `Every change is shown to ${first} as yours.` : "Nothing can be changed while viewing."}</span>
        <form action={switchBackAction} className="ml-auto">
          <SubmitButton className="btn btn-primary btn-xs" pendingText="Going back…" data-testid="switch-back">
            Back to my account
          </SubmitButton>
        </form>
      </div>
      <Suspense fallback={null}>
        <SwitchErrorLine />
      </Suspense>
    </div>
  );
}
