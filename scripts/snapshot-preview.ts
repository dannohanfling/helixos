/** Crawls the running app as the demo client (then coach) and writes a single self-contained HTML snapshot with hash routing. */
import { chromium, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const base = "http://localhost:3000";
const out = process.argv[2];
const MAX = 150;
const PER_SHAPE = 4;
function shape(r: string): string {
  const [path, q = ""] = r.split("?");
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|rec[A-Za-z0-9]{14}|Ω[^/?]*/g, ":id") + "?" + q.split("&").map((kv) => kv.split("=")[0]).sort().join("&");
}

type Snap = { route: string; html: string; title: string };

function norm(href: string): string {
  const u = new URL(href, base);
  return u.pathname + u.search;
}

async function capture(page: Page, route: string): Promise<{ html: string; title: string; links: string[] }> {
  await page.goto(base + route, { waitUntil: "networkidle" });
  return page.evaluate(() => {
    document.querySelectorAll("script, next-route-announcer, nextjs-portal, [data-nextjs-toast], link[rel=preload]").forEach((n) => n.remove());
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).getAttribute("href") || "");
    return { html: document.body.innerHTML, title: document.title, links };
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // CSS once
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const cssHrefs = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => (l as HTMLLinkElement).href));
  let css = "";
  for (const h of cssHrefs) css += (await (await page.request.get(h)).text()) + "\n";

  const snaps: Snap[] = [];
  const skip = (r: string) => /^\/(login|join|api|_next)|logout/.test(r) || r.startsWith("/settings?") && false;

  const shapeCount = new Map<string, number>();
  async function crawl(seed: string[], allowCoachOnly: boolean, seen: Set<string>) {
    const queue = [...seed];
    const seeds = new Set(seed);
    while (queue.length && snaps.length < MAX) {
      const route = queue.shift()!;
      if (seen.has(route) || skip(route)) continue;
      seen.add(route);
      const sh = shape(route);
      if (!seeds.has(route) && (shapeCount.get(sh) ?? 0) >= PER_SHAPE) continue;
      shapeCount.set(sh, (shapeCount.get(sh) ?? 0) + 1);
      try {
        const { html, title, links } = await capture(page, route);
        if (page.url().includes("/login")) continue;
        snaps.push({ route, html, title });
        console.log(`${snaps.length}. ${route}`);
        for (const l of links) {
          if (!l.startsWith("/") || l.startsWith("//")) continue;
          const n = norm(l).replace(/#.*$/, "");
          if (!seen.has(n) && !skip(n) && !queue.includes(n)) {
            if (!allowCoachOnly && /^\/(coach|integrations)/.test(n)) continue;
            queue.push(n);
          }
        }
      } catch (e) {
        console.error("skip", route, (e as Error).message);
      }
    }
  }

  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
  const seenClient = new Set<string>();
  await crawl(["/today", "/tasks", "/content", "/conversations", "/groups", "/webinars", "/offers", "/pathway", "/pathway?view=all", "/courses", "/courses?program=Accelerator", "/courses?program=Academy", "/doctrine", "/proof", "/clients", "/community", "/numbers", "/rewards", "/certification", "/settings", "/more", "/conversations/playbook"], false, seenClient);

  // Coach pages
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  const before = snaps.length;
  for (const r of ["/coach", "/integrations", "/certification?role=coach", "/today?role=coach"]) {
    const { html, title } = await capture(page, r.replace("?role=coach", ""));
    snaps.push({ route: r, html, title });
  }
  console.log(`coach pages: ${snaps.length - before}`);
  await browser.close();

  const pages = snaps.map((s) => `<template data-route="${s.route.replace(/"/g, "&quot;")}" data-title="${s.title.replace(/"/g, "&quot;")}">${s.html}</template>`).join("\n");
  const doc = `<title>HelixOS Preview</title>
<style>${css}</style>
<style>
#hx-bar{position:fixed;left:0;right:0;top:0;z-index:1000;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:6px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
#hx-bar a{color:#fff;text-decoration:underline}
#hx-bar select{font-size:12px;padding:2px 4px;border-radius:4px}
#hx-toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 14px;border-radius:10px;font:13px system-ui,sans-serif;z-index:1001;opacity:0;transition:opacity .2s;pointer-events:none;max-width:90vw}
#hx-toast.on{opacity:1}
#app{padding-top:32px}
</style>
<div id="hx-bar"><strong>HelixOS preview</strong><span>Read-only snapshot of the demo workspace. Links work. Saving needs the real app (see README).</span><label>Jump: <select id="hx-jump"></select></label><a href="#/today">Client view</a><a href="#/today?role=coach">Coach view</a></div>
<div id="app"></div>
<div id="hx-toast"></div>
${pages}
<script>
(function(){
  var tpls = Array.prototype.slice.call(document.querySelectorAll('template[data-route]'));
  var byRoute = {};
  tpls.forEach(function(t){ byRoute[t.getAttribute('data-route')] = t; });
  var app = document.getElementById('app');
  var toast = document.getElementById('hx-toast'); var tt;
  function say(msg){ toast.textContent = msg; toast.classList.add('on'); clearTimeout(tt); tt = setTimeout(function(){ toast.classList.remove('on'); }, 2600); }
  function find(route){
    if (byRoute[route]) return byRoute[route];
    var path = route.split('?')[0];
    if (byRoute[path]) return byRoute[path];
    var k = Object.keys(byRoute).filter(function(r){ return r.split('?')[0] === path; })[0];
    if (k) return byRoute[k];
    var seg = path.split('/').slice(0,2).join('/');
    k = Object.keys(byRoute).filter(function(r){ return r.indexOf(seg) === 0; })[0];
    return k ? byRoute[k] : null;
  }
  function render(){
    var route = (location.hash || '#/today').slice(1);
    if (route.charAt(0) !== '/') route = '/' + route;
    var t = find(route);
    if (!t) { say('That page is not in this snapshot. Run the app locally to see it.'); t = byRoute['/today']; }
    app.innerHTML = t.innerHTML;
    document.title = (t.getAttribute('data-title') || 'HelixOS') + ' · preview';
    window.scrollTo(0,0);
    app.querySelectorAll('details').forEach(function(d){ /* keep as captured */ });
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') return;
      if (href.charAt(0) === '/' && href.charAt(1) !== '/') { e.preventDefault(); location.hash = '#' + href.replace(/#.*$/, ''); return; }
      if (/^https?:/.test(href)) { a.setAttribute('target','_blank'); a.setAttribute('rel','noreferrer'); return; }
    }
    var b = e.target.closest && e.target.closest('button');
    if (b && b.closest('form')) { e.preventDefault(); say('Read-only preview: this button saves data in the real app. Run it locally to try it.'); }
  }, true);
  document.addEventListener('submit', function(e){ e.preventDefault(); say('Read-only preview: forms are disabled here.'); }, true);
  var jump = document.getElementById('hx-jump');
  Object.keys(byRoute).sort().forEach(function(r){ var o = document.createElement('option'); o.value = r; o.textContent = r; jump.appendChild(o); });
  jump.addEventListener('change', function(){ location.hash = '#' + jump.value; });
  window.addEventListener('hashchange', render);
  render();
})();
</script>`;
  writeFileSync(out, doc);
  console.log(`wrote ${out}: ${snaps.length} pages, ${(doc.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
