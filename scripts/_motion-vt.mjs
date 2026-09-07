import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2];
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1 · does a real view transition run on a sub-tab change?
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
for (const u of ['/weekly/36/summary','/weekly/36/scurve','/weekly/36/detail','/']) {
  await page.goto(BASE + u, { waitUntil: 'networkidle0', timeout: 120000 });
}
await page.goto(BASE + '/weekly/36/summary', { waitUntil: 'networkidle0', timeout: 120000 });
await sleep(1000);
await page.evaluate(() => {
  window.__vt = 0;
  const real = document.startViewTransition?.bind(document);
  if (real) document.startViewTransition = (cb) => { window.__vt++; return real(cb); };
});
await page.evaluate(() => document.querySelector('a[href="/weekly/36/scurve"]').click());
await page.waitForFunction(() => location.pathname.endsWith('/scurve'), { timeout: 30000 });
await sleep(900);
const subtab = await page.evaluate(() => ({ vt: window.__vt, path: location.pathname }));
console.log(`sub-tab change   viewTransitions=${subtab.vt}  now ${subtab.path}`);

// section change: Weekly -> Dashboard
await page.evaluate(() => { window.__vt = 0; });
await page.evaluate(() => document.querySelector('a[href="/"]').click());
await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 });
await sleep(900);
console.log(`section change   viewTransitions=${await page.evaluate(() => window.__vt)}`);

// ---- 2 · reduced motion must leave content visible, never hidden
const rm = await browser.newPage();
await rm.setViewport({ width: 390, height: 844 });
await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await rm.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 120000 });
await sleep(1200);
const r = await rm.evaluate(() => ({
  armed: document.querySelectorAll('.scroll-reveal').length,
  invisible: [...document.querySelectorAll('main *')].filter((e) => {
    const c = getComputedStyle(e);
    return c.opacity === '0' && c.display !== 'none' && e.getBoundingClientRect().height > 20;
  }).length,
}));
console.log(`reduced motion   armed=${r.armed} (must be 0)   invisible=${r.invisible} (must be 0)`);

await browser.close();
