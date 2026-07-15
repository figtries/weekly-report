import 'server-only';
import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';

// Why the app renders its own PDF instead of calling window.print():
//
// Browsers print a band of their own into the page margins — the date and page
// title across the top, the URL and "1/9" across the bottom. It is a client
// print setting, not something the page can influence: no CSS turns it off
// (@page { margin: 0 } does not — Chrome then draws the band ON TOP of the
// content), and iOS Safari does not even offer the toggle. The only way to get
// a printout that is just the report, on every device, is to never go through
// the browser's print pipeline. So the server renders the report page in
// headless Chromium and hands back a PDF with displayHeaderFooter off. The user
// prints or shares that. One Chromium produces the file, so Windows, Android
// and iPhone all get byte-identical pages.

const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

async function launch(): Promise<Browser> {
  // On Vercel the only Chromium that fits (and runs) in a lambda is the
  // headless build from @sparticuz/chromium. Imported lazily: the package
  // unpacks a ~60MB binary and has no business loading during local dev.
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default;
    // No WebGL on these pages (charts are plain SVG) — skipping the graphics
    // stack means the lambda doesn't unpack swiftshader on cold boot.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const exe = LOCAL_CHROME.find((path) => path && existsSync(path));
  if (!exe) throw new Error('No local Chrome found for PDF rendering — set CHROME_PATH');
  return puppeteer.launch({ executablePath: exe, headless: true });
}

// Booting Chromium costs seconds — the bulk of every "Preparing PDF…" wait —
// so one browser is kept alive and each request only opens a page in it. The
// module-level promise survives warm lambda invocations on Vercel too. If the
// browser died since last use (frozen lambda, crash), relaunch.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  const cached = browserPromise ? await browserPromise.catch(() => null) : null;
  if (cached?.connected) return cached;
  browserPromise = launch();
  try {
    return await browserPromise;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}

export async function renderReportPdf(url: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // domcontentloaded + the explicit readiness checks below, not networkidle0:
    // idle-watching charges ≥500ms after the last response no matter how ready
    // the page already is, and everything the PDF needs is waited on by name.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('.print-sheet-a4', { timeout: 20_000 });
    // Recharts draws its curves a frame after the markup mounts, and a webfont
    // that lands late reflows every table. Printing before either is done is
    // how the S-curve came out empty.
    await page.evaluate(async () => {
      // Kick every image into loading NOW: the app chrome renders next/image
      // logos with loading=lazy, and in headless (nothing ever scrolls) a lazy
      // image below the fold never starts — the complete-poll below would sit
      // out its full cap waiting for it.
      for (const img of document.images) img.loading = 'eager';
      const charts = [...document.querySelectorAll('[data-print-chart]')];
      const drawn = () =>
        charts.every((chart) => {
          const curves = [...chart.querySelectorAll('path.recharts-curve')];
          return curves.length > 0 && curves.every((c) => (c.getAttribute('d') ?? '').length > 2);
        });
      for (let i = 0; i < 100 && !drawn(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // Wait on img.complete, NOT img.decode(): in headless Chromium decode()
      // promises never settle (no frames are produced until page.pdf), which
      // hung this evaluate until the protocol timeout.
      const imagesLoaded = async () => {
        const loaded = () => [...document.images].every((img) => img.complete);
        for (let i = 0; i < 200 && !loaded(); i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      };
      await imagesLoaded();
      await document.fonts.ready;
      // Photos are stored at up to 1600px but print at ~7cm wide; Chromium
      // embeds them into the PDF at stored resolution, which made every
      // documentation pack a multi-MB download. Redraw each one at twice its
      // laid-out size (~190dpi on paper) before printing — the on-screen sheet
      // is already A4-wide, so the laid-out size IS the printed size.
      for (const img of document.querySelectorAll<HTMLImageElement>('.rpt-photo img')) {
        try {
          const targetW = Math.round(img.getBoundingClientRect().width * 2);
          if (targetW <= 0 || targetW >= img.naturalWidth) continue;
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = Math.round(img.naturalHeight * (targetW / img.naturalWidth));
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          img.src = canvas.toDataURL('image/jpeg', 0.8);
        } catch {
          // A photo that can't be redrawn (still fine to print) keeps its
          // original bytes rather than failing the whole report.
        }
      }
      await imagesLoaded();
    });
    // preferCSSPageSize honours @page (A4 + our margins); displayHeaderFooter
    // is off — that band is the whole reason this file exists.
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}
