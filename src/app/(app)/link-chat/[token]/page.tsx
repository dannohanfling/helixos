import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { chatLinkByToken, stamp } from "@/lib/chat";
import { CHANNEL_LABELS, LINK_MESSAGES, linkState } from "@/lib/engine/chat";
import { confirmChatLinkAction } from "@/lib/actions/chat";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Link your chat" };

/**
 * "Tap to confirm it's you" (rev 241): the one-time link the coach's assistant sent in a chat lands here, signed in. One
 * question, one button. A used, expired or foreign link says so in plain words and offers nothing to press.
 */
export default async function LinkChatPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  const [{ token }, { error }] = await Promise.all([params, searchParams]);
  const row = await chatLinkByToken(token);
  // A token that was never issued is a missing item, like any other unknown id in the app.
  if (!row) notFound();
  // The clock read once, outside the render's own rules, by the same helper the actions use.
  const state = linkState(row!, v.workspace.id, Date.parse(stamp()));
  const first = v.user.name.split(" ")[0];
  return (
    <>
      <PageHeader title="Link your chat" subtitle="So the assistant knows it's you, on every channel." />
      <Card>
        {v.switchedInto ? (
          <p className="text-sm" data-testid="link-chat-state" data-state="switched">
            Linked chats are {v.switchedInto.clientName.split(" ")[0]}&apos;s own. They can confirm this from their own HelixOS.
          </p>
        ) : state !== "ok" ? (
          <p className="text-sm" data-testid="link-chat-state" data-state={state}>
            {LINK_MESSAGES[state]}
          </p>
        ) : (
          <form action={confirmChatLinkAction} className="space-y-3" data-testid="link-chat-state" data-state="ok">
            <input type="hidden" name="token" value={token} />
            <p className="text-sm">
              Link your <strong>{CHANNEL_LABELS[row!.channel]}</strong> chat to your HelixOS account, {first}?
            </p>
            <p className="text-xs text-ink-3">Your coach&apos;s assistant will know the {CHANNEL_LABELS[row!.channel]} chat and this account are the same person, so a conversation can carry on across channels. It gets your name and the email on this account, nothing else. You can unlink it any time in Settings.</p>
            {error ? <p className="text-sm text-danger" data-testid="link-chat-error">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Linking…" data-testid="link-chat-confirm">
                Confirm
              </SubmitButton>
              <Link href="/today" className="text-sm text-ink-3 underline">
                Not now
              </Link>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
