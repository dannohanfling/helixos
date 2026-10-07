import { logoutAction } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access ended" };

/** Shown to a client whose coach has removed them, or a team member the owner has: a plain sentence and a way out, no app chrome and no data. */
export default function RemovedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Your access has ended</h1>
      <p className="mt-3 text-ink-2">Your HelixOS access has been closed. If you think this is a mistake, contact your coach, or the person whose team you were on.</p>
      <form action={logoutAction} className="mt-6">
        <SubmitButton className="btn btn-soft" pendingText="Logging out…">Log out</SubmitButton>
      </form>
    </main>
  );
}
