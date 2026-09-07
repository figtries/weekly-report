// Throwaway: drive the merged Update screen far enough to photograph the
// quantity and milestone entry controls, which no seeded item uses yet.
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const [, , out, method] = process.argv;
const b = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await b.newPage();
await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/weekly/36/overall', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('button')].filter((x) => /activities/.test(x.textContent || ''));
    rows[0]?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
}
// Open the first card's Details, then set the method.
await page.evaluate(() => {
  const d = [...document.querySelectorAll('button')].find((x) => /Details/.test(x.textContent || ''));
  d?.click();
});
await new Promise((r) => setTimeout(r, 700));
// The sidebar's project switcher is also a <select>; pick the one that offers
// progress methods.
const handles = await page.$$('select');
let target = null;
for (const h of handles) {
  const has = await h.evaluate((el, m) => [...el.options].some((o) => o.value === m), method);
  if (has) { target = h; break; }
}
if (!target) throw new Error('method select not found');
await target.select(method);
await new Promise((r) => setTimeout(r, 3000));
await page.screenshot({ path: out });
await b.close();
console.log('saved', out);
