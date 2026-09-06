import Link from "next/link";
import { demoLoginAction } from "@/lib/actions/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Welcome back</h1>
        <p className="mb-4 mt-1 text-sm text-ink-2">Log in, lock in your day, keep the streak alive.</p>
        <LoginForm next={next} />
        <p className="mt-4 text-center text-sm text-ink-2">
          Have an invite code?{" "}
          <Link href="/join" className="font-semibold text-ink underline">
            Join your coach&apos;s workspace
          </Link>
        </p>
      </div>
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
    </div>
  );
}
