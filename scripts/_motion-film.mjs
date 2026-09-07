/** Film a sub-tab change and write the frames, because motion cannot be read
 *  from the DOM. Frames land in /tmp/film-*.png at ~60ms apart. */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const B = process.argv[2];
const OUT = process.argv[3] || 'C:/Users/LENOVO/AppData/Local/Temp/film';
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1000, height: 700 });
for (const u of ['/weekly/36/summary','/weekly/36/detail']) await p.goto(B+u,{waitUntil:'networkidle0',timeout:120000});
await p.goto(B+'/weekly/36/summary',{waitUntil:'networkidle0',timeout:120000});
await new Promise(r=>setTimeout(r,1200));

const client = await p.target().createCDPSession();
const frames = [];
const t0 = Date.now();
client.on('Page.screencastFrame', async ({ data, sessionId }) => {
  frames.push({ t: Date.now() - t0, data });
  await client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await p.evaluate(() => document.querySelector('a[href="/weekly/36/detail"]').click());
await new Promise(r=>setTimeout(r,1400));
await client.send('Page.stopScreencast');

console.log('frames captured:', frames.length, 'over', frames.at(-1)?.t, 'ms');
frames.forEach((f, i) => writeFileSync(`${OUT}/f${String(i).padStart(2,'0')}_${f.t}ms.png`, Buffer.from(f.data,'base64')));
console.log(frames.map(f=>f.t).join(' '));
await b.close();
