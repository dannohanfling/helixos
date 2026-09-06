/** Second library wave: doctrine principles, frameworks and metaphors, courses, certification. Idempotent. */
import { eq } from "drizzle-orm";
import { db, schema } from "./index";
import { newId } from "@/lib/ids";
import principlesJson from "@/data/seed/original/principles.json";
import frameworksJson from "@/data/seed/original/frameworks.json";
import accelerator from "@/data/seed/original/curriculum_accelerator.json";
import exercises from "@/data/seed/original/exercises.json";
import certModulesJson from "@/data/seed/original/certification_modules.json";
import certDeliverablesJson from "@/data/seed/original/certification_deliverables.json";
import hooksJson from "@/data/seed/library/hooks.json";
import ctasJson from "@/data/seed/library/ctas.json";
import patternsJson from "@/data/seed/library/patterns.json";
import swipesJson from "@/data/seed/library/swipes.json";

type P = (typeof principlesJson)[number];
type F = (typeof frameworksJson)[number];

export async function seedDoctrine(): Promise<void> {
  let unnumbered = 0;
  for (const p of principlesJson as P[]) {
    const code = p.order > 0 ? p.code : `Ω-x${++unnumbered}`;
    const row = {
      code,
      order: p.order,
      symbol: p.symbol ?? null,
      greekName: p.greekName ?? null,
      name: p.name,
      summary: p.summary ?? null,
      doctrine: p.doctrine ?? null,
      greekStory: p.greekStory ?? null,
      stoicStory: p.stoicStory ?? null,
      businessCase: p.businessCase ?? null,
      publicFigureStory: p.publicFigureStory ?? null,
      scienceAnchor: p.scienceAnchor ?? null,
      personalStory: p.personalStory ?? null,
      clientStory: p.clientStory ?? null,
      reelScript: p.reelScript ?? null,
      trainingOutline: p.trainingOutline ?? null,
      salesPositioning: p.salesPositioning ?? null,
      layer: p.layer ?? null,
      phase: p.phase ?? null,
      pillar: p.pillar ?? null,
      hookAngle: p.hookAngle ?? null,
    };
    await db.insert(schema.principles).values(row).onConflictDoUpdate({ target: schema.principles.code, set: row });
  }
}

export async function seedFrameworks(): Promise<void> {
  const existing = await db.select({ id: schema.libraryAssets.id }).from(schema.libraryAssets).where(eq(schema.libraryAssets.type, "framework"));
  if (existing.length) return;
  const rows: (typeof schema.libraryAssets.$inferInsert)[] = [];
  for (const f of frameworksJson as F[]) {
    const body = [f.description, f.story, f.metaphor, f.simple].filter(Boolean).join("\n\n") || (f.phases ?? []).join("\n");
    if (!body.trim()) continue;
    rows.push({
      id: newId(),
      type: "framework",
      name: f.name.replace(/^Metaphor — /, ""),
      body,
      summary: f.oneLiner ?? f.promise ?? null,
      useWhen: f.useWhen ?? null,
      reframe: f.advanced ?? null,
      proof: f.proofAngle ?? null,
      tag: f.type ?? (f.phases?.length ? "Framework" : "Angle"),
      isExample: false,
      extra: {
        stage: f.stage ?? null,
        promise: f.promise ?? null,
        transitionIn: f.transitionIn ?? null,
        transitionOut: f.transitionOut ?? null,
        slideTitle: f.slideTitle ?? null,
        visual: f.visual ?? null,
        priority: f.priority ?? null,
        problem: f.problem ?? null,
        commonMistake: f.commonMistake ?? null,
        misunderstanding: f.misunderstanding ?? null,
        limitingBeliefs: f.limitingBeliefs ?? null,
        phases: f.phases?.length ? f.phases.join("\n") : null,
      },
    });
  }
  if (rows.length) await db.insert(schema.libraryAssets).values(rows);
  console.log(`Frameworks and metaphors: ${rows.length}`);
}

const WEEK_STAGE: Record<string, string> = { "Week 1": "onboarding", "Week 2": "system-install", "Week 3": "community", "Week 4": "community", "Week 5": "launch-first-conversion-event", "Week 6": "launch-first-conversion-event" };
const LAUNCH_PAD_ORDER = ["Start Here", "Start Smart", "Magnetic Messaging"];
const LAUNCH_PAD_STAGE: Record<string, string> = { "Start Here": "onboarding", "Start Smart": "onboarding", "Magnetic Messaging": "system-install" };

function splitName(raw: string): { name: string; objective: string | null } {
  const cleaned = raw.replace(/^✅\s*KBB Match:\s*/, "").trim();
  const [name, ...rest] = cleaned.split(/\s[–—-]\s/);
  return { name: name.trim(), objective: rest.length ? rest.join(" – ").trim() : null };
}

export async function seedCourses(): Promise<void> {
  const existing = await db.select({ id: schema.courses.id }).from(schema.courses);
  if (existing.length) return;
  let courseOrder = 0;
  let lessonCount = 0;
  const addCourse = async (program: string, name: string, description: string | null, tier: string | null, lessons: { name: string; objective?: string | null; prompts?: string | null; resources?: string | null; week?: string | null; stageKey?: string | null; points?: number }[]) => {
    const id = newId();
    await db.insert(schema.courses).values({ id, workspaceId: null, program, name, description, order: ++courseOrder, tier });
    if (lessons.length) {
      await db.insert(schema.lessons).values(lessons.map((l, i) => ({ id: newId(), courseId: id, order: i + 1, name: l.name, objective: l.objective ?? null, prompts: l.prompts ?? null, resources: l.resources ?? null, week: l.week ?? null, stageKey: l.stageKey ?? null, points: l.points ?? 15 })));
      lessonCount += lessons.length;
    }
  };

  // Launch Pad: mini-courses grouped by their course name.
  const lp = exercises.filter((e) => e.program === "Launch Pad");
  for (const courseName of LAUNCH_PAD_ORDER) {
    const items = lp.filter((e) => e.course === courseName);
    if (!items.length) continue;
    const ordered = courseName === "Start Here" ? ["Welcome to Evolve Omega", "The Evolve Omega Roadmap", "Core Values and Community Culture", "Get Your Evolve Omega Pass", "Your Next Steps"].map((n) => items.find((i) => i.name === n)).filter((x): x is (typeof items)[number] => Boolean(x)) : items;
    await addCourse("Launch Pad", courseName, courseName === "Start Here" ? "Get oriented, get your pass, and know the road ahead." : courseName === "Start Smart" ? "Niche, avatar, first offer, and how to talk so they lean in." : "Say the one thing your people need to hear.", "Mini", ordered.map((e) => ({ name: e.name, objective: e.outcome ?? e.summary ?? null, stageKey: LAUNCH_PAD_STAGE[courseName], points: 10 })));
  }

  // Accelerator: the 6-week build, one course per week. Duplicate rows in the source collapse to one lesson.
  const weeks = Array.from(new Set(accelerator.filter((c) => c.week).map((c) => c.week!))).sort();
  for (const week of weeks) {
    const rows = accelerator.filter((c) => c.week === week);
    const moduleName = rows[0]?.module ?? week;
    const seen = new Set<string>();
    const lessons = rows
      .filter((r) => {
        if (seen.has(r.name)) return false;
        seen.add(r.name);
        return true;
      })
      .map((r) => ({ name: r.name, objective: r.objective ?? null, prompts: r.prompts ?? null, resources: r.resources ?? null, week: `${week}${r.course ? ` · ${r.course}` : ""}`, stageKey: WEEK_STAGE[week] ?? null, points: 20 }));
    await addCourse("Accelerator", `${week} · ${moduleName}`, null, "6-week build", lessons);
  }
  const accEx = exercises.filter((e) => e.program === "Accelerator");
  if (accEx.length) await addCourse("Accelerator", "Accelerator exercises", "The full exercises. Each one produces an asset you'll use for years.", "Full", accEx.map((e) => ({ name: e.name, objective: e.outcome ?? e.summary ?? null, points: 25 })));

  // Academy: exercises, each with an outcome pulled from its name.
  const ac = exercises.filter((e) => e.program === "Academy");
  if (ac.length) await addCourse("Academy", "Academy exercises", "Return to these whenever the business needs a reset.", "Academy", ac.map((e) => ({ ...splitName(e.name), points: 20 })));
  console.log(`Courses: ${courseOrder}, lessons: ${lessonCount}`);
}

const CERT_MAP: Record<number, string[]> = {
  1: ["Prepare a client-ready implementation tracker", "Complete a simulated client handoff task"],
  2: ["Map the full customer journey", "Build a mock funnel"],
  3: ["Create a CRM pipeline", "Set up automations for registration and follow-up"],
  4: ["Build a mock chatbot", "Load a 5-email sequence", "Load reminder SMS"],
  5: ["Create a QA checklist and run it", "Diagnose and fix a broken workflow"],
  6: ["Submit a loom walkthrough of the finished system"],
};
const CERT_OBJECTIVES: Record<number, string> = {
  1: "Take a new client from signed to set up: intake, access, tracker, expectations.",
  2: "Organize the strategy layer so the build team knows exactly what to make.",
  3: "Build the funnel, the CRM pipeline, and the automations that move people through it.",
  4: "Wire the channels: chatbot, email, SMS, and wallet passes.",
  5: "Test everything, fix what breaks, and support the launch.",
  6: "Report on results, optimize, and keep the client informed.",
};
const EVIDENCE: Record<string, string> = { "Submit a loom walkthrough of the finished system": "Loom video", "Create a QA checklist and run it": "Checklist + screenshots", "Diagnose and fix a broken workflow": "Before/after screenshots", "Prepare a client-ready implementation tracker": "Shared doc link" };

export async function seedCertification(): Promise<void> {
  const existing = await db.select({ id: schema.certModules.id }).from(schema.certModules);
  if (existing.length) return;
  const ordered = (certModulesJson as { name: string; objective: string | null }[]).slice().sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0));
  const thresholds = new Map((certDeliverablesJson as { name: string; passThreshold: number }[]).map((d) => [d.name, d.passThreshold]));
  let count = 0;
  for (const m of ordered) {
    const n = Number(m.name.match(/\d+/)?.[0] ?? 0);
    const id = newId();
    await db.insert(schema.certModules).values({ id, order: n, name: m.name, objective: m.objective ?? CERT_OBJECTIVES[n] ?? null });
    const ds = CERT_MAP[n] ?? [];
    if (ds.length) {
      await db.insert(schema.certDeliverables).values(ds.map((name, i) => ({ id: newId(), moduleId: id, order: i + 1, name, evidenceType: EVIDENCE[name] ?? "Link or screenshot", passThreshold: thresholds.get(name) ?? 85 })));
      count += ds.length;
    }
  }
  console.log(`Certification: ${ordered.length} modules, ${count} deliverables`);
}

const TYPE_MAP: Record<string, string> = { "Value Post": "Quick Win / Pro-Tip", Quote: "Belief Shifting Post", "Short Bait": "CTA Post", "Written Post": "CTA Post", "Story Post": "Story Post" };

/** Shared swipe files: hooks, CTAs, post patterns and proven posts from the master and original bases. Loads once. */
export async function seedContentLibrary(): Promise<void> {
  const existing = await db.select({ id: schema.libraryPosts.id }).from(schema.libraryPosts).where(eq(schema.libraryPosts.source, "master"));
  if (existing.length) return;
  const rows: (typeof schema.libraryPosts.$inferInsert)[] = [];
  for (const h of hooksJson) rows.push({ id: newId(), kind: "hook", shared: true, title: h.name, hook: h.text, body: h.text, pillar: h.painPoint, tags: [h.painPoint], source: "master" });
  for (const c of ctasJson) rows.push({ id: newId(), kind: "cta", shared: true, title: c.name, cta: c.text, body: c.text, hasCta: true, source: "master" });
  for (const p of patternsJson) rows.push({ id: newId(), kind: "pattern", shared: true, title: p.name, contentType: p.contentType, hook: p.hook, body: p.body, cta: p.cta, hasCta: true, useWhen: p.useWhen, whyItWorks: p.whyItWorks, example: p.example, tags: p.tags, source: "master" });
  for (const sw of swipesJson as { title: string; hook: string | null; body: string; contentType: string | null; pillar: string | null; angle: string | null; ctaType: string | null; engagements: number | null; notes: string | null; audienceStage: string | null }[]) {
    const hasCta = Boolean(sw.ctaType && !/no cta/i.test(sw.ctaType));
    rows.push({ id: newId(), kind: "post", shared: true, title: sw.title, contentType: sw.contentType ? (TYPE_MAP[sw.contentType] ?? sw.contentType) : null, pillar: sw.pillar, angle: sw.angle, hook: sw.hook ?? null, body: sw.body, hasCta, useWhen: sw.audienceStage ? `Audience: ${sw.audienceStage}` : null, whyItWorks: sw.notes, tags: [sw.pillar, sw.angle, sw.ctaType].filter((x): x is string => Boolean(x)), engagements: sw.engagements ?? 0, source: "master" });
  }
  await db.insert(schema.libraryPosts).values(rows);
  console.log(`Content library: ${rows.length} shared entries`);
}

export async function seedLibraryWave2(): Promise<void> {
  await seedContentLibrary();
  await seedDoctrine();
  await seedFrameworks();
  await seedCourses();
  await seedCertification();
}
