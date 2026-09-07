/**
 * Visit every route at every device width and report anything that forces a
 * HORIZONTAL scroll, plus small tap targets and console errors.
 *
 *   node scripts/responsive-audit.mjs [route-substring]
 *
 * The number that matters is `docOver` — pixels the document scrolls sideways.
 * It must be 0 everywhere; a page that scrolls sideways on a phone is broken
 * however good it looks in a screenshot. Two classes of finding are filtered
 * out on purpose because they are not defects: an element inside an
 * `overflow-x` scroller, and a `truncate` box, which always reports
 * scrollWidth > clientWidth — that is what an ellipsis IS.
 *
 * This complements scripts/shoot.mjs rather than replacing it: overflow is
 * measurable, composition is not. Look at the screenshots too.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:3000';
const ONLY = process.argv[2];

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = CANDIDATES.find((p) => p && existsSync(p));

const WIDTHS = [
  { w: 360, h: 780, name: 'android-sm' },
  { w: 390, h: 844, name: 'iphone' },
  { w: 430, h: 932, name: 'iphone-max' },
  { w: 768, h: 1024, name: 'tablet' },
  { w: 1024, h: 768, name: 'ipad-land' },
  { w: 1440, h: 900, name: 'desktop' },
];

const ROUTES = [
  '/',
  '/projects',
  '/projects/gundih',
  '/weekly/43/overall',
  '/weekly/43/control',
  '/weekly/43/summary',
  '/weekly/43/detail',
  '/weekly/43/scurve',
  '/weekly/43/documentation',
  '/weekly/43/print',
  '/dokumen/43/summary',
  '/dokumen/43/data',
  '/dokumen/43/vdrl',
  '/dokumen/43/vdrl-data',
  '/daily',
  '/daily/2026-06-04',
  '/settings',
  '/setup',
  '/klaim',
].filter((r) => !ONLY || r.includes(ONLY));

const PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const scrollers = [];
  const seen = new Set();
  const describe = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 6).join('.')
      : '';
    return el.tagName.toLowerCase() + id + cls;
  };

  // 1. every scroll container that actually overflows horizontally
  const all = Array.from(document.querySelectorAll('*'));
  for (const el of [document.documentElement, document.body, ...all]) {
    if (seen.has(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    // A truncated box ALWAYS reports scrollWidth > clientWidth — that is what
    // an ellipsis is. Deliberate, so it is not an overflow finding.
    const intentional = /(auto|scroll)/.test(s.overflowX) || s.textOverflow === 'ellipsis';
    const over = el.scrollWidth - el.clientWidth;
    if (over > 1 && !intentional && el.clientWidth > 0) {
      scrollers.push({ sel: describe(el), over, cw: el.clientWidth, sw: el.scrollWidth });
    }
  }

  // 2. elements sticking past the viewport with no scrollable ancestor
  const escapees = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= vw + 2) continue;
    let p = el.parentElement, guarded = false;
    while (p) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { guarded = true; break; }
      if (s.position === 'fixed' && p.getBoundingClientRect().right <= 1) { guarded = true; break; }
      p = p.parentElement;
    }
    if (!guarded) escapees.push({ sel: describe(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), txt: (el.textContent || '').trim().slice(0, 40) });
  }

  // 3. tap targets under 44px that are real controls
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.height < 36) small.push({ sel: describe(el), h: Math.round(r.height), w: Math.round(r.width), txt: (el.textContent || '').trim().slice(0, 28) });
  }

  return {
    docOver: document.documentElement.scrollWidth - vw,
    bodyOver: document.body.scrollWidth - document.body.clientWidth,
    scrollers: scrollers.slice(0, 12),
    escapees: escapees.slice(0, 14),
    small: small.slice(0, 10),
    vw,
  };
};

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const rows = [];

for (const route of ROUTES) {
  for (const d of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width: d.w, height: d.h, deviceScaleFactor: 1, isMobile: d.w < 768, hasTouch: d.w < 768 });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    let res;
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 600));
      res = await page.evaluate(PROBE);
    } catch (e) {
      res = { error: String(e).slice(0, 120) };
    }
    rows.push({ route, dev: d.name, w: d.w, ...res, errors: [...new Set(errors)].slice(0, 3) });
    await page.close();
  }
  const bad = rows.filter((r) => r.route === route && (r.docOver > 1 || r.escapees?.length || r.scrollers?.length || r.error));
  const tag = bad.length ? 'FAIL' : ' ok ';
  console.log(`[${tag}] ${route}`);
  for (const b of bad) {
    console.log(`   ${b.w}px  docOver=${b.docOver ?? '-'} ${b.error || ''}`);
    for (const s of b.scrollers || []) console.log(`      scroll +${s.over}px  ${s.sel}`);
    for (const e of b.escapees || []) console.log(`      escape ${e.left}..${e.right} (w${e.w})  ${e.sel}  "${e.txt}"`);
  }
  const errs = rows.filter((r) => r.route === route && r.errors?.length);
  for (const e of errs.slice(0, 1)) console.log(`   console: ${e.errors.join(' | ')}`);
}

await browser.close();

console.log('\n===== TAP TARGETS < 36px (390px viewport) =====');
for (const r of rows.filter((x) => x.w === 390 && x.small?.length)) {
  console.log(r.route);
  for (const s of r.small) console.log(`   ${s.h}x${s.w}  ${s.sel}  "${s.txt}"`);
}
