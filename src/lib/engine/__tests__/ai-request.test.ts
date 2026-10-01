import { describe, expect, it } from "vitest";
import { IMAGE_MAX_BYTES, anthropicUserContent, imageRefusal, isImageType, openaiInput, type DraftImage } from "@/lib/engine/ai-request";

const img: DraftImage = { data: "aGVsbG8=", mediaType: "image/jpeg" };

describe("the model request's user turn (rev 201): images are additive", () => {
  it("with no images, both providers get exactly the string they always got", () => {
    expect(anthropicUserContent("Draft this.")).toBe("Draft this.");
    expect(anthropicUserContent("Draft this.", [])).toBe("Draft this.");
    expect(openaiInput("Draft this.")).toBe("Draft this.");
    expect(openaiInput("Draft this.", undefined)).toBe("Draft this.");
  });
  it("Anthropic: each image as a base64 block, then the text", () => {
    expect(anthropicUserContent("What's on the plate?", [img])).toEqual([{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } }, { type: "text", text: "What's on the plate?" }]);
  });
  it("OpenAI: one user item with an input_image data URL per image, then input_text", () => {
    expect(openaiInput("What's on the plate?", [img, { ...img, mediaType: "image/png" }])).toEqual([
      { role: "user", content: [{ type: "input_image", image_url: "data:image/jpeg;base64,aGVsbG8=", detail: "auto" }, { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=", detail: "auto" }, { type: "input_text", text: "What's on the plate?" }] },
    ]);
  });
  it("a provider refusing the image is told apart from a broken key or a down service", () => {
    expect(imageRefusal(400, "This model does not support image input")).toBe(true);
    expect(imageRefusal(400, "messages.0.content.0.image.source: media type not supported")).toBe(true);
    expect(imageRefusal(400, "Invalid request: max_tokens too large")).toBe(false);
    expect(imageRefusal(401, "image: invalid x-api-key")).toBe(false);
    expect(imageRefusal(500, "vision backend down")).toBe(false);
  });
  it("accepts the four image types and caps what reaches the server", () => {
    expect(["image/jpeg", "image/png", "image/webp", "image/gif"].every(isImageType)).toBe(true);
    expect(isImageType("image/heic")).toBe(false);
    expect(IMAGE_MAX_BYTES).toBeLessThan(1_000_000);
  });
});

describe("src/lib/ai.ts carries images without touching a text-only call", () => {
  it("builds the user turn through the pure builders, keeps images out of the usage row and the error log, and throws AiImageError only for an image call", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/ai.ts", "utf8");
    expect(src).toMatch(/content: anthropicUserContent\(user, images\)/);
    expect(src).toMatch(/input: openaiInput\(user, images\)/);
    expect(src).toMatch(/opts\.essence === false \? null : await essenceBlockFor/);
    expect(src).toMatch(/if \(opts\.images\?\.length && imageRefusal\(err\.status, err\.message \?\? ""\)\) throw new AiImageError\("This model can't read images\."\)/);
    // The usage row and the failure log name the provider, the model, the feature and the counts: never the images.
    const usage = src.slice(src.indexOf("db.insert(schema.aiUsage)"), src.indexOf(";", src.indexOf("db.insert(schema.aiUsage)")));
    expect(usage).not.toMatch(/images|opts\./);
    const log = src.slice(src.indexOf('console.error("[ai] draft failed"'), src.indexOf("\n", src.indexOf('console.error("[ai] draft failed"')));
    expect(log).not.toMatch(/images|user|opts/);
  });
});
