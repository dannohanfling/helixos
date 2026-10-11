"use server";

/**
 * Avatars by interview (rev 639): the page's actions. Apart from src/lib/actions/avatars.ts because these hand the viewer on:
 * the AI calls run on the member's own key, which is found from it. A coach switched in is refused before anything runs.
 */
import { redirect } from "next/navigation";
import { AVATAR_FIELDS, type AvatarField } from "@/db/schema";
import { answerInterview, saveInterview, startInterview, stopInterview } from "@/lib/avatar-interview";
import type { FieldChoice } from "@/lib/engine/avatar-interview";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { queueProgress } from "@/lib/chat-progress";

const go = (path: string, q: Record<string, string>, anchor = "") => redirect(`${path}?${new URLSearchParams(q).toString()}${anchor ? `#${anchor}` : ""}`);
const THEIRS = "An interview is in {first}'s own words, so it's theirs to answer.";

/** Interview me: a new avatar, or an avatar's empty fields; an interview already under way is picked up where it was. */
export async function startInterviewAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const avatarId = str(fd, "avatarId") || null;
  const r = await startInterview(v, avatarId);
  if (!r.ok) go(avatarId ? `/avatars/${avatarId}` : "/avatars", { interview: r.error }, "interview");
  else redirect(`/avatars/interview/${r.interview.id}`);
}

/** One answer (blank skips the question), or "That's enough, show me". */
export async function answerInterviewAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const id = str(fd, "id");
  const r = await answerInterview(v, id, str(fd, "answer"), fd.get("enough") === "1");
  refresh();
  if (!r.ok) go(`/avatars/interview/${id}`, { error: r.error });
  else redirect(`/avatars/interview/${id}`);
}

/** Save avatar: only the fields kept or edited; then on to the avatar, to say which offers it's for. */
export async function saveInterviewAction(fd: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const id = str(fd, "id");
  const choices = Object.fromEntries(
    AVATAR_FIELDS.filter((f) => fd.has(`keep_${f}`)).map((f) => {
      // Keep saves what is in the box, edited or not; Skip saves nothing for that field.
      return [f, { keep: str(fd, `keep_${f}`) === "keep" ? "edit" : "skip", text: str(fd, `text_${f}`) } satisfies FieldChoice];
    }),
  ) as Partial<Record<AvatarField, FieldChoice>>;
  const r = await saveInterview(v, id, choices, str(fd, "name"));
  if (!r.ok) go(`/avatars/interview/${id}`, { error: r.error });
  else {
    queueProgress(workspaceId, userId, "offer_changed");
    refresh();
    go(`/avatars/${r.avatarId}`, { saved: "interview" }, "offers");
  }
}

/** Stop this interview; the answers stay. */
export async function stopInterviewAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  await stopInterview(v, str(fd, "id"));
  refresh();
  go("/avatars", { saved: "stopped" });
}
