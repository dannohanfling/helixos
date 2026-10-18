import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { chatWidgetProps } from "@/lib/chat";
import { coachFirstName } from "@/lib/queries/reports";
import { ChatWidget } from "@/components/chat-widget";

export const metadata = { title: "Ask your coach" };

/**
 * Ask your coach (H-693, plan H-700): the one page with the coach's chat. Every other page is the member's own, with no bubble
 * over the welcome, the scenes or the close. The member is told to the chat the way they always were (setUser with the
 * identifier hash); with no chat set up, the page says so.
 */
export default async function AskPage() {
  const v = await requireViewer();
  const [chat, coachFirst] = await Promise.all([chatWidgetProps(v), v.role === "client" ? coachFirstName(v.workspace.id) : Promise.resolve(null)]);
  const who = coachFirst ?? "your coach";
  return (
    <div className="mx-auto max-w-2xl" data-testid="ask-page">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your coach</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Ask {coachFirst ?? "your coach"}</h1>
      {chat ? (
        <>
          <p className="mt-2 text-sm text-ink-2" data-testid="ask-line">
            Ask about your offer, your content or your next step. {coachFirst ? `${coachFirst}'s` : "Your coach's"} assistant answers here, and {who} sees the chat.
          </p>
          <div className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm text-ink-2" data-testid="ask-chat-home">
            The chat opens here. If it hasn&apos;t, tap the chat button at the bottom of this page.
          </div>
          <ChatWidget {...chat} />
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-2" data-testid="ask-off">
          The chat with {who} isn&apos;t set up yet.{" "}
          <Link href="/today" className="underline">
            Back to Today
          </Link>
        </p>
      )}
    </div>
  );
}
