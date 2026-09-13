/**
 * Where does this app still make you wait?
 *
 * Everything here is timed from INSIDE the page — a MutationObserver coalesced
 * into one check per frame — so the number is what a hand feels rather than
 * what this script's polling can resolve. Two kinds of measurement:
 *
 *   nav    press a sidebar link → that page's own content is on screen.
 *   press  press a control that writes → the screen changes at all.
 *
 * The second is the one that found the planner bugs. A write that awaits a
 * server round trip before moving anything reads as a dead button, and on this
 * deployment every write awaits a ~2 MB snapshot upload to Vercel Blob — so
 * "make the server faster" is never the answer; moving the screen first is.
 *
 * Phone profile by default (390px, 4x CPU), because that is what this app is
 * tested on and a desktop hides exactly the cost this looks for.
 *
 * Usage: node scripts/audit-responsiveness.mjs [baseUrl] [phone|desktop]
 */
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const PHONE = (process.argv[3] ?? 'phone') === 'phone';
/**
 * Two different promises, so two different lines.
 *
 * A PRESS is local feedback and owes nothing to the network: the screen has to
 * move within about a tenth of a second or the control reads as dead. That is
 * the bar the planner's buttons now clear at 20-40ms.
 *
 * A NAV fetches a segment from the server, so it cannot be instant — but on a
 * 4x-throttled phone anything past ~0.7s stops feeling like a page arriving and
 * starts feeling like a page refusing.
 */
const SLOW_PRESS = 150;
const SLOW_NAV = 700;

const exe = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('No local Chrome found — set CHROME_PATH');
mkdirSync('scratch', { recursive: true });

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport(
  PHONE
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1400, height: 900, deviceScaleFactor: 1 }
);
const cdp = await page.createCDPSession();
if (PHONE) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const rows = [];
/**
 * `skip` is not a failure and must not be counted as one.
 *
 * A control this script cannot find is usually this script's fault — the page
 * moved on after the previous press, or the label changed. Reporting that as
 * DEAD alongside a genuinely frozen button is how a tool stops being believed.
 */
function note(kind, what, ms, extra = '', skip = false) {
  const limit = kind === 'nav' ? SLOW_NAV : SLOW_PRESS;
  const flag = skip ? 'skip' : ms === null ? 'DEAD' : ms > limit ? 'SLOW' : 'ok  ';
  rows.push({ kind, what, ms, flag, extra });
  console.log(
    `${flag} ${kind.padEnd(5)} ${what.padEnd(30)} ${(ms === null ? '—' : `${ms}ms`).padStart(8)}  ${extra}`
  );
}

/**
 * Start watching for the thing that says the press landed.
 *
 * `mode: 'any'`   — the screen changed at all. What a hand feels on a press.
 * `mode: 'route'` — the URL is under `arg` AND `<main>` is no longer showing
 *                   what it was showing. A route is not arrived just because
 *                   the path changed: an index route redirects, and the shell
 *                   paints before its content does. Matching on a WORD is
 *                   worse than useless here — every page label lives in the
 *                   sidebar, so "Dashboard" is on screen before you press it,
 *                   and an earlier version of this script cheerfully reported
 *                   20ms navigations because of it.
 *
 * Checks are coalesced into one per animation frame, and read `textContent`
 * rather than `innerText`: innerText forces a layout on every mutation, which
 * under a 4x CPU throttle is the measurement changing what it measures.
 */
const watch = (mode, arg) =>
  page.evaluate(
    (m, a0) => {
      window.__a?.obs?.disconnect();
      const main = () => document.querySelector('main') ?? document.body;
      const a = { t0: null, ms: null, obs: null, was: (main().textContent ?? '').slice(0, 400) };
      let queued = false;
      const hit = () => {
        if (m === 'any') return true;
        // '=' means the dashboard, which IS the root path — a startsWith on
        // '/' would match every route in the app.
        if (a0 === '=' ? location.pathname !== '/' : !location.pathname.startsWith(a0)) return false;
        const now = (main().textContent ?? '').slice(0, 400);
        return now !== a.was && now.trim().length > 40;
      };
      const check = () => {
        queued = false;
        if (a.t0 === null || a.ms !== null) return;
        if (hit()) a.ms = Math.round(performance.now() - a.t0);
      };
      a.obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(check);
      });
      a.obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      window.__a = a;
    },
    mode,
    arg ?? ''
  );

async function result(ms = 25_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await page.evaluate(() => window.__a?.ms ?? null);
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

/** Press by visible text, stamping t0 in the same tick as the click. */
const press = (text) =>
  page.evaluate((t) => {
    const norm = (x) => (x.textContent ?? '').trim().replace(/\s+/g, ' ');
    const all = [...document.querySelectorAll('button, a, [role="button"]')];
    const el = all.find((x) => norm(x) === t) ?? all.find((x) => norm(x).startsWith(t));
    if (!el) throw new Error(`no control "${t}"`);
    if (el.disabled) throw new Error(`"${t}" disabled`);
    if (window.__a) window.__a.t0 = performance.now();
    el.click();
  }, text);

/** A phone hides the sidebar behind a button; open it and it stays open. */
async function openNav() {
  const has = await page.evaluate(() =>
    [...document.querySelectorAll('a')].some((a) => (a.textContent ?? '').trim() === 'Dashboard')
  );
  if (has) return true;
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) =>
        /menu|navigation|sidebar/i.test(x.getAttribute('aria-label') ?? '') ||
        x.querySelector('svg.lucide-menu')
    );
    if (!b) return false;
    b.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 800));
  return opened;
}

async function nav(label, linkText, prefix) {
  await openNav();
  await watch('route', prefix);
  try {
    await press(linkText);
  } catch (e) {
    note('nav', label, null, e.message);
    return false;
  }
  const ms = await result();
  const where = await page.evaluate(() => location.pathname);
  note('nav', label, ms, ms === null ? `stuck at ${where}` : where);
  await new Promise((r) => setTimeout(r, PHONE ? 1500 : 700));
  return ms !== null;
}

console.log(`\n${base} — ${PHONE ? 'phone 390px, 4x CPU' : 'desktop 1400px'}\n`);
await page.goto(`${base}/projects`, { waitUntil: 'networkidle0', timeout: 180_000 });
await new Promise((r) => setTimeout(r, PHONE ? 5000 : 2500));

// Every sidebar destination, there and back again, so a cached second visit is
// measured as well as a cold one.
const TRIPS = [
  ['Dashboard', 'Dashboard', '='],
  ['Weekly Progress', 'Weekly Progress', '/weekly'],
  ['Daily', 'Daily', '/daily'],
  ['Reports', 'Reports', '/weekly'],
  ['Document Control', 'Document Control', '/dokumen'],
  ['Projects', 'Projects', '/projects'],
  ['Settings', 'Settings', '/settings'],
];
for (const t of TRIPS) await nav(...t);
console.log('');
for (const t of TRIPS) await nav(`${t[0]} (again)`, t[1], t[2]);

// ------------------------------------------------------------------ presses
// Every control that WRITES, because that is the shape the planner bugs had:
// the server is awaited, the screen is not touched, and the button reads as
// dead for however long the snapshot upload takes.
console.log('');

async function at(url) {
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await new Promise((r) => setTimeout(r, PHONE ? 3500 : 1800));
}

/** Press one control and time the first thing that moves anywhere on screen. */
async function tap(label, control, { before } = {}) {
  if (before) await before();
  await watch('any');
  try {
    await press(control);
  } catch (e) {
    note('press', label, null, e.message, /^no control|disabled$/.test(e.message));
    return;
  }
  note('press', label, await result());
  await new Promise((r) => setTimeout(r, PHONE ? 2500 : 1500));
}

// The weekly report tab row — only the report pages carry it.
await at('/weekly/36/detail');
for (const tab of ['Summary', 'S-Curve', 'Photos']) await tap(`weekly tab ${tab}`, tab);

// Data Overall, the screen the week is actually filled in on.
await at('/weekly/36/overall');
// "Nothing moved on this item this week" — the control whose whole job is to
// get a card out of the queue, so it has to leave on the tap.
await tap('mark No progress', 'No progress');
await at('/weekly/36/overall');
await tap('stepper +', '+');
await tap('open Details', 'Details');
await at('/weekly/36/overall');
// The drill into every measurable item at once. 176 of them on this project,
// which is the one place a render could plausibly cost more than the network.
await tap('Browse all items', 'Browse all');

// Document Control's data screen. Reloaded before each press: opening a group
// drills the screen, so a chain of presses on one load measures whatever the
// previous press happened to leave behind — which is how this reported the
// needs-work filter as dead when, on its own, it works.
await at('/dokumen/36/data');
await tap('open a document group', 'EXECUTION PLAN');
await at('/dokumen/36/data');
await tap('filter needs work', 'need work');
await at('/dokumen/36/data');
await tap('Add group', 'Add group');

// Daily.
await at('/daily');
await tap('All months', 'All months');
await at('/daily');
await tap('New Daily Report', 'New Daily Report');

// Document Control.
await at('/dokumen/36/summary');
await tap('Use this numbering', 'Use this numbering');

// Settings catalogs.
await at('/settings');
await tap('catalog Add row', 'Add row');
await tap('catalog Save', 'Save');

// Opening another project re-points the entire app, so it is the heaviest
// single press there is.
await at('/projects');
await tap('open another project', 'Open', {
  before: async () => {
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].find((x) =>
        /^\/projects\/./.test(x.getAttribute('href') ?? '')
      );
      a?.click();
    });
    await new Promise((r) => setTimeout(r, PHONE ? 3500 : 1800));
  },
});

await browser.close();

const bad = rows.filter((r) => r.flag === 'SLOW' || r.flag === 'DEAD');
const skipped = rows.filter((r) => r.flag === 'skip').length;
console.log('');
const real = consoleErrors.filter((e) => !/favicon|DevTools|Download the React/i.test(e));
if (real.length) console.log(`console errors (${real.length}):\n  ${real.slice(0, 6).join('\n  ')}\n`);
console.log(
  bad.length
    ? `${bad.length} of ${rows.length} felt slow or dead.`
    : `All ${rows.length - skipped} measured are inside budget (press <${SLOW_PRESS}ms, nav <${SLOW_NAV}ms)` +
      (skipped ? `, ${skipped} skipped because the control was not on screen.` : '.')
);
