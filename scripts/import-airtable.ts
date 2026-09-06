/**
 * Pulls the "Universal" template content from a HelixOS Airtable base into src/data/seed/*.json.
 * Usage: AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... npm run import:airtable
 * Then: npm run db:seed -- --library-only   (or a full db:seed for the demo workspace)
 *
 * Field names below match the HelixOS MASTER TEMPLATE base. Adjust if your base renamed them.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID ?? "appz2UoSLKvSr4OWQ";
if (!API_KEY) {
  console.error("Set AIRTABLE_API_KEY (a personal access token with data.records:read on the base).");
  process.exit(1);
}

type Rec = { id: string; fields: Record<string, unknown> };

async function all(table: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { records: Rec[]; offset?: string };
    out.push(...json.records);
    offset = json.offset;
  } while (offset);
  return out;
}

const strip = (s: unknown) => String(s ?? "").replace(/^[^\w[]+/, "").trim();
const slug = (s: unknown) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? String(v[0] ?? "") : v == null ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || null);
const universal = (v: unknown) => String(v ?? "").includes("Universal");

async function main() {
  const outDir = path.join(process.cwd(), "src", "data", "seed");
  const write = (name: string, data: unknown) => {
    writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 1) + "\n");
    console.log(`wrote ${name}`);
  };

  const stagesRaw = await all("🛣️ Success Pathway Stages");
  const stages = stagesRaw
    .map((r) => ({
      key: slug(r.fields["📍 Stage Name"]),
      order: num(r.fields["🔢 Stage Order"]) ?? 99,
      icon: str(r.fields["🎨 Icon"]) ?? "",
      name: strip(r.fields["📍 Stage Name"]),
      track: strip(r.fields["🗺️ Track"]),
      tagline: str(r.fields["💬 Tagline"]),
      description: str(r.fields["📖 Description"]),
      entryCriteria: str(r.fields["✅ Entry Criteria"]),
      exitCriteria: str(r.fields["🏁 Exit Criteria"]),
      pointsAvailable: num(r.fields["🎯 Stage Points Available"]),
      expectedDuration: str(r.fields["⏳ Expected Duration"]),
      runsInParallel: Boolean(r.fields["↔️ Runs in Parallel"]),
    }))
    .sort((a, b) => a.order - b.order);
  const stageIdToKey = new Map(stagesRaw.map((r) => [r.id, slug(r.fields["📍 Stage Name"])]));
  write("stages.json", stages);

  const libRaw = await all("🏆 Success Task Library");
  const subMap: Record<string, string> = { Screenshot: "screenshot", Video: "video", Link: "link", "Written answer": "written", "Written Post": "written", "Checkbox only": "checkbox", "Self-Confirmation": "checkbox" };
  const library = libRaw
    .filter((r) => r.fields["💾 Active"] === true && !String(r.fields["👤 Who Does It"] ?? "").includes("Coach") && !String(r.fields["🎯 Task Name"] ?? "").startsWith("Advanced spec"))
    .map((r) => {
      const stageIds = (r.fields["🧭 Stage"] as string[] | undefined) ?? [];
      const eff = String(r.fields["💪 Effort Tier"] ?? "");
      const pr = String(r.fields["🚦 Priority Level"] ?? "");
      return {
        key: r.id,
        stage: stageIdToKey.get(stageIds[0]) ?? null,
        order: num(r.fields["🔢 Task Order"]) ?? 999,
        name: str(r.fields["🎯 Task Name"]),
        teaching: str(r.fields["📖 Teaching Copy"]),
        howTo: str(r.fields["✅ How to Complete"]),
        submissionType: subMap[strip(r.fields["🔍 Submission Type"])] ?? "written",
        points: num(r.fields["⭐ Points Value"]) ?? 10,
        effort: /Quick|Light/.test(eff) ? "quick" : /Medium/.test(eff) ? "medium" : /Heavy/.test(eff) ? "heavy" : /Deep|Multi/.test(eff) ? "deep" : "medium",
        priority: /Must/.test(pr) ? "must" : /Should/.test(pr) ? "should" : /Nice/.test(pr) ? "nice" : "optional",
        unlocks: str(r.fields["🔓 Unlocks"]),
        trainingUrl: str(r.fields["🔗 Training URL"]),
      };
    })
    .filter((t) => t.stage)
    .sort((a, b) => stages.findIndex((s) => s.key === a.stage) - stages.findIndex((s) => s.key === b.stage) || a.order - b.order);
  write("task_library.json", library);

  const curRaw = await all("📆 30-Day Curriculum");
  write(
    "curriculum.json",
    curRaw
      .map((r) => ({
        day: num(r.fields["🔢 Day"]) ?? 0,
        week: strip(r.fields["📅 Week"]),
        title: str(r.fields["📋 Day Task"]),
        type: strip(r.fields["🎯 Task Type"]),
        instructions: str(r.fields["📖 Instructions"]),
        estTime: strip(r.fields["⏱️ Est. Time"]),
        points: num(r.fields["⭐ Points"]) ?? 10,
        why: str(r.fields["💡 Why This Matters"]),
      }))
      .sort((a, b) => a.day - b.day),
  );

  const dmRaw = await all("💌 DM Library");
  write(
    "dm_library.json",
    dmRaw
      .filter((r) => String(r.fields["🚦 Status"] ?? "").includes("Active"))
      .map((r) => ({
        name: str(r.fields["📝 Message Name"]),
        sequence: strip(r.fields["🎯 Sequence"]),
        step: num(r.fields["🔢 Step Order"]) ?? 1,
        branch: str(r.fields["🌿 Branch"]),
        purpose: strip(r.fields["🎬 Purpose"]),
        body: str(r.fields["💬 Message Body"]),
        whyItWorks: str(r.fields["🧠 Why It Works"]),
        whenToSend: str(r.fields["📅 When to Send"]),
        tokens: ((r.fields["🏷️ Tokens Used"] as string[] | undefined) ?? []).map(String),
        universal: universal(r.fields["🧬 Template Status"]),
      }))
      .sort((a, b) => a.sequence.localeCompare(b.sequence) || a.step - b.step),
  );

  const tiersRaw = await all("🏅 Community Tiers");
  write(
    "tiers.json",
    tiersRaw
      .map((r) => ({
        level: num(r.fields["🔢 Level"]) ?? 0,
        name: str(r.fields["🏅 Tier Name"]),
        minPoints: num(r.fields["📉 Min Points"]) ?? 0,
        maxPoints: num(r.fields["📈 Max Points"]),
        color: strip(r.fields["🎨 Tier Color"]),
        welcome: str(r.fields["📣 Member-Facing Copy"]),
        signal: str(r.fields["🎯 What This Signals"]),
      }))
      .sort((a, b) => a.level - b.level),
  );

  const prizesRaw = await all("🎁 Prize Ladder");
  write(
    "prizes.json",
    prizesRaw
      .map((r) => ({
        name: strip(r.fields["🏆 Prize Name"]),
        pointsRequired: num(r.fields["🎯 Points Required"]) ?? 0,
        description: (str(r.fields["📝 Description"]) ?? "").trim(),
        tier: strip(r.fields["🏷️ Tier"]),
        status: strip(r.fields["🚦 Status"]),
      }))
      .sort((a, b) => a.pointsRequired - b.pointsRequired),
  );

  const rewardsRaw = await all("🎁 Pass Rewards");
  write(
    "rewards.json",
    rewardsRaw
      .map((r) => ({
        order: num(r.fields["🔢 Sort Order"]) ?? 0,
        name: str(r.fields["🎁 Reward Name"]),
        description: str(r.fields["📝 Description"]),
        pointsCost: num(r.fields["💎 Point Cost"]),
        tierRequired: strip(r.fields["🏅 Minimum Tier"]),
        unlockType: strip(r.fields["🔓 Unlock Model"]),
        category: strip(r.fields["🏷️ Reward Type"]),
        imageUrl: str(r.fields["🖼️ Image URL"]),
        value: num(r.fields["💎 Perceived Value"]),
        cap: num(r.fields["🪑 Spots Per Period"]),
        capPeriod: strip(r.fields["📅 Period"]),
        howToEarn: str(r.fields["📝 Internal Notes"]),
      }))
      .sort((a, b) => a.order - b.order),
  );
  console.log("Done. Now run: npm run db:seed -- --library-only");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
