/**
 * The shape of a model request's user turn (rev 201, for B4's screenshot and B8's meal photo): pure, so a test can hold that a
 * call with no images builds exactly the string it built before, and that an image call builds each provider's own shape. The
 * SDK types are not imported here (ESLint keeps the SDKs inside src/lib/ai.ts); src/lib/ai.ts casts these to them.
 */

export type DraftImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
/** One image for the model: base64 bytes and their type. Never stored, never logged; it lives in the request and nowhere else. */
export type DraftImage = { data: string; mediaType: DraftImageType };

export type AnthropicUserContent = string | ({ type: "image"; source: { type: "base64"; media_type: DraftImageType; data: string } } | { type: "text"; text: string })[];
export type OpenAiInput = string | { role: "user"; content: ({ type: "input_image"; image_url: string; detail: "auto" } | { type: "input_text"; text: string })[] }[];

/** Anthropic: with no images the user turn is the plain string, as always; with images, each image block then the text. */
export function anthropicUserContent(user: string, images?: DraftImage[]): AnthropicUserContent {
  if (!images?.length) return user;
  return [...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })), { type: "text" as const, text: user }];
}

/** OpenAI's Responses API: with no images the input is the plain string, as always; with images, one user item of image parts then the text. */
export function openaiInput(user: string, images?: DraftImage[]): OpenAiInput {
  if (!images?.length) return user;
  return [{ role: "user", content: [...images.map((i) => ({ type: "input_image" as const, image_url: `data:${i.mediaType};base64,${i.data}`, detail: "auto" as const })), { type: "input_text" as const, text: user }] }];
}

/** A provider's refusal of the image itself (a text-only model, an unsupported type, too large), from its status and words. */
export function imageRefusal(status: number | undefined, message: string): boolean {
  return (status === 400 || status === 415 || status === 422) && /image|vision|multimodal|media.?type/i.test(message);
}

/** The accepted types, and the size cap on what reaches the server (the phone downsizes first). */
export const IMAGE_TYPES: readonly DraftImageType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const IMAGE_MAX_BYTES = 900_000;
export const isImageType = (t: string): t is DraftImageType => (IMAGE_TYPES as readonly string[]).includes(t);
