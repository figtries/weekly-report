/**
 * Screenshot a running dev server page with the Chrome this repo already uses
 * for PDFs. Exists because a design cannot be judged from extracted text.
 *
 * Usage: node scripts/shoot.mjs <url> <out.png> [width] [height] [full]
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const [, , url, out, w = '1280', h = '900', full = 'full'] = process.argv;

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const exe = CANDIDATES.find((p) => p && existsSync(p));
if (!exe) throw new Error('No local Chrome found — set CHROME_PATH');

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
// Let the entry animations settle before the shutter.
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: out, fullPage: full === 'full' });
await browser.close();

console.log(`saved ${out}`);
if (errors.length) console.log('console errors:\n  ' + errors.join('\n  '));
