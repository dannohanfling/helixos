import localFont from "next/font/local";

/**
 * The leaderboard design's three faces (H-28), Latin, all under the SIL Open Font License, served from this folder as Hermes
 * serves its own: neither the build nor a visitor's browser reaches Google. Variable fonts, so every weight the design uses
 * (League Spartan 500–800, Montserrat 400–600, Cormorant Garamond 500–600 and its italic) comes from one file each.
 */
export const lbSpartan = localFont({ src: "./fonts/LeagueSpartan-latin.woff2", variable: "--lb-spartan", weight: "100 900", display: "swap" });
export const lbSans = localFont({ src: "./fonts/Montserrat-latin.woff2", variable: "--lb-sans", weight: "100 900", display: "swap" });
export const lbSerif = localFont({
  // Not preloaded (Speed 1, H-1623): the ceremonies on every page import it, so a preload cost every page 61 KB; the browser
  // fetches it only when a ceremony or the board actually draws in it.
  preload: false,
  src: [
    { path: "./fonts/CormorantGaramond-latin.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/CormorantGaramond-italic-latin.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--lb-serif",
  display: "swap",
});
export const lbFonts = `${lbSpartan.variable} ${lbSans.variable} ${lbSerif.variable}`;
