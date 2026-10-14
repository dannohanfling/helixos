import Link from "next/link";
import { ConfirmEmailForm } from "@/components/change-email-form";
import { pendingEmailChange } from "@/lib/email-change";

export const metadata = { title: "Confirm your email" };

/** The link from the new inbox (H-47): one button, single use, 24 hours. An expired or used link says so and points at Settings. */
export default async function EmailChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pending = await pendingEmailChange(token);
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Confirm your new login email</h1>
      {pending ? (
        <div className="mt-3">
          <ConfirmEmailForm token={token} newMasked={pending.newMasked} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-2" data-testid="email-link-gone">
          This link has expired or was already used. Start the change again from Settings.
        </p>
      )}
      <p className="mt-4 text-center text-sm text-ink-2">
        <Link href="/login" className="font-semibold text-ink underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
