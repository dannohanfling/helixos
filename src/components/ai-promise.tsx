import Link from "next/link";
import type { ReactNode } from "react";

/**
 * What a ✨ action returns, said before the click: a plain count of the artifacts, derived from the code's return shape.
 * When the member has no AI key it says so instead, with the way to fix it, rather than failing after the click.
 */
export function AiPromise({ enabled, children, needs }: { enabled: boolean; children: ReactNode; needs?: string }) {
  return (
    <p className="text-xs text-ink-3" data-testid="ai-promise" data-enabled={enabled ? "1" : "0"}>
      {enabled ? (
        <>
          ✨ {children}
          {needs ? <> {needs}</> : null}
        </>
      ) : (
        <>
          ✨ With AI needs your own Anthropic or OpenAI key.{" "}
          <Link href="/settings#ai" className="underline">
            Connect it in Settings
          </Link>
          .
        </>
      )}
    </p>
  );
}
