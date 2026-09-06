import Link from "next/link";
import { JoinForm } from "./join-form";

export const metadata = { title: "Join" };

export default function JoinPage() {
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Join your coach&apos;s workspace</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">Your coach gave you an invite code. Enter it and you&apos;ll land on Day 1 with your pathway ready.</p>
      <JoinForm />
      <p className="mt-4 text-center text-sm text-ink-2">
        Already a member?{" "}
        <Link href="/login" className="font-semibold text-ink underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
