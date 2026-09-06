/** Demo data for the doctrine, groups, proof, targets, courses, certification and integrations wave. */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./index";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/dates";
import { alignPost } from "@/lib/engine/groups";
import { monthOf } from "@/lib/engine/targets";

export async function seedDemoWave2(wsId: string, mayaId: string, jordanId: string, today: string): Promise<void> {
  // Groups for Maya: her own, four she's in, three she's prospecting in, one on the bench.
  const own = newId();
  await db.insert(schema.groups).values([
    { id: own, workspaceId: wsId, userId: mayaId, name: "Busy Moms Who Actually Lose It", url: "https://www.facebook.com/groups/busymomsloseit", kind: "own", rank: 0, mission: "A no-diet-culture space for moms who want to lose the weight for good without giving up wine or weekends.", audience: "Moms of school-age kids, 32 to 48, tried everything.", adminName: "Maya Torres", adminValues: "Honesty over hype. Small daily wins. No before-and-after shaming.", rules: "Be kind. No MLM. Post your plate, not your scale.", postingNorms: "Daily #showedup thread at 7am. Wins on Friday.", whatWorks: "Plate photos. 'What I ate at the party' posts.", memberCount: 412, postsPerDay: 6, rating: 5, lastPostedAt: `${today}T14:00:00.000Z` },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "The Coaching Jungle", url: "https://www.facebook.com/groups/919866651401254", kind: "member", rank: 0, adminName: "Marc Mawhinney", mission: "Coaches helping coaches grow their practices.", rules: "No links in posts. Promo Fridays only.", memberCount: 31000, postsPerDay: 20, rating: 3 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Tribe of Champions: Scalable & Sustainable Growth Strategies for Coaches", url: "https://www.facebook.com/groups/digitalmarketingforentrepeneurs", kind: "member", rank: 0, adminName: "Michael Chu", rating: 3 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "The FREEDOM Initiative, for coaches, experts & LEADERS.", url: "https://www.facebook.com/groups/freedominitiative", kind: "member", rank: 0, adminName: "Brian Campbell", mission: "Freedom-first business building for coaches and experts.", rating: 5 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Content Creators Community: Monetize Your Passion", url: "https://www.facebook.com/groups/fulltimefreedom", kind: "member", rank: 0, adminName: "Doug Boughton", rating: 2 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Fit Moms Over 35", url: "https://www.facebook.com/groups/fitmomsover35", kind: "prospect", rank: 1, mission: "Helping moms over 35 get strong, lean and energized without extreme diets.", description: "A supportive place to share workouts, meals, and real-life wins. 40k moms who lift, walk, and eat like adults.", audience: "Moms 35 to 50, mostly working, kids at home. Sick of restart cycles.", adminName: "Jess Caldwell", adminValues: "Consistency over intensity. She praises honest check-ins and deletes anything that shames bodies or sells hard. Posts her own walks daily.", rules: "No links. No self-promo. No DMing members you haven't spoken with. Value first, always.", postingNorms: "Mornings get the most comments. Long text posts do better than graphics. Questions at the end.", whatWorks: "Meal-swap posts. 'One thing I stopped doing' posts.", memberCount: 40200, postsPerDay: 25, rating: 5, lastPostedAt: `${addDays(today, -3)}T14:00:00.000Z` },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Meal Prep for Busy Families", url: "https://www.facebook.com/groups/mealprepbusyfamilies", kind: "prospect", rank: 2, mission: "Feed your family well in less time.", description: "Recipes, prep plans, freezer hacks. Parents who cook once and eat all week.", audience: "Parents cooking for 3 to 6 people, budget-aware, time-starved.", adminName: "Ramona Ortiz", adminValues: "Practical over perfect. Loves photos of real fridges. Removes diet-talk and supplement pitches.", rules: "No promotion or advertising. Recipes must be complete. Be respectful.", postingNorms: "Sunday prep-day posts blow up. Photos required.", whatWorks: "Fridge photos with the plan. '12 minutes on Tuesday' style time-savers.", memberCount: 88000, postsPerDay: 40, rating: 4 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Healthy Habits for Working Moms", url: "https://www.facebook.com/groups/healthyhabitsworkingmoms", kind: "prospect", rank: 3, mission: "Small habits that fit into a full-time job and a full-time family.", audience: "Working moms, 30 to 45, corporate and healthcare.", adminName: "Dr. Lena Park", adminValues: "Evidence-based. Praises specific numbers and time frames. Deletes miracle claims.", rules: "Ask admin approval before sharing offers. No affiliate links. Cite sources when making health claims.", postingNorms: "Tuesday and Thursday evenings. Short posts, one idea each.", whatWorks: "Habit-stacking examples. Before/after routines (not bodies).", memberCount: 12500, postsPerDay: 8, rating: 4 },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Wine & Wellness Moms", kind: "prospect", rank: 0, adminName: "Carly Brandt", mission: "Balance, not restriction.", memberCount: 6100, rating: 3 },
  ]);

  // Proof bank
  const sarah = await db.query.clientRecords.findFirst({ where: and(eq(schema.clientRecords.userId, mayaId), eq(schema.clientRecords.name, "Sarah Kim")) });
  await db.insert(schema.proofs).values([
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Sarah: 11 lbs by week 6, wine on Saturday", type: "result", who: "Sarah, mom of two", problemBefore: "I quit every diet by week three.", shift: "Stopped planning Sundays. Started picking from templates on Tuesday.", resultAfter: "Down 11 lbs at week 6. Had wine Saturday and didn't spiral.", beliefBroken: "internal", shortVersion: "Sarah, mom of two: quit every diet by week three. Week 6 of the Reset: down 11 lbs, wine on Saturday, still going.", hook: "She told me she'd quit by week three. She always did.", punchline: "The plan did the work. She just followed it.", clientRecordId: sarah?.id ?? null, status: "approved" },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Marcus: 22 lbs before the wedding", type: "result", who: "Marcus, dad, weekend-beer guy", problemBefore: "Weekend beers undid every week.", shift: "Weekends went into the plan instead of against it.", resultAfter: "22 lbs down. Graduated. Photos he actually likes.", beliefBroken: "external", status: "approved" },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "47 moms, average 14 lbs at day 90", type: "stat", who: "Program average", resultAfter: "Average 14 lbs at day 90 across 47 moms.", beliefBroken: "vehicle", shortVersion: "47 moms through the Reset. Average 14 lbs at day 90.", status: "approved" },
    { id: newId(), workspaceId: wsId, userId: mayaId, name: "Dana's first full week", type: "testimonial", who: "Dana", resultAfter: "\"First full week I didn't skip a single check-in. That's never happened.\"", beliefBroken: "internal", status: "draft" },
  ]);

  // Targets for this month
  const month = monthOf(today);
  await db.insert(schema.targets).values(
    Object.entries({ dmsStarted: 60, conversations: 40, callsBooked: 8, posts: 20, cashCollected: 4500, webinarRegs: 150 }).map(([metric, target]) => ({ id: newId(), workspaceId: wsId, userId: mayaId, month, metric, target })),
  );

  // Optional close numbers on Maya's recent logs
  const logs = await db.query.dailyLogs.findMany({ where: eq(schema.dailyLogs.userId, mayaId), orderBy: asc(schema.dailyLogs.date) });
  for (const [i, l] of logs.entries()) {
    if (!l.eveningDoneAt) continue;
    const rev = l.cashCollected;
    await db
      .update(schema.dailyLogs)
      .set({
        proofPosts: l.posts && i % 3 === 0 ? 1 : 0,
        ctaPosts: l.posts && i % 3 === 1 ? 1 : 0,
        beliefPosts: l.posts && i % 3 === 2 ? 1 : 0,
        storiesCreated: i % 2 === 0 ? 2 : 1,
        referralAsks: i % 5 === 0 ? 1 : 0,
        webinarRegs: i % 4 === 0 ? 6 + (i % 7) : 0,
        webinarShows: i % 8 === 0 ? 3 : 0,
        applications: i % 8 === 0 ? 1 : 0,
        revContent: rev && i % 2 === 0 ? rev : 0,
        revWebinar: rev && i % 2 === 1 ? rev * 0.6 : 0,
        revDm: rev && i % 2 === 1 ? rev * 0.4 : 0,
      })
      .where(eq(schema.dailyLogs.id, l.id));
  }

  // Lessons: Maya finished Launch Pad and a bit of Accelerator; Jordan the first three.
  const courses = await db.query.courses.findMany({ orderBy: asc(schema.courses.order) });
  const lessons = await db.query.lessons.findMany({ orderBy: asc(schema.lessons.order) });
  const lpIds = new Set(courses.filter((c) => c.program === "Launch Pad").map((c) => c.id));
  const week1 = courses.find((c) => c.name.startsWith("Week 1"));
  const mayaDone = [...lessons.filter((l) => lpIds.has(l.courseId)), ...lessons.filter((l) => l.courseId === week1?.id).slice(0, 2)];
  await db.insert(schema.lessonProgress).values(mayaDone.map((l, i) => ({ id: newId(), workspaceId: wsId, userId: mayaId, lessonId: l.id, completedAt: `${addDays(today, -20 + i)}T16:00:00.000Z` })));
  await db.insert(schema.pointsLedger).values(mayaDone.map((l, i) => ({ id: newId(), workspaceId: wsId, userId: mayaId, type: "curriculum" as const, points: l.points, reason: `Lesson: ${l.name}`, refId: `lesson:${l.id}`, createdAt: `${addDays(today, -20 + i)}T16:00:00.000Z` })));
  const jordanDone = lessons.filter((l) => lpIds.has(l.courseId)).slice(0, 3);
  await db.insert(schema.lessonProgress).values(jordanDone.map((l, i) => ({ id: newId(), workspaceId: wsId, userId: jordanId, lessonId: l.id, completedAt: `${addDays(today, -40 + i)}T16:00:00.000Z` })));

  // Certification for Maya: one passed, one waiting
  const deliverables = await db.query.certDeliverables.findMany({ orderBy: asc(schema.certDeliverables.order) });
  const modules = await db.query.certModules.findMany({ orderBy: asc(schema.certModules.order) });
  const m1 = deliverables.filter((d) => d.moduleId === modules[0]?.id);
  if (m1[0]) await db.insert(schema.certSubmissions).values({ id: newId(), workspaceId: wsId, userId: mayaId, deliverableId: m1[0].id, url: "https://docs.google.com/spreadsheets/d/example-tracker", notes: "Tracker with phases, owners and dates.", status: "passed", score: 92, feedback: "Clean. Add a column for client sign-off next time.", reviewedBy: "coach" });
  if (m1[1]) await db.insert(schema.certSubmissions).values({ id: newId(), workspaceId: wsId, userId: mayaId, deliverableId: m1[1].id, url: "https://www.loom.com/share/example-handoff", notes: "Simulated handoff with Priya's onboarding.", status: "submitted" });
  await db.update(schema.memberships).set({ certEnabled: true, eoPassUrl: "https://pass.evolveomega.com/p/maya-torres", eoPassSerial: "EO-0001-MT", eoPassInstalledAt: `${addDays(today, -22)}T18:00:00.000Z`, eoPassLastPushAt: `${addDays(today, -1)}T15:00:00.000Z` }).where(and(eq(schema.memberships.workspaceId, wsId), eq(schema.memberships.userId, mayaId)));
  await db.update(schema.memberships).set({ eoPassUrl: "https://pass.evolveomega.com/p/jordan-lee", eoPassSerial: "EO-0002-JL" }).where(and(eq(schema.memberships.workspaceId, wsId), eq(schema.memberships.userId, jordanId)));

  // Integrations: configured but off, so nothing leaves the demo. Secrets are placeholders.
  await db.insert(schema.integrations).values([
    { id: newId(), workspaceId: wsId, provider: "community_loyalty", enabled: false, config: { apiUrl: "https://api.communityloyalty.app", programId: "evolve-omega", pointsRate: "1" }, inboundSecret: "hx_demo_community_loyalty_secret" },
    { id: newId(), workspaceId: wsId, provider: "gohighlevel", enabled: false, config: { apiUrl: "https://services.leadconnectorhq.com", companyId: "agency_demo", locationId: "loc_demo", pipelineId: "pipe_demo", stageId: "stage_booked" }, inboundSecret: "hx_demo_ghl_secret" },
  ]);
  await db.insert(schema.syncEvents).values([
    { id: newId(), workspaceId: wsId, userId: mayaId, provider: "community_loyalty", direction: "out", event: "points.add", payload: { serial: "EO-0001-MT", points: 20, reason: "Closed the day" }, status: "skipped", note: "Integration disabled", createdAt: `${addDays(today, -1)}T03:10:00.000Z` },
    { id: newId(), workspaceId: wsId, userId: mayaId, provider: "community_loyalty", direction: "in", event: "pass.installed", payload: { serial: "EO-0001-MT", email: "client@demo.helixos.app" }, status: "received", note: "Pass marked installed", createdAt: `${addDays(today, -22)}T18:00:00.000Z` },
    { id: newId(), workspaceId: wsId, userId: mayaId, provider: "gohighlevel", direction: "out", event: "contact.upsert", payload: { firstName: "Priya", lastName: "Natarajan", tags: ["helixos", "client"] }, status: "skipped", note: "Integration disabled", createdAt: `${addDays(today, -2)}T17:30:00.000Z` },
  ]);

  // Maya's sub-account, as it looks after a successful account refresh
  const demoAccounts = [
    { id: "loc_maya_fbpage_1", name: "Torres Nutrition Coaching", platform: "facebook", type: "page", isExpired: false },
    { id: "loc_maya_fbgroup_1", name: "Busy Moms Who Actually Lose It", platform: "facebook", type: "group", isExpired: false },
    { id: "loc_maya_ig_1", name: "@torresnutrition", platform: "instagram", type: "business", isExpired: false },
    { id: "loc_maya_li_1", name: "Maya Torres", platform: "linkedin", type: "profile", isExpired: false },
  ];
  await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: wsId, userId: mayaId, provider: "gohighlevel", locationId: "loc_maya", coachAssigned: true, ghlUserId: "user_maya", accounts: demoAccounts, mapping: { fb_page: "loc_maya_fbpage_1", fb_group: "loc_maya_fbgroup_1", instagram: "loc_maya_ig_1", stories: "loc_maya_ig_1", linkedin: "loc_maya_li_1" }, connectedAt: `${addDays(today, -20)}T18:00:00.000Z`, lastSyncAt: `${addDays(today, -1)}T18:00:00.000Z` });

  // Group-aligned drafts for Maya's top posted item
  const posted = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.userId, mayaId), eq(schema.contentItems.status, "posted")) });
  const groups = await db.query.groups.findMany({ where: eq(schema.groups.userId, mayaId) });
  if (posted) {
    const targets = groups.filter((g) => g.kind === "own" || (g.kind === "prospect" && g.rank >= 1 && g.rank <= 3));
    await db.insert(schema.contentVariants).values(
      targets.map((g, i) => {
        const a = alignPost({ title: posted.title, hook: posted.hook, body: posted.body, hasCta: posted.hasCta }, g);
        const isPosted = g.kind === "own" || g.rank === 1;
        return { id: newId(), contentItemId: posted.id, userId: mayaId, channel: g.kind === "own" ? ("fb_group" as const) : ("other_groups" as const), groupId: g.id, body: a.body, status: isPosted ? ("posted" as const) : ("draft" as const), postedAt: isPosted ? `${addDays(today, -3 + i)}T15:00:00.000Z` : null, reactions: isPosted ? 30 - i * 8 : 0, comments: isPosted ? 11 - i * 3 : 0, dms: isPosted ? 3 - i : 0, leads: isPosted ? 2 - i : 0 };
      }),
    );
  }
  console.log(`Wave 2 demo: ${groups.length} groups, proofs, targets, lessons, certification, integrations`);
}
