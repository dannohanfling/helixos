/**
 * A synthetic client base for the Airtable import (27 Sep): the table and field names of a HelixOS-template base exactly as
 * Airtable returns them (emoji prefixes, double spaces), with invented content. No client's words are in here, by rule: a client's
 * material never seeds an example anywhere else. The unit tests map it; scripts/mock-airtable.ts serves it to the import walk.
 */
export type FixtureRecord = { id: string; createdTime: string; fields: Record<string, unknown> };
export type FixtureTable = { id: string; name: string; records: FixtureRecord[] };

const NEW = "2026-06-10T20:32:22.000Z";
const TEMPLATE = "2026-04-14T09:00:00.000Z";
let n = 0;
const rec = (fields: Record<string, unknown>, createdTime = NEW): FixtureRecord => ({ id: `rec${String(++n).padStart(14, "0")}`, createdTime, fields });
const v1id = (i: number) => `recV1${String(i).padStart(12, "0")}`;

export const V2_BASE = "appSynthSourceV2x";
export const V1_BASE = "appSynthFallbkV1x";

const vision: FixtureTable = {
  id: "tblVISION0000001",
  name: "🌎  Vision",
  records: [
    rec({ "👦 Name": "Courage", "⭐️ Type": "❤️ Values", "❤️ Value Type": "👨‍💼 Business", "✍️ Description": "We say the hard thing kindly.", "🗝️ V1 Record ID": v1id(1) }),
    rec({ "👦 Name": "Steadiness", "⭐️ Type": "🪨 Principles", "🪨 Principle Type": "💻 Work", "🗝️ V1 Record ID": v1id(2) }),
    rec({ "👦 Name": "Growth is chosen daily", "⭐️ Type": "🧠 Belief", "🧠 Belief Type": "💝 Internal", "✍️ Description": "Nobody drifts into growth.", "🗝️ V1 Record ID": v1id(3) }),
    rec({ "👦 Name": "Harbour Coaching Ltd", "⭐️ Type": "🌎 Vision", "🛤️ Specialist Pathway": "For Teams", "🚀 Mission Statement": "Calm leaders for busy teams.", "🌎 Vision Statement": "Every team led from the inside out.", "❤️ Purpose": "To make leadership feel lighter.", "👨‍💼 Founders Story": "I ran a team that burned out, and I rebuilt it slowly.", "🤝 Strategic Partners": ["Guild of Coaches"] }),
    rec({ "👦 Name": "Master Brand Slogan + Master Positioning", "⭐️ Type": "🌎 Vision", "🎯 Slogan": "Lead lighter.", "🏷️ Tagline": "Calm is a skill.", "🏁 Master Positioning": "The calm-leadership coach for small teams.", "⚔️ Competitive Advantage": "Twenty years inside teams." }),
    rec({ "👦 Name": "Complete Founder Story + Content Pillars (Master)", "⭐️ Type": "🌎 Vision", "👨‍💼 Founders Story": "The whole story, start to now.", "📣 Content Pillar 1": "Calm first", "📣 Content Pillar 2": "Clear roles" }),
    rec({ "👦 Name": "Harbour — For Founders (Pathway Vision)", "⭐️ Type": "🌎 Vision", "🛤️ Specialist Pathway": "For Founders", "👨‍💼 Founders Story": "I started alone, with a laptop and a problem.", "🏷️ Tagline": "Build without breaking.", "🎤 Audience Promise": "A business that doesn't need you every hour." }),
    rec({ "👦 Name": "3-Year Revenue Targets + Strategic Roadmap", "✍️ Description": "YEAR 1 - 2026 — Proving it: $100,000–$120,000 NZD\n• 3x cohorts (20 x $2,000 = $40,000)\nYEAR 2 - 2027 — Nothing set yet\nYEAR 3 - 2028-2029 — Scale: $900,000–$950,000 NZD\nThen we hire." }),
    rec({ "👦 Name": "Brand Values + Tone of Voice", "✍️ Description": "Warm, plain, never loud." }),
    rec({ "👦 Name": "ZZ_TEST_DELETE_ME", "⭐️ Type": "❤️ Values" }, "2026-05-12T00:00:00.000Z"),
    rec({ "👦 Name": "Integrity", "⭐️ Type": "❤️ Values" }, TEMPLATE),
  ],
};

const offers: FixtureTable = {
  id: "tblOFFERS0000001",
  name: "🎁 OffersOS",
  records: [
    rec({ "👦 Name": "🔓 Harbour Reset™ — Open Door", "⭐️ Status": "✅ Launched", "🏦 PIF Price": 500, "🛤️ Pathway (True North)": ["Open Door"], "⭐️ Headline": "A first honest look.", "🎁 Big Promise": "Know what to fix first.", "Money Objection": "It pays for itself in one decision.", "🗝️ V1 Record ID": v1id(10) }),
    rec({ "👦 Name": "🧭 T00 — Team Diagnostic", "⭐️ Status": "✅ Launched", "🏦 PIF Price": 6000, "🛤️ Pathway (True North)": ["Teams"], "🔄 Transformation Arc": ["See", "Reset"], "⭐️ Headline": "See your team clearly.", "😖 Pain": "Meetings that go nowhere.", "😳 Problems (Current Situation)": "Everyone is busy and nothing moves.", "🏆 Promises (Desired Situation)": "Clear owners, calm weeks.", "🪨 Core Components": "Interviews\nReport\nDebrief", "Wrong Time Objection": "There is never a quiet quarter.", "🗝️ V1 Record ID": v1id(11) }),
    rec({ "👦 Name": "🗺️ F1 — Founder Blueprint", "⭐️ Status": "In Progress", "🏦 PIF Price": 3000, "🛤️ Pathway (True North)": ["Founders"], "⭐️ Headline": "A plan you can keep.", "🗝️ V1 Record ID": v1id(12) }),
    rec({ "👦 Name": "01 Team Diagnostic", "⭐️ Status": "Launched", "🏦 PIF Price": 5500, "🪜 Value Ladder Tier": "1", "🛤️ Pathway (True North)": ["Teams"], "🗝️ V1 Record ID": v1id(13) }, "2026-06-10T20:17:51.000Z"),
    rec({ "👦 Name": "F2 Founder Blueprint", "⭐️ Status": "Creating Offer", "🏦 PIF Price": 3000, "🪜 Value Ladder Tier": "2", "🗝️ V1 Record ID": v1id(14) }, "2026-06-10T20:17:51.000Z"),
    rec({ "👦 Name": "Calm Week Checklist", "⭐️ Status": "Launched", "🪜 Value Ladder Tier": "🧲 Lead Magnet", "🗝️ V1 Record ID": v1id(15) }, "2026-06-10T20:17:51.000Z"),
  ],
};

const methodologies: FixtureTable = {
  id: "tblMETHOD0000001",
  name: "🏆 Methodologies",
  records: [
    rec({ "🏆 Methodology": "The Calm Loop", "📝 Description": "Notice, name, next step.", "🔑 Core Insight": "Calm is a sequence, not a mood.", "🎯 Application": "📚 Teaching", "💡 Memorable Phrase": "Name it to tame it.", "🗝️ V1 Record ID": v1id(20) }),
    rec({ "🏆 Methodology": "Template Framework", "🧬 Template Status": "✅ Universal (keep in template)" }, TEMPLATE),
  ],
};

const readiness: FixtureTable = {
  id: "tblREADY00000001",
  name: "⛓️ Buyer Readiness",
  records: [
    rec({ "⛓️ Stage": "Notice", "📝 Description": "They feel the drag.", "🏆 Outcome": "They name it.", "🎁 Offers": [] as string[], "🗝️ V1 Record ID": v1id(30) }),
    rec({ "⛓️ Stage": "Reset", "📝 Description": "They try the first fix.", "💬 Strategic Message": ["You're not alone"], "🗝️ V1 Record ID": v1id(31) }),
    rec({ "⛓️ Stage": "Team description (review)", "📝 Description": "MIGRATION NOTE: v1 record name held this full text", "🗝️ V1 Record ID": v1id(32) }),
    rec({ "⛓️ Stage": "and a calmer week.", "🗝️ V1 Record ID": v1id(33) }),
    rec({ "⛓️ Stage": "clarity", "🗝️ V1 Record ID": v1id(34) }),
    rec({ "⛓️ Stage": "[EXAMPLE] Awareness" }, TEMPLATE),
  ],
};
// Stage "Notice" links to the old 01 offer: the import points it at the current T00.
(readiness.records[0].fields as Record<string, unknown>)["🎁 Offers"] = [offers.records[3].id];

const tasks: FixtureTable = {
  id: "tblTASKS00000001",
  name: "📌 TasksOS",
  records: [
    rec({ "📌 Tasks": "Book three discovery calls", "⭐️ Status": "📌 Today", "🚨 Urgency": "🏆 Top 3", "📌 Tasks Type": "💰 Sales", "📆 Due Date": "2026-10-01", "👨 Responsible (v1 text)": "Sam", "⭐️ Goals": ["recGOAL0000000001"], "🗝️ V1 Record ID": v1id(40) }),
    rec({ "📌 Tasks": "Write the team report template", "⭐️ Status": "✅ Complete", "✅ Complete Date": "2026-09-01", "🚨 Urgency": "👌 Medium", "📌 Tasks Type": "⚙️ Operations", "🗝️ V1 Record ID": v1id(41) }),
    rec({ "📌 Tasks": "Plan the retreat", "⭐️ Status": "💡 Idea", "🗝️ V1 Record ID": v1id(42) }),
  ],
};

const groups: FixtureTable = {
  id: "tblGROUPS0000001",
  name: "👨‍👨‍👦‍👦 Groups",
  records: [rec({ "👨‍👨‍👦‍👦 Group Name": "Calm Leaders Circle", "🔗 Link": "https://example.com/groups/calm", "⭐️ Type": "📲 Facebook", "👍 Engagement": "⭐️ High", "🗝️ V1 Record ID": v1id(50) })],
};

const leadMagnet: FixtureTable = {
  id: "tblMAGNET0000001",
  name: "🧲 Lead Magnet",
  records: [
    rec({ "🧲 Lead Magnet Name": "Calm Week Checklist", "🎁 Asset Link": "https://example.com/calm-week", "🚀 Status": "🟢 Live", "✍️ Notes": "[MIGRATION NOTE — v1 🧲Business Tools] Pathway: Teams", "🗝️ V1 Record ID": v1id(60) }),
    rec({ "🧲 Lead Magnet Name": "Meeting Audit", "🚀 Status": "👓 Review", "🗝️ V1 Record ID": v1id(61) }),
  ],
};

export const V2_TABLES: FixtureTable[] = [
  vision,
  offers,
  methodologies,
  readiness,
  tasks,
  groups,
  leadMagnet,
  // Tables of hers Phase 1 doesn't write: counted and answered on the dry run. KPIs has one template row, not counted.
  { id: "tblKPIS000000001", name: "#️⃣ KPIs", records: [rec({ "KPI Name": "Calls booked" }), rec({ "KPI Name": "Template KPI" }, TEMPLATE)] },
  { id: "tblCALENDAR00001", name: "📆 Calendar", records: [rec({ "Name": "Episode 1", "Day": "2026-10-06" }), rec({ "Name": "Episode 2", "Day": "2026-10-13" })] },
  // People: named on the dry run, never read. A walk fails if the import asks for these rows.
  { id: "tblLEADS00000001", name: "🧲 Leads", records: [rec({ "Name": "A person" })] },
  // The template's own tools: named, not read.
  { id: "tblHUBSET0000001", name: "⚙️ Hub Settings", records: [] },
];

/** The first base: the review row's full text, joined through its V1 Record ID. */
export const V1_TABLES: FixtureTable[] = [
  {
    id: "tblV1READY000001",
    name: "⛓️ Value Ladder Buyer Readiness",
    records: [{ id: v1id(32), createdTime: "2026-03-01T00:00:00.000Z", fields: { "Value Ladder Stage": "Teams notice the drag long before they name it, and they name it long before they act." } }],
  },
];
