/**
 * Read-only audit for rev 511 (5 Oct): which of a member's records point at another member's library entry (a story, an
 * objection), from before the library scope was fixed. Changes nothing. Run against production with its DATABASE_URL:
 *
 *   npx tsx --tsconfig tsconfig.json scripts/audit-library-scope.ts
 *
 * It prints, per workspace, each reference whose owner differs from the entry's owner (the record, its owner, the entry, the
 * entry's owner), and how many private entries each member had that every other member of the workspace could read. Names
 * only; nothing is sent anywhere and nothing is written.
 */
async function main() {
  const { db } = await import("@/db");
  const users = new Map((await db.query.users.findMany({ columns: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const who = (id: string | null) => (id ? (users.get(id) ?? `unknown user ${id.slice(0, 8)}`) : "nobody");
  const assets = await db.query.libraryAssets.findMany({ columns: { id: true, workspaceId: true, userId: true, name: true, type: true } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const webinars = new Map((await db.query.webinars.findMany({ columns: { id: true, userId: true, title: true, workspaceId: true } })).map((w) => [w.id, w]));
  const rows: { workspaceId: string; what: string; owner: string; entry: string; entryOwner: string }[] = [];
  const check = (workspaceId: string, ownerId: string, what: string, assetId: string | null | undefined) => {
    if (!assetId || assetId.startsWith("essence:")) return;
    const a = byId.get(assetId);
    if (!a || !a.userId || a.userId === ownerId) return;
    rows.push({ workspaceId, what, owner: who(ownerId), entry: `${a.type} "${a.name}"`, entryOwner: who(a.userId) });
  };
  for (const s of await db.query.webinarSections.findMany({ columns: { webinarId: true, name: true, assetId: true } })) {
    const w = webinars.get(s.webinarId);
    if (w) check(w.workspaceId, w.userId, `webinar "${w.title}", section ${s.name}`, s.assetId);
  }
  for (const b of await db.query.webinarBeliefs.findMany({ columns: { webinarId: true, type: true, storyAssetId: true } })) {
    const w = webinars.get(b.webinarId);
    if (w) check(w.workspaceId, w.userId, `webinar "${w.title}", ${b.type} belief story`, b.storyAssetId);
  }
  for (const o of await db.query.offers.findMany({ columns: { workspaceId: true, userId: true, name: true, objectionAssetIds: true } })) {
    for (const id of o.objectionAssetIds ?? []) check(o.workspaceId, o.userId, `offer "${o.name}", objections`, id);
  }
  const exposed = new Map<string, number>();
  for (const a of assets) if (a.workspaceId && a.userId) exposed.set(`${a.workspaceId}:${a.userId}`, (exposed.get(`${a.workspaceId}:${a.userId}`) ?? 0) + 1);

  console.log(`\nLibrary scope audit (read-only): ${rows.length} reference${rows.length === 1 ? "" : "s"} to another member's entry\n`);
  for (const r of rows) console.log(`- ${r.owner}: ${r.what} uses ${r.entry}, which is ${r.entryOwner}'s`);
  console.log(`\nPrivate entries every other member of the workspace could read before the fix:`);
  for (const [k, n] of [...exposed].sort((a, b) => b[1] - a[1])) console.log(`- ${who(k.split(":")[1])}: ${n}`);
  console.log("\nNothing was changed. After the fix these references no longer resolve: the section shows no story, and the coach or member picks their own.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
