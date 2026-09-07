/**
 * Resizes public/report.png into the sizes the manifest actually declares.
 *
 * `app/manifest.ts` pointed all three icon entries at the 1254x1254 original —
 * 848 KB — including the one labelled 192x192. A phone installing the app, or
 * merely reading the manifest during a navigation, downloaded the whole thing:
 * traced arriving mid-click on the way into a project, competing for bandwidth
 * with the page being opened.
 *
 * No image library is added for this. The repo already carries a Chrome for
 * PDFs; a canvas in that Chrome resizes better than a dependency nobody else
 * needs.
 *
 * Run: node scripts/make-icons.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const exe = CANDIDATES.find((p) => p && existsSync(p));
if (!exe) throw new Error('No local Chrome found - set CHROME_PATH');

const src = 'data:image/png;base64,' + readFileSync('public/report.png').toString('base64');
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

for (const size of [192, 512]) {
  const dataUrl = await page.evaluate(
    async (s, n) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = n;
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, n, n);
          res(c.toDataURL('image/png'));
        };
        img.src = s;
      }),
    src,
    size
  );
  const out = `public/icon-${size}.png`;
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(out, buf);
  console.log(`${out}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

await browser.close();
