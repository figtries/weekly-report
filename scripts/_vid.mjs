import { existsSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const src = 'file:///C:/Users/LENOVO/Downloads/tai.mp4';
const out = process.argv[2];
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage();
await page.setViewport({ width: 1280, height: 820 });
await page.goto('file:///C:/Users/LENOVO/Downloads/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.setContent(`<body style="margin:0;background:#111"><video id="v" src="${src}" style="width:100%;display:block"></video></body>`);
const meta = await page.evaluate(() => new Promise((res) => {
  const v = document.getElementById('v');
  const done = () => res({ dur: v.duration, w: v.videoWidth, h: v.videoHeight, err: null });
  if (v.readyState >= 1) return done();
  v.onloadedmetadata = done;
  v.onerror = () => res({ err: String(v.error && v.error.message || v.error && v.error.code) });
  setTimeout(() => res({ err: 'timeout, readyState=' + v.readyState }), 15000);
}));
console.log('video:', JSON.stringify(meta));
if (meta.err) { await b.close(); process.exit(1); }
await page.setViewport({ width: Math.min(1280, meta.w), height: Math.min(900, meta.h) });
const n = 9;
for (let i = 0; i < n; i++) {
  const t = (meta.dur * (i + 0.5)) / n;
  await page.evaluate((t) => new Promise((res) => {
    const v = document.getElementById('v');
    v.onseeked = () => res();
    v.currentTime = t;
    setTimeout(res, 4000);
  }), t);
  await new Promise((r) => setTimeout(r, 180));
  writeFileSync(out.replace('.png', `-${String(Math.round(t * 1000)).padStart(5, '0')}ms.png`), await page.screenshot({ encoding: 'binary' }));
}
await b.close();
console.log('extracted', n, 'frames across', meta.dur.toFixed(2), 's');
