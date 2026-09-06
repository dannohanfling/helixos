import Link from "next/link";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Choose a new password</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">At least 8 characters. Saving signs you in here and signs out every other device.</p>
      <ResetForm token={token} />
      <p className="mt-4 text-center text-sm text-ink-2">
        <Link href="/forgot" className="font-semibold text-ink underline">
          Need a new link?
        </Link>
      </p>
    </div>
  );
}
