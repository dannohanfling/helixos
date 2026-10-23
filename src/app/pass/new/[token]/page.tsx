import type { Metadata } from "next";
import { SubmitButton } from "@/components/submit-button";
import { switchWords } from "@/lib/engine/pass-move";
import { switchByToken } from "@/lib/pass-move";

/**
 * A member's private link to their program's new pass (H-1859, plan H-1861 approved in H-1868): /pass/new/<token>, no
 * sign-in, not indexed. Opening it changes nothing (a link preview can't make a pass); the pass is made only on the press.
 * No name, email, provider or price on the page.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Your new pass" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function NewPassPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params;
  const { r } = await searchParams;
  const found = await switchByToken(token);
  const said = switchWords(found ? r : "invalid");
  const made = found?.row.status === "made" ? found.row : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10" data-testid="new-pass">
      <h1 className="text-2xl font-semibold">Your new pass</h1>
      {said ? (
        <p className={said.good ? "text-good" : "text-danger"} role="status" data-testid="new-pass-said">
          {said.text}
        </p>
      ) : null}
      {found && made ? (
        <>
          <p className="text-ink-2">Add it to your wallet. Your points come with it{made.carryPoints ? `: ${made.carryPoints.toLocaleString("en-US")} of them` : ""}. Your old pass keeps working until you remove it.</p>
          {made.toPassUrl ? (
            <a href={made.toPassUrl} className="btn btn-accent min-h-11 text-base" data-testid="new-pass-add">
              Add to wallet
            </a>
          ) : (
            <p className="text-ink-3">The wallet link didn&apos;t come back. Your program can send it to you.</p>
          )}
        </>
      ) : found ? (
        <>
          <p className="text-ink-2">Your pass has a new look. Get it here: your points move over with it, and your old pass keeps working until you remove it.</p>
          <form action={`/pass/new/${encodeURIComponent(token)}/make`} method="post">
            <SubmitButton className="btn btn-primary min-h-11 w-full text-base" pendingText="Making your pass…" data-testid="new-pass-get">
              Get my new pass
            </SubmitButton>
          </form>
        </>
      ) : null}
    </main>
  );
}
