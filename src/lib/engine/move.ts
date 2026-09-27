/**
 * Moving the coach's own items to one of their clients (handoff 27 Sep: "Move to a client's workspace"). A client's material is
 * the rows their user owns, so a move changes the owner, and each row's children (an offer's components, a webinar's sections,
 * a proof's attachments) follow their parent with nothing to change. An item never moves alone: a webinar points at its offer,
 * its belief proofs, stories and evidence, its section assets and its deck images, and every page and the deck resolve those
 * against the owner's own material (rev 53), so a move carries what the picked items point at. Something a staying item also
 * points at is not carried, and the plan says so, as it does for what cannot move at all (a story in the coach's Essence). Pure:
 * the page reads the rows, this decides, the action writes exactly the plan the coach saw.
 */

export type MoveKind = "webinar" | "offer" | "proof" | "lead_magnet" | "image" | "evidence" | "asset" | "client_record";
export const MOVE_KIND_LABEL: Record<MoveKind, string> = {
  webinar: "Webinar",
  offer: "Offer",
  proof: "Proof",
  lead_magnet: "Lead magnet",
  image: "Image",
  evidence: "Evidence",
  asset: "Bank entry",
  client_record: "Client record",
};
/** What the coach ticks directly; bank entries and client records only ever move because a picked item points at them. */
export const PICKABLE: MoveKind[] = ["webinar", "offer", "proof", "lead_magnet", "image", "evidence"];

/** "offer:abc" pairs from a form or an address, pickable kinds only. */
export const parsePicks = (values: string[]): { kind: MoveKind; id: string }[] =>
  values.flatMap((v) => {
    const [kind, id] = v.split(":");
    return PICKABLE.includes(kind as MoveKind) && id ? [{ kind: kind as MoveKind, id }] : [];
  });

/** The coach's own rows, with only what the plan reads. `refs` are the ids each row points at, by kind. */
export type MoveRow = { kind: MoveKind; id: string; label: string; refs: { kind: MoveKind; id: string }[] };
export type MoveWorld = {
  rows: MoveRow[];
  /** Webinar stories that live in the coach's Essence ("essence:<n>"), by webinar id, with the story's name: they cannot move. */
  essenceStories: { webinarId: string; name: string }[];
};

export type PlannedMove = { kind: MoveKind; id: string; label: string; why: string };
export type MovePlan = { moves: PlannedMove[]; cannot: string[]; warnings: string[] };

const key = (k: MoveKind, id: string) => `${k}:${id}`;

export function planMove(world: MoveWorld, picked: { kind: MoveKind; id: string }[]): MovePlan {
  const byKey = new Map(world.rows.map((r) => [key(r.kind, r.id), r]));
  const moving = new Map<string, PlannedMove>();
  const cannot: string[] = [];
  const warnings: string[] = [];
  for (const p of picked) {
    const r = byKey.get(key(p.kind, p.id));
    if (r && !moving.has(key(r.kind, r.id))) moving.set(key(r.kind, r.id), { kind: r.kind, id: r.id, label: r.label, why: "picked" });
  }
  // Who points at a row, among all the coach's rows.
  const referrers = new Map<string, MoveRow[]>();
  for (const r of world.rows) for (const ref of r.refs) referrers.set(key(ref.kind, ref.id), [...(referrers.get(key(ref.kind, ref.id)) ?? []), r]);
  const staying = (k: string) => (referrers.get(k) ?? []).filter((r) => !moving.has(key(r.kind, r.id)));

  // Carry what the moving items point at, until nothing new is added. A row a staying item also points at is held back; it is
  // looked at again on the next pass, since the staying item may itself be carried meanwhile.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of [...moving.values()]) {
      for (const ref of byKey.get(key(m.kind, m.id))?.refs ?? []) {
        const k = key(ref.kind, ref.id);
        const target = byKey.get(k);
        if (!target || moving.has(k) || staying(k).length) continue;
        moving.set(k, { kind: target.kind, id: target.id, label: target.label, why: `${MOVE_KIND_LABEL[m.kind].toLowerCase()} "${m.label}" points at it` });
        changed = true;
      }
    }
  }
  // What the moving items point at that stays behind: the link stays, and resolves to nothing for the client.
  for (const m of moving.values()) {
    for (const ref of byKey.get(key(m.kind, m.id))?.refs ?? []) {
      const k = key(ref.kind, ref.id);
      const target = byKey.get(k);
      if (!target || moving.has(k)) continue;
      const users = staying(k).filter((r) => key(r.kind, r.id) !== key(m.kind, m.id));
      cannot.push(`${MOVE_KIND_LABEL[target.kind]} "${target.label}" stays with you, because ${users.map((u) => `${MOVE_KIND_LABEL[u.kind].toLowerCase()} "${u.label}"`).join(" and ")} also uses it. ${MOVE_KIND_LABEL[m.kind]} "${m.label}" will point at something the client can't see; pick both to move them together.`);
    }
  }
  // A picked row a staying item points at moves anyway (it was picked), and the staying item loses it.
  for (const m of moving.values()) {
    if (m.why !== "picked") continue;
    const users = staying(key(m.kind, m.id));
    if (users.length) warnings.push(`${MOVE_KIND_LABEL[m.kind]} "${m.label}" is also used by ${users.map((u) => `${MOVE_KIND_LABEL[u.kind].toLowerCase()} "${u.label}"`).join(" and ")}, which stays with you and will lose it.`);
  }
  for (const s of world.essenceStories) {
    const w = moving.get(key("webinar", s.webinarId));
    if (w) cannot.push(`The story "${s.name}" in webinar "${w.label}" lives in your Essence, which doesn't move. Add it to the client's Essence, or pick another story for that belief.`);
  }
  const order: MoveKind[] = ["webinar", "offer", "proof", "lead_magnet", "image", "evidence", "asset", "client_record"];
  const moves = [...moving.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label));
  return { moves, cannot, warnings };
}

/** A fingerprint of exactly what a plan moves: the Move button carries the one the coach saw, and a plan that changed moves nothing. */
export const planKey = (clientId: string, plan: MovePlan): string => [clientId, ...plan.moves.map((m) => key(m.kind, m.id)).sort()].join("|");
