import Link from "next/link";
import { emailConfigured } from "@/lib/email";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Forgot your password?</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">Enter the email you log in with. If it has an account, you&apos;ll get a link that works for 60 minutes.</p>
      {!emailConfigured() ? (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm">
          Email sending isn&apos;t set up yet. {process.env.NODE_ENV === "production" ? "Ask your coach to reset your password for you." : "In development the reset link is shown on screen instead."}
        </p>
      ) : null}
      <ForgotForm />
      <p className="mt-4 text-center text-sm text-ink-2">
        <Link href="/login" className="font-semibold text-ink underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
