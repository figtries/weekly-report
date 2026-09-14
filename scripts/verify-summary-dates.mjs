/**
 * A package row's dates are the PROMISE, and the work inside is planned to fit.
 *
 * Reported 14 Sep 2026 with a screenshot: Procurement ran 29 Dec 25 to
 * 28 Mar 27, one Add inside moved it to a single day in March 2027, and every
 * date cell on it turned grey and refused to be typed in. Two causes, both
 * fixed here:
 *
 *   - a summary's span was COMPUTED from its children and its own stored dates
 *     were ignored, so the first child decided where the package sat;
 *   - a row added inside another took the day after its PARENT finished, which
 *     is where that single day in March came from.
 *
 * The rule now: a branch shows its own box widened to cover its children, its
 * dates can be typed, and a date that would break the fence is REFUSED by name
 * in both directions — a child outside its package, or a package narrowed below
 * something already inside it. Nothing is ever silently clamped.
 *
 * Usage: node scripts/verify-summary-dates.mjs [baseUrl] [projectId]
 *   Needs a dev server on a THROWAWAY database — it adds and deletes rows.
 *   e.g. preview "dev-verify-db" (port 3221, REPORT_DB_PATH=data/verify.db)
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const projectId = process.argv[3] ?? 'pmtoach6ae252';

const PKG_START = '2025-12-29';
const PKG_FINISH = '2027-03-28';
const SHOWN_START = '29 Dec 25';
const SHOWN_FINISH = '28 Mar 27';

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
const ERR = 'p.bg-destructive\\/10';
/** Grid columns, in the order the row renders them. */
const COL = { code: 0, name: 1, duration: 2, start: 3, finish: 4 };

const failures = [];
const say = (ok, line) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${line}`);
  if (!ok) failures.push(line);
};

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const rowCount = () => page.$$eval(ROW, (rs) => rs.length);
const cell = (i, col) =>
  page.evaluate(
    (sel, n, c) => document.querySelectorAll(sel)[n]?.children[c]?.innerText.trim() ?? null,
    ROW,
    i,
    col
  );
const errorText = () => page.evaluate((sel) => document.querySelector(sel)?.innerText.trim() ?? null, ERR);
const settled = async () => {
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-pulse`), { timeout: 25_000 }, ROW);
  await new Promise((r) => setTimeout(r, 1400));
};

/** Open a cell, replace what is in it, commit with Enter. */
async function typeCell(i, col, value) {
  const opened = await page.evaluate(
    (sel, n, c) => {
      const b = document.querySelectorAll(sel)[n]?.children[c]?.querySelector('button');
      if (!b) return false;
      b.click();
      return true;
    },
    ROW,
    i,
    col
  );
  if (!opened) throw new Error(`row ${i} column ${c} has no editable cell`);
  await new Promise((r) => setTimeout(r, 120));
  await page.evaluate(
    (sel, n, c, v) => {
      const el = document.querySelectorAll(sel)[n].children[c].querySelector('input');
      if (!el) throw new Error('the cell did not open');
      // React listens for the native input event, so the value has to be set
      // through the prototype setter rather than assigned.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    },
    ROW,
    i,
    col,
    value
  );
  await new Promise((r) => setTimeout(r, 1600));
}

const clickToolbar = (label) =>
  page.evaluate((text) => {
    const all = [...document.querySelectorAll('button')];
    const norm = (x) => x.textContent.trim().replace(/\s+/g, ' ');
    const b = all.find((x) => norm(x) === text);
    if (!b) throw new Error(`No button "${text}"`);
    if (b.disabled) throw new Error(`Button "${text}" is disabled`);
    b.click();
  }, label);

const selectRow = (i) =>
  page.evaluate(
    (sel, n) => document.querySelectorAll(sel)[n].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    ROW,
    i
  );

/**
 * Select the last row at the OUTERMOST level.
 *
 * Add row anchors on the selection, or on the last row when there is none —
 * and on a project left with a package at the bottom, the last row is a CHILD.
 * The new "package" was then born inside the previous run's one, where the
 * fence correctly refused to let it widen. A test that leaves its own trap for
 * the next run reports a product bug that is not there.
 */
const selectLastTopLevel = () =>
  page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    const top = rows.filter((r) => parseInt(getComputedStyle(r.children[1]).paddingLeft, 10) === 0);
    const last = top.at(-1) ?? rows.at(-1);
    last?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, ROW);

/** The toolbar's Delete, then the confirm panel's own if the row has children. */
async function deleteRow(i) {
  await selectRow(i);
  await clickToolbar('Delete');
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.bg-destructive')].find((x) =>
      /^(Delete|Deleting…)$/.test(x.textContent.trim())
    );
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1800));
}

await page.goto(`${base}/projects/${projectId}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));

const start = await rowCount();

/* ── The package, typed the way somebody is given one ────────────────────── */
await selectLastTopLevel();
await clickToolbar('Add row');
await settled();
await page.keyboard.press('Escape');
const pkg = start; // appended at the end
await typeCell(pkg, COL.start, PKG_START);
await typeCell(pkg, COL.finish, PKG_FINISH);
say(
  (await cell(pkg, COL.start)) === SHOWN_START && (await cell(pkg, COL.finish)) === SHOWN_FINISH,
  `package  typed ${SHOWN_START} to ${SHOWN_FINISH} (${await cell(pkg, COL.start)} to ${await cell(pkg, COL.finish)})`
);
const pkgDays = await cell(pkg, COL.duration);

/* ── 1. Add inside must not move it ──────────────────────────────────────── */
await selectRow(pkg);
await clickToolbar('Add inside');
await settled();
await page.keyboard.press('Escape');
const kid = pkg + 1;

const afterStart = await cell(pkg, COL.start);
const afterFinish = await cell(pkg, COL.finish);
say(
  afterStart === SHOWN_START && afterFinish === SHOWN_FINISH,
  `holds    the package still reads ${afterStart} to ${afterFinish} with a row inside it`
);
say(
  (await cell(pkg, COL.duration)) === pkgDays,
  `days     it is still ${pkgDays} (now ${await cell(pkg, COL.duration)})`
);
say(
  (await cell(kid, COL.start)) === SHOWN_START,
  `inside   the new row starts when its package does (${await cell(kid, COL.start)})`
);

/* ── 2. The package's own dates can still be typed ───────────────────────── */
const editable = await page.evaluate(
  (sel, n, c) => !!document.querySelectorAll(sel)[n]?.children[c]?.querySelector('button'),
  ROW,
  pkg,
  COL.finish
);
say(editable, 'typable  the package\u2019s finish is a cell you can open, not a grey label');

await typeCell(pkg, COL.finish, '2027-04-30');
say(
  (await cell(pkg, COL.finish)) === '30 Apr 27',
  `widen    the package took a new finish (${await cell(pkg, COL.finish)})`
);
await typeCell(pkg, COL.finish, PKG_FINISH);

/* ── 3. A child outside the box is refused, by name ──────────────────────── */
await typeCell(kid, COL.start, '2025-12-28');
const outErr = await errorText();
say(
  !!outErr && outErr.includes(SHOWN_START) && outErr.includes(SHOWN_FINISH),
  `fence    a child starting a day early is refused: ${outErr ?? 'NO MESSAGE'}`
);
say(
  (await cell(kid, COL.start)) === SHOWN_START,
  `intact   the child kept its old start (${await cell(kid, COL.start)})`
);

/* ── 4. Narrowing the package below its child is refused, by name ────────── */
await typeCell(kid, COL.finish, '2026-06-30');
say((await cell(kid, COL.finish)) === '30 Jun 26', `child    moved inside the box to ${await cell(kid, COL.finish)}`);
await typeCell(pkg, COL.finish, '2026-01-31');
const narrowErr = await errorText();
say(
  !!narrowErr && narrowErr.includes('30 Jun 26'),
  `shrink   narrowing the package below its child is refused: ${narrowErr ?? 'NO MESSAGE'}`
);
say(
  (await cell(pkg, COL.finish)) === SHOWN_FINISH,
  `kept     the package kept its finish (${await cell(pkg, COL.finish)})`
);

/* ── 5. A row can be MOVED inside its package, in one edit ───────────────── */
//
// Moving a line inside its package took two edits and only one order of the two
// worked. Engineering by Solar had to go from 09 Feb – 17 May 26 to 28 Sep –
// 25 Oct 26 inside a package ending 08 Nov 26: typing the finish first was
// taken (the row became 259 days), then typing the start dragged that duration
// into June 2027 and was refused, and starting the other way round dragged the
// old 98 days into January 2027 and was refused too. Only duration-then-start
// reached it, and nothing said so (14 Sep 2026).
//
// So when holding the duration would push the finish out of the fence and the
// row fits where it already ends, the FINISH is held and the duration gives
// way. The start is taken exactly as typed either way.
await typeCell(kid, COL.start, PKG_START);
await typeCell(kid, COL.finish, PKG_FINISH);
say(
  (await cell(kid, COL.start)) === SHOWN_START && (await cell(kid, COL.finish)) === SHOWN_FINISH,
  `fills    the row is stretched to fill its package (${await cell(kid, COL.duration)})`
);
await typeCell(kid, COL.start, '2026-06-01');
const movedErr = await errorText();
say(
  (await cell(kid, COL.start)) === '01 Jun 26',
  `move     the start was taken as typed (${await cell(kid, COL.start)}${movedErr ? ` — ${movedErr}` : ''})`
);
say(
  (await cell(kid, COL.finish)) === SHOWN_FINISH,
  `held     the finish held instead of being dragged past the package (${await cell(kid, COL.finish)})`
);

/* ── 6. And it all survives a reload ─────────────────────────────────────── */
await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
say(
  (await cell(pkg, COL.start)) === SHOWN_START && (await cell(pkg, COL.finish)) === SHOWN_FINISH,
  `stored   after a reload the package still reads ${await cell(pkg, COL.start)} to ${await cell(pkg, COL.finish)}`
);

/* ── Put the project back ────────────────────────────────────────────────── */
await new Promise((r) => setTimeout(r, 2000));
for (let i = 0; i < 4 && (await rowCount()) > start; i += 1) {
  try {
    // The package takes its children with it, so this is one delete, not two.
    await deleteRow(start);
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
console.log('PASSED — the package keeps its dates, can be typed into, and fences what is inside it.');
