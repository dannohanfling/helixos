import Link from "next/link";
import { demoLoginAction } from "@/lib/actions/auth";
import { LoginForm } from "./login-form";
import { demoLoginEnabled } from "@/lib/demo";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reason?: string }> }) {
  const { next, error, reason } = await searchParams;
  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Welcome back</h1>
        <p className="mb-4 mt-1 text-sm text-ink-2">Log in, lock in your day, keep the streak alive.</p>
        {reason === "signed-out" ? <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">You were signed out because the password for this account changed. Sign in again.</p> : null}
        <LoginForm next={next} />
        <p className="mt-3 text-center text-sm">
          <Link href="/forgot" className="text-ink-2 underline">
            Forgot your password?
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-ink-2">
          Have an invite code?{" "}
          <Link href="/join" className="font-semibold text-ink underline">
            Join your coach&apos;s workspace
          </Link>
        </p>
      </div>
      {demoLoginEnabled() ? (
      <div className="card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">Try the demo</div>
        {error === "demo" ? <p className="mt-2 text-sm text-danger">Demo accounts aren&apos;t seeded yet. Run `npm run db:seed`.</p> : null}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <form action={demoLoginAction}>
            <input type="hidden" name="who" value="client" />
            <button className="btn btn-soft w-full" type="submit">
              🌊 As a client
            </button>
          </form>
          <form action={demoLoginAction}>
            <input type="hidden" name="who" value="coach" />
            <button className="btn btn-soft w-full" type="submit">
              🔱 As the coach
            </button>
          </form>
        </div>
      </div>
      ) : null}
    </div>
  );
}
