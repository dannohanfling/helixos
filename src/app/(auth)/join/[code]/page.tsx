import { eq, or } from "drizzle-orm";
import Link from "next/link";
import { db, ensureMigrated, schema } from "@/db";
import { JoinForm } from "../join-form";

export const metadata = { title: "Join" };

export default async function JoinWithCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  await ensureMigrated();
  const upper = code.toUpperCase();
  const ws = await db.query.workspaces.findFirst({ where: or(eq(schema.workspaces.clientInviteCode, upper), eq(schema.workspaces.coachInviteCode, upper)) });
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">{ws ? `Join ${ws.name}` : "Join a workspace"}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">
        {ws ? "Create your login and you'll land on Day 1 with your pathway ready." : "We couldn't find that code, but you can enter one below."}
      </p>
      <JoinForm code={ws ? upper : undefined} />
      <p className="mt-4 text-center text-sm text-ink-2">
        Already a member?{" "}
        <Link href="/login" className="font-semibold text-ink underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
