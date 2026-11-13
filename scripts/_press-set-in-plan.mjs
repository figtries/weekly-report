/** Press Data Overall -> "Set in plan" -> Cancel the way a thumb does, and say
 *  what happened: how many dialogs, whether one press closed it, whether it
 *  came back, what the sidebar says afterwards.
 *    node scripts/_press-set-in-plan.mjs [width] [height] [cpu-throttle]
 *  PRESS_BASE picks the server. Signs in with a ten-minute session in
 *  data/auth.json and removes it. Exits 1 on any failed expectation. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import puppeteer from 'puppeteer-core';

const B = process.env.PRESS_BASE || 'http://localhost:3211';
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const CPU = Number(process.argv[4] || 1);
const PROJECT = 'pdemo-merbau';
const WEEK = 36;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUTH = 'data/auth.json';
const token = randomBytes(32).toString('base64url');
const editAuth = (fn) => {
  const doc = JSON.parse(readFileSync(AUTH, 'utf8'));
  fn(doc);
  writeFileSync(AUTH, JSON.stringify(doc));
};
editAuth((d) => (d.sessions[token] = { id: d.accounts[0].id, exp: Date.now() + 600_000 }));

const db = new Database('data/report.db', { readonly: true });
const leaves = ['Plot Plan & 3D Model Review', 'HDD Design & Feasibility', 'Building Material (Steel, Panel, Finishing)'].map((n) =>
  db.prepare('select id, deskripsi as name from wbs_nodes where project_id = ? and deskripsi = ?').get(PROJECT, n)
);
db.close();

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed++;
  console.log(ok ? '  ok  ' : '  FAIL', what);
};

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: exe, headless: true });
try {
  const p = await b.newPage();
  const mobile = W < 600;
  await p.setViewport({ width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await p.setCookie({ name: 'lucille_session', value: token, url: B });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  const client = await p.target().createCDPSession();
  if (CPU > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const press = (x, y) => (mobile ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));

  const dialogs = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getClientRects().length).map((d) => {
        const r = d.getBoundingClientRect();
        return { label: d.getAttribute('aria-label'), top: Math.round(r.top), left: Math.round(r.left), kind: !!d.querySelector('.btn-cancel') };
      })
    );
  /** The kind sheet, once its box has stopped moving for three frames. */
  const settledKind = async () => {
    await p.waitForFunction(() => document.querySelector('[role=dialog] .btn-cancel'), { timeout: 8000 }).catch(() => {});
    return p.evaluate(
      () =>
        new Promise((res) => {
          const tops = [];
          const tick = () => {
            const d = document.querySelector('[role=dialog] .btn-cancel')?.closest('[role=dialog]');
            if (!d) return res({ gone: true, tops, x: 5, y: 5 });
            tops.push(Math.round(d.getBoundingClientRect().top));
            const n = tops.length;
            if (n > 3 && tops[n - 1] === tops[n - 2] && tops[n - 2] === tops[n - 3]) {
              const c = d.querySelector('.btn-cancel').getBoundingClientRect();
              return res({ tops, x: c.left + c.width / 2, y: c.top + c.height / 2 });
            }
            requestAnimationFrame(tick);
          };
          tick();
        })
    );
  };
  /** ms until no dialog is left, or null after `limit`. */
  const goneWithin = (limit) =>
    p.evaluate(
      (limit) =>
        new Promise((res) => {
          const t0 = performance.now();
          const tick = () => {
            if (![...document.querySelectorAll('[role=dialog]')].some((d) => d.getClientRects().length)) return res(Math.round(performance.now() - t0));
            if (performance.now() - t0 > limit) return res(null);
            requestAnimationFrame(tick);
          };
          tick();
        }),
      limit
    );
  const after = async (leaf, how) => {
    const state = await p.evaluate(() => ({
      hash: location.hash,
      path: location.pathname,
      overflow: document.body.style.overflow,
      overlays: [...document.querySelectorAll('[style*="view-transition-name: ov-"]')].filter((d) => d.getClientRects().length).length,
    }));
    check(state.path === `/projects/${PROJECT}` && state.hash === '', `${how}: on the planner, hash consumed (${state.path}${state.hash})`);
    check(state.overflow === '', `${how}: scroll lock released (body overflow "${state.overflow}")`);
    check(state.overlays === 0, `${how}: no overlay left (${state.overlays})`);
    await sleep(1500);
    check((await dialogs()).length === 0, `${how}: dialog did not come back`);
    const row = await p.evaluate((name) => document.body.innerText.includes(name.slice(0, 8)), leaf.name);
    check(row, `${how}: the row "${leaf.name}" is on screen`);
  };

  /** Data Overall with the activity's panel open, then one press on the link. */
  const setInPlan = async (leaf, fresh) => {
    if (fresh) await p.goto(`${B}/weekly/${WEEK}/overall?item=${encodeURIComponent(leaf.id)}`, { waitUntil: 'load', timeout: 60000 });
    const link = await p.waitForSelector('a[href*="open=kind"]', { timeout: 30000 });
    await sleep(fresh ? 2500 : 600);
    await p.evaluate(() => {
      window.__vt = [];
      if (window.__vtPatched) return;
      window.__vtPatched = true;
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (arg) => {
        const t = start(arg);
        const t0 = performance.now();
        const skip = t.skipTransition.bind(t);
        t.skipTransition = () => (window.__vt.push('SKIPPED'), skip());
        t.finished.then(() => window.__vt.push('vt ' + Math.round(performance.now() - t0) + 'ms'));
        return t;
      };
    });
    const box = await link.boundingBox();
    const t0 = Date.now();
    await press(box.x + box.width / 2, box.y + box.height / 2);
    const s = await settledKind();
    const ms = Date.now() - t0;
    const ds = await dialogs();
    check(ds.filter((d) => d.kind).length === 1, `one kind dialog, settled ${ms}ms after the press (${JSON.stringify(ds)})`);
    check(ds.every((d) => d.label === leaf.name), `it is this row's ("${ds.map((d) => d.label)}")`);
    // Rising only: every frame at or above the one before.
    const up = s.tops.every((t, i) => i === 0 || t <= s.tops[i - 1]);
    check(up, `it rose once and stayed (tops ${[...new Set(s.tops)].join(' ')})`);
    return s;
  };

  console.log(`\n${W}x${H} cpu ${CPU} @ ${B}`);
  // 1. Five rounds, each from a fresh load of Data Overall.
  for (let i = 0; i < 5; i++) {
    const leaf = leaves[i % leaves.length];
    console.log(`round ${i + 1}: ${leaf.name}`);
    const s = await setInPlan(leaf, true);
    await press(s.x, s.y);
    const gone = await goneWithin(1500);
    check(gone !== null, `one press on Cancel closed it (${gone}ms)`);
    await after(leaf, 'cancel');
    const vt = await p.evaluate(() => window.__vt);
    check(!vt.includes('SKIPPED'), `route transition played whole (${vt.join(', ')})`);
  }

  // 2. Back to Data Overall and in again without a reload: the planner is the kept one.
  console.log('back, then Set in plan again (planner kept by the router)');
  await p.goBack();
  await p.waitForFunction(() => location.pathname.startsWith('/weekly/'), { timeout: 15000 });
  await sleep(1200);
  check((await dialogs()).filter((d) => d.kind).length === 0, 'Back shows no kind dialog on Data Overall');
  {
    const leaf = leaves[4 % leaves.length];
    const s = await setInPlan(leaf, false);
    await p.keyboard.press('Escape');
    check((await goneWithin(1500)) !== null, 'Escape closed it');
    await after(leaf, 'escape');
  }
  await p.goBack();
  await sleep(1200);
  await p.goForward();
  await sleep(2000);
  check((await dialogs()).length === 0, 'Back then Forward does not reopen the dialog');

  // 3. The deep link itself, cold.
  console.log('direct deep link');
  {
    const leaf = leaves[1];
    await p.goto(`${B}/`, { waitUntil: 'load', timeout: 60000 });
    await p.goto(`${B}/projects/${PROJECT}#row=${encodeURIComponent(leaf.id)}&open=kind`, { waitUntil: 'load', timeout: 60000 });
    const s = await settledKind();
    const ds = await dialogs();
    check(ds.length === 1 && ds[0].label === leaf.name, `deep link opens this row's dialog once (${JSON.stringify(ds)})`);
    await press(s.x, s.y);
    check((await goneWithin(1500)) !== null, 'one press on Cancel closed it');
    await after(leaf, 'deep link');
  }

  // 4. The menu after all that: which link is lit, which project the card names.
  if (mobile) {
    console.log('drawer');
    await p.evaluate(() => document.querySelector('button[aria-label="Open menu"]').click());
    await sleep(700);
    const side = await p.evaluate(() => {
      const panel = [...document.querySelectorAll('body > div.fixed')].find((d) => d.querySelector('a[data-area]'));
      const lit = [...panel.querySelectorAll('a[data-area]')].filter((a) => a.className.split(' ').includes('text-chart-1')).map((a) => a.innerText.trim());
      return { lit, card: panel.querySelector('a[href="/projects"][aria-label]')?.getAttribute('aria-label') };
    });
    check(side.lit.join() === 'Projects', `drawer lights Projects (${side.lit})`);
    check(/Merbau/.test(side.card || ''), `drawer card names the open project (${side.card})`);
  }

  // 5. Open the other project from its plan, then this one again: the menu's
  //    card must name whichever is open, without a reload.
  if (mobile) {
    console.log('open another project');
    const card = async () => {
      await p.evaluate(() => document.querySelector('button[aria-label="Open menu"]').click());
      await sleep(700);
      return p.evaluate(() => {
        const panel = [...document.querySelectorAll('body > div.fixed')].find((d) => d.querySelector('a[data-area]'));
        return panel.querySelector('a[href="/projects"][aria-label]')?.getAttribute('aria-label');
      });
    };
    for (const [id, word] of [['pmtygg3od7c19', 'Samberah'], [PROJECT, 'Merbau']]) {
      await p.goto(`${B}/projects/${id}`, { waitUntil: 'load', timeout: 60000 });
      await sleep(1500);
      const open = await p.evaluateHandle(() => [...document.querySelectorAll('main button')].find((x) => /^Open/.test(x.innerText.trim())));
      const box = await open.asElement()?.boundingBox();
      check(!!box, `${word}: its plan offers Open`);
      if (!box) continue;
      await press(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForFunction(() => location.pathname.startsWith('/weekly/'), { timeout: 20000 });
      await sleep(1500);
      const said = await card();
      check(new RegExp(word).test(said || ''), `${word}: the menu's card follows (${said})`);
    }
  }

  check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} finally {
  await b.close();
  editAuth((d) => delete d.sessions[token]);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
