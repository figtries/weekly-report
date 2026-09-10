/** Measure real composited frames while wheel-scrolling a page. */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const url = process.argv[2];
const sel = process.argv[3] || 'main';
const cpu = Number(process.argv[4] || 4);
const CANDS = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const exe = CANDS.find((p) => p && existsSync(p));

const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--force-device-scale-factor=1'] });
const page = await browser.newPage();
await page.setViewport({ width: Number(process.argv[5] || 1440), height: Number(process.argv[6] || 900) });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1200));

const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

// where to aim the wheel
const box = await page.evaluate((s) => {
  const el = s === 'auto'
    ? [...document.querySelectorAll('*')].filter((e) => e.scrollHeight - e.clientHeight > 200 && getComputedStyle(e).overflowY.match(/auto|scroll/)).sort((a, b) => (b.clientHeight * b.clientWidth) - (a.clientHeight * a.clientWidth))[0]
    : document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, scrollH: el.scrollHeight, clientH: el.clientHeight };
}, sel);
if (!box) { console.log('selector not found:', sel); await browser.close(); process.exit(1); }

const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push(f.metadata.timestamp);
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, everyNthFrame: 1 });

const t0 = Date.now();
const STEPS = 60;
for (let i = 0; i < STEPS; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 60, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 16));
}
await new Promise((r) => setTimeout(r, 600));
const dur = Date.now() - t0;
await cdp.send('Page.stopScreencast');

const gaps = [];
for (let i = 1; i < frames.length; i++) gaps.push((frames[i] - frames[i - 1]) * 1000);
gaps.sort((a, b) => a - b);
const p = (q) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))].toFixed(0) : 'n/a';
console.log(JSON.stringify({
  url, sel, cpu, durMs: dur, frames: frames.length,
  fps: +(frames.length / (dur / 1000)).toFixed(1),
  gapMedian: p(0.5), gapP90: p(0.9), gapMax: gaps.length ? gaps[gaps.length - 1].toFixed(0) : 'n/a',
  longGaps: gaps.filter((g) => g > 50).length,
  scrolled: await page.evaluate((s) => document.querySelector(s)?.scrollTop, sel),
}, null, 2));
await browser.close();
