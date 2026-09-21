import { logoutAction } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access ended" };

/** Shown to a client whose coach has removed them: a plain sentence and a way out, no app chrome and no data. */
export default function RemovedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Your access has ended</h1>
      <p className="mt-3 text-ink-2">Your coach has closed your HelixOS access. If you think this is a mistake, contact your coach.</p>
      <form action={logoutAction} className="mt-6">
        <button className="btn btn-soft" type="submit">Log out</button>
      </form>
    </main>
  );
}
