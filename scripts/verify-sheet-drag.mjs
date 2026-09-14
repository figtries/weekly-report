/**
 * Can a plan be SHAPED with the mouse, and does "inside" mean at the end?
 *
 * Asked for on 14 Sep 2026: "tadi aku mau add inside row di dalam Procurement
 * tapi malah jadi 3.1 bukan malah 3.3, bikin bisa di re-arrange gitu kalau di
 * teken pakai mouse-nya". Two things in one sentence, and both are here.
 *
 *   - Add inside put the new line FIRST among the children, because the
 *     insertion point was the anchor's order plus one, which is exactly where
 *     its first child lives. Inside means at the END of what is already inside.
 *   - Nothing could be re-arranged by hand. Move up / Move down in the row menu
 *     walk a row among the siblings it has; Indent and Outdent change its level
 *     without changing its neighbours. A drag asks both at once.
 *
 * The drop is aimed by a line drawn AT THE DEPTH the row will land at, and the
 * gap is computed from the pointer against ROW_H rather than from whatever
 * element is under the cursor — so it has to work over the windowed rows and
 * over the two spacers standing in for the rest. A drop under an OPEN branch
 * means "first thing inside it"; that is the only way to aim at an empty one.
 *
 * Usage: node scripts/verify-sheet-drag.mjs [baseUrl] [projectId]
 *   Needs a dev server on a THROWAWAY database — it adds and deletes rows.
 *   e.g. preview "dev-verify-db" (port 3221, REPORT_DB_PATH=data/verify.db)
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3221';
const projectId = process.argv[3] ?? 'pmtoach6ae252';

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
/** Every row as `code:name`, which is the whole shape of the plan in one line. */
const shape = () =>
  page.$$eval(ROW, (rs) =>
    rs.map((r) => {
      const code = r.children[0].innerText.trim();
      const name = (r.children[1].innerText.trim().split('\n')[0] ?? '').trim();
      return `${code}:${name}`;
    })
  );
const settled = async () => {
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .animate-pulse`), { timeout: 25_000 }, ROW);
  await new Promise((r) => setTimeout(r, 1300));
};

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

const selectLastTopLevel = () =>
  page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    const top = rows.filter((r) => parseInt(getComputedStyle(r.children[1]).paddingLeft, 10) === 0);
    (top.at(-1) ?? rows.at(-1))?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, ROW);

const box = async (i) => {
  const h = (await page.$$(ROW))[i];
  if (!h) throw new Error(`no row ${i}`);
  return h.boundingBox();
};

/**
 * A real mouse drag: press on row `from`, release on the gap under row `to`.
 *
 * `levels` is how far left or right the hand also moves, in whole levels of
 * twelve pixels — which is how a row is taken OUT of the package it is in, the
 * gap under its last line meaning both "after that line" and "after the
 * package" until the horizontal position says which.
 */
async function drag(from, to, levels = 0) {
  const a = await box(from);
  const b = await box(to);
  const x0 = a.x + 260;
  const y0 = a.y + a.height / 2;
  const x1 = x0 + levels * 12;
  const y1 = b.y + b.height;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // Past the 6px threshold in small steps, the way a hand moves.
  for (let s = 1; s <= 10; s += 1) {
    await page.mouse.move(x0 + ((x1 - x0) * s) / 10, y0 + ((y1 - y0) * s) / 10);
    await new Promise((r) => setTimeout(r, 20));
  }
  await page.mouse.up();
  await settled();
}

/** Add a row inside the selected one and type its name. */
async function addInside(name) {
  await clickToolbar('Add inside');
  await new Promise((r) => setTimeout(r, 150));
  await page.keyboard.type(name, { delay: 15 });
  await page.keyboard.press('Enter');
  await settled();
}

await page.goto(`${base}/projects/${projectId}`, { waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2500));

const start = await rowCount();

/* ── 1. Inside means at the END of what is already inside ────────────────── */
await selectLastTopLevel();
await clickToolbar('Add row');
await new Promise((r) => setTimeout(r, 150));
await page.keyboard.type('Package', { delay: 15 });
await page.keyboard.press('Enter');
await settled();

const pkg = start;
await selectRow(pkg);
await addInside('Alpha');
await selectRow(pkg);
await addInside('Bravo');
await selectRow(pkg);
await addInside('Charlie');

const inside = (await shape()).slice(pkg, pkg + 4);
say(
  inside[1].endsWith(':Alpha') && inside[2].endsWith(':Bravo') && inside[3].endsWith(':Charlie'),
  `append   three added inside land in the order they were typed [${inside.join(' | ')}]`
);

/* ── 2. Drag the first child past the last ───────────────────────────────── */
await drag(pkg + 1, pkg + 3);
const moved = (await shape()).slice(pkg + 1, pkg + 4);
say(
  moved[0].endsWith(':Bravo') && moved[1].endsWith(':Charlie') && moved[2].endsWith(':Alpha'),
  `reorder  Alpha dragged past Charlie [${moved.join(' | ')}]`
);
const codes = moved.map((m) => m.split(':')[0]);
say(
  codes[0] < codes[1] && codes[1] < codes[2],
  `renumber the outline codes followed the move (${codes.join(', ')})`
);

/* ── 3. It is the database that moved, not the screen ────────────────────── */
await page.reload({ waitUntil: 'networkidle0', timeout: 90_000 });
await page.waitForSelector(ROW, { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2000));
const reloaded = (await shape()).slice(pkg + 1, pkg + 4);
say(
  reloaded[2].endsWith(':Alpha'),
  `stored   after a reload the order held [${reloaded.join(' | ')}]`
);

/* ── 4. Out of the package again: same gap, one level to the left ────────── */
await drag(pkg + 1, pkg + 3, -1);
const out = await shape();
const depthOf = await page.$$eval(ROW, (rs) =>
  rs.map((r) => parseInt(getComputedStyle(r.children[1]).paddingLeft, 10) || 0)
);
say(
  out[pkg + 3].endsWith(':Bravo') && depthOf[pkg + 3] === 0,
  `outdent  dropped past the package's last line, Bravo is top level again (${out[pkg + 3]}, indent ${depthOf[pkg + 3]}px)`
);

/* ── 5. A row cannot be dropped inside itself ────────────────────────────── */
const before = await shape();
await drag(pkg, pkg + 1);
const after = await shape();
say(
  before.join() === after.join(),
  'refuse   dragging a package into its own child changed nothing'
);

/* ── Put the project back ────────────────────────────────────────────────── */
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 6 && (await rowCount()) > start; i += 1) {
  try {
    await selectRow(start);
    await clickToolbar('Delete');
    await new Promise((r) => setTimeout(r, 700));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.bg-destructive')].find((x) =>
        /^(Delete|Deleting…)$/.test(x.textContent.trim())
      );
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 1700));
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
console.log('PASSED — inside means last, and a row goes where it is dropped.');
