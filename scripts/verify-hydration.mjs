/**
 * Does any page hand the browser a DOM it then has to throw away?
 *
 * Two checks over every route, and the first is the one that matters because it
 * catches the fault in the HTML rather than in its symptom.
 *
 * **THE COLLISION.** React numbers its streamed Suspense boundaries `S:0…S:n`
 * and splices each one in with `$RC`. Next numbers the PPR resume segments it
 * splices into a prerendered shell `S:3…S:n` and uses `$RS`. Same namespace,
 * and Next always starts at 3 — measured 13 Sep 2026 across every route in this
 * app: take a boundary away and the resume segments still start at 3.
 *
 * The two do not splice at the same moment. `$RC` resolves its elements and
 * QUEUES the reveal, flushing up to ~300ms later so several can be batched. In
 * that window React's `<div hidden id="S:3">` is still in the document — and
 * `$RS("S:3","P:3")` resolves by id, at call time, so it takes the FIRST match.
 * On five routes that was the sidebar's navigation, which Next then spliced
 * into the middle of a summary card. React found a DOM it had not produced,
 * threw #418 and regenerated `.section-shell` — week picker, stepper and tab
 * row rebuilt on every load, for 308ms to first paint against 156ms on a page
 * without it (390px, 4x CPU).
 *
 * So: **the shell must own fewer than four streamed Suspense boundaries.** That
 * is a hard budget, it is invisible in review, and a single `<Suspense>` added
 * anywhere above the page brings the bug back in silence. This fails the moment
 * it does.
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
  const rc = ids(html, /\$RC\("B:\d+","(S:\d+)"\)/g);
  const rs = ids(html, /\$RS\("(S:\d+)","P:\d+"\)/g);
  const clash = rc.filter((x) => rs.includes(x));
  if (clash.length) failures.push(`${r}: ${clash.join(', ')} is spliced by BOTH $RC and $RS`);
  console.log(
    `${clash.length ? 'CLASH' : 'ok   '} ${r.padEnd(30)} RC[${rc.join(' ') || '—'}]  RS[${rs.slice(0, 4).join(' ') || '—'}]`
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
    '\nA clash means the shell has grown a fourth streamed Suspense boundary.\n' +
      'See the note on ActiveNavList in components/layout/Sidebar.tsx.'
  );
  process.exit(1);
}
console.log(`PASSED — no id is spliced twice, and no route throws a recoverable React error.`);
