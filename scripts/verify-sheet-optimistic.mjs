/**
 * Does the planner move when you press the button, or only when the server
 * answers?
 *
 * Structural edits used to wait for a server action AND a `router.refresh()`
 * before anything on screen changed — 1.5 to 3 seconds on the deployment, most
 * of it one awaited ~2 MB snapshot upload. Nothing dimmed, nothing appeared,
 * no row moved, so every one of Add row / Add inside / Indent / Delete read as
 * a button that had not registered the press (reported 13 Sep 2026).
 *
 * The fix is not a faster server. It is that the sheet now draws what it can
 * already know and lets the authoritative rows — carried on the action's own
 * reply now, instead of a second round trip — settle the rest.
 *
 * So this measures TWO times per operation and the gap between them is the
 * whole point:
 *
 *   seen      click → the screen changes. What the hand feels.
 *   settled   click → the server's rows have landed.
 *
 * Under the old code these two were the same number by construction. A run
 * where they are still the same number is the regression coming back.
 *
 * 400ms of emulated latency is added on purpose, because localhost hides
 * exactly the wait this is about.
 *
 * Usage: node scripts/verify-sheet-optimistic.mjs [baseUrl] [projectId]
 *   Needs a dev server on a THROWAWAY database — it adds and deletes rows.
 *   e.g. preview "dev-verify-db" (port 3221, REPORT_DB_PATH=data/verify.db)
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const projectId = process.argv[3] ?? 'pmtygg3od7c19';
const LATENCY_MS = 400;
/** The hand notices about a tenth of a second; anything under it reads as instant. */
const INSTANT_MS = 120;
/** Longer than the sheet's own debounced page refresh, so 'settled' means settled. */
const QUIET_MS = 1400;

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

const ROW = 'div.group.grid.border-b';
const failures = [];

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${base}/projects/${projectId}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
// Hydration: the toolbar is server-rendered long before it is wired up, and a
// click that lands first proves nothing at all.
await new Promise((r) => setTimeout(r, 2000));

// Only now, so the page itself loads at full speed.
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
// LATENCY ONLY, never bandwidth. `next dev` ships megabytes of uncompressed
// RSC where the deployment ships about fifty kilobytes, so a throughput cap
// here measures the dev server's waistline and calls it a slow app — it put
// twelve seconds on an Add inside that the server log timed at 16ms. Round-trip
// delay is the part that is real on a phone in the field.
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

/** The sheet's whole visible state, as one string to compare against. */
const snapshot = () =>
  page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    return {
      count: rows.length,
      pending: rows.filter((r) => r.querySelector('.animate-pulse')).length,
      shape: rows
        .map((r) => {
          const code = r.firstElementChild?.innerText.trim() ?? '';
          const name = r.children[1];
          const pad = name ? parseInt(getComputedStyle(name).paddingLeft, 10) || 0 : 0;
          return `${code}@${pad}`;
        })
        .join(','),
    };
  }, ROW);

/**
 * The toolbar's button, and never a dialog's.
 *
 * An earlier version took the first button whose text merely STARTED with the
 * label, which on a row with children matched the confirm panel's own
 * "Delete N rows" instead of the toolbar — so the run measured a dialog opening
 * and reported it as an eleven-second delete.
 */
const clickButton = (label) =>
  page.evaluate((text) => {
    const all = [...document.querySelectorAll('button')];
    const norm = (x) => x.textContent.trim().replace(/\s+/g, ' ');
    const b =
      all.find((x) => norm(x) === text) ??
      all.find((x) => norm(x).startsWith(text) && !norm(x).includes('row'));
    if (!b) throw new Error(`No button "${text}"`);
    if (b.disabled) throw new Error(`Button "${text}" is disabled`);
    // The stopwatch starts in the same tick as the press. Timing this from
    // node instead put a CDP round trip and a 10ms poll between the click and
    // the first look, which is most of a number that is supposed to be small.
    if (window.__m) window.__m.t0 = performance.now();
    b.click();
  }, label);

/**
 * Select a LEAF row by name — the rows this script added, and only those.
 *
 * The LAST match, because indent needs a sibling above it to sit under and the
 * first "New task" on the page is the one added INSIDE row 1, where there is
 * none. Refusing that indent is correct, and a test that measures a refusal is
 * measuring nothing.
 */
const selectLeafNamed = (name) =>
  page.evaluate(
    (sel, wanted) => {
      const rows = [...document.querySelectorAll(sel)].filter(
        (r) =>
          r.innerText.includes(wanted) &&
          !r.querySelector('button[aria-label^="Collapse"], button[aria-label^="Expand"]')
      );
      const row = rows.at(-1);
      if (!row) throw new Error(`No leaf row named "${wanted}"`);
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    },
    ROW,
    name
  );

/** Click, then watch the DOM until it changes, and again until it stops. */
async function measure(name, act) {
  const before = await snapshot();
  // Watch from inside the page, so "the screen changed" is timed by the DOM
  // itself rather than by however fast this script happens to poll.
  await page.evaluate((sel) => {
    window.__m?.obs?.disconnect();
    const m = { t0: null, seen: null, obs: null };
    m.obs = new MutationObserver(() => {
      if (m.t0 !== null && m.seen === null) m.seen = Math.round(performance.now() - m.t0);
    });
    m.obs.observe(document.querySelector(sel).closest('div').parentElement ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    window.__m = m;
  }, ROW);

  const t0 = Date.now();
  await act();

  let seen = null;
  let settled = null;
  let last = before;
  let quietSince = null;
  const timeline = [];
  const deadline = t0 + 25_000;

  while (Date.now() < deadline) {
    const now = await snapshot();
    const changed = now.shape !== last.shape || now.count !== last.count || now.pending !== last.pending;
    if (seen === null) seen = await page.evaluate(() => window.__m?.seen ?? null);
    if (changed) {
      timeline.push(`${Date.now() - t0}ms rows=${now.count} pending=${now.pending}`);
      quietSince = null;
      last = now;
    } else if (seen !== null && now.pending === 0) {
      quietSince ??= Date.now();
      // Two things have to be true: nothing pending, and nothing moving. The
      // refresh that follows the action can still land after the rows do.
      if (Date.now() - quietSince > QUIET_MS) {
        settled = Date.now() - t0 - QUIET_MS;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 10));
  }

  const ok = seen !== null && seen < INSTANT_MS && settled !== null && settled > seen;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} seen ${String(seen).padStart(5)}ms   settled ${String(settled).padStart(5)}ms   rows ${before.count} -> ${last.count}`
  );
  // A slow settle is almost always the sheet being written to more than once;
  // the timeline is what says by whom.
  if (!ok || (settled ?? 0) > 3000) console.log(`     ${timeline.join('\n     ')}`);
  if (seen === null) failures.push(`${name}: the screen never changed`);
  else if (seen >= INSTANT_MS) failures.push(`${name}: ${seen}ms before anything moved (want <${INSTANT_MS}ms)`);
  if (settled === null) failures.push(`${name}: never settled`);
  return { before, after: last, seen, settled };
}

const selectRow = (i) =>
  page.evaluate(
    (sel, n) => {
      const r = document.querySelectorAll(sel)[n];
      if (!r) throw new Error(`No row ${n}`);
      r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    },
    ROW,
    i
  );

console.log(`\n${base}/projects/${projectId} — ${LATENCY_MS}ms emulated latency\n`);

// ---- Add row -------------------------------------------------------------
const start = await snapshot();
const add = await measure('Add row', () => clickButton('Add row'));
if (add.after.count !== start.count + 1) failures.push(`Add row: ${start.count} -> ${add.after.count}`);

// What the pending row looks like, caught mid-flight. A screenshot is the only
// way to know whether "unconfirmed" reads as calm or as broken.
//
// Anchored near the TOP on purpose. With nothing selected a new row goes to the
// end of the plan, and on a project taller than the viewport that is below the
// fold and outside the mounted window — nothing to photograph, and nothing the
// person who pressed the button sees either.
await selectRow(2);
await clickButton('Add row');
await new Promise((r) => setTimeout(r, 180));
await page.screenshot({ path: 'scratch/sheet-pending.png' });
const midPending = (await snapshot()).pending;
if (midPending < 1) failures.push('The pending row carried no sign that it was unconfirmed');
await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-pulse`), { timeout: 25_000 }, ROW);

// ---- Add inside ----------------------------------------------------------
await selectRow(1);
await measure('Add inside', () => clickButton('Add inside'));

// ---- Indent / Outdent ----------------------------------------------------
// Always one of the rows this script added, so the shape it acts on is known.
await selectLeafNamed('New task');
await measure('Indent', () => clickButton('Indent'));
await selectLeafNamed('New task');
await measure('Outdent', () => clickButton('Outdent'));

// ---- Delete --------------------------------------------------------------
// Its own three leaves, by name. A row WITH children opens the confirm panel
// instead of deleting, which is correct behaviour and a different measurement.
for (let k = 0; k < 3; k += 1) {
  const s = await snapshot();
  await selectLeafNamed('New task');
  const d = await measure(`Delete ${k + 1}`, () => clickButton('Delete'));
  if (d.after.count !== s.count - 1) failures.push(`Delete: ${s.count} -> ${d.after.count}`);
}

const end = await snapshot();
if (end.count !== start.count) {
  failures.push(`Left ${end.count} rows behind, started with ${start.count}`);
}

// ---- The phone ------------------------------------------------------------
// Below 640px the outline-code column is hidden, so the pending row's dot goes
// with it and the arriving row itself is the entire feedback. Worth looking at:
// Add row is the only structural button a phone gets.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 400));
await selectRow(2);
await clickButton('Add row');
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: 'scratch/sheet-pending-390.png' });
const mobilePending = await page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].filter((r) => r.innerText.includes('New task')).length,
  ROW
);
if (mobilePending < 1) failures.push('390px: the new row never appeared');
await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-pulse`), { timeout: 25_000 }, ROW);
await selectLeafNamed('New task');
await clickButton('Delete');
await new Promise((r) => setTimeout(r, 2500));

// ---- A different project --------------------------------------------------
// The sheet seeds its rows once and never re-reads the prop, so opening another
// project has to give it a new instance. Next does remount across a changed
// dynamic param today, and this passes with or without the page's own `key` —
// which is the point of checking it rather than assuming it, because the day
// that stops being true this sheet shows the wrong plan and says nothing.
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
const here = await page.evaluate((sel) => document.querySelector(sel).innerText, ROW);
await page.evaluate(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('All projects'));
  link.click();
});
await page.waitForFunction(() => location.pathname === '/projects', { timeout: 30_000 });
// The route resolves before the cards do; asking for links too early finds none
// and reports "only one project" on a workspace that has four.
await page.waitForFunction(
  () => [...document.querySelectorAll('a')].filter((a) => /^\/projects\/./.test(a.getAttribute('href') ?? '')).length > 1,
  { timeout: 30_000 }
);
const went = await page.evaluate((id) => {
  const link = [...document.querySelectorAll('a')].find(
    (a) => a.getAttribute('href')?.startsWith('/projects/') && !a.getAttribute('href').includes(id)
  );
  if (!link) return null;
  link.click();
  return link.getAttribute('href');
}, projectId);
if (went) {
  await page.waitForFunction((p) => location.pathname === p, { timeout: 30_000 }, went);
  await page.waitForSelector(ROW, { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1200));
  const there = await page.evaluate((sel) => document.querySelector(sel).innerText, ROW);
  if (there === here) failures.push(`Navigated to ${went} and the old project's rows were still there`);
  else console.log(`OK   project swap  ${went} shows its own first row`);
} else {
  console.log('     (only one project — the project-swap check was skipped)');
}

// ---- A row added below the fold -------------------------------------------
// The case optimism alone does not reach. With nothing selected, Add row puts
// the new row at the END of the plan; on a long one that is thousands of pixels
// down and OUTSIDE the mounted window, so instant drawing still shows nothing.
// Checked on the longest project in the workspace, from the top of it.
await page.goto(`${base}/projects`, { waitUntil: 'networkidle0', timeout: 60_000 });
await page.waitForFunction(
  () => [...document.querySelectorAll('a')].some((a) => /^\/projects\/./.test(a.getAttribute('href') ?? '')),
  { timeout: 30_000 }
);
const longest = await page.evaluate(() => {
  let best = null;
  let most = -1;
  for (const a of document.querySelectorAll('a')) {
    const href = a.getAttribute('href') ?? '';
    if (!/^\/projects\/./.test(href)) continue;
    // The whole card, not a guessed ancestor: the row count sits several
    // levels away from the title link.
    const card = a.closest('div.group') ?? a.parentElement?.parentElement;
    const n = Number((card?.innerText.match(/(\d[\d,.]*)\s+rows/) ?? [])[1]?.replace(/[,.]/g, '') ?? 0);
    if (n > most) {
      most = n;
      best = href;
    }
  }
  return { href: best, rows: most };
});
if (!longest.href) throw new Error('No project links on /projects');
await page.goto(`${base}${longest.href}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2500));
console.log(`\n${longest.href} — ${longest.rows} rows, scrolled to the top, nothing selected`);

await page.evaluate((sel) => {
  const pane = document.querySelector(sel)?.closest('[class*="overflow-auto"]');
  if (pane) pane.scrollTop = 0;
}, ROW);
await new Promise((r) => setTimeout(r, 400));
// The SCROLLER's height, not the mounted row count: this list is windowed, so
// the number of rows in the DOM stays about forty however long the plan is.
// One more row is exactly one ROW_H of scrollable height.
const paneHeight = () =>
  page.evaluate(
    (sel) => document.querySelector(sel)?.closest('[class*="overflow-auto"]')?.scrollHeight ?? 0,
    ROW
  );
const beforeAdd = await paneHeight();
await clickButton('Add row');

let landed = null;
for (let t = 0; t < 300; t += 1) {
  landed = await page.evaluate((sel) => {
    const row = [...document.querySelectorAll(sel)].find((r) => r.querySelector('.animate-pulse'));
    if (!row) return null;
    const pane = row.closest('[class*="overflow-auto"]');
    const a = row.getBoundingClientRect();
    const b = pane.getBoundingClientRect();
    return { inView: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, top: Math.round(a.top - b.top) };
  }, ROW);
  if (landed?.inView) break;
  await new Promise((r) => setTimeout(r, 20));
}
if (!landed) failures.push('Below the fold: the new row never mounted at all');
else if (!landed.inView) failures.push(`Below the fold: the new row mounted but sits ${landed.top}px outside the pane`);
else console.log(`OK   reveal       new row mounted and ${landed.top}px into the pane`);

await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-pulse`), { timeout: 25_000 }, ROW);
await page.screenshot({ path: 'scratch/sheet-reveal.png' });
const afterAdd = await paneHeight();
if (afterAdd <= beforeAdd) {
  failures.push(`Below the fold: the plan did not grow (${beforeAdd}px -> ${afterAdd}px)`);
}
// Put the long plan back the way it was found. Scroll to the end first: with
// the reveal broken the new row is never mounted, and the cleanup would throw
// a selector error on top of the real failure instead of leaving it readable.
await page.evaluate((sel) => {
  const pane = document.querySelector(sel)?.closest('[class*="overflow-auto"]');
  if (pane) pane.scrollTop = pane.scrollHeight;
}, ROW);
await new Promise((r) => setTimeout(r, 600));
try {
  await selectLeafNamed('New task');
  await clickButton('Delete');
  await new Promise((r) => setTimeout(r, 2500));
} catch (e) {
  console.log(`     (could not clean up the added row: ${e.message})`);
}

await browser.close();

const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
if (realErrors.length) failures.push(`console: ${realErrors.join(' | ')}`);

console.log('');
if (failures.length) {
  console.log('FAILED');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED — every operation moved the screen in under ${INSTANT_MS}ms, and settled after.`);
