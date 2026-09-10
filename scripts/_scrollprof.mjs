/** CPU profile of a wheel scroll — where the main thread actually goes. */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const url = process.argv[2], sel = process.argv[3] || 'main', cpu = Number(process.argv[4] || 4);
const CANDS = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'];
const browser = await puppeteer.launch({ executablePath: CANDS.find((p) => p && existsSync(p)), headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1200));
const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const box = await page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
for (let i = 0; i < 40; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaY: 60, deltaX: 0, pointerType: 'mouse' }); await new Promise((r) => setTimeout(r, 16)); }
await new Promise((r) => setTimeout(r, 400));
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const total = profile.samples.length;
for (const id of profile.samples) {
  const n = byId.get(id); if (!n) continue;
  const f = n.callFrame;
  const key = `${f.functionName || '(anonymous)'}  ${(f.url || '').split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + 1);
}
const dur = (profile.endTime - profile.startTime) / 1000;
console.log(`samples=${total}  wall=${dur.toFixed(0)}ms  interval=200us\n`);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
  .forEach(([k, v]) => console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v * 0.2).toFixed(0).padStart(6)}ms  ${k}`));
await browser.close();
