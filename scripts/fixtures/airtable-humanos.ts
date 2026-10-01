/**
 * A synthetic HumanOS base for Body's Airtable history walk (rev 237 phase 7): the Journal, Exercises and Routines tables with
 * the field names as Airtable returns them and invented numbers. Nobody's data is in here, by rule. scripts/mock-airtable.ts
 * serves it; the Body walk imports it and checks the page against what the mapper says.
 */
import type { FixtureRecord, FixtureTable } from "./airtable-client";

let n = 500;
const rec = (fields: Record<string, unknown>, id = `recH${String(++n).padStart(13, "0")}`): FixtureRecord => ({ id, createdTime: "2026-04-01T09:00:00.000Z", fields });

export const HUMANOS_BASE = "appSynthHumanOS00";
export const HUMANOS_TOKEN = "pat-humanos-good";

const journal: FixtureTable = {
  id: "tblHJOURNAL00001",
  name: "📖 Journal",
  records: [
    // The oldest generation: percents as fractions.
    rec({ "📆 Date": "2026-05-04", "⚖ Weight": 171.4, "🫓 Body Fat %": 0.223, "🏗 Skeletal Muscle %": 0.498, "💧 Body Water %": 0.561, "🧬 Fat-Free Mass": 133, "🫀 Visceral Fat": 9, "🔥 BMR": 1640, "🧠 Metabolic Age": 38 }, "recHW00000000001"),
    // The middle generation beside the oldest on one day: the middle wins.
    rec({ "📆 Date": "2026-05-05", "⚖ Weight": 171, "🫓 Body Fat %": 0.22, "🤖 RENPHO Current Weight": 170.6, "🤖 RENPHO Current Body Fat": 21.9, "🤖 RENPHO Current Skeletal Muscle": 50.1 }, "recHW00000000002"),
    // The newest generation, and a carried-forward day that stays out.
    rec({ "📆 Date": "2026-09-20", "RENPHO Weight": 151.2, "RENPHO Body Fat %": 18.1, "RENPHO Skeletal Muscle %": 52.9, "RENPHO Visceral Fat": 8, "RENPHO Body Water %": 59, "RENPHO Metabolic Age": 34, "RENPHO BMR": 1560 }, "recHW00000000003"),
    rec({ "📆 Date": "2026-09-21", "RENPHO Weight": 151, "RENPHO Body Fat %": 18, "📊 Renpho Data Type": "Weekly Carry-Forward" }, "recHW00000000004"),
    // A spring day with structured Exercises rows (two Journal rows on the day) and a routine.
    rec({ "📆 Date": "2026-04-12", "🏋️ Workouts": ["recHEX0000000001"], "🏋🏿 Routines": ["recHRT0000000002"], "🏋️ Exercise Notes": "Working Session\nPrimary — Squats\n• 115 × 10\n" }, "recHJ00000000001"),
    rec({ "📆 Date": "2026-04-12", "🏋️ Workouts": ["recHEX0000000002"] }, "recHJ00000000002"),
    // A later day whose sets live only in the notes.
    rec({ "📆 Date": "2026-09-26", "🏋🏿 Routines": ["recHRT0000000002"], "🏋️ Exercise Notes": "🦵 SATURDAY LEGS (9/26) — a reload session\n\nMEAL FRAMEWORK (Lift Day):\n• Shake within 90 min\n\nWarm-Up\n• Bodyweight squats ×15\n\nWorking Session (3 sets per exercise)\n\nBack Squat (reduced)\nwarmup: 45×10\n• 125×8\n• 125×8\n• 125×8\n\nLeg Curl (STRICT FORM — hips planted)\n• 85×10\n• 90×10\n• ninety by ten\n\nRecovery\n• Sauna 15 min\n" }, "recHJ00000000003"),
    rec({ "📆 Date": "2026-09-27", "🏋️ Exercise Notes": "😴 SUNDAY OFF (9/27) — not trained.\n" }, "recHJ00000000004"),
    // Danno's rules (1 Oct): an Off Day placeholder with a draft row (no sets), a chest row linked to two days (the later only), a day entered twice (once).
    rec({ "📆 Date": "2026-04-10", "💪 Exercise Type": ["😴 Off Day"], "🏋️ Workouts": ["recHEX0000000005"] }, "recHJ00000000005"),
    rec({ "📆 Date": "2026-04-15", "💪 Exercise Type": ["🤾‍♀️ Chest"], "🏋️ Workouts": ["recHEX0000000006"] }, "recHJ00000000006"),
    rec({ "📆 Date": "2026-03-30", "🏋️ Workouts": ["recHEX0000000007"] }, "recHJ00000000007"),
    rec({ "📆 Date": "2026-03-30", "🏋️ Workouts": ["recHEX0000000008"] }, "recHJ00000000008"),
  ],
};

const exercises: FixtureTable = {
  id: "tblHEXERCISES001",
  name: "🏋️ Exercises",
  records: [
    rec({ "🏋️ Exercise": "Squats", "🏋🏿 Rep Weight": 115, "💪 Reps / Set": 10, "🏆 Sets": 2, "📖 Journal": ["recHJ00000000001"] }, "recHEX0000000001"),
    rec({ "🏋️ Exercise": "Leg Press", "🏋🏿 Rep Weight": 300, "💪 Reps / Set": 15, "🏆 Sets": 2, "📖 Journal": ["recHJ00000000002"] }, "recHEX0000000002"),
    rec({ "🏋️ Exercise": "SKULLCRUSHERS", "💪 Reps / Set": 12, "🏆 Sets": 3 }, "recHEX0000000003"),
    rec({ "🏋️ Exercise": "Pushups" }, "recHEX0000000004"),
    rec({ "🏋️ Exercise": "Leg Press", "🏋🏿 Rep Weight": 280, "💪 Reps / Set": 10, "🏆 Sets": 2, "📖 Journal": ["recHJ00000000005"] }, "recHEX0000000005"),
    rec({ "🏋️ Exercise": "Dumbbell Flat Press", "🏋🏿 Rep Weight": 65, "💪 Reps / Set": 10, "🏆 Sets": 3, "📖 Journal": ["recHJ00000000001", "recHJ00000000006"] }, "recHEX0000000006"),
    rec({ "🏋️ Exercise": "Lat Pulldown", "📝 Notes": "Warm-up: 60 × 12\nWorking sets: 105 × 10, 105 × 10", "📖 Journal": ["recHJ00000000007"] }, "recHEX0000000007"),
    rec({ "🏋️ Exercise": "Lat Pulldown", "📝 Notes": "Working sets: 105 × 10, 105 × 10", "📖 Journal": ["recHJ00000000008"] }, "recHEX0000000008"),
  ],
};

const routines: FixtureTable = {
  id: "tblHROUTINES0001",
  name: "🏋️‍♀️ Routines",
  records: [rec({ Name: "💪 Arm Day", "🏋️‍♂️ Exercises": ["recHEX0000000003", "recHEX0000000004"] }, "recHRT0000000001"), rec({ Name: "🦵 Leg Day", "🏋️‍♂️ Exercises": ["recHEX0000000001", "recHEX0000000002"] }, "recHRT0000000002")],
};

/** A table the import must never read: its rows are a tripwire in the walk. */
const secrets: FixtureTable = { id: "tblHPASSWORDS001", name: "🔐 Password Bank", records: [rec({ Name: "never read" })] };

export const HUMANOS_TABLES: FixtureTable[] = [journal, exercises, routines, secrets];
