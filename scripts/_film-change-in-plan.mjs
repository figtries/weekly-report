/** Film "Change in plan" (Data Overall panel -> planner, kind view open) and
 *  write a contact sheet plus the transition's own timeline, because motion
 *  cannot be read from the DOM.
 *    node scripts/_film-change-in-plan.mjs <out-dir> [width] [height] [cpu-throttle]
 *  Signs in by minting a ten-minute session in data/auth.json and removing it. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const B = process.env.FILM_BASE || 'http://localhost:3000';
const OUT = process.argv[2];
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 900);
const CPU = Number(process.argv[5] || 1);
mkdirSync(OUT, { recursive: true });
const tag = `${W}x${H}`;

const AUTH = 'data/auth.json';
const token = randomBytes(32).toString('base64url');
const editAuth = (fn) => {
  const doc = JSON.parse(readFileSync(AUTH, 'utf8'));
  fn(doc);
  writeFileSync(AUTH, JSON.stringify(doc));
};
editAuth((d) => (d.sessions[token] = { id: d.accounts[0].id, exp: Date.now() + 600_000 }));

const db = new Database('data/report.db', { readonly: true });
const leaf = db
  .prepare("select id, project_id from wbs_nodes where deskripsi like 'Pipeline Route Survey%' limit 1")
  .get();
db.close();
console.log('leaf', leaf);

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: true });
try {
  const p = await b.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: W < 600, hasTouch: W < 600 });
  await p.setCookie({ name: 'lucille_session', value: token, url: B });
  // Warm both routes (dev compiles on first hit), then arrive with the panel open.
  await p.goto(`${B}/projects/${leaf.project_id}`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  await p.goto(`${B}/weekly/36/overall?item=${encodeURIComponent(leaf.id)}`, { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('a[href*="open=kind"]', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  // The transition's own account of itself.
  await p.evaluate(() => {
    const log = (window.__log = []);
    const t0 = (window.__t0 = performance.now());
    const at = () => Math.round(performance.now() - t0);
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (arg) => {
      log.push([at(), 'vt start']);
      const t = start(arg);
      t.ready.then(() => log.push([at(), 'vt ready']), () => log.push([at(), 'vt ready REJECTED']));
      t.finished.then(() => log.push([at(), 'vt finished']));
      const skip = t.skipTransition.bind(t);
      t.skipTransition = () => {
        log.push([at(), 'vt SKIPPED']);
        skip();
      };
      return t;
    };
    new MutationObserver((list) => {
      for (const r of list)
        for (const n of r.addedNodes)
          if (n instanceof Element) {
            const ov = n.matches('[style*="view-transition-name: ov-"]') ? n : n.querySelector('[style*="view-transition-name: ov-"]');
            if (ov) log.push([at(), 'overlay added ' + String(ov.className).slice(0, 60)]);
          }
    }).observe(document.body, { childList: true, subtree: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) log.push([Math.round(e.startTime - t0), `LONG TASK ${Math.round(e.duration)}ms`]);
    }).observe({ entryTypes: ['longtask'] });
  });

  const client = await p.target().createCDPSession();
  if (CPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const frames = [];
  let t0 = 0;
  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    frames.push({ t: Date.now() - t0, data });
    await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
  t0 = Date.now();
  await p.evaluate(() => {
    window.__t0click = Math.round(performance.now() - window.__t0);
    document.querySelector('a[href*="open=kind"]').click();
  });
  await new Promise((r) => setTimeout(r, Number(process.env.FILM_MS || 2600) * Math.max(1, CPU / 2)));
  await client.send('Page.stopScreencast');
  if (CPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const info = await p.evaluate(() => ({ click: window.__t0click, log: window.__log.concat(performance.getEntriesByType('resource').filter((e) => e.startTime - window.__t0 >= window.__t0click).map((e) => [Math.round(e.responseEnd - window.__t0), 'fetched ' + e.name.replace(location.origin, '').slice(0, 70) + ' (' + Math.round(e.duration) + 'ms)'])), url: location.pathname + location.hash }));
  console.log(tag, 'cpu', CPU, 'url', info.url);
  for (const [t, what] of info.log.sort((a, b2) => a[0] - b2[0])) console.log(String(t - info.click).padStart(6), what);
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  console.log('frames', frames.length, 'longest gap', Math.max(...gaps), 'ms; times', frames.map((f) => f.t).join(' '));

  // Contact sheet, drawn by the browser so nothing extra is installed.
  const pick = frames.filter((_, i) => i % Math.max(1, Math.ceil(frames.length / 24)) === 0).slice(0, 24);
  const sheet = await b.newPage();
  const cols = W < 600 ? 8 : 4;
  const cw = W < 600 ? 200 : 480;
  await sheet.setViewport({ width: cols * (cw + 8) + 8, height: 800 });
  await sheet.setContent(
    `<body style="margin:8px;background:#222;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:8px;font:12px sans-serif;color:#fff">` +
      pick.map((f) => `<div><div>${f.t} ms</div><img style="width:${cw}px;display:block" src="data:image/jpeg;base64,${f.data}"></div>`).join('') +
      '</body>'
  );
  await sheet.screenshot({ path: `${OUT}/sheet-${tag}-cpu${CPU}.png`, fullPage: true });
  console.log('wrote', `${OUT}/sheet-${tag}-cpu${CPU}.png`);
} finally {
  await b.close();
  editAuth((d) => delete d.sessions[token]);
}
