import { and, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "./index";
import stages from "@/data/seed/stages.json";
import library from "@/data/seed/task_library.json";
import curriculum from "@/data/seed/curriculum.json";
import dmLibrary from "@/data/seed/dm_library.json";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { addDays, isWeekday, todayInTz } from "@/lib/dates";
import { streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { POINTS, closeActivityPoints, contentPoints } from "@/lib/engine/points";
import { SECTION_TEMPLATES } from "@/lib/engine/webinar";
import { repurposeAll } from "@/lib/engine/repurpose";
import stories from "@/data/seed/webinar/stories.json";
import analogies from "@/data/seed/webinar/analogies.json";
import objections from "@/data/seed/webinar/objections.json";
import beliefsSeed from "@/data/seed/webinar/beliefs.json";
import offerComponentsExample from "@/data/seed/webinar/offer_components_example.json";
import { seedLibraryWave2 } from "./seed-library2";
import { seedDemoWave2 } from "./seed-demo2";

type LibraryRow = (typeof library)[number];

export async function seedLibrary(): Promise<void> {
  for (const s of stages) {
    await db
      .insert(schema.pathwayStages)
      .values({ ...s, tagline: s.tagline ?? null, description: s.description ?? null, entryCriteria: s.entryCriteria ?? null, exitCriteria: s.exitCriteria ?? null })
      .onConflictDoUpdate({ target: schema.pathwayStages.key, set: { ...s } });
  }
  for (const t of library as LibraryRow[]) {
    const row = {
      key: t.key,
      stageKey: t.stage,
      order: t.order,
      name: t.name,
      teaching: t.teaching ?? null,
      howTo: t.howTo ?? null,
      submissionType: t.submissionType as schema.LibraryTask["submissionType"],
      points: t.points,
      effort: t.effort as schema.LibraryTask["effort"],
      priority: t.priority as schema.LibraryTask["priority"],
      unlocks: t.unlocks ?? null,
      trainingUrl: t.trainingUrl ?? null,
    };
    await db.insert(schema.libraryTasks).values(row).onConflictDoUpdate({ target: schema.libraryTasks.key, set: row });
  }
  for (const c of curriculum) {
    const row = { day: c.day, week: c.week, title: c.title, type: c.type, instructions: c.instructions ?? "", estTime: c.estTime ?? null, points: c.points ?? 10, why: c.why ?? null };
    await db.insert(schema.curriculumDays).values(row).onConflictDoUpdate({ target: schema.curriculumDays.day, set: row });
  }
  const existingTemplates = await db.query.dmTemplates.findMany({ where: eq(schema.dmTemplates.workspaceId, "" ) });
  void existingTemplates;
  const globalTemplates = await db.select({ id: schema.dmTemplates.id }).from(schema.dmTemplates).where(eq(schema.dmTemplates.sequence, "__probe__"));
  void globalTemplates;
  const count = await db.select({ id: schema.dmTemplates.id }).from(schema.dmTemplates);
  if (count.length === 0) {
    await db.insert(schema.dmTemplates).values(
      dmLibrary.map((m) => ({
        id: newId(),
        workspaceId: null,
        name: m.name,
        sequence: m.sequence,
        step: m.step ?? 1,
        branch: m.branch ?? null,
        purpose: m.purpose ?? null,
        body: m.body ?? "",
        whyItWorks: m.whyItWorks ?? null,
        whenToSend: m.whenToSend ?? null,
        tokens: m.tokens ?? [],
      })),
    );
  }
  const assetCount = await db.select({ id: schema.libraryAssets.id }).from(schema.libraryAssets);
  if (assetCount.length === 0) {
    type A = { name: string; body: string; universal?: boolean; useWhen?: string | null; summary?: string | null; reframe?: string | null; proof?: string | null; tag?: string | null };
    const rows: (typeof schema.libraryAssets.$inferInsert)[] = [];
    for (const st of stories as (A & { moral?: string; storyType?: string | null; beliefItHandles?: string | null })[]) {
      rows.push({ id: newId(), type: "story", name: st.name, body: st.body, summary: st.moral ?? null, useWhen: st.useWhen ?? null, tag: st.beliefItHandles ?? st.storyType ?? null, isExample: !st.universal });
    }
    for (const an of analogies as (A & { concept?: string | null; emotion?: string | null })[]) {
      rows.push({ id: newId(), type: "analogy", name: an.name, body: an.body, summary: an.concept ?? null, useWhen: an.useWhen ?? null, tag: an.emotion ?? null, isExample: !an.universal });
    }
    for (const ob of objections as (A & { objectionType?: string | null; stage?: string | null; storyResponse?: string | null })[]) {
      rows.push({ id: newId(), type: "objection", name: ob.name, body: ob.body, reframe: ob.reframe ?? null, proof: ob.proof ?? null, useWhen: ob.stage ?? null, tag: ob.objectionType ?? null, isExample: !ob.universal });
    }
    for (const be of beliefsSeed as (A & { beliefType?: string | null; howWeHandleIt?: string | null })[]) {
      rows.push({ id: newId(), type: "belief", name: be.name, body: be.body, reframe: be.howWeHandleIt ?? null, proof: be.proof ?? null, tag: be.beliefType ?? null, isExample: !be.universal });
    }
    await db.insert(schema.libraryAssets).values(rows);
    console.log(`Library assets: ${rows.length}`);
  }
  console.log(`Library: ${stages.length} stages, ${library.length} tasks, ${curriculum.length} curriculum days, ${dmLibrary.length} DM templates`);
  await seedLibraryWave2();
}

const DEMO_SLUG = "evolve-omega-demo";

async function wipeDemo(): Promise<void> {
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, DEMO_SLUG) });
  if (!ws) return;
  const members = await db.query.memberships.findMany({ where: eq(schema.memberships.workspaceId, ws.id) });
  const userIds = members.map((m) => m.userId);
  const byWs = [schema.tasks, schema.contentItems, schema.contacts, schema.dailyLogs, schema.pointsLedger, schema.pathwayProgress, schema.curriculumProgress, schema.goals, schema.rewardClaims, schema.offers, schema.webinars, schema.clientRecords, schema.proofs, schema.groups, schema.targets, schema.lessonProgress, schema.certSubmissions, schema.integrations, schema.syncEvents, schema.memberships] as const;
  if (userIds.length) await db.delete(schema.libraryAssets).where(inArray(schema.libraryAssets.userId, userIds));
  for (const t of byWs) await db.delete(t).where(eq(t.workspaceId, ws.id));
  await db.delete(schema.dmTemplates).where(eq(schema.dmTemplates.workspaceId, ws.id));
  if (userIds.length) {
    await db.delete(schema.messages).where(inArray(schema.messages.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
}

export async function seedDemo(): Promise<void> {
  await wipeDemo();
  const tz = "America/Los_Angeles";
  const today = todayInTz(tz);
  const wsId = newId();
  await db.insert(schema.workspaces).values({
    id: wsId,
    name: "Evolve Omega Academy",
    slug: DEMO_SLUG,
    timezone: tz,
    clientInviteCode: "ACADEMY1",
    coachInviteCode: "COACH001",
    brandVoice: "Direct. Clear. Punchy. Heart-led, not fluffy. 4th-grade reading level. Short sentences.",
    airtableBaseId: "appz2UoSLKvSr4OWQ",
  });
  const password = await hashPassword("demo1234");
  const coachId = newId();
  const clientId = newId();
  const client2Id = newId();
  await db.insert(schema.users).values([
    { id: coachId, email: "coach@demo.helixos.app", name: "Danno Hanfling", passwordHash: password, avatarEmoji: "🔱" },
    { id: clientId, email: "client@demo.helixos.app", name: "Maya Torres", passwordHash: password, avatarEmoji: "🌊" },
    { id: client2Id, email: "client2@demo.helixos.app", name: "Jordan Lee", passwordHash: password, avatarEmoji: "🔥" },
  ]);
  await db.insert(schema.memberships).values([
    { id: newId(), workspaceId: wsId, userId: coachId, role: "coach", startedAt: addDays(today, -120) },
    { id: newId(), workspaceId: wsId, userId: clientId, role: "client", programTier: "Elite", passEnabled: true, passName: "Torres Nutrition Community Pass", passHashtag: "#showedup", businessName: "Torres Nutrition Coaching", bigPromise: "I help busy moms drop 15 lbs in 90 days without giving up wine or weekends.", startedAt: addDays(today, -24) },
    { id: newId(), workspaceId: wsId, userId: client2Id, role: "client", businessName: "Lee Leadership Lab", startedAt: addDays(today, -50) },
  ]);

  await seedClientActivity(wsId, clientId, today, { days: 24, missDays: [addDays(today, -9), addDays(today, -16)], intensity: 1 });
  await seedBusinessAssets(wsId, clientId, today);
  await seedClientActivity(wsId, client2Id, today, { days: 50, missDays: [today, addDays(today, -1), addDays(today, -2), addDays(today, -3), addDays(today, -4)], intensity: 0.6 });
  await seedDemoWave2(wsId, clientId, client2Id, today);
  console.log("Demo workspace ready. Coach: coach@demo.helixos.app / demo1234 · Client: client@demo.helixos.app / demo1234 · Client invite code: ACADEMY1");
}

async function seedBusinessAssets(workspaceId: string, userId: string, today: string): Promise<void> {
  // Offer
  const offerId = newId();
  await db.insert(schema.offers).values({
    id: offerId,
    workspaceId,
    userId,
    name: "90-Day Reset",
    status: "live",
    avatar: "Busy moms of school-age kids who've tried every diet and keep quitting by week three.",
    coreProblem: "I lose 10 pounds and gain it back every single time. I'm sick of starting over.",
    promise: "I help busy moms drop 15 lbs in 90 days without giving up wine or weekends.",
    mechanismName: "The 12-Minute Tuesday System",
    pathSteps: ["Reset", "Rhythm", "Results"],
    container: "Group program",
    length: "90 days",
    price: 1500,
    paymentPlan: "3 x $550",
    guarantee: "Follow the plan for 90 days and don't lose 10 lbs? I coach you free until you do.",
    whyNow: "Next cohort opens Monday. 12 seats.",
    oneBelief: "If they believe the plan does the work and they only have to follow it, they buy.",
    difference: "Every other plan asks for 3 hours on Sunday. This asks for 12 minutes on Tuesday.",
    whyTrust: "47 moms through the program. Average 14 lbs at day 90. I've done it myself, twice.",
    howItWorks: "Two 30-minute group calls a week, a daily check-in, templates for every meal.",
    forYouIf: "You'll show up to two calls a week and follow the plan even when it's boring.",
    notForYouIf: "You want a magic pill or you won't do the daily check-in.",
    objTime: "It's 12 minutes on a Tuesday. You spend longer picking a show.",
    objMoney: "It's less than the groceries you throw away each month.",
    objPartner: "Bring them to the call. Most partners want this for you more than you do.",
    objTriedBefore: "You didn't fail the plans. The plans failed you: no rhythm, no accountability.",
    objDiy: "You could. You haven't. That's the whole point.",
  });
  const comps = [
    { name: "The 90-Day Reset program", type: "core" as const, perceivedValue: 3000, beliefBreak: "vehicle" as const, description: "Two 30-minute group calls a week for 12 weeks." },
    { name: "Every-meal template library", type: "bonus" as const, perceivedValue: 497, beliefBreak: "internal" as const, description: "You don't plan. You pick." },
    { name: "Weekend & Wine Playbook", type: "bonus" as const, perceivedValue: 297, beliefBreak: "external" as const, description: "How to eat out, drink, and still lose." },
    { name: "Daily check-in with me", type: "bonus" as const, perceivedValue: 1200, beliefBreak: "internal" as const, description: "Text me your plate. I reply." },
    { name: "Free until you lose 10", type: "guarantee" as const, perceivedValue: 0, beliefBreak: "none" as const, description: "" },
  ];
  await db.insert(schema.offerComponents).values(comps.map((c, i) => ({ id: newId(), offerId, order: i + 1, ...c })));
  const draftOfferId = newId();
  await db.insert(schema.offers).values({ id: draftOfferId, workspaceId, userId, name: "Holiday Survival Sprint", status: "draft", promise: "Get through the holidays without gaining", price: 297, container: "Workshop" });
  await db.insert(schema.offerComponents).values(
    (offerComponentsExample as { name: string; type: string; description: string | null; perceivedValue: number | null }[]).slice(0, 2).map((c, i) => ({ id: newId(), offerId: draftOfferId, order: i + 1, name: c.name, type: c.type === "core" ? ("core" as const) : ("bonus" as const), description: c.description, perceivedValue: c.perceivedValue ?? 0, beliefBreak: "none" as const })),
  );

  // Webinars: the worked example + one in progress
  const exampleId = newId();
  await db.insert(schema.webinars).values({
    id: exampleId,
    workspaceId,
    userId,
    title: "The Leaky Webinar (worked example)",
    status: "delivered",
    isExample: true,
    audience: "Coaches and course creators who've run at least one launch that did 'okay'.",
    coreProblem: "80% of my leads vanish by Friday and I don't know why.",
    desiredResult: "A pipeline that remembers every lead and keeps selling for 14 days.",
    promise: "In 75 minutes, see exactly how to give your pipeline a brain.",
    mechanismName: "The Synchronized Journey Framework",
    ctaType: "Book a call",
    scheduledAt: `${addDays(today, -21)}T18:00:00`,
    registered: 212,
    showed: 81,
    offersMade: 81,
    callsBooked: 14,
    sales: 6,
    revenue: 29400,
    debriefLeak: "Drop-off at the internal case study. Too long.",
    debriefFix: "Cut Dave's story to 90 seconds. Move proof block earlier.",
    debriefWins: "38% show-up. Six sales from 81 in the room.",
  });
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => ({ id: newId(), webinarId: exampleId, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, keyPoints: t.exampleKeyPoints, script: t.exampleScript, transitionIn: t.exampleTransition?.split("|")[0]?.replace("In:", "").trim() ?? null, transitionOut: t.exampleTransition?.split("|")[1]?.replace("Out:", "").trim() ?? null, status: "final" as const })),
  );
  await db.insert(schema.webinarBeliefs).values([
    { id: newId(), webinarId: exampleId, type: "vehicle", fromBelief: "I've tried funnels before. This is just better email automation.", toBelief: "This is a different vehicle. Pipeline amnesia can't be fixed by improving any single channel.", proof: "11% to 38% show-up without changing ads." },
    { id: newId(), webinarId: exampleId, type: "internal", fromBelief: "I'm not technical enough to wire this up.", toBelief: "I don't need to invent. I follow four steps in order.", proof: "44 of 47 installs finished in 4 weeks. Zero were systems people." },
    { id: newId(), webinarId: exampleId, type: "external", fromBelief: "Organic reach is dying and big players will crush me.", toBelief: "Channel decay is my moat. Their broken channels are my advantage.", proof: "Terri: $71K launch the week Meta broke." },
  ]);
  await db.insert(schema.readinessReviews).values({ id: newId(), webinarId: exampleId, ratings: { promise: 5, audience: 5, vehicle: 5, internal: 4, external: 4, proof: 5, stories: 4, offer: 5, cta: 4, objections: 4, convert: 5 }, score: 91, verdict: "ready", biggestGaps: "Internal case study runs long.", nextActions: "Trim Dave to 90 seconds." });

  const wipId = newId();
  await db.insert(schema.webinars).values({
    id: wipId,
    workspaceId,
    userId,
    title: "Eat Like a Grown-Up: lose the first 5 lbs without giving up wine",
    status: "building",
    audience: "Busy moms of school-age kids who've tried every diet and quit by week three.",
    coreProblem: "I lose 10 lbs and gain it back every time. I'm sick of starting over.",
    desiredResult: "To stop starting over. To trust themselves around food.",
    promise: "Leave with a 12-minute Tuesday plan and the 3 swaps that drop the first 5 lbs in 14 days.",
    mechanismName: "The 12-Minute Tuesday System",
    offerId,
    ctaType: "Book a call",
    scheduledAt: `${addDays(today, 9)}T17:00:00`,
  });
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => {
      const done = t.order <= 6;
      return { id: newId(), webinarId: wipId, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, keyPoints: done ? t.exampleKeyPoints.replace(/pipeline|lead/gi, "meal plan") : null, script: done ? `[Drafted] ${t.exampleScript.split(". ").slice(0, 2).join(". ")}.` : null, status: done ? ("drafted" as const) : ("todo" as const) };
    }),
  );
  await db.insert(schema.webinarBeliefs).values([
    { id: newId(), webinarId: wipId, type: "vehicle", fromBelief: "Diets are all the same. I just need more willpower.", toBelief: "It was never willpower. It was the plan. A 12-minute rhythm beats a 3-hour Sunday.", proof: "47 moms, average 14 lbs at day 90." },
    { id: newId(), webinarId: wipId, type: "internal", fromBelief: "I always quit by week three.", toBelief: "Quitting was the plan's fault. With a daily check-in, nobody quits alone.", proof: "Sarah: 11 lbs, week 6, wine on Saturday." },
    { id: newId(), webinarId: wipId, type: "external", fromBelief: "My family, my schedule, the holidays. Life won't let me.", toBelief: "The system is built for real life. Weekends and wine are in the plan, not against it." },
  ]);

  // Clients
  const clients = [
    { name: "Sarah Kim", emoji: "💪", goal: "Down 15 lbs by Thanksgiving and keep it off through the holidays.", fear: "Gaining it all back in December.", roadblock: "Sunday meal prep never happens.", start: -45, last: -3, next: 2, checkins: [{ d: -3, wins: "Down 11 lbs. Had wine Saturday and didn't spiral.", blockers: "Late-night snacking on work nights.", next: "Pre-plate the 9pm snack.", m: 8, e: 7, b: 6, cash: 0, nps: 10 }, { d: -10, wins: "Hit both calls. Meal templates working.", blockers: "Travel week.", next: "Pack the Tuesday kit.", m: 7, e: 6, b: 6, cash: 0, nps: 9 }] },
    { name: "Dana Whitfield", emoji: "🌱", goal: "Stop the yo-yo. Fit the jeans by her 40th.", fear: "Being the before photo forever.", roadblock: "Kids' schedules eat every evening.", start: -20, last: -9, next: null, checkins: [{ d: -9, wins: "First full week without skipping the check-in.", blockers: "Birthday parties.", next: "One plate rule at parties.", m: 6, e: 5, b: 7, cash: 550, nps: 8 }] },
    { name: "Priya Natarajan", emoji: "🔥", goal: "Get back to pre-baby energy and 12 lbs.", fear: "Never feeling like herself again.", roadblock: "Sleep.", start: -2, last: null, next: 2, checkins: [] },
    { name: "Marcus Bell", emoji: "🏋️", goal: "Lose 20 lbs before the wedding in spring.", fear: "Looking soft in the photos.", roadblock: "Weekend beers.", start: -60, last: -1, next: 6, status: "completed" as const, checkins: [{ d: -1, wins: "Graduated. 22 lbs down.", blockers: "", next: "Alumni check-in monthly.", m: 9, e: 9, b: 8, cash: 0, nps: 10 }] },
  ];
  for (const c of clients) {
    const id = newId();
    await db.insert(schema.clientRecords).values({ id, workspaceId, userId, name: c.name, avatarEmoji: c.emoji, status: c.status ?? "active", offerId, programName: "90-Day Reset", startDate: addDays(today, c.start), goal90: c.goal, fear: c.fear, roadblock: c.roadblock, lastCheckinAt: c.last === null ? null : addDays(today, c.last), nextCallAt: c.next === null ? null : `${addDays(today, c.next)}T17:00:00`, checkinCadenceDays: 7 });
    if (c.checkins.length) {
      await db.insert(schema.clientCheckins).values(c.checkins.map((k) => ({ id: newId(), clientRecordId: id, userId, date: addDays(today, k.d), kind: "checkin" as const, wins: k.wins, blockers: k.blockers || null, nextStep: k.next, mindset: k.m, energy: k.e, business: k.b, cashCollected: k.cash, nps: k.nps })));
    }
    const pts = [
      { p: 10, r: "Posted with #showedup · day 1", d: -6 },
      { p: 20, r: "Posted with #showedup · day 2", d: -5 },
      { p: 40, r: "Posted with #showedup · day 3", d: -4 },
      { p: 25, r: "Posted a win in the group", d: -3 },
    ].slice(0, c.name === "Sarah Kim" ? 4 : c.name === "Priya Natarajan" ? 1 : 2);
    if (pts.length) await db.insert(schema.memberPoints).values(pts.map((x) => ({ id: newId(), clientRecordId: id, userId, points: x.p, reason: x.r, syncStatus: "local" as const, createdAt: `${addDays(today, x.d)}T16:00:00.000Z` })));
  }

  // Content variants for the top posted item
  const posted = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.userId, userId), eq(schema.contentItems.status, "posted")) });
  if (posted) {
    const drafts = repurposeAll({ title: posted.title, hook: posted.hook, body: posted.body, hasCta: posted.hasCta, hashtag: "#showedup", firstName: null });
    await db.insert(schema.contentVariants).values(
      drafts.map((d, i) => ({ id: newId(), contentItemId: posted.id, userId, channel: d.channel, body: d.body, subject: d.subject ?? null, status: i < 4 ? ("posted" as const) : i < 6 ? ("scheduled" as const) : ("draft" as const), postedAt: i < 4 ? `${addDays(today, -5 + i)}T16:00:00.000Z` : null, reactions: i < 4 ? 12 * (4 - i) : 0, comments: i < 4 ? 3 * (4 - i) : 0, dms: i < 4 ? (i === 0 ? 4 : 1) : 0, leads: i === 0 ? 2 : 0 })),
    );
  }
}

async function seedClientActivity(
  workspaceId: string,
  userId: string,
  today: string,
  opts: { days: number; missDays: string[]; intensity: number },
): Promise<void> {
  const ctx = { workspaceId, userId };
  const ledger: (typeof schema.pointsLedger.$inferInsert)[] = [];
  const push = (type: schema.PointsEntry["type"], points: number, reason: string, refId: string | null, createdAt: string) =>
    ledger.push({ id: newId(), workspaceId, userId, type, points, reason, refId, createdAt });

  // Pathway: everyone starts with the full library as todo.
  const lib = await db.query.libraryTasks.findMany();
  const stagesRows = await db.query.pathwayStages.findMany({ orderBy: schema.pathwayStages.order });
  const stageOrder = new Map(stagesRows.map((s) => [s.key, s.order]));
  const ordered = lib.slice().sort((a, b) => (stageOrder.get(a.stageKey)! - stageOrder.get(b.stageKey)!) || a.order - b.order);
  const verifiedCount = Math.round(18 * opts.intensity);
  const progressRows = ordered.map((t, i) => {
    const daysAgo = Math.max(1, opts.days - Math.floor((i / Math.max(verifiedCount, 1)) * (opts.days - 2)));
    const when = `${addDays(today, -daysAgo)}T17:30:00.000Z`;
    if (i < verifiedCount) {
      push("pathway", t.points, `Pathway: ${t.name}`, t.key, when);
      return { id: newId(), workspaceId, userId, libraryTaskKey: t.key, status: "verified" as const, submittedAt: when, verifiedAt: when, verifiedBy: "coach", submissionText: "Done — posted in the group." };
    }
    if (i === verifiedCount) return { id: newId(), workspaceId, userId, libraryTaskKey: t.key, status: "submitted" as const, submittedAt: `${addDays(today, -1)}T20:10:00.000Z`, submissionText: "Draft attached. Went with the 3-step version.", submissionUrl: "https://www.facebook.com/groups/example/posts/1" };
    if (i === verifiedCount + 1) return { id: newId(), workspaceId, userId, libraryTaskKey: t.key, status: "revision" as const, submittedAt: `${addDays(today, -3)}T20:10:00.000Z`, submissionText: "First pass.", coachFeedback: "Good start. Make the promise measurable: what number, by when? Resubmit and it's yours." };
    return { id: newId(), workspaceId, userId, libraryTaskKey: t.key, status: "todo" as const };
  });
  await db.insert(schema.pathwayProgress).values(progressRows);

  // 30-day curriculum
  const cur = await db.query.curriculumDays.findMany({ orderBy: schema.curriculumDays.day });
  const doneDays = Math.min(cur.length, Math.round(Math.min(opts.days, 30) * 0.55 * opts.intensity + 3));
  await db.insert(schema.curriculumProgress).values(
    cur.slice(0, doneDays).map((c, i) => {
      const when = `${addDays(today, -(doneDays - i))}T16:00:00.000Z`;
      push("curriculum", c.points, `Day ${c.day}: ${c.title}`, `day:${c.day}`, when);
      return { id: newId(), workspaceId, userId, day: c.day, completedAt: when };
    }),
  );

  // Daily logs
  const closed = new Set<string>();
  const wins = [
    "Booked a call from a cold DM. First one ever.",
    "Posted before 9am. Didn't overthink it.",
    "Two people replied to the hashtag post.",
    "Finished the Big Promise. It actually sounds like me now.",
    "Client said the meal plan changed her week.",
    "Hit 3 DMs before lunch.",
    "Said no to a discount. Held the price.",
  ];
  let cash = 0;
  for (let d = opts.days; d >= 0; d--) {
    const date = addDays(today, -d);
    if (!isWeekday(date) && d !== 0) continue;
    if (opts.missDays.includes(date)) continue;
    const isToday = d === 0;
    const seed = (d * 7919) % 13;
    const numbers = {
      dmsStarted: Math.round((2 + (seed % 4)) * opts.intensity),
      conversations: Math.round((1 + (seed % 3)) * opts.intensity),
      callsBooked: seed % 5 === 0 ? 1 : 0,
      callsHeld: seed % 7 === 0 ? 1 : 0,
      posts: seed % 2 === 0 ? 1 : 0,
      offersMade: seed % 6 === 0 ? 1 : 0,
      newLeads: seed % 4 === 0 ? 1 : 0,
      cashCollected: seed % 9 === 0 ? 1500 : 0,
    };
    cash += numbers.cashCollected;
    const morningAt = `${date}T15:05:00.000Z`;
    const eveningAt = `${date}T01:10:00.000Z`;
    const closeIt = !isToday;
    const streakDay = closeIt ? weeklyStreakDay(closed, date) : 0;
    if (closeIt) closed.add(date);
    await db.insert(schema.dailyLogs).values({
      id: newId(),
      workspaceId,
      userId,
      date,
      morningDoneAt: morningAt,
      eveningDoneAt: closeIt ? eveningAt : null,
      energy: 3 + (seed % 3),
      intention: ["Three real conversations before noon.", "Ship the objection post.", "Follow up with everyone who replied.", "Protect the morning block."][seed % 4],
      ...(closeIt ? numbers : { dmsStarted: 0, conversations: 0, callsBooked: 0, callsHeld: 0, posts: 0, offersMade: 0, newLeads: 0, cashCollected: 0 }),
      start: closeIt ? "Batch DMs into one 30-minute block." : null,
      stop: closeIt ? "Checking notifications between tasks." : null,
      keep: closeIt ? "Posting before I open my inbox." : null,
      win: closeIt ? wins[seed % wins.length] : null,
      streakDay,
      createdAt: morningAt,
    });
    push("checkin", POINTS.checkin, "Morning lock-in", date, morningAt);
    if (closeIt) {
      push("close", POINTS.close, "Closed the day", date, eveningAt);
      const bonus = streakBonus(streakDay);
      if (bonus) push("streak", bonus, `Streak day ${streakDay}`, date, eveningAt);
      const act = closeActivityPoints(numbers);
      if (act.total) push("dm", act.total, `Daily activity: ${act.lines.map((l) => l.label).join(", ")}`, `activity:${date}`, eveningAt);
    }
  }

  // Goal
  await db.insert(schema.goals).values({ id: newId(), workspaceId, userId, title: "Cash collected this month", target: 5000, actual: Math.min(cash, 4500), unit: "$", period: "This month", primary: true });

  // Tasks
  const taskDefs: { title: string; details?: string; urgency: schema.Task["urgency"]; category: schema.Task["category"]; due: number; done?: boolean; focus?: boolean; repeat?: number }[] = [
    { title: "Reach out to 3 people in your audience", details: "Not a pitch. Recognition first. Log each in Conversations.", urgency: "top3", category: "sales", due: 0, focus: true, repeat: 1 },
    { title: "Post today's hashtag update", details: "What you're working on. What you finished. Short beats perfect.", urgency: "top3", category: "content", due: 0, focus: true, repeat: 1 },
    { title: "Follow up with Priya about the call time", urgency: "top3", category: "sales", due: 0, focus: true },
    { title: "Record the 'why most diets fail' reel", details: "60 seconds. Hook in the first 3 seconds.", urgency: "high", category: "content", due: 0 },
    { title: "Send welcome sequence to the 4 new group members", urgency: "high", category: "community", due: -1 },
    { title: "Update the lead magnet landing page headline", urgency: "medium", category: "system", due: -2 },
    { title: "Draft the Thursday email", urgency: "medium", category: "content", due: 2 },
    { title: "Book tech rehearsal for the workshop", urgency: "high", category: "system", due: 3 },
    { title: "Ask Sarah for a testimonial", urgency: "medium", category: "fulfillment", due: 4 },
    { title: "Review last week's numbers", urgency: "low", category: "admin", due: 5, repeat: 7 },
    { title: "Write the objection post", urgency: "high", category: "content", due: -3, done: true },
    { title: "Set up the community welcome post", urgency: "high", category: "community", due: -5, done: true },
    { title: "Choose the offer container", urgency: "top3", category: "system", due: -6, done: true },
    { title: "Reach out to 3 people in your audience", urgency: "top3", category: "sales", due: -1, done: true },
    { title: "Post yesterday's hashtag update", urgency: "top3", category: "content", due: -1, done: true },
  ];
  const taskRows = taskDefs.map((t) => {
    const due = addDays(today, t.due);
    const id = newId();
    if (t.done) push("task", t.urgency === "top3" ? POINTS.top3Task : POINTS.task, `Task: ${t.title}`, id, `${due}T22:00:00.000Z`);
    return {
      id,
      workspaceId,
      userId,
      title: t.title,
      details: t.details ?? null,
      urgency: t.urgency,
      category: t.category,
      dueDate: due,
      status: t.done ? ("done" as const) : t.due <= 0 ? ("today" as const) : ("upcoming" as const),
      focusDate: t.focus && !t.done ? today : t.done && t.urgency === "top3" ? due : null,
      completedAt: t.done ? `${due}T22:00:00.000Z` : null,
      points: t.urgency === "top3" ? POINTS.top3Task : POINTS.task,
      repeatEveryDays: t.repeat ?? null,
      createdAt: `${addDays(due, -2)}T15:00:00.000Z`,
    };
  });
  await db.insert(schema.tasks).values(taskRows);

  // Content
  const contentDefs: { title: string; type: string; platform: string; status: schema.ContentItem["status"]; cta?: boolean; day: number; hook?: string; eng?: number; views?: number; leads?: number }[] = [
    { title: "Why most diets fail by week 3 (and the fix)", type: "Belief Shifting Post", platform: "FB Group", status: "posted", day: -6, hook: "It's not willpower. It's the plan.", eng: 42, views: 1150, leads: 3 },
    { title: "Client win: Sarah, down 11 lbs, still drinking wine", type: "Client Win", platform: "FB Personal", status: "posted", cta: true, day: -4, eng: 67, views: 2300, leads: 5 },
    { title: "The 5-minute grocery list swap", type: "Quick Win / Pro-Tip", platform: "IG Reels", status: "posted", day: -2, eng: 210, views: 8900, leads: 2 },
    { title: "Question: what's the meal that always derails you?", type: "Question Post", platform: "FB Group", status: "posted", day: -1, eng: 31, views: 640 },
    { title: "Objection post: 'I don't have time to meal prep'", type: "Belief Shifting Post", platform: "FB Group", status: "scheduled", cta: true, day: 0, hook: "You don't need 3 hours on Sunday. You need 12 minutes on Tuesday." },
    { title: "Reel: why most diets fail", type: "Short Form Video", platform: "IG Reels", status: "creating", day: 0 },
    { title: "Thursday email: the 90-day promise", type: "Email", platform: "Email", status: "ready", cta: true, day: 2 },
    { title: "Story post: the day I quit counting calories", type: "Story Post", platform: "FB Personal", status: "scheduled", day: 3 },
    { title: "Workshop invite: 'Eat Like a Grown-Up' live training", type: "CTA Post", platform: "FB Group", status: "idea", cta: true, day: 5 },
    { title: "LIVE: Q&A on weekend eating", type: "LIVE Video", platform: "FB Group", status: "idea", day: 7 },
    { title: "Behind the scenes: building my lead magnet", type: "Hype Post", platform: "LinkedIn", status: "scheduled", day: -1 },
  ];
  await db.insert(schema.contentItems).values(
    contentDefs.map((c) => {
      const day = addDays(today, c.day);
      const id = newId();
      if (c.status === "posted") push("content", contentPoints(Boolean(c.cta)), `Posted: ${c.title}`, id, `${day}T17:00:00.000Z`);
      return {
        id,
        workspaceId,
        userId,
        title: c.title,
        status: c.status,
        contentType: c.type,
        platform: c.platform,
        hasCta: Boolean(c.cta),
        hook: c.hook ?? null,
        body: c.status === "posted" || c.status === "scheduled" || c.status === "ready" ? `${c.hook ?? c.title}\n\nMost people think the answer is discipline. It isn't. It's the system around you.\n\nHere's what actually works...` : null,
        postAt: `${day}T09:00:00`,
        postedAt: c.status === "posted" ? `${day}T17:00:00.000Z` : null,
        postLink: c.status === "posted" ? "https://www.facebook.com/groups/example/posts/123" : null,
        engagements: c.eng ?? 0,
        views: c.views ?? 0,
        leads: c.leads ?? 0,
        createdAt: `${addDays(day, -3)}T15:00:00.000Z`,
      };
    }),
  );

  // Conversations
  const convo: { name: string; platform: string; stage: schema.Contact["stage"]; warmth: schema.Contact["warmth"]; building: string; msgs: { dir: "in" | "out"; body: string; daysAgo: number }[]; followUp: number | null; callIn?: number }[] = [
    { name: "Priya Natarajan", platform: "Facebook", stage: "call_booked", warmth: "hot", building: "Postpartum fitness program for new moms", followUp: 0, callIn: 2, msgs: [
      { dir: "out", body: "Hey Priya — noticed you've been showing up in the group consistently. Saw your comment on the meal prep post last week — that landed. Not asking for anything. Just acknowledging.", daysAgo: 8 },
      { dir: "in", body: "Aw thank you! That means a lot honestly. I've been trying to be more consistent.", daysAgo: 8 },
      { dir: "out", body: "Quick question while we're here — what are you actually building right now?", daysAgo: 7 },
      { dir: "in", body: "A postpartum program. I have 4 clients but I can't seem to get past word of mouth.", daysAgo: 6 },
      { dir: "out", body: "That's the bottleneck most people hit. Want to jump on a 20-min call Thursday? I'll show you the exact system I use.", daysAgo: 5 },
      { dir: "in", body: "Yes!! Thursday works. What time?", daysAgo: 1 },
    ] },
    { name: "Marcus Bell", platform: "Instagram", stage: "conversation", warmth: "warm", building: "Online strength coaching for men over 40", followUp: 0, msgs: [
      { dir: "out", body: "Marcus — your 'train like you're 30' reel was sharp. The hook stopped my scroll.", daysAgo: 4 },
      { dir: "in", body: "Ha, appreciate it man. Still figuring out this whole content thing.", daysAgo: 3 },
      { dir: "out", body: "You're further than you think. What's the thing you'd want to see take off this year?", daysAgo: 3 },
      { dir: "in", body: "Honestly, a group program. I keep selling 1:1 and I'm maxed out.", daysAgo: 2 },
    ] },
    { name: "Elena Fischer", platform: "Facebook", stage: "replied", warmth: "warm", building: "Gut health coaching", followUp: 1, msgs: [
      { dir: "out", body: "Elena — saw your gut health thread in the group. That was a real contribution, not a drive-by.", daysAgo: 2 },
      { dir: "in", body: "Thanks Maya! I love that group.", daysAgo: 1 },
    ] },
    { name: "Tom Okafor", platform: "LinkedIn", stage: "new", warmth: "cold", building: "Corporate wellness workshops", followUp: 1, msgs: [
      { dir: "out", body: "Tom — your post on burnout in tech teams was the most honest thing I read this week.", daysAgo: 3 },
    ] },
    { name: "Sarah Kim", platform: "Facebook", stage: "client", warmth: "hot", building: "Down 11 lbs, month 2 of the 90-day program", followUp: null, msgs: [
      { dir: "in", body: "Week 6 check-in: down 11 lbs and I had wine on Saturday. Wild.", daysAgo: 4 },
      { dir: "out", body: "THAT is the whole point. Proud of you. Can I share this win in the group (first name only)?", daysAgo: 4 },
      { dir: "in", body: "Please do!", daysAgo: 4 },
    ] },
    { name: "Dana Whitfield", platform: "Skool", stage: "conversation", warmth: "warm", building: "Meal planning app for families", followUp: -2, msgs: [
      { dir: "out", body: "Dana — welcome to the community! What brought you in?", daysAgo: 10 },
      { dir: "in", body: "A friend recommended it. I'm building a meal planning app and want to learn how coaches actually think about nutrition.", daysAgo: 9 },
      { dir: "out", body: "Love that. Happy to swap notes — I'll DM you after the workshop.", daysAgo: 8 },
    ] },
    { name: "Luis Herrera", platform: "Instagram", stage: "cold", warmth: "cold", building: "Unknown", followUp: null, msgs: [
      { dir: "out", body: "Luis — enjoyed your marathon recap. What are you training for next?", daysAgo: 15 },
      { dir: "out", body: "No pressure — just circling back in case this got buried.", daysAgo: 10 },
    ] },
    { name: "Aisha Rahman", platform: "Facebook", stage: "new", warmth: "warm", building: "Pilates studio, wants to add online", followUp: 3, msgs: [
      { dir: "out", body: "Aisha — noticed you comment on nearly every live. That kind of consistency is rare. Just wanted to say I see it.", daysAgo: 0 },
    ] },
  ];
  for (const c of convo) {
    const id = newId();
    const outs = c.msgs.filter((m) => m.dir === "out");
    const ins = c.msgs.filter((m) => m.dir === "in");
    const lastOut = outs.length ? Math.min(...outs.map((m) => m.daysAgo)) : null;
    const lastIn = ins.length ? Math.min(...ins.map((m) => m.daysAgo)) : null;
    const firstOut = outs.length ? Math.max(...outs.map((m) => m.daysAgo)) : null;
    await db.insert(schema.contacts).values({
      id,
      workspaceId,
      userId,
      name: c.name,
      platform: c.platform,
      stage: c.stage,
      warmth: c.warmth,
      source: "Community",
      whatTheyreBuilding: c.building,
      lastOutboundAt: lastOut === null ? null : `${addDays(today, -lastOut)}T18:00:00.000Z`,
      lastInboundAt: lastIn === null ? null : `${addDays(today, -lastIn)}T19:30:00.000Z`,
      nextFollowUpAt: c.followUp === null ? null : addDays(today, c.followUp),
      callAt: c.callIn ? `${addDays(today, c.callIn)}T17:00:00.000Z` : null,
      createdAt: `${addDays(today, -(firstOut ?? 0))}T18:00:00.000Z`,
    });
    if (firstOut !== null) push("dm", POINTS.dmStarted, `Started a conversation with ${c.name}`, `contact:${id}`, `${addDays(today, -firstOut)}T18:00:00.000Z`);
    if (c.stage === "call_booked") push("call", POINTS.callBooked, `Call booked with ${c.name}`, `call:${id}`, `${addDays(today, -1)}T20:00:00.000Z`);
    if (c.stage === "client") push("call", POINTS.newClient, `New client: ${c.name}`, `client:${id}`, `${addDays(today, -20)}T20:00:00.000Z`);
    await db.insert(schema.messages).values(
      c.msgs.map((m, i) => ({ id: newId(), contactId: id, userId, direction: m.dir, body: m.body, sentAt: `${addDays(today, -m.daysAgo)}T${String(16 + i).padStart(2, "0")}:00:00.000Z` })),
    );
  }

  await db.insert(schema.pointsLedger).values(ledger).onConflictDoNothing();
  void ctx;
}

async function main() {
  await ensureMigrated();
  await seedLibrary();
  if (!process.argv.includes("--library-only")) await seedDemo();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
