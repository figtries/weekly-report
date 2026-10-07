/**
 * How the Projects page feels: press, scroll, drag and load, measured from
 * INSIDE the page, on a production build. Budget and baseline live in
 * docs/superpowers/plans/2026-10-07-projects-links-gantt.md.
 *
 * Usage: node scripts/verify-projects-perf.mjs [baseUrl] [projectId]
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3211';
const project = process.argv[3] ?? 'pdemo-merbau';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

async function open(phone) {
  const page = await browser.newPage();
  await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true });
    window.__lcp = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(`${base}/projects/${project}`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await sleep(1500);
  return page;
}

/** Press, then time until `text` is on screen, from inside the page. */
async function pressUntil(page, selector, text) {
  return page.evaluate(
    (selector, text) =>
      new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (!el) return resolve(null);
        const t0 = performance.now();
        const done = () => document.body.innerText.includes(text);
        const mo = new MutationObserver(() => {
          if (done()) {
            mo.disconnect();
            requestAnimationFrame(() => resolve(Math.round(performance.now() - t0)));
          }
        });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        el.click();
        setTimeout(() => {
          mo.disconnect();
          resolve(null);
        }, 5000);
      }),
    selector,
    text
  );
}

// Phone: load, scroll, press.
{
  const page = await open(true);
  out.lcp = Math.round(await page.evaluate(() => window.__lcp));
  // The JS the page actually loaded, compressed as it crossed the wire. Next 16
  // no longer prints First Load JS in the build output, and this is the figure
  // the phone pays anyway.
  out.jsKB = await page.evaluate(() =>
    Math.round(
      performance
        .getEntriesByType('resource')
        .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
        .reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024
    )
  );
  await page.evaluate(() => (window.__long = []));
  // Proof the scroll happened at all: a probe that scrolls nothing reports a
  // perfect zero, which is how a tool stops being believed.
  out.scrolledPx = await page.evaluate(async () => {
    const scrollers = [...document.querySelectorAll('main *')].filter(
      (e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible'
    );
    const s = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!s) return 0;
    for (let i = 0; i < 10; i += 1) {
      s.scrollBy(0, 400);
      await new Promise((r) => setTimeout(r, 120));
    }
    const moved = s.scrollTop;
    s.scrollTo(0, 0);
    return moved;
  });
  await sleep(500);
  const long = await page.evaluate(() => window.__long);
  out.scrollLongMax = Math.round(Math.max(0, ...long));
  out.scrollLongTotal = Math.round(long.reduce((a, b) => a + b, 0));
  out.pressMenu = await pressUntil(page, 'button[aria-label="Actions for row 1.1.1.1"]', 'Add row below');
  out.pressLinks = (await page.$('[data-links-entry]'))
    ? await pressUntil(page, '[data-links-entry]', 'Add what it waits for')
    : 'n/a (before Task 9)';
  await page.close();
}

// Desktop: a drag across the Gantt (only once handles exist, Task 10).
{
  const page = await open(false);
  const handle = await page.$('[data-link-handle="finish"]');
  if (handle) {
    const bar = await page.evaluateHandle((h) => h.parentElement, handle);
    await bar.hover();
    const box = await handle.boundingBox();
    await page.evaluate(() => (window.__long = []));
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    for (let i = 0; i < 60; i += 1) await page.mouse.move(box.x + 4 + i * 3, box.y + 4 + i * 2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const long = await page.evaluate(() => window.__long);
    out.dragLongMax = Math.round(Math.max(0, ...long));
  } else out.dragLongMax = 'n/a (before Task 10)';
  await page.close();
}

console.log(JSON.stringify(out));
await browser.close();
