/**
 * HelixOS's own address, the one rule every link it builds uses (rev 843): APP_URL as set in Vercel, with no trailing slash, so
 * a stray slash or an old copy of the rule can't make a link that doesn't match the live domain.
 */
export const siteUrl = (): string => (process.env.APP_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
