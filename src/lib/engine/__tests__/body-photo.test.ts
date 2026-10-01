import { describe, expect, it } from "vitest";
import { PHOTO_MAX_LINES, PHOTO_TASK, parsePhotoLines, photoItems, readPhotoLines } from "@/lib/engine/body-photo";
import { totalsOf } from "@/lib/engine/body";

const answer = JSON.stringify({ lines: [{ name: "Grilled chicken breast", qty: 6, unit: "oz", cal: 280, p: 52, f: 6, c: 0 }, { name: "White rice", qty: 1, unit: "cup", cal: 205, p: 4.3, f: 0.4, c: 45 }], note: "Portions are a guess." });

describe("a meal from a photo (rev 237 phase 14): the model's answer", () => {
  it("asks for JSON lines only and reads them back, fences and prose stripped, bad lines dropped, twelve at most", () => {
    expect(PHOTO_TASK).toMatch(/meal photo/);
    expect(PHOTO_TASK).toMatch(/"lines"/);
    expect(parsePhotoLines("```json\n" + answer + "\n```")).toEqual({ lines: [{ name: "Grilled chicken breast", qty: 6, unit: "oz", cal: 280, p: 52, f: 6, c: 0 }, { name: "White rice", qty: 1, unit: "cup", cal: 205, p: 4.3, f: 0.4, c: 45 }], note: "Portions are a guess." });
    expect(parsePhotoLines("Here you go: " + answer).lines).toHaveLength(2);
    expect(parsePhotoLines(JSON.stringify({ lines: [{ name: "", qty: 1, unit: "oz", cal: 1, p: 0, f: 0, c: 0 }, { name: "No qty", unit: "oz", cal: 1, p: 0, f: 0, c: 0 }, { name: "Neg", qty: 1, unit: "oz", cal: -5, p: 0, f: 0, c: 0 }, { name: "Odd unit", qty: 2, unit: "handful", cal: 10, p: 1, f: 0, c: 1 }] })).lines).toEqual([{ name: "Odd unit", qty: 2, unit: "handful", cal: 10, p: 1, f: 0, c: 1 }]);
    expect(parsePhotoLines(JSON.stringify({ lines: Array.from({ length: 20 }, (_, i) => ({ name: `Food ${i}`, qty: 1, unit: "oz", cal: 1, p: 0, f: 0, c: 0 })) })).lines).toHaveLength(PHOTO_MAX_LINES);
    expect(parsePhotoLines("not json at all")).toEqual({ lines: [], note: null });
    expect(parsePhotoLines('{"lines":[],"note":"That is a cat."}')).toEqual({ lines: [], note: "That is a cat." });
  });
  it("becomes entry items per unit, so a changed amount scales the macros", () => {
    const items = photoItems(parsePhotoLines(answer).lines);
    expect(items[0]).toEqual({ foodId: null, name: "Grilled chicken breast", unit: "oz", qty: 6, cal: 46.67, p: 8.67, f: 1, c: 0, capTag: null });
    expect(totalsOf(items)).toEqual({ cal: 485, p: 56.3, f: 6.4, c: 45 });
  });
  it("reads the confirm form: ticked lines only, the member's amount against the model's portion, edited words kept", () => {
    const fields: Record<string, string> = {
      line_0_use: "1", line_0_name: "Chicken breast", line_0_qty: "8", line_0_qty0: "6", line_0_unit: "oz", line_0_cal: "280", line_0_p: "52", line_0_f: "6", line_0_c: "0",
      line_1_use: "", line_1_name: "White rice", line_1_qty: "1", line_1_qty0: "1", line_1_unit: "cup", line_1_cal: "205", line_1_p: "4.3", line_1_f: "0.4", line_1_c: "45",
      line_2_use: "1", line_2_name: "Broccoli", line_2_qty: "0", line_2_qty0: "1", line_2_unit: "cup", line_2_cal: "55", line_2_p: "3.7", line_2_f: "0.6", line_2_c: "11",
    };
    expect(readPhotoLines((k) => fields[k] ?? "")).toEqual([{ name: "Chicken breast", qty: 8, unit: "oz", cal: 373.3, p: 69.3, f: 8, c: 0 }]);
  });
});
