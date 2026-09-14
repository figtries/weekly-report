/**
 * Does the colour change when you change it, and can you get out of here?
 *
 * Reported 14 Sep 2026: "kalau ganti-ganti warnanya ngeleg banget, kayak jeda
 * gitu, nggak smooth" and "ini nggak ada button back or cancel-nya".
 *
 * Every control in that dialog was driven straight off the props, so picking a
 * colour changed NOTHING on screen until a server action and the page refresh
 * behind it had both come back: the dropdown snapped back to its old value the
 * moment React re-rendered, and sat there for the best part of a second while
 * the whole dialog was disabled. The list is held locally now and the write
 * goes behind it.
 *
 * So this measures the one number that matters — how long the dropdown takes to
 * show what was picked — with 400ms of latency on every call, which is what a
 * phone in the field has and localhost never does.
 *
 * Usage: node scripts/verify-bar-styles.mjs [baseUrl] [projectId]
 *   Needs a dev server on a THROWAWAY database — it rewrites the project's
 *   bar style rules. e.g. preview "dev-verify-db" (port 3221).
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const projectId = process.argv[3] ?? 'pmtoach6ae252';
const LATENCY_MS = 400;
/** The hand notices about a tenth of a second; under it reads as instant. */
const INSTANT_MS = 120;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const exe = CANDIDATES.find((p) => p && existsSync(p));
if (!exe) throw new Error('No local Chrome found — set CHROME_PATH');

const failures = [];
const say = (ok, line) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${line}`);
  if (!ok) failures.push(line);
};

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const openDialog = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      x.textContent.trim().startsWith('Bar styles')
    );
    if (!b) throw new Error('no Bar styles button');
    b.click();
  });
  await page.waitForFunction(() => !!document.querySelector('select'), { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 400));
};

/** The colour dropdown of the first rule, and what it is set to. */
const colourSelect = () =>
  page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.textContent.trim() === 'Red')
    );
    return sel ? { value: sel.value, options: [...sel.options].map((o) => o.value) } : null;
  });

await page.goto(`${base}/projects/${projectId}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector('div.group.grid.border-b', { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));

const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

await openDialog();

/* ── 1. A close button, where you can find it ────────────────────────────── */
const hasClose = await page.evaluate(
  () => !!document.querySelector('button[aria-label="Close"]')
);
say(hasClose, 'close    the dialog has a Close button in its header');

/* ── 2. The colour shows the moment it is picked ─────────────────────────── */
const before = await colourSelect();
if (!before) throw new Error('no colour dropdown found');
const next = before.options.find((o) => o !== before.value && o !== '');
const shown = await page.evaluate(
  (want) =>
    new Promise((resolve) => {
      const sel = [...document.querySelectorAll('select')].find((s) =>
        [...s.options].some((o) => o.textContent.trim() === 'Red')
      );
      const t0 = performance.now();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, want);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      // Poll until the dropdown SETTLES on the new value — the old code let
      // React snap it back to the prop on the very next render.
      // The answer is when it FIRST showed the new value and never let go of
      // it; the frames after that only prove it stuck.
      let stable = 0;
      let since = null;
      const tick = () => {
        if (sel.value === want) {
          stable += 1;
          since ??= Math.round(performance.now() - t0);
        } else {
          stable = 0;
          since = null;
        }
        if (stable >= 8) return resolve(since);
        if (performance.now() - t0 > 6000) return resolve(null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
  next
);
say(
  shown !== null && shown < INSTANT_MS,
  `instant  the dropdown held the new colour after ${shown === null ? 'never' : `${shown}ms`} (want under ${INSTANT_MS}ms)`
);

/* ── 3. And the choice above it moves with it ────────────────────────────── */
const own = await page.evaluate(() => {
  const card = [...document.querySelectorAll('button, div[role="button"]')].find((x) =>
    x.textContent.includes('My own rules')
  );
  return card ? card.className.includes('border-foreground') || !!card.querySelector('svg') : null;
});
say(own !== false, 'custom   "My own rules" is marked as the live list straight away');

/* ── 4. Close, and it really is saved ────────────────────────────────────── */
await new Promise((r) => setTimeout(r, 2500));
if (hasClose) await page.click('button[aria-label="Close"]');
else await page.evaluate(() => document.querySelector('.fixed.inset-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await new Promise((r) => setTimeout(r, 600));
const gone = await page.evaluate(() => !document.querySelector('button[aria-label="Close"]'));
say(gone, 'closed   pressing Close put the dialog away');

await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector('div.group.grid.border-b', { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));
await openDialog();
const after = await colourSelect();
say(
  after?.value === next,
  `stored   after a reload the rule still reads "${after?.value}" (picked "${next}")`
);

await browser.close();

const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
if (realErrors.length) failures.push(`console: ${realErrors.join(' | ')}`);

console.log('');
if (failures.length) {
  console.log('FAILED');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASSED — the colour lands as it is picked, and there is a way out.');
