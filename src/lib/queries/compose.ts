import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { dripSetup } from "@/lib/rung-drip";
import type { Viewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { connectionFor } from "@/lib/ghl";
import { readiness } from "@/lib/engine/ghl-map";
import type { GroupTarget } from "@/lib/engine/compose";
import type { Persona } from "@/components/channel-previews";
import { visibleLibrary } from "./library-posts";
import { attachmentsForProofs } from "./proof-attachments";
import { withAttribution } from "@/lib/engine/fathom";
import { downloadUrlFor, mediaUrlFor, type ComposerMedia } from "@/lib/engine/compose-media";

/** Everything the composer needs: the user's groups (own + top 3 + members), persona for previews, AI and Social Planner state. */
export async function composerContext(v: Viewer) {
  const dripOn = dripSetup(v.membership).on;
  const [groups, conn, lib, approvedProofs] = await Promise.all([
    db.query.groups.findMany({ where: eq(schema.groups.userId, v.user.id), orderBy: [asc(schema.groups.kind), asc(schema.groups.rank), asc(schema.groups.name)] }),
    connectionFor(v.user.id),
    visibleLibrary(v.workspace.id, v.user.id),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  // Approved proof only, a line or two with the name attached: a draft quote never reaches the composer.
  // The same proofs' photos and videos are offered as media (a document is not post media); the client picks, nothing attaches on its own.
  const proofName = new Map(approvedProofs.map((p) => [p.id, p.name]));
  const attachments = await attachmentsForProofs(approvedProofs.map((p) => p.id));
  const media: ComposerMedia[] = attachments
    .filter((a): a is typeof a & { kind: "image" | "video" } => a.kind === "image" || a.kind === "video")
    .map((a) => ({ id: a.id, proofId: a.proofId, proofTitle: proofName.get(a.proofId) ?? "", kind: a.kind, label: `${proofName.get(a.proofId) ?? ""} · ${a.originalFilename}`, url: mediaUrlFor(a), downloadUrl: downloadUrlFor(a), hasAlt: Boolean(a.altText?.trim()), showsAResult: a.showsAResult }));
  // The Images library too (friction walk CP1, 7 Oct: the composer had only a URL field): each image as a pick, the same
  // private read route as a proof's file. A proof-kind image shows a result, so it carries the illustrative rule.
  const library = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), orderBy: (t, { desc }) => [desc(t.createdAt)] });
  media.push(...library.map((img) => libraryMedia(img)));
  const snippets = {
    hooks: lib.filter((p) => p.kind === "hook").map((p) => ({ id: p.id, title: p.title, text: p.hook ?? p.body })),
    ctas: lib.filter((p) => p.kind === "cta").map((p) => ({ id: p.id, title: p.title, text: p.cta ?? p.body })),
    proofs: approvedProofs.map((p) => ({ id: p.id, title: p.name, text: p.quote ? withAttribution(p.shortVersion ?? p.quote, p.who) : (p.hook ?? p.punchline ?? p.shortVersion ?? "") })).filter((p) => p.text),
    media,
  };
  const ordered: GroupTarget[] = [
    ...groups.filter((g) => g.kind === "own"),
    ...groups.filter((g) => g.kind === "prospect" && g.rank >= 1 && g.rank <= 3).sort((a, b) => a.rank - b.rank),
    ...groups.filter((g) => g.kind === "member" || (g.kind === "prospect" && (g.rank < 1 || g.rank > 3))),
  ].map((g) => ({ id: g.id, name: g.name, kind: g.kind, rank: g.rank, mission: g.mission, description: g.description, audience: g.audience, adminName: g.adminName, adminValues: g.adminValues, rules: g.rules, postingNorms: g.postingNorms, whatWorks: g.whatWorks }));
  const persona: Persona = {
    name: v.user.name,
    handle: v.user.name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    avatar: v.user.avatarEmoji ?? "🙂",
    business: v.membership.businessName ?? "",
  };
  return { dripOn,
    groups: ordered,
    persona,
    hashtag: v.membership.passHashtag,
    today: v.today,
    aiEnabled: await hasAiKey(),
    socialConnected: Boolean(conn && readiness(conn.mapping).mapped > 0),
    snippets,
    /** Who the composer's own upload records images for: the member whose composer it is. */
    uploader: { workspaceId: v.workspace.id, userId: v.user.id },
  };
}

/** An Images entry as the composer offers it. Its id is prefixed, so the saved post can tell it from a proof's file. */
export const libraryMedia = (img: { id: string; kind: string; caption: string | null; createdAt: string }): ComposerMedia => ({ id: `img:${img.id}`, proofId: "", proofTitle: "Images", kind: "image", label: `Images · ${img.caption?.trim() || img.kind} · ${img.createdAt.slice(0, 10)}`, url: `/api/deck-images/${img.id}`, downloadUrl: `/api/deck-images/${img.id}`, hasAlt: Boolean(img.caption?.trim()), showsAResult: img.kind === "proof" });
