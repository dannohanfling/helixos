import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionWords, withSwitchError } from "../switch";

const SRC = join(__dirname, "..", "..", "..");
const ACTIONS = join(SRC, "lib", "actions");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
/** Every exported server action, with its body up to the next export. */
const actions = readdirSync(ACTIONS)
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => {
    const text = readFileSync(join(ACTIONS, f), "utf8");
    return [...text.matchAll(/^export async function (\w+)\(/gm)].map((m) => {
      const next = text.indexOf("\nexport ", (m.index ?? 0) + 1);
      return { file: f, name: m[1], body: text.slice(m.index, next < 0 ? undefined : next) };
    });
  });
const byName = (name: string) => actions.find((a) => a.name === name)!;

describe("switch to client: the words in the client's log (rev 216)", () => {
  it("turns an action's name into what was done", () => {
    expect(actionWords("updateOfferAction")).toBe("Updated offer");
    expect(actionWords("saveBotLinesAction")).toBe("Saved bot lines");
    expect(actionWords("createWebinarAction")).toBe("Created webinar");
    expect(actionWords("toggleTaskAction")).toBe("Changed task");
    expect(actionWords("frobnicateThingAction")).toBe("Frobnicate thing");
    expect(actionWords(null)).toBe("Made a change");
  });
  it("sends a refusal back to the same page, replacing an earlier one", () => {
    expect(withSwitchError("/offers/abc?tab=2", "No.")).toBe("/offers/abc?tab=2&switchError=No.");
    expect(withSwitchError("/today?switchError=old", "New")).toBe("/today?switchError=New");
  });
});

describe("switch to client: no write escapes the gate", () => {
  // They establish, end or move the session itself, so they have no member to act as.
  const SESSION = ["setupAction", "forgotAction", "resetAction", "loginAction", "joinAction", "logoutAction", "demoLoginAction", "switchToClientAction", "switchBackAction"];
  it("every action goes through ctx() (the gate) or requireCoach() (a switched session is a client to it), or moves the session", () => {
    const loose = actions.filter((a) => !/await ctx\(|await requireCoach\(/.test(a.body) && !SESSION.includes(a.name));
    // The one read that doesn't: it returns nothing while switched (it would read the client's GoHighLevel connection).
    expect(loose.map((a) => a.name)).toEqual(["channelOutcomesAction"]);
    expect(byName("channelOutcomesAction").body).toMatch(/if \(v\.switchedInto\) return \[\];/);
    expect(actions.length).toBeGreaterThan(200);
  });

  // What is the client's own, refused while switched in View or Work (rev 236): account and consent, secrets, sends, their
  // streak, their points, their own words, erasing, and all of Body.
  const REFUSED = [
    "updateProfileAction", "changePasswordAction", "setCoachCanWorkAction", "confirmChatLinkAction", "unlinkChatAction", "setChatProgressShareAction", "setBodyShareAction", "setBodyAiAction", "saveBodySettingsAction",
    "saveFathomKeyAction", "removeFathomKeyAction", "recheckFathomKeyAction", "harvestRecordingAction", "connectGhlAction", "disconnectGhlAction", "setGhlMappingAction", "refreshGhlAccountsAction", "syncPostStatusAction", "checkAllPostStatusAction", "markPassInstalledAction",
    "distributeAllAction", "pushLadderUpdateAction", "handOffLadderAction", "pushYourBotAction", "sendTestPushAction", "publishMagnetAction", "unpublishMagnetAction", "markPostedInGroupAction", "logMessageAction", "sendFaqAction", "recordShareAction",
    "morningCheckinAction", "eveningCloseAction", "repairStreakAction",
    "claimRewardAction", "completeLessonAction", "uncompleteLessonAction", "completeCurriculumDayAction",
    "saveIntentionAction", "reviewIntentionAction", "saveMonthIntentionAction", "saveFeedbackAction", "saveOohRequestAction", "submitCertAction", "submitPathwayTaskAction",
    "eraseBodyAction", "setupBodyAction", "logFoodAction", "logMealAction",
  ];
  it.each(REFUSED)("%s is refused while switched, with a reason, before anything else it awaits", (name) => {
    const b = byName(name).body;
    expect(b).toMatch(/ctx\(\{ whileSwitched: "refuse", reason: "[^"]+" \}\)/);
    expect(b.indexOf("await ")).toBe(b.indexOf('await ctx({ whileSwitched: "refuse"'));
  });

  it("read-state side effects mark nothing for the client: What's new and the tier celebration", () => {
    for (const name of ["markWhatsNewSeenAction", "markTierCelebratedAction"]) {
      const b = byName(name).body;
      expect(b).toMatch(/ctx\(\{ whileSwitched: "noop" \}\)/);
      expect(b.indexOf("if (v.switchedInto) return;")).toBeGreaterThan(-1);
      expect(b.indexOf("if (v.switchedInto) return;")).toBeLessThan(b.indexOf("db.update"));
    }
  });

  it("the gate refuses every write while viewing, and logs every write while working", () => {
    const gate = read("lib/switch.ts");
    expect(gate).toMatch(/if \(sw\.mode === "view"\) await refuseSwitched\(/);
    expect(gate).toMatch(/insert\(schema\.coachChanges\)/);
    expect(read("lib/action-helpers.ts")).toMatch(/if \(v\.switchedInto\) await switchedWrite\(v, opts\.whileSwitched \?\? "log", opts\.reason\)/);
  });

  it("points, AI and Body: never the client's while switched", () => {
    expect(read("lib/queries/points.ts")).toMatch(/if \(await switchedRequest\(\)\) return false;/);
    const ai = read("lib/ai.ts");
    expect(ai).toMatch(/credentialFor\(v\.workspace\.id, aiUserId\(v\)\)/);
    expect(ai).toMatch(/userId: aiUserId\(v\)/);
    expect(ai).not.toMatch(/credentialFor\(v\.workspace\.id, v\.user\.id\)/);
    expect(read("lib/queries/body.ts")).toMatch(/if \(v\.switchedInto \|\| v\.actor\.id !== v\.user\.id\) return false;/);
    // The viewer hides Body entirely while switched, by Body's own flag.
    expect(read("lib/auth.ts")).toMatch(/membership: \{ \.\.\.cm, bodyEnabled: false \}/);
  });

  it("the client's export is refused, and uploads while viewing", () => {
    expect(read("app/api/export/route.ts")).toMatch(/if \(v\.switchedInto\) return NextResponse\.json/);
    for (const r of ["app/api/deck-images/upload/route.ts", "app/api/magnets/upload/route.ts", "app/api/proofs/upload/route.ts"]) expect(read(r)).toMatch(/v\.switchedInto\?\.mode === "view"/);
  });
});
