/** Demo logins show in development, and in production only when DEMO_LOGIN=1 is set on purpose. */
export function demoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN === "1" || process.env.NODE_ENV !== "production";
}
