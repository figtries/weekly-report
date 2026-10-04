/**
 * Does any page hand the browser a DOM it then has to throw away?
 *
 * Two checks over every route, and the first is the one that matters because it
 * catches the fault in the HTML rather than in its symptom.
 *
 * **THE COLLISION.** Every hidden segment React streams is a
 * `<div hidden id="S:n">` spliced in by id, and no id may appear twice. One
 * did, on every load of seven routes, and the cause is in React itself (read
 * in the bundled react-dom, 4 Oct 2026; Next 16.3.8 ships the same code):
 * `prerender` copies `nextSegmentId` into the postponed state BEFORE the
 * prelude is flushed, and flushing the prelude can still take ids — a
 * COMPLETED boundary over 500 bytes in a shell over ~12.8 KB is "outlined",
 * written as a template plus `$RC("B:n","S:n")` with the next id. The resume
 * then starts counting from the stale copy and hands the same id to its own
 * segments (`$RS("S:3","P:3")`). `$RS` resolves by id at call time and takes
 * the FIRST match, so on five routes the phone header's menu button was
 * spliced into a summary card; React found a DOM it had not produced, threw
 * #418 and regenerated the section shell — 308ms to first paint against 156ms
 * (390px, 4x CPU). The 13 Sep reading ("Next always starts at 3, keep the
 * shell under four boundaries") saw the symptom, not this.
 *
 * So: **no `<Suspense>` in the shell may complete during the prerender.** A
 * boundary that postpones is safe (its id is taken before the copy); one that
 * finishes at build time is not. Read request data after mount instead (see
 * `LiveLinks` and `DrawerOverlay` in components/layout/Sidebar.tsx). This fails
 * the moment any segment id is written twice.
 *
 * **THE SYMPTOM.** Then it loads each route in a real browser and fails on any
 * recoverable React error, which catches every other kind of mismatch too.
 *
 * Usage: node scripts/verify-hydration.mjs [baseUrl]
 *   Needs a PRODUCTION build — `next dev` has no prerendered shell to resume
 *   into, so it cannot reproduce this at all and stays silent throughout.
 */
import { existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3212';
const WEEK = process.argv[3] ?? '36';

const ROUTES = [
  '/',
  '/projects',
  '/settings',
  '/klaim',
  '/daily',
  `/weekly/${WEEK}/overall`,
  `/weekly/${WEEK}/summary`,
  `/weekly/${WEEK}/detail`,
  `/weekly/${WEEK}/scurve`,
  `/weekly/${WEEK}/documentation`,
  `/weekly/${WEEK}/control`,
  `/dokumen/${WEEK}/summary`,
  `/dokumen/${WEEK}/data`,
  `/dokumen/${WEEK}/vdrl`,
  `/dokumen/${WEEK}/vdrl-data`,
];

const get = (u) =>
  new Promise((resolve, reject) => {
    (u.startsWith('https') ? https : http)
      .get(u, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });

const failures = [];
const ids = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

console.log(`\n${base} — ${ROUTES.length} routes\n`);
console.log('ids React streams (RC) against ids Next resumes (RS)\n');

for (const r of ROUTES) {
  let html;
  try {
    html = await get(base + r);
  } catch (e) {
    failures.push(`${r}: could not be fetched (${e.message})`);
    continue;
  }
  // Ids are hex (`S:a` follows `S:9`), and a segment inside a table or an svg
  // is wrapped in something other than a div, so match the id alone.
  const segs = ids(html, / id="(S:[0-9a-f]+)"/g);
  const clash = [...new Set(segs.filter((x, i) => segs.indexOf(x) !== i))];
  const rc = ids(html, /\$RC\("B:[0-9a-f]+","(S:[0-9a-f]+)"\)/g);
  const rs = ids(html, /\$RS\("(S:[0-9a-f]+)","P:[0-9a-f]+"\)/g);
  if (clash.length) failures.push(`${r}: ${clash.join(', ')} is written more than once`);
  console.log(
    `${clash.length ? 'CLASH' : 'ok   '} ${r.padEnd(30)} RC[${rc.join(' ') || '-'}]  RS[${rs.slice(0, 4).join(' ') || '-'}]`
  );
}

const exe = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!exe) throw new Error('No local Chrome found — set CHROME_PATH');

console.log('\nand what the browser actually says\n');
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
for (const r of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => {
    const code = String(e).match(/#(\d+)/)?.[1];
    if (code) errs.push(code);
  });
  try {
    await page.goto(base + r, { waitUntil: 'networkidle0', timeout: 90_000 });
    await new Promise((x) => setTimeout(x, 2500));
  } catch (e) {
    failures.push(`${r}: ${e.message}`);
  }
  if (errs.length) failures.push(`${r}: React error #${errs[0]} x${errs.length}`);
  console.log(`${errs.length ? 'FAIL ' : 'ok   '} ${r.padEnd(30)} ${errs.length ? `React #${errs[0]} x${errs.length}` : ''}`);
  await page.close();
}
await browser.close();

console.log('');
if (failures.length) {
  console.log('FAILED');
  for (const f of failures) console.log(`  - ${f}`);
  console.log(
    '\nA clash means a <Suspense> in the shell completed during the prerender.\n' +
      'See the note above ActiveLinks in components/layout/Sidebar.tsx.'
  );
  process.exit(1);
}
console.log(`PASSED — no id is spliced twice, and no route throws a recoverable React error.`);
