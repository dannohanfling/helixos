/**
 * Danno's import: his CommunityLoyalty FAQ table in Airtable, read-only, into his HelixOS FAQ store, so his own bot is the
 * first test. Every Published row is imported and the count is what the source returned, never assumed; a Draft row stays in
 * Airtable. Airtable is never written. Each imported entry lands ai_unreviewed, as every entry does, and the Bot Brief
 * approves it before anything reaches the bot; a re-run updates an entry it already imported (matched on the Airtable record
 * id) rather than doubling it.
 *
 *   AIRTABLE_API_KEY=pat... AIRTABLE_FAQ_BASE_ID=app... AIRTABLE_FAQ_TABLE=tbl... npm run import:faq -- coach@demo.helixos.app
 *
 * The field names are the §1 report's: Question, Answer, Bot Answer, Alt Phrasings, Keywords, Category, Funnel Phase,
 * Canonical, Times Asked, Source URL, Call Date, Status. Only the ones the FAQ entry carries are read.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { fromAirtable, type AirtableFaqRecord } from "@/lib/engine/faq";

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_FAQ_BASE_ID;
const TABLE = process.env.AIRTABLE_FAQ_TABLE;
const email = process.argv[2];

if (!API_KEY || !BASE_ID || !TABLE || !email) {
  console.error("Usage: AIRTABLE_API_KEY=pat… AIRTABLE_FAQ_BASE_ID=app… AIRTABLE_FAQ_TABLE=tbl… npm run import:faq -- <owner email>");
  process.exit(1);
}

/** Every row the table returns, paged; read-only (GET), the only Airtable call this script makes. */
async function allRows(): Promise<AirtableFaqRecord[]> {
  const out: AirtableFaqRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE!)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { records: AirtableFaqRecord[]; offset?: string };
    out.push(...json.records);
    offset = json.offset;
  } while (offset);
  return out;
}

async function main() {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email!) });
  if (!user) throw new Error(`no user with email ${email}`);
  const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) });
  if (!membership) throw new Error(`${email} has no workspace membership`);
  const rows = await allRows();
  const mapped = rows.map(fromAirtable).filter((r): r is NonNullable<typeof r> => r !== null);
  const published = mapped.filter((r) => r.published);
  const drafts = mapped.length - published.length;
  console.log(`Airtable returned ${rows.length} rows: ${published.length} Published (imported), ${drafts} Draft (left in Airtable), ${rows.length - mapped.length} without a question or an answer (skipped).`);
  let inserted = 0;
  let updated = 0;
  const now = nowIso();
  for (const r of published) {
    const existing = await db.query.faqEntries.findFirst({ where: and(eq(schema.faqEntries.workspaceId, membership.workspaceId), eq(schema.faqEntries.userId, user.id), eq(schema.faqEntries.source, "airtable"), eq(schema.faqEntries.sourceRef, r.sourceRef)) });
    const values = { question: r.question, alsoAsked: r.alsoAsked, keywords: r.keywords, answer: r.answer, category: r.category, timesAsked: r.timesAsked, updatedAt: now };
    if (existing) {
      await db.update(schema.faqEntries).set(values).where(eq(schema.faqEntries.id, existing.id));
      updated++;
    } else {
      await db.insert(schema.faqEntries).values({ id: newId(), workspaceId: membership.workspaceId, userId: user.id, origin: "ai_unreviewed", source: "airtable", sourceRef: r.sourceRef, ...values });
      inserted++;
    }
  }
  console.log(`Imported into ${email}'s FAQ store: ${inserted} new, ${updated} updated. Every entry is a draft until accepted on the Bot Brief.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
