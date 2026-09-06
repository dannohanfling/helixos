import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SETUP_RESULT_COOKIE } from "@/lib/setup";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Workspace ready" };

/** Shown once right after setup. The links live in a 10-minute cookie; leaving through the button clears it. */
export default async function SetupDonePage() {
  const jar = await cookies();
  const raw = jar.get(SETUP_RESULT_COOKIE)?.value;
  if (!raw) notFound();
  let data: { clientLink: string; coachLink: string; existingUser?: boolean };
  try {
    data = JSON.parse(raw);
  } catch {
    notFound();
  }
  return (
    <div className="card space-y-4 p-6">
      <h1 className="text-xl font-bold">Your workspace is ready</h1>
      <div className="rounded-lg bg-good-soft px-3 py-2 text-sm">Workspace created and you&apos;re signed in{data.existingUser ? " (your existing login and password were kept)" : ""}.</div>
      <div className="rounded-lg border border-warn bg-warn-soft p-3 text-sm">
        <div className="font-semibold">Save these two links now. They are shown once.</div>
        <p className="mt-1">The client link is what you send every member. The coach link grants full coach access, including your integrations, so keep it to yourself. Both can be rotated later on Settings.</p>
      </div>
      <div>
        <div className="label">Client invite link</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5 text-xs" data-testid="client-link">{data.clientLink}</code>
          <CopyButton text={data.clientLink} label="Copy" className="btn btn-soft btn-xs" />
        </div>
      </div>
      <div>
        <div className="label">Coach invite link (private)</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5 text-xs" data-testid="coach-link">{data.coachLink}</code>
          <CopyButton text={data.coachLink} label="Copy" className="btn btn-soft btn-xs" />
        </div>
      </div>
      <a href="/setup/finish" className="btn btn-primary w-full">
        I&apos;ve saved them. Take me in →
      </a>
    </div>
  );
}
