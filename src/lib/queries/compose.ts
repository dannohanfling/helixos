import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { connectionFor } from "@/lib/ghl";
import { readiness } from "@/lib/engine/ghl-map";
import type { GroupTarget } from "@/lib/engine/compose";
import type { Persona } from "@/components/channel-previews";
import { visibleLibrary } from "./library-posts";
import { withAttribution } from "@/lib/engine/fathom";

/** Everything the composer needs: the user's groups (own + top 3 + members), persona for previews, AI and Social Planner state. */
export async function composerContext(v: Viewer) {
  const [groups, conn, lib, approvedProofs] = await Promise.all([
    db.query.groups.findMany({ where: eq(schema.groups.userId, v.user.id), orderBy: [asc(schema.groups.kind), asc(schema.groups.rank), asc(schema.groups.name)] }),
    connectionFor(v.user.id),
    visibleLibrary(v.workspace.id, v.user.id),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  // Approved proof only, a line or two with the name attached: a draft quote never reaches the composer.
  const snippets = {
    hooks: lib.filter((p) => p.kind === "hook").map((p) => ({ id: p.id, title: p.title, text: p.hook ?? p.body })),
    ctas: lib.filter((p) => p.kind === "cta").map((p) => ({ id: p.id, title: p.title, text: p.cta ?? p.body })),
    proofs: approvedProofs.map((p) => ({ id: p.id, title: p.name, text: p.quote ? withAttribution(p.hook ?? p.punchline ?? p.shortVersion ?? p.quote, p.who) : (p.hook ?? p.punchline ?? p.shortVersion ?? "") })).filter((p) => p.text),
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
  return {
    groups: ordered,
    persona,
    hashtag: v.membership.passHashtag,
    today: v.today,
    aiEnabled: await hasAiKey(),
    socialConnected: Boolean(conn && readiness(conn.mapping).mapped > 0),
    snippets,
  };
}
