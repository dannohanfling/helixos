/** Demo: Maya's ladder facts and one finished ladder in her voice, so the checklist, live hour and hand-offs can be walked without Claude. */
import { db, schema } from "./index";
import { newId } from "@/lib/ids";

export async function seedDemoLadders(wsId: string, mayaId: string, today: string): Promise<void> {
  await db.insert(schema.ladderProfiles).values({
    id: newId(),
    workspaceId: wsId,
    userId: mayaId,
    productName: "The 90-Day Reset",
    productPitch: "A 90-day plan for busy moms: three template meals, one weekend rule, and a five-minute check-in every day with someone who notices.",
    priceLine: "$497 for 90 days, or 3 payments of $179.",
    trialLine: "Free 7-day starter plan, no card.",
    keywords: [
      { keyword: "RESET", use: "default, anything selling the Reset" },
      { keyword: "PLAN", use: "the free 7-day starter plan" },
    ],
    scarcityLine: null,
    bannedPhrases: ["cheat day", "guilt-free", "skinny"],
    verifiedStats: [{ stat: "47 moms through the Reset, average 14 lbs at day 90", source: "program data, 2026" }],
    claimsRules: "Never promise a number of pounds. Results are averages from real clients and are said to be averages.",
    originStory: "Maya was a night-shift nurse for nine years. Twelve-hour shifts, vending-machine dinners, and a diet that restarted every Monday. She quit every plan by week three, for six years. What finally worked wasn't a better plan. It was a Tuesday: ten minutes picking from three meals she already knew, one weigh-in on Thursday, and a text from one friend who noticed. She lost the weight in a year nobody would call heroic. Then the other nurses asked how.",
    positioningLine: "NIGHT-SHIFT NURSE. / NUTRITION COACH. / SAME DISCIPLINE.",
    handle: "@torresnutrition",
  });

  const rungs = [
    "Mistake one.\nI planned every meal on Sunday.\nThree hours. Color-coded.\nBy Tuesday the plan was dead.\nA kid got sick. A shift ran long.\nAnd I felt like I failed the whole week.\nThe plan was never the problem.\nThe timing was.\nPlanning on the one day you have energy sets you up to quit on the days you don't.\nBig plans die on Tuesday.",
    "Mistake two.\nI cut everything at once.\nNo wine. No bread. No weekends.\nIt worked for nine days.\nThen a birthday happened.\nOne slice became the whole cake.\nAll or nothing always ends in nothing.\nNow I cut one thing at a time.\nJust one. For two weeks.\nThen the next.\nYou can keep a rule you can actually keep.",
    "Mistake three.\nI weighed myself every morning.\nUp a pound? Ruined day.\nDown a pound? Reward dinner.\nThe scale ran my mood.\nWater, salt and sleep move that number by three pounds.\nNone of it is fat.\nNow my clients weigh in once a week.\nSame day. Same time.\nWe look at the trend, not the day.\nThe scale is a weather report, not a verdict.",
    "Mistake four.\nI ate like a bodybuilder.\nChicken. Rice. Broccoli. Repeat.\nI hated every meal by day four.\nMy family ate something else.\nSo I cooked twice.\nNobody keeps a plan that makes dinner harder.\nNow every meal on the Reset is a family meal.\nOne pot. Kids eat it too.\nThe plan has to fit the kitchen you already have.",
    "Mistake five.\nI kept it a secret.\nI didn't want to fail in public again.\nSo nobody knew.\nSo nobody asked.\nSo quitting cost nothing.\nThe week I told two friends, I stopped skipping.\nNot because they checked.\nBecause I knew they might.\nA plan nobody knows about is a plan you can drop quietly.",
    "What fixed the first two.\nI moved planning to Tuesday.\nTen minutes, not three hours.\nI pick from three template meals I already know.\nBreakfast is the same every day.\nLunch is leftovers.\nDinner is one of three.\nAnd I cut one thing at a time.\nTwo weeks each.\nThat's the whole system.\nSmall and boring beats big and perfect.",
    "What fixed the rest.\nOne weigh-in a week, on Thursday.\nFamily meals only, one pot.\nAnd a five-minute check-in every day with someone who notices.\nThat check-in is the piece people skip.\nIt's also the piece that works.\nNot a lecture. A text.\n\"Did you eat your three today?\"\nYes or no.\nThat's it.\nBeing noticed is the habit under every habit.",
    "The honest math.\n(Illustrative. Your numbers will differ.)\nA mom who quits by week three loses maybe four pounds.\nThen gains them back.\nThat's the cycle.\nA mom who lasts twelve weeks at one pound a week loses twelve.\nSame effort per week.\nThe only difference is not quitting in week three.\nOur average across 47 moms is 14 lbs at day 90.\nThat's the average, not a promise.\nStaying is the whole strategy.",
    "Proof.\nSarah: \"quit every diet by week three. Week 6 of the Reset: down 11 lbs, wine on Saturday, still going.\"\nShe's a mom of two.\nShe did nothing heroic.\nShe picked from three meals on a Tuesday.\nShe told one friend.\nShe weighed in on Thursdays.\nThat's the whole story.\nBoring is what working looks like.",
    "Who this is not for.\nIf you want to lose 20 pounds by the wedding in three weeks, this isn't it.\nIf you want a plan you can hide from your family, this isn't it.\nIf you want someone to yell at you, this isn't it.\nThe Reset is slow on purpose.\nIt's for the mom who has quit three times and is tired of starting over.\nIf that's you, read the next one.\nSlow is the only speed that lasts.",
    "Here's the whole system.\nPlan on Tuesday, ten minutes.\nThree template meals.\nCut one thing at a time.\nWeigh in on Thursday.\nTell someone.\nThat's the 90-Day Reset.\n$497 for 90 days, or 3 payments of $179.\nFree 7-day starter plan, no card.\nComment RESET and I'll send you the link.\nIf nothing happens, message me RESET.\nStart small. Stay long.",
  ].map((body, i) => ({ n: i + 1, body, postedAt: null }));

  await db.insert(schema.ladders).values({
    id: newId(),
    workspaceId: wsId,
    userId: mayaId,
    format: "mistakes",
    topic: "The five mistakes that made me quit every diet by week three",
    audience: "warm",
    keyword: "RESET",
    realNumbers: "47 moms through the Reset, average 14 lbs at day 90. Sarah: 11 lbs at week 6.",
    postName: "SKIN — Mistakes Ladder — quit by week three",
    headline: "I QUIT EVERY DIET BY WEEK THREE / UNTIL I STOPPED PLANNING SUNDAYS (gold: WEEK THREE)",
    altHeadlines: ["FIVE MISTAKES THAT ENDED EVERY DIET / BY WEEK THREE (gold: WEEK THREE)"],
    hook: "I quit every diet by week three.",
    copy: "I quit every diet by week three.\nFor six years.\nThen I stopped doing the five things below.\n\nThe whole plan is in the comments. Read them in order. 👇\n\nSave this for the Sunday you're about to plan again.\n\nWhich one of the five is yours?",
    rungs,
    dmKeyword: "RESET",
    carousel: [
      "SLIDE 1 — I QUIT EVERY DIET BY WEEK THREE (gold: WEEK THREE) + SWIPE →",
      "SLIDE 2 — Big plans die on Tuesday. (gold: TUESDAY)",
      "SLIDE 3 — All or nothing always ends in nothing. (gold: NOTHING)",
      "SLIDE 4 — The scale is a weather report, not a verdict. (gold: WEATHER REPORT)",
      "SLIDE 5 — The plan has to fit the kitchen you already have. (gold: ALREADY HAVE)",
      "SLIDE 6 — A plan nobody knows about is a plan you can drop quietly. (gold: QUIETLY)",
      "SLIDE 7 — Being noticed is the habit under every habit. (gold: NOTICED)",
      "SLIDE 8 — Staying is the whole strategy. (gold: STAYING)",
      "SLIDE 9 — (solid black) COMMENT RESET and I'll send you the link.",
    ],
    igCaption:
      "I quit every diet by week three. For six years.\n\n**Sunday planning.** Three hours, color-coded, dead by Tuesday. Now it's ten minutes on a Tuesday, picking from three meals I already know.\n\n**All at once.** No wine, no bread, no weekends. Nine days, then a birthday. Now it's one thing at a time, two weeks each.\n\n**The daily scale.** Water and salt move it three pounds. Now it's Thursdays only, and we watch the trend.\n\n**Keeping it secret.** Quitting cost nothing. The week I told two friends, I stopped skipping.\n\nAcross 47 moms the average is 14 lbs at day 90. An average, not a promise.\n\nComment RESET and I'll send you the link.",
    threadsChain: [
      "1/ I quit every diet by week three. For six years. Here are the five mistakes, and what fixed them.",
      "2/ I planned every meal on Sunday. Three hours. Dead by Tuesday. Big plans die on Tuesday.",
      "3/ I cut everything at once. Nine days, then a birthday. All or nothing always ends in nothing.",
      "4/ I weighed in every morning and let the number run my day. The scale is a weather report, not a verdict.",
      "5/ I kept it a secret, so quitting cost nothing. Being noticed is the habit under every habit.",
      "6/ Now: ten minutes on Tuesday, three template meals, one thing at a time, weigh-in Thursday, tell someone. Comment RESET and I'll send you the link.",
    ],
    notes: "Verify before posting: Sarah's quote is word for word from the Proof Bank. The 47-mom average is from program data. No pounds promised anywhere.",
    generatedBy: "example",
    status: "ready",
    createdAt: `${today}T15:00:00.000Z`,
  });
}
