/**
 * Does a row you add STAY added, and can you type its name straight away?
 *
 * Reported 14 Sep 2026, in these words: adding a row "suka ilang-ilangin",
 * the row is "kek g ke add", and typing the name then pressing Enter has an
 * effect nobody can describe. Three separate faults sat behind that sentence,
 * and all three only appear once there is real latency between the press and
 * the answer — which is why this script emulates 400ms and the old one on
 * localhost never caught any of them:
 *
 *   1. A second Add row pressed before the first had answered was sent with
 *      the FIRST row's placeholder id as its anchor. The server has never
 *      heard of `tmp-2`, answers "That row is no longer in the plan", and the
 *      sheet swallows that answer on purpose — so the row vanished in silence.
 *   2. An action's reply carries the WHOLE sheet, so applying it wiped every
 *      other guess still in flight. The first answer took the second row off
 *      the screen even when the second one was going to succeed.
 *   3. The new row refused every edit until the server confirmed it, so the
 *      first click on the name you had just asked for did nothing at all, and
 *      Enter left you with no cursor anywhere.
 *
 * So this presses Add row FOUR TIMES as fast as it can and then checks the
 * database, and it types a name into a row that is still arriving.
 *
 * Usage: node scripts/verify-sheet-add-row.mjs [baseUrl] [projectId]
 *   Needs a dev server on a THROWAWAY database — it adds and deletes rows.
 *   e.g. preview "dev-verify-db" (port 3221, REPORT_DB_PATH=data/verify.db)
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const projectId = process.argv[3] ?? 'pmtoach6ae252';
const LATENCY_MS = 400;
const BURST = 4;
const TYPED = 'Piling Works';

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
const say = (ok, line) => console.log(`${ok ? 'OK  ' : 'FAIL'} ${line}`);

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const rowCount = () => page.$$eval(ROW, (rs) => rs.length);
const pendingCount = () => page.$$eval(ROW, (rs) => rs.filter((r) => r.querySelector('.animate-pulse')).length);
const names = () =>
  page.$$eval(ROW, (rs) => rs.map((r) => r.children[1]?.innerText.trim().split('\n')[0] ?? ''));
const settle = async (ms = 20_000) => {
  await page.waitForFunction(
    (sel) => !document.querySelector(`${sel} .animate-pulse`),
    { timeout: ms },
    ROW
  );
  // The sheet's own debounced page refresh lands after the rows do.
  await new Promise((r) => setTimeout(r, 1200));
};

const clickToolbar = (label) =>
  page.evaluate((text) => {
    const all = [...document.querySelectorAll('button')];
    const norm = (x) => x.textContent.trim().replace(/\s+/g, ' ');
    const b = all.find((x) => norm(x) === text) ?? all.find((x) => norm(x).startsWith(text) && !norm(x).includes('row'));
    if (!b) throw new Error(`No button "${text}"`);
    if (b.disabled) throw new Error(`Button "${text}" is disabled`);
    b.click();
  }, label);

await page.goto(`${base}/projects/${projectId}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
// Hydration: the toolbar is server-rendered long before it is wired up.
await new Promise((r) => setTimeout(r, 2500));

const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

const start = await rowCount();
console.log(`${start} rows to begin with, ${LATENCY_MS}ms of latency on every call\n`);

/* ── 1. Four presses, faster than any of them can answer ─────────────────── */
for (let i = 0; i < BURST; i += 1) {
  await clickToolbar('Add row');
  await new Promise((r) => setTimeout(r, 60));
}
const drawn = await rowCount();
say(drawn === start + BURST, `burst   ${BURST} presses drew ${drawn - start} rows at once (want ${BURST})`);
if (drawn !== start + BURST) failures.push(`burst: ${drawn - start} of ${BURST} rows appeared`);

// The disappearance happened HERE, while the answers were landing one by one.
const lowest = await (async () => {
  let low = drawn;
  for (let t = 0; t < 400; t += 1) {
    const [n, p] = [await rowCount(), await pendingCount()];
    low = Math.min(low, n);
    if (p === 0) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return low;
})();
say(lowest >= start + BURST, `hold    the plan never dipped below ${start + BURST} rows while they landed (lowest ${lowest})`);
if (lowest < start + BURST) failures.push(`hold: rows fell to ${lowest} — a guess was wiped by another reply`);

await settle();
const kept = await rowCount();
say(kept === start + BURST, `kept    ${kept - start} rows survived (want ${BURST})`);
if (kept !== start + BURST) failures.push(`kept: ${kept - start} of ${BURST} rows survived the round trips`);

/* ── 2. Reload: the database is the only witness that matters ────────────── */
await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
const stored = await rowCount();
say(stored === start + BURST, `stored  ${stored - start} rows are in the database (want ${BURST})`);
if (stored !== start + BURST) failures.push(`stored: the database kept ${stored - start} of ${BURST}`);

/* ── 3. Type into a row that is still arriving ───────────────────────────── */
await new Promise((r) => setTimeout(r, 2500));
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

await clickToolbar('Add row');
// No wait: the point is that the caret is there before the server has answered.
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return el && el.tagName === 'INPUT'
    ? { value: el.value, selected: el.selectionStart === 0 && el.selectionEnd === el.value.length }
    : null;
});
say(!!focused, `caret   the new row's name is focused immediately${focused ? ` ("${focused.value}")` : ''}`);
if (!focused) failures.push('caret: nothing was focused after Add row — the row has to be hunted down and clicked');
else if (!focused.selected) failures.push('caret: the placeholder name is not selected, so typing appends to "New task"');

// Typed WHILE the add is in flight, and finished with Enter — which must both
// keep the name and open the next row.
await page.keyboard.type(TYPED, { delay: 25 });
const midTyping = await page.evaluate(() => document.activeElement?.value ?? null);
say(midTyping === TYPED, `typing  the field holds "${midTyping}" while the row is still arriving`);
if (midTyping !== TYPED) failures.push(`typing: the field lost the draft mid-word (holds "${midTyping}")`);

await page.keyboard.press('Enter');
const next = await page.evaluate(() => {
  const el = document.activeElement;
  return el && el.tagName === 'INPUT' ? el.value : null;
});
say(next !== null, `enter   Enter opened the next row's name (${next === null ? 'nothing focused' : `"${next}"`})`);
if (next === null) failures.push('enter: Enter left no cursor anywhere — a plan cannot be typed line after line');

await settle();
await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
const after = await names();
say(after.includes(TYPED), `saved   "${TYPED}" is in the database after a reload`);
if (!after.includes(TYPED)) failures.push(`saved: the typed name never reached the database (${after.join(' | ')})`);

const total = await rowCount();
say(total === start + BURST + 2, `total   ${total - start} rows added in all (want ${BURST + 2})`);
if (total !== start + BURST + 2) failures.push(`total: ${total - start} rows added, wanted ${BURST + 2}`);

/* ── Put the project back the way it was found ───────────────────────────── */
await new Promise((r) => setTimeout(r, 2000));
for (let i = 0; i < BURST + 2; i += 1) {
  try {
    await page.evaluate(
      (sel, n) => {
        const r = document.querySelectorAll(sel)[n];
        if (!r) throw new Error('gone');
        r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      },
      ROW,
      start
    );
    await clickToolbar('Delete');
    await new Promise((r) => setTimeout(r, 1600));
  } catch {
    break;
  }
}
const left = await rowCount();
if (left !== start) console.log(`     (cleanup left ${left} rows, started with ${start})`);

await browser.close();

const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
if (realErrors.length) failures.push(`console: ${realErrors.join(' | ')}`);

console.log('');
if (failures.length) {
  console.log('FAILED');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('PASSED — every row pressed for arrived, stayed, and could be typed into at once.');
