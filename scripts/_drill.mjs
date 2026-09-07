import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = CANDIDATES.find((p) => p && existsSync(p));
const out = process.argv[2];
const w = Number(process.argv[3] || 1440);
const h = Number(process.argv[4] || 1400);
const depth = Number(process.argv[5] || 1);

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/weekly/36/overall', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

for (let i = 0; i < depth; i++) {
  // The drill-down rows are buttons carrying a chevron; take the first one.
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('button')].filter((b) =>
      /activities|Plan /.test(b.textContent || '')
    );
    if (!rows.length) return false;
    rows[0].click();
    return true;
  });
  if (!clicked) {
    console.log('no row to click at depth', i);
    break;
  }
  await new Promise((r) => setTimeout(r, 900));
}

await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('saved', out);
