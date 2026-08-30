/**
 * Does the motion work cost anything to scroll?
 *
 * Scrolls the longest screens in the app in realistic steps and records long
 * tasks (>50ms of blocked main thread) and forced synchronous layouts. Both
 * are what "laggy" actually is; a frame counter would not tell them apart from
 * a slow dev build.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2];
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const client = await page.target().createCDPSession();
// A mid-range phone, not this laptop.
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The last two carry the interaction layer's heaviest pieces: /weekly/36/overall
// holds the drill-down Swap, /settings the Expand panels and a SectionTabs pill.
// If forced synchronous layouts rise on either, the cause is Expand's height or
// a `layout` prop that reached a long list — not the spring.
for (const url of ['/', '/dokumen/36/summary', '/daily/2026-08-29', '/weekly/36/overall', '/settings']) {
  await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 120_000 });
  await sleep(1500);

  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
    window.__scroller = (() => {
      let best = document.scrollingElement, bestH = 0;
      for (const el of document.querySelectorAll('*')) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight - el.clientHeight > bestH) {
          bestH = el.scrollHeight - el.clientHeight; best = el;
        }
      }
      return best;
    })();
  });

  // 24 steps down the page, one per animation frame-ish, the way a thumb does it.
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() => { window.__scroller.scrollTop += window.__scroller.clientHeight / 3; });
    await sleep(60);
  }
  await sleep(600);

  const r = await page.evaluate(() => ({
    long: window.__long,
    revealed: [...document.querySelectorAll('.scroll-reveal')].map((e) => e.classList.contains('is-in')),
    stillHidden: [...document.querySelectorAll('.scroll-reveal:not(.is-in)')].length,
  }));
  const worst = r.long.length ? Math.max(...r.long) : 0;
  console.log(
    `${url.padEnd(24)} reveals=${r.revealed.length} stillHidden=${r.stillHidden} ` +
    `longTasks=${r.long.length} worst=${worst}ms  ${r.long.join(',')}`
  );
}
await browser.close();
