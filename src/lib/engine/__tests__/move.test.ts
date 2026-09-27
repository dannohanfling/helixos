import { describe, expect, it } from "vitest";
import { parsePicks, planKey, planMove, type MoveWorld } from "../move";

// Danno's workspace with Lindsey's things mixed in: her webinar points at her offer, her proof, a story and an image; her
// proof points at her client's record. His own lead magnet points at his offer, and his webinar shares one story with hers.
const world: MoveWorld = {
  rows: [
    { kind: "webinar", id: "w-edge", label: "Your Edge, Uncovered", refs: [{ kind: "offer", id: "o-diag" }, { kind: "proof", id: "p-kate" }, { kind: "asset", id: "a-her-story" }, { kind: "image", id: "i-slide" }, { kind: "asset", id: "a-shared-story" }] },
    { kind: "webinar", id: "w-danno", label: "It Goes Down In The DMs", refs: [{ kind: "offer", id: "o-gs" }, { kind: "asset", id: "a-shared-story" }] },
    { kind: "offer", id: "o-diag", label: "90-Minute Diagnostic", refs: [] },
    { kind: "offer", id: "o-gs", label: "Get started", refs: [] },
    { kind: "proof", id: "p-kate", label: "Kate", refs: [{ kind: "client_record", id: "c-kate" }] },
    { kind: "proof", id: "p-rachael", label: "Rachael", refs: [] },
    { kind: "lead_magnet", id: "m-dms", label: "DM scripts", refs: [{ kind: "offer", id: "o-gs" }] },
    { kind: "image", id: "i-slide", label: "Turas slide", refs: [] },
    { kind: "asset", id: "a-her-story", label: "story: The drift", refs: [] },
    { kind: "asset", id: "a-shared-story", label: "story: First $5k week", refs: [] },
    { kind: "client_record", id: "c-kate", label: "Kate", refs: [] },
  ],
  essenceStories: [{ webinarId: "w-edge", name: "My reset" }],
};

describe("moving the coach's items to a client (27 Sep)", () => {
  const plan = planMove(world, [{ kind: "webinar", id: "w-edge" }, { kind: "proof", id: "p-rachael" }]);
  const ids = plan.moves.map((m) => `${m.kind}:${m.id}:${m.why === "picked" ? "picked" : "carried"}`);
  it("a picked webinar carries what only it points at: its offer, its proof (and that proof's client record), its story and its image", () => {
    expect(ids).toEqual(["webinar:w-edge:picked", "offer:o-diag:carried", "proof:p-kate:carried", "proof:p-rachael:picked", "image:i-slide:carried", "asset:a-her-story:carried", "client_record:c-kate:carried"]);
    expect(plan.moves.find((m) => m.id === "o-diag")!.why).toBe('webinar "Your Edge, Uncovered" points at it');
  });
  it("what a staying item also uses is held back, and said; a story in the coach's Essence can't move, and is said", () => {
    expect(ids.some((i) => i.startsWith("asset:a-shared-story"))).toBe(false);
    expect(plan.cannot).toEqual([
      'Bank entry "story: First $5k week" stays with you, because webinar "It Goes Down In The DMs" also uses it. Webinar "Your Edge, Uncovered" will point at something the client can\'t see; pick both to move them together.',
      'The story "My reset" in webinar "Your Edge, Uncovered" lives in your Essence, which doesn\'t move. Add it to the client\'s Essence, or pick another story for that belief.',
    ]);
  });
  it("picking both moves the shared story with them; picking an item a staying one uses moves it and warns", () => {
    const both = planMove(world, [{ kind: "webinar", id: "w-edge" }, { kind: "webinar", id: "w-danno" }]);
    expect(both.moves.map((m) => m.id)).toContain("a-shared-story");
    const offer = planMove(world, [{ kind: "offer", id: "o-gs" }]);
    expect(offer.warnings).toEqual(['Offer "Get started" is also used by webinar "It Goes Down In The DMs" and lead magnet "DM scripts", which stays with you and will lose it.']);
  });
  it("an item nobody picked, and nothing picked points at, never moves; unknown ids and unpickable kinds are ignored", () => {
    expect(planMove(world, [{ kind: "proof", id: "nope" }]).moves).toEqual([]);
    expect(parsePicks(["offer:o1", "asset:a1", "client_record:c1", "webinar:", "junk"])).toEqual([{ kind: "offer", id: "o1" }]);
  });
  it("the plan's key is the client and exactly what moves, in any order", () => {
    expect(planKey("m1", plan)).toBe(planKey("m1", { ...plan, moves: [...plan.moves].reverse() }));
    expect(planKey("m1", plan)).not.toBe(planKey("m2", plan));
  });
});
