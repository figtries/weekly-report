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

export async function renderReportPdf(url: string): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
    await page.waitForSelector('.print-sheet-a4', { timeout: 20_000 });
    // Recharts draws its curves a frame after the markup mounts, and a webfont
    // that lands late reflows every table. Printing before either is done is
    // how the S-curve came out empty.
    await page.evaluate(async () => {
      const charts = [...document.querySelectorAll('[data-print-chart]')];
      const drawn = () =>
        charts.every((chart) => {
          const curves = [...chart.querySelectorAll('path.recharts-curve')];
          return curves.length > 0 && curves.every((c) => (c.getAttribute('d') ?? '').length > 2);
        });
      for (let i = 0; i < 100 && !drawn(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await document.fonts.ready;
    });
    // preferCSSPageSize honours @page (A4 + our margins); displayHeaderFooter
    // is off — that band is the whole reason this file exists.
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  } finally {
    await browser.close();
  }
}
