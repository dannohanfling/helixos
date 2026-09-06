import { notFound } from "next/navigation";
import { safeEqual } from "@/lib/crypto";
import { anyWorkspaceExists } from "@/lib/setup";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up HelixOS" };

/**
 * First-run setup. 404 (not a redirect) whenever it must not run: SETUP_TOKEN unset, token wrong, or a workspace already exists.
 * The token is re-checked inside the action; this gate only decides whether to render the form.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const expected = process.env.SETUP_TOKEN ?? "";
  const { token = "" } = await searchParams;
  if (!expected || !safeEqual(token, expected)) notFound();
  if (await anyWorkspaceExists()) notFound();
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Set up your workspace</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">One form, once. This creates your workspace, your coach login, and the two invite links. It also loads the library: pathway, curriculum, doctrine, courses and swipe files.</p>
      <SetupForm token={token} />
    </div>
  );
}
