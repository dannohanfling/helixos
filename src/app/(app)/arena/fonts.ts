import localFont from "next/font/local";

/** Cinzel for the Arena's headings, from the same OFL file the Hermes pages use; preloaded on /arena only, where it's imported. */
export const arenaDisplay = localFont({ src: "../../../components/hermes/fonts/Cinzel-latin.woff2", variable: "--ar-display", weight: "400 900", display: "swap" });
