import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { getIntegration, socialAccountMap } from "@/lib/integrations";
import type { GroupTarget } from "@/lib/engine/compose";
import type { Persona } from "@/components/channel-previews";

/** Everything the composer needs: the user's groups (own + top 3 + members), persona for previews, AI and Social Planner state. */
export async function composerContext(v: Viewer) {
  const [groups, ghl] = await Promise.all([
    db.query.groups.findMany({ where: eq(schema.groups.userId, v.user.id), orderBy: [asc(schema.groups.kind), asc(schema.groups.rank), asc(schema.groups.name)] }),
    getIntegration(v.workspace.id, "gohighlevel"),
  ]);
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
    aiEnabled: aiEnabled(),
    socialConnected: Boolean(ghl?.enabled && Object.keys(socialAccountMap(ghl.config)).length),
  };
}
