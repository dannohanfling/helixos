import localFont from "next/font/local";

/** Cinzel (headings) and DM Sans (body), Latin, OFL, served from this folder: neither the build nor a page reaches Google. */
export const hermesSerif = localFont({ src: "./fonts/Cinzel-latin.woff2", variable: "--hm-serif", weight: "400 900", display: "swap" });
export const hermesSans = localFont({ src: "./fonts/DMSans-latin.woff2", variable: "--hm-sans", weight: "100 1000", display: "swap" });
export const hermesFonts = `${hermesSerif.variable} ${hermesSans.variable}`;
