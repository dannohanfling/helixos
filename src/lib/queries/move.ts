import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MoveKind, MoveRow, MoveWorld } from "@/lib/engine/move";

/** The table each kind lives in; every one has a workspace and a user column, and the move rewrites only the user. */
export const MOVE_TABLES = {
  webinar: schema.webinars,
  offer: schema.offers,
  proof: schema.proofs,
  lead_magnet: schema.leadMagnets,
  image: schema.deckImages,
  evidence: schema.evidence,
  asset: schema.libraryAssets,
  client_record: schema.clientRecords,
} as const satisfies Record<MoveKind, unknown>;

/**
 * The coach's own rows in their workspace, as the move planner reads them: what each is called and what it points at. Only rows
 * the coach owns are listed, so a shared bank entry (no owner) or the starter shelf ("shared:<id>") never moves.
 */
export async function moveWorldFor(workspaceId: string, userId: string): Promise<MoveWorld & { onBot: Set<string> }> {
  const [webinars, offers, proofs, magnets, images, evidence, assets, clientRecords] = await Promise.all([
    db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, workspaceId), eq(schema.webinars.userId, userId)) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, workspaceId), eq(schema.offers.userId, userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId)) }),
    db.query.leadMagnets.findMany({ where: and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.userId, userId)) }),
    db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId)) }),
    db.query.evidence.findMany({ where: and(eq(schema.evidence.workspaceId, workspaceId), eq(schema.evidence.userId, userId)) }),
    db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.workspaceId, workspaceId), eq(schema.libraryAssets.userId, userId)) }),
    db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.workspaceId, workspaceId), eq(schema.clientRecords.userId, userId)) }),
  ]);
  const ids = webinars.map((w) => w.id);
  const [beliefs, sections, slots] = ids.length
    ? await Promise.all([
        db.query.webinarBeliefs.findMany({ where: inArray(schema.webinarBeliefs.webinarId, ids) }),
        db.query.webinarSections.findMany({ where: inArray(schema.webinarSections.webinarId, ids) }),
        db.query.deckSlots.findMany({ where: inArray(schema.deckSlots.webinarId, ids) }),
      ])
    : [[], [], []];
  const essence = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, workspaceId), eq(schema.essences.userId, userId)) });
  const essenceNames = (((essence?.data as Record<string, Record<string, unknown>> | undefined)?.representative_stories?.stories as { name?: string }[] | undefined) ?? []).map((s) => s.name ?? "");

  const ref = (kind: MoveKind, id: string | null | undefined) => (id ? [{ kind, id }] : []);
  const rows: MoveRow[] = [
    ...webinars.map((w) => ({
      kind: "webinar" as const,
      id: w.id,
      label: w.title,
      refs: [
        ...ref("offer", w.offerId),
        ...beliefs.filter((b) => b.webinarId === w.id).flatMap((b) => [...ref("proof", b.proofId), ...(b.storyAssetId?.startsWith("essence:") ? [] : ref("asset", b.storyAssetId)), ...(b.evidenceId?.startsWith("shared:") ? [] : ref("evidence", b.evidenceId))]),
        ...sections.filter((s) => s.webinarId === w.id).flatMap((s) => ref("asset", s.assetId)),
        ...slots.filter((s) => s.webinarId === w.id).flatMap((s) => ref("image", s.imageId)),
      ],
    })),
    ...offers.map((o) => ({ kind: "offer" as const, id: o.id, label: o.name, refs: o.objectionAssetIds.flatMap((a) => ref("asset", a)) })),
    ...proofs.map((p) => ({ kind: "proof" as const, id: p.id, label: p.name, refs: ref("client_record", p.clientRecordId) })),
    ...magnets.map((m) => ({ kind: "lead_magnet" as const, id: m.id, label: m.title, refs: ref("offer", m.offerId) })),
    ...images.map((i) => ({ kind: "image" as const, id: i.id, label: i.caption || `${i.kind} image`, refs: [] })),
    ...evidence.map((e) => ({ kind: "evidence" as const, id: e.id, label: e.title || e.claim, refs: [] })),
    ...assets.map((a) => ({ kind: "asset" as const, id: a.id, label: `${a.type}: ${a.name}`, refs: [] })),
    ...clientRecords.map((c) => ({ kind: "client_record" as const, id: c.id, label: c.name, refs: ref("offer", c.offerId) })),
  ];
  const essenceStories = beliefs
    .filter((b) => b.storyAssetId?.startsWith("essence:"))
    .map((b) => ({ webinarId: b.webinarId, name: essenceNames[Number(b.storyAssetId!.slice("essence:".length))] || "an Essence story" }));
  return { rows, essenceStories, onBot: new Set(offers.filter((o) => o.botRole !== "not_on_bot").map((o) => o.id)) };
}
