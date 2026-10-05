"use server";

import { redirect } from "next/navigation";
import { AVATAR_FIELDS, type AvatarField } from "@/db/schema";
import { archiveAvatar, duplicateAvatar, linkOffer, saveAvatar, savePrimary, type AvatarInput } from "@/lib/avatars";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { queueProgress } from "@/lib/chat-progress";

/** Where a form came from: one of the avatar pages, an offer's page or the Pathway, never anywhere else. */
function from(fd: FormData, fallback: string): string {
  const f = str(fd, "from");
  return /^\/(avatars(\/[\w-]+)?|offers\/[\w-]+|pathway|today)$/.test(f) ? f : fallback;
}
const go = (path: string, q: Record<string, string>, anchor = "") => redirect(`${path}?${new URLSearchParams(q).toString()}${anchor ? `#${anchor}` : ""}`);

/** Only the fields the form carries: the Pathway's four never blank the other six. */
function inputOf(fd: FormData): AvatarInput {
  const fields = Object.fromEntries(AVATAR_FIELDS.filter((f) => fd.has(f)).map((f) => [f, opt(fd, f)])) as Partial<Record<AvatarField, string | null>>;
  return { name: str(fd, "name"), ...(fd.has("oneLine") ? { oneLine: opt(fd, "oneLine") } : {}), ...(fd.has("parentId") ? { parentId: str(fd, "parentId") || null } : {}), ...fields };
}

/** New, or Save on an avatar's page. */
export async function saveAvatarAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const id = str(fd, "id") || null;
  const back = from(fd, id ? `/avatars/${id}` : "/avatars");
  const r = await saveAvatar(m, id, { ...inputOf(fd), ...(fd.get("primary") === "on" ? { primary: true } : {}) });
  if ("error" in r) go(back, { error: r.error, ...(r.field ? { field: r.field } : {}) }, id ? "" : "new");
  else {
    queueProgress(m.workspaceId, m.userId, "offer_changed");
    refresh();
    go(id ? back : `/avatars/${r.avatar.id}`, { saved: "1" });
  }
}

/** The Pathway's "Define Your Buyer Avatar" card: into the Primary. */
export async function savePrimaryAvatarAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const back = from(fd, "/avatars");
  const r = await savePrimary(m, inputOf(fd));
  if ("error" in r) go(back, { error: r.error, ...(r.field ? { field: r.field } : {}) }, "define");
  else {
    refresh();
    go(back, { saved: "primary" }, "define");
  }
}

export async function makePrimaryAvatarAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const id = str(fd, "id");
  await saveAvatar(m, id, { primary: true });
  refresh();
  go(from(fd, "/avatars"), { saved: "1" });
}

export async function duplicateAvatarAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const copy = await duplicateAvatar(m, str(fd, "id"));
  refresh();
  go(`/avatars/${copy.id}`, { saved: "copy" });
}

/** Archive, or bring back with `back=1`. */
export async function archiveAvatarAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const id = str(fd, "id");
  const restore = str(fd, "back") === "1";
  const a = await archiveAvatar(m, id, restore);
  refresh();
  if (restore) go(`/avatars/${id}`, { saved: "back" });
  else go("/avatars", { archived: a.id });
}

/** Link, unlink or make main, from an avatar's page or an offer's "Who it's for". */
export async function linkAvatarOfferAction(fd: FormData): Promise<void> {
  // Only the member's two ids go on, so nothing else of the viewer reaches an insert.
  const { workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const avatarId = str(fd, "avatarId");
  const offerId = str(fd, "offerId");
  const back = from(fd, `/avatars/${avatarId}`);
  if (!avatarId || !offerId) go(back, { error: "Pick an avatar and an offer." }, "offers");
  const linked = str(fd, "linked") !== "0";
  await linkOffer(m, avatarId, offerId, { linked, ...(str(fd, "main") === "1" ? { main: true } : {}) });
  queueProgress(m.workspaceId, m.userId, "offer_changed");
  refresh();
  go(back, { saved: "link" }, back.startsWith("/offers/") ? "who-for" : "offers");
}
