/**
 * The emoji picker (H-94): about sixty common emojis in five groups, each with a plain name a screen reader can say and a
 * search can match; and the one rule for "Other…": exactly one emoji, nothing else.
 */
export type EmojiItem = { e: string; name: string };
export type EmojiGroup = { name: string; items: EmojiItem[] };

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: "People",
    items: [
      { e: "🧭", name: "compass" },
      { e: "😀", name: "grinning face" },
      { e: "😎", name: "sunglasses" },
      { e: "🤓", name: "nerd face" },
      { e: "🥳", name: "party face" },
      { e: "🤔", name: "thinking face" },
      { e: "😴", name: "sleeping face" },
      { e: "🤝", name: "handshake" },
      { e: "💪", name: "flexed biceps" },
      { e: "👋", name: "waving hand" },
      { e: "🙏", name: "folded hands" },
      { e: "🧠", name: "brain" },
    ],
  },
  {
    name: "Symbols",
    items: [
      { e: "🔱", name: "trident" },
      { e: "⚡", name: "lightning" },
      { e: "🔥", name: "fire" },
      { e: "⭐", name: "star" },
      { e: "✨", name: "sparkles" },
      { e: "💎", name: "gem" },
      { e: "❤️", name: "red heart" },
      { e: "💡", name: "light bulb" },
      { e: "🎯", name: "bullseye" },
      { e: "🏆", name: "trophy" },
      { e: "🚀", name: "rocket" },
      { e: "♾️", name: "infinity" },
    ],
  },
  {
    name: "Nature",
    items: [
      { e: "🌊", name: "wave" },
      { e: "🌱", name: "seedling" },
      { e: "🌳", name: "tree" },
      { e: "🌸", name: "cherry blossom" },
      { e: "🌙", name: "crescent moon" },
      { e: "☀️", name: "sun" },
      { e: "🌈", name: "rainbow" },
      { e: "🏔️", name: "mountain" },
      { e: "🌋", name: "volcano" },
      { e: "🍀", name: "four-leaf clover" },
      { e: "🌵", name: "cactus" },
      { e: "🪐", name: "planet" },
    ],
  },
  {
    name: "Objects",
    items: [
      { e: "🎨", name: "palette" },
      { e: "🎸", name: "guitar" },
      { e: "📚", name: "books" },
      { e: "🛠️", name: "tools" },
      { e: "⚓", name: "anchor" },
      { e: "🏛️", name: "classical building" },
      { e: "🗝️", name: "key" },
      { e: "🎲", name: "dice" },
      { e: "🧩", name: "puzzle piece" },
      { e: "🔭", name: "telescope" },
      { e: "☕", name: "coffee" },
      { e: "🧲", name: "magnet" },
    ],
  },
  {
    name: "Animals",
    items: [
      { e: "🦁", name: "lion" },
      { e: "🐺", name: "wolf" },
      { e: "🦅", name: "eagle" },
      { e: "🦉", name: "owl" },
      { e: "🐬", name: "dolphin" },
      { e: "🐢", name: "turtle" },
      { e: "🦋", name: "butterfly" },
      { e: "🐝", name: "bee" },
      { e: "🐘", name: "elephant" },
      { e: "🦊", name: "fox" },
      { e: "🐎", name: "horse" },
      { e: "🦄", name: "unicorn" },
    ],
  },
];
export const ALL_EMOJI: EmojiItem[] = EMOJI_GROUPS.flatMap((g) => g.items);

/** The name the picker shows and announces for an emoji; one from outside the list is "your own". */
export const emojiName = (e: string): string => ALL_EMOJI.find((i) => i.e === e)?.name ?? "your own";

/** Exactly one emoji: one grapheme, and that grapheme a pictograph (a letter or a word is refused). */
export function isOneEmoji(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 16) return false;
  const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].length : [...t].length;
  return graphemes === 1 && /\p{Extended_Pictographic}/u.test(t);
}

/** The items whose name holds every word of the query, in the list's own order. */
export function searchEmoji(q: string): EmojiItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return ALL_EMOJI;
  return ALL_EMOJI.filter((i) => words.every((w) => i.name.includes(w) || i.e === w));
}
