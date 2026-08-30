/**
 * Behavioural checks for the motion work. A screenshot cannot show motion, so
 * these assert the properties that actually matter:
 *   1. a below-fold section is hidden only AFTER the observer has seen it is
 *      off screen, and is revealed when scrolled to;
 *   2. the weekly tab row SURVIVES a sub-tab navigation — the root template
 *      this replaced destroyed and rebuilt it every time;
 *   3. nothing is left stuck invisible once the entrance has settled.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2];
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) fail++;
};
const go = (u) => page.goto(BASE + u, { waitUntil: 'networkidle0', timeout: 120_000 });

/* ------------------------------------------- 1 · scroll reveal, dashboard */
await go('/');
await sleep(1000);
const armed = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll-reveal')].map((el) => ({
    hidden: getComputedStyle(el).opacity === '0',
    isIn: el.classList.contains('is-in'),
    top: Math.round(el.getBoundingClientRect().top),
  }))
);
check('below-fold sections armed and hidden', armed.length > 0 && armed.every((a) => a.hidden && !a.isIn), JSON.stringify(armed));
check('nothing armed was already on screen', armed.every((a) => a.top >= 844));

await page.evaluate(() => {
  const s = document.querySelector('main');
  s.scrollTo({ top: s.scrollHeight, behavior: 'instant' });
});
await sleep(1000);
const revealed = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll-reveal')].map((el) => ({ isIn: el.classList.contains('is-in'), o: getComputedStyle(el).opacity }))
);
check('scrolling reveals every one', revealed.length > 0 && revealed.every((r) => r.isIn && r.o === '1'), JSON.stringify(revealed));

/* --------------------------------------- 2 · the weekly tab row survives */
// Warm both routes first: a cold dev compile takes tens of seconds and would
// look like a navigation that never happened.
await go('/weekly/36/detail');
await go('/weekly/36/summary');
await sleep(1200);
await page.evaluate(() => {
  document.querySelector('a[href="/weekly/36/detail"]').dataset.survivedNav = 'yes';
});
await page.evaluate(() => document.querySelector('a[href="/weekly/36/detail"]').click());
await page.waitForFunction(() => location.pathname.endsWith('/detail'), { timeout: 30_000 }).catch(() => {});
await sleep(1200);
const nav = await page.evaluate(() => ({
  url: location.pathname,
  tabSurvived: !!document.querySelector('a[data-survived-nav="yes"]'),
  title: document.querySelector('main h1')?.textContent,
}));
check('navigated to the Detail tab', nav.url.endsWith('/detail'), `${nav.url} · h1 "${nav.title}"`);
check('the tab row was NOT remounted', nav.tabSurvived);

/* ------------------------------- 3 · nothing left invisible after entry */
const stuck = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('main *')) {
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' && cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 20) {
      out.push(el.className?.toString().slice(0, 50));
    }
  }
  return out.slice(0, 6);
});
check('no visible element stuck at opacity 0', stuck.length === 0, JSON.stringify(stuck));
check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

/* ------------------------- 4 · nothing ships hidden in the SERVER HTML */
// Check 3 above looks at the page AFTER hydration, which is exactly the moment
// this bug stops being visible. This one reads the markup the SERVER sent, with
// no JavaScript involved at all — the state the field crew's phone is looking at
// while the bundle is still on its way.
//
// It has been paid for three times: Reveal shipped six elements at opacity 0,
// CountUp shipped the hero figure invisible and never recovered it under
// prefers-reduced-motion, and WbsTreeVisual's ring shipped an empty arc for four
// and a half seconds. Every one of them was found by a person who happened to
// look.
//
// WHAT IT DOES NOT FLAG, and why each exemption is real rather than convenient:
//   - `aria-hidden` elements. Radix's Switch and Checkbox each render a hidden
//     native input at opacity 0 for form submission — /settings alone ships five.
//     A guard that shouts about those is a guard someone switches off.
//   - `transform: none` and `rotate(0deg)`. The first is what framer-motion
//     writes for a settled element (Swap emits exactly that, which is the
//     OPPOSITE of the bug); the second is a chevron at rest.
// So it looks for opacity 0, visibility hidden, and transforms that actually
// displace something.
const ROUTES = ['/', '/weekly/36/summary', '/weekly/36/overall', '/weekly/36/detail', '/daily', '/dokumen/43/summary', '/portfolio', '/settings'];
const HIDDEN = /<[^>]*style="[^"]*(?:opacity:\s*0(?![.\d])|visibility:\s*hidden|transform:\s*(?:translate|scale\(0))[^"]*"[^>]*>/g;
for (const route of ROUTES) {
  const html = await fetch(BASE + route).then((r) => r.text()).catch((e) => `FETCH FAILED ${e.message}`);
  const hits = [...html.matchAll(HIDDEN)]
    .map((m) => m[0])
    .filter((tag) => !/aria-hidden/.test(tag))
    .map((tag) => tag.slice(0, 90));
  check(`server HTML of ${route} ships nothing hidden`, hits.length === 0, hits.slice(0, 2).join(' | '));
}

/* ------------------------------------- 5 · the interaction layer is live */
// A press that reports `none` means the element is outside MotionRoot. That is
// the failure mode MotionRoot's own comment warns about, and it is silent: no
// error, no warning, just a button that does not answer. The hamburger is used
// deliberately because it lives in the SIDEBAR, a sibling of <main> — so this
// also guards the provider's boundary, not just that motion works at all.
await go('/');
await sleep(900);
const press = await page.evaluate(async () => {
  const btn = document.querySelector('button[aria-label="Open menu"]');
  if (!btn) return { err: 'hamburger not found' };
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1 }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 90));
  const t = getComputedStyle(btn).transform;
  btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1 }));
  return { t, outsideMain: !btn.closest('main') };
});
check('a button outside <main> scales on press', !press.err && press.t !== 'none' && press.outsideMain, JSON.stringify(press));

// The sliding pill is a single shared element, so exactly ONE may exist per row.
// Two means shadcn's static active background was left switched on beside it;
// none means the pill is not rendering and the active tab has lost its ground.
await go('/weekly/36/summary');
await sleep(900);
const pills = await page.evaluate(() =>
  [...document.querySelectorAll('span[aria-hidden]')]
    .filter((s) => getComputedStyle(s).position === 'absolute' && s.getBoundingClientRect().width > 40)
    .map((s) => Math.round(s.getBoundingClientRect().width))
);
check('one sliding pill per tab row', pills.length === 2, JSON.stringify(pills));

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
