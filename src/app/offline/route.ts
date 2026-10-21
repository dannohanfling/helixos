import { OFFLINE_MARK } from "./mark";

/**
 * The offline screen (H-626, Phase 1). The service worker keeps this one page and shows it when a page load finds no network.
 * It is a whole HTML document with its styles inline and no scripts or files from the app, because none of those can load
 * while the phone is offline. Light or dark follows the phone, as the app does (#f6f5f1 and #111318).
 */
const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)">
<meta name="robots" content="noindex">
<title>Offline · HelixOS</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f1; --ink: #16181d; --ink-2: #4b4f58; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111318; --ink: #f2f1ec; --ink-2: #b9bcc4; } }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; text-align: center;
    padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  }
  main { max-width: 340px; }
  .mark { display: block; width: 72px; height: 72px; margin: 0 auto 20px; border-radius: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { margin: 0 0 24px; color: var(--ink-2); }
  button { min-height: 44px; min-width: 44px; padding: 0 22px; border-radius: 10px; border: 0; background: var(--ink); color: var(--bg);
    font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <img class="mark" src="${OFFLINE_MARK}" width="72" height="72" alt="">
  <h1>You're offline</h1>
  <p>HelixOS will be back when your connection is. Nothing you saved is lost.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
<script>window.addEventListener("online", function () { location.reload(); });</script>
</body>
</html>`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
