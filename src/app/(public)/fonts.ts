import localFont from "next/font/local";

/** The public pages' two faces (Scriba's design), Latin, OFL, served from public/fonts: no visitor's browser reaches Google. */
export const legalSerif = localFont({
  src: [
    { path: "../../../public/fonts/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/cormorant-garamond-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--lg-serif",
  display: "swap",
});
export const legalSans = localFont({
  src: [
    { path: "../../../public/fonts/manrope-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../../public/fonts/manrope-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../../public/fonts/manrope-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--lg-sans",
  display: "swap",
});
