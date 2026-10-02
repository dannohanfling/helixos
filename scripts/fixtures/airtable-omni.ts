/**
 * A synthetic Omnichannel base for the coach's Airtable backfill walk (rev 441): Client Feedback, Client Support and the
 * Fulfillment members table, with the field names as Airtable returns them and invented answers. Nobody's data is in here, by
 * rule. Fulfillment carries a phone beside the email so the walk proves only the email field is ever asked for, and the base has
 * a Password Bank that is never read.
 */
import type { FixtureRecord, FixtureTable } from "./airtable-client";

const rec = (id: string, fields: Record<string, unknown>, createdTime = "2026-03-01T09:00:00.000Z"): FixtureRecord => ({ id, createdTime, fields });

export const OMNI_BASE = "appSynthOmnichan1";
export const OMNI_TOKEN = "pat-omni-good";
/** The real table and field ids the importer asks for by id (src/lib/engine/coach-backfill.ts). */
const EMAIL = "fld3PV6STUBAFyfeT";

const members: FixtureTable = {
  id: "tblxCBKthZ4EmmV6Y",
  name: "❤️ Fulfillment",
  records: [
    rec("recOMMAYA0000001", { [EMAIL]: "Client@Demo.HelixOS.app", fldNivkhvmczy1X5V: "+1 555 0100" }),
    rec("recOMJORDAN00001", { [EMAIL]: "client2@demo.helixos.app", fldNivkhvmczy1X5V: "+1 555 0101" }),
    rec("recOMNOBODY00001", { [EMAIL]: "left-long-ago@example.com" }),
  ],
};

const answers = (n: number) => ({ "🏆 Proud": `Proud ${n}`, "❤ Love": `Love ${n}`, "⬇ Less": `Less ${n}`, "⬆ More": `More ${n}`, "😮 Wow": `Wow ${n}`, "⭐ Favorite": `Favorite ${n}` });
const feedback: FixtureTable = {
  id: "tblqYwzs6zpAa2wvm",
  name: "❤️ Client Feedback",
  records: [
    rec("recOFB0000000001", { ...answers(1), "📆 Date": "2026-02-27", "🗓 Month": "💙 February", "🔢 NPS": 9, "📣 Referrals": "A friend", "✨ Improve": "More Fridays", "👨🏻‍🤝‍👨🏻 Member Card": ["recOMMAYA0000001"] }),
    rec("recOFB0000000002", { ...answers(2), "📆 Date": "2026-04-02", "🔢 NPS": 8, "👨🏻‍🤝‍👨🏻 Member Card": ["recOMMAYA0000001"] }),
    rec("recOFB0000000003", { ...answers(3), "📆 Date": "2026-02-28", "🗓 Month": "💙 February", "🔢 NPS": 10, "👨🏻‍🤝‍👨🏻 Member Card": ["recOMJORDAN00001"] }),
    rec("recOFB0000000004", { ...answers(4), "📆 Date": "2026-02-28", "🔢 NPS": 6, "👨🏻‍🤝‍👨🏻 Member Card": ["recOMNOBODY00001"] }),
    rec("recOFB0000000005", { ...answers(5), "📆 Date": "2026-05-30", "👨🏻‍🤝‍👨🏻 Member Card": ["recOMJORDAN00001"] }),
    // The first rows had no date: the month falls back to when the row was made.
    rec("recOFB0000000006", { ...answers(6), "🔢 NPS": 7, "👨🏻‍🤝‍👨🏻 Member Card": ["recOMJORDAN00001"] }, "2023-11-01T10:00:00.000Z"),
  ],
};

const support: FixtureTable = {
  id: "tblvAH0kkgq0LQ5Ga",
  name: "❤️ Client Support",
  records: [
    rec("recOOH0000000001", {
      "⏱️ Time Created": "2026-03-10T15:00:00.000Z",
      "🗓 Workshop Date": "2026-03-13",
      Email: "client@demo.helixos.app",
      "Please explain the obstacle at hand": "My opt-in page doesn't load on phones",
      "What have you done to try to solve the issue?": "Rebuilt the page",
      "💡 What is the solution we are trying to achieve on our call?": "A page that loads",
      "🧰 What tools are necessary?": ["GoHighLevel"],
      "⛓ Category": "funnels",
      "📊 Status": "✅ Resolved",
      "✍ Notes": "Fixed the image sizes live",
    }),
    rec("recOOH0000000002", { "👨‍💼 Member": ["recOMJORDAN00001"], "❓ Core Question": "How do I price two offers?", "✍ Description": "Two offers, one audience", "⚙️ Solution Attempts": "Asked the group", "📌 Type": "Offer creation", "📊 Status": "No show" }, "2023-12-04T16:00:00.000Z"),
    rec("recOOH0000000003", { Email: "left-long-ago@example.com", "Please explain the obstacle at hand": "Old question", "💡 What is the solution we are trying to achieve on our call?": "An answer" }),
  ],
};

const secrets: FixtureTable = { id: "tblOPASSWORDS0001", name: "🔐 Password Bank", records: [rec("recOSECRET000001", { Name: "never read" })] };

export const OMNI_TABLES: FixtureTable[] = [feedback, support, members, secrets];
