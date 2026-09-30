/**
 * Proves the daily Excel export. There is no Excel or LibreOffice on the
 * development machine, so "exact" is proved by structure: the patcher leaves every
 * byte it was not asked to change, every part of an export is well-formed, and
 * the user's own 12 March workbook comes back out cell for cell.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-daily-xlsx.ts
 * Sample workbooks (only for the checks that need the real file) are read from
 * DAILY_SAMPLE_DIR, else the client's Maret folder; those checks are skipped when it
 * is not on this machine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { SheetXml } from '../lib/xlsx/sheet-xml.ts';
import { excelSerial } from '../lib/xlsx/addr.ts';

let failed = 0;
let skipped = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
function skip(name: string, why: string) {
  skipped += 1;
  console.log(`skip ${name} (${why})`);
}

const SAMPLE_DIR =
  process.env.DAILY_SAMPLE_DIR ??
  'E:/Pa Singgih/44. CPP Gundih_Relokasi Taurus 60 Tanjung & Relokasi Centaur 40 Limau/6. Progress/Daily Report/Maret';
const sample = (day: string) => path.join(SAMPLE_DIR, `PRGG-00-G0-RPT-003_DAILY PROGRESS REPORT ${day}.xlsx`);
const haveSample = fs.existsSync(sample('12032026'));

async function sheetOf(file: string): Promise<string> {
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  return (await z.file('xl/worksheets/sheet1.xml')?.async('string')) as string;
}

/* ----------------------------------------------------------- addresses */

await check('excelSerial matches the serials the workbook stores', () => {
  assert.equal(excelSerial('2026-03-12'), 46093);
  assert.equal(excelSerial('2025-11-17'), 45978);
  assert.equal(excelSerial('2025-11-23'), 45984);
  assert.equal(excelSerial('nope'), null);
});

/* -------------------------------------------------------------- patcher */

if (haveSample) {
  const xml = await sheetOf(sample('12032026'));

  await check('parse then serialize returns the sheet byte for byte', () => {
    assert.equal(SheetXml.parse(xml).serialize(), xml);
  });

  await check('reads the sample: text, number, formula and style', () => {
    const s = SheetXml.parse(xml);
    assert.equal(s.rawValue('E4'), '46093');
    assert.equal(s.formula('G17'), '8*E17');
    assert.equal(s.formula('G18'), 'E18*12');
    assert.equal(s.formula('H17'), 'F17+G17');
    assert.equal(s.formula('R24'), 'P24+N24');
    assert.equal(s.formula('R25'), null); // a shared-formula child carries no text
    assert.equal(s.style('G17'), '176');
    assert.ok(s.has('C36') && !s.has('ZZ9'));
    assert.ok(s.merges().includes('C32:I32'));
    assert.equal(s.mergeAt('C32'), 'C32:I32');
    assert.equal(s.rowHeight(16), 79.8);
  });

  await check('an edit changes only the edited cell and row', () => {
    const s = SheetXml.parse(xml);
    s.setText('C36', 'Tes teks');
    s.setNumber('E4', 46094);
    const out = s.serialize();
    assert.notEqual(out, xml);
    const back = SheetXml.parse(out);
    assert.equal(back.inlineText('C36'), 'Tes teks');
    assert.equal(back.rawValue('E4'), '46094');
    // Every other row is still the original text.
    const rowsOf = (t: string) => [...t.matchAll(/<row\b[\s\S]*?<\/row>/g)].map((m) => m[0]);
    const a = rowsOf(xml), b = rowsOf(out);
    const changed = a.map((r, i) => (r === b[i] ? -1 : i)).filter((i) => i >= 0);
    assert.equal(changed.length, 2, `rows changed: ${changed.length}`);
    // Style survives; text with markup is escaped.
    assert.equal(back.style('C36'), SheetXml.parse(xml).style('C36'));
    s.setText('C37', ' a < b & c ');
    assert.equal(SheetXml.parse(s.serialize()).inlineText('C37'), ' a < b & c ');
  });

  await check('cached values keep the formula, shared masters keep their ref', () => {
    const s = SheetXml.parse(xml);
    s.setCached('G17', 999);
    s.setFormulaText('R24', 'O24+P24');
    s.setCached('R24', 7);
    const out = SheetXml.parse(s.serialize());
    assert.equal(out.formula('G17'), '8*E17');
    assert.equal(out.rawValue('G17'), '999');
    assert.equal(out.formula('R24'), 'O24+P24');
    assert.match(s.serialize(), /<f t="shared" ref="R24:R29" si="0">O24\+P24<\/f><v>7<\/v>/);
    assert.throws(() => s.setCached('C36', 1), /no formula/);
  });

  await check('a missing cell is created in column order, in a missing row too', () => {
    const s = SheetXml.parse(xml);
    s.setText('T20', 'x', '2');
    s.setNumber('C500', 1);
    const out = SheetXml.parse(s.serialize());
    assert.equal(out.inlineText('T20'), 'x');
    const row20 = /<row r="20"[\s\S]*?<\/row>/.exec(s.serialize())?.[0] ?? '';
    const cols = [...row20.matchAll(/<c r="([A-Z]+)20"/g)].map((m) => m[1]);
    assert.deepEqual(cols, [...cols].sort((p, q) => p.length - q.length || p.localeCompare(q)));
    assert.equal(out.rawValue('C500'), '1');
  });

  await check('row height, column widths and merges', () => {
    const s = SheetXml.parse(xml);
    s.setRowHeight(16, 100);
    assert.equal(SheetXml.parse(s.serialize()).rowHeight(16), 100);
    assert.match(s.serialize(), /<row r="16"[^>]*customHeight="1"/);
    assert.ok(s.colWidth(3) > 20 && s.colWidth(3) < 30);
    assert.equal(Math.round(s.widthOf('C32:D32') * 100) / 100, Math.round((s.colWidth(3) + s.colWidth(4)) * 100) / 100);
    s.setMerges(['A1:B2', 'C3:D4']);
    assert.deepEqual(SheetXml.parse(s.serialize()).merges(), ['A1:B2', 'C3:D4']);
    assert.match(s.serialize(), /<mergeCells count="2">/);
  });
} else {
  skip('patcher checks', `sample not found in ${SAMPLE_DIR}`);
}

/* ------------------------------------------------------------ the template */

import ExcelJS from 'exceljs';
import saxes from 'saxes';
import { buildDailyWorkbook } from '../lib/xlsx/daily-export.ts';
import { DAILY_TEMPLATE_B64 } from '../lib/xlsx/daily-template.ts';
import { fillDailySheet, linesFor, type DailyExportInput } from '../lib/xlsx/daily-fill.ts';
import { CAPACITY } from '../lib/xlsx/daily-cells.ts';
import type { DailyReport } from '../lib/types.ts';

const TEMPLATE = Buffer.from(DAILY_TEMPLATE_B64, 'base64');

function wellFormed(xml: string, name: string) {
  const p = new saxes.SaxesParser();
  let err: Error | null = null;
  p.on('error', (e: Error) => { err = e; });
  p.write(xml).close();
  if (err) throw new Error(`${name}: ${(err as Error).message}`);
}

async function partsOf(bytes: Buffer): Promise<Map<string, Buffer>> {
  const z = await JSZip.loadAsync(bytes);
  const out = new Map<string, Buffer>();
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) out.set(n, await z.file(n)!.async('nodebuffer'));
  return out;
}

/** Every XML part parses; every relationship target and content type resolves. */
async function packageIsSound(bytes: Buffer) {
  const parts = await partsOf(bytes);
  for (const [n, b] of parts) if (/\.(xml|rels)$/.test(n)) wellFormed(b.toString('utf8'), n);
  const ct = parts.get('[Content_Types].xml')!.toString('utf8');
  const defaults = new Set([...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const overrides = new Set([...ct.matchAll(/<Override PartName="([^"]+)"/g)].map((m) => m[1]));
  for (const o of overrides) assert.ok(parts.has(o.slice(1)), `content type override for a missing part: ${o}`);
  for (const n of parts.keys()) {
    if (n === '[Content_Types].xml') continue;
    const ext = n.split('.').pop()!.toLowerCase();
    assert.ok(overrides.has('/' + n) || defaults.has(ext), `no content type for ${n}`);
  }
  for (const [n, b] of parts) {
    if (!n.endsWith('.rels')) continue;
    // `_rels/.rels` has no name before the extension, hence `*` and not `+`.
    const base = n.replace(/_rels\/[^/]*\.rels$/, '');
    for (const m of b.toString('utf8').matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?>/g)) {
      const tag = m[0];
      if (/TargetMode="External"/.test(tag)) continue;
      const target = m[1].startsWith('/') ? m[1].slice(1) : path.posix.normalize(base + m[1]);
      assert.ok(parts.has(target), `${n} points at a missing part: ${m[1]}`);
    }
  }
  return parts;
}

await check('the template is a sound package, with no pictures and no calc chain, and its checkboxes intact', async () => {
  const parts = await packageIsSound(TEMPLATE);
  assert.ok(!parts.has('xl/calcChain.xml'));
  assert.ok(![...parts.keys()].some((n) => n.startsWith('xl/media/')));
  const drawing = parts.get('xl/drawings/drawing1.xml')!.toString('utf8');
  assert.equal((drawing.match(/<xdr:pic>/g) ?? []).length, 0);
  assert.equal((drawing.match(/Check Box \d/g) ?? []).length, 4);
  assert.equal([...parts.keys()].filter((n) => n.startsWith('xl/ctrlProps/')).length, 4);
  assert.ok(parts.has('xl/drawings/vmlDrawing1.vml'));
});

await check('the template blanks one day of data but keeps the forms formulas', async () => {
  const sheet = SheetXml.parse((await partsOf(TEMPLATE)).get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  for (const a of ['C17', 'E17', 'L16', 'O16', 'C32', 'M32', 'D51', 'C60', 'C65', 'F2', 'E5']) {
    assert.equal(sheet.rawValue(a), null, `${a} still holds a value`);
    assert.equal(sheet.inlineText(a), null, `${a} still holds text`);
  }
  assert.equal(sheet.formula('G18'), 'E18*12');
  assert.equal(sheet.formula('D53'), 'D52-D51');
  assert.equal(sheet.formula('E21'), 'SUM(E17:E20)');
  assert.equal(sheet.style('S4'), '423');
  // Activity rows are unified: full-width merges and the right-edge styles.
  for (let r = 32; r <= 39; r++) {
    assert.ok(sheet.merges().includes(`C${r}:K${r}`) && sheet.merges().includes(`M${r}:S${r}`), `row ${r} merges`);
    assert.equal(sheet.style(`K${r}`), '309');
    assert.equal(sheet.style(`S${r}`), '312');
  }
  assert.equal(sheet.merges().length, new Set(sheet.merges()).size, 'no duplicate merges');
});

/* ------------------------------------------------------ an empty export */

const EMPTY: DailyExportInput = {
  project: {
    name: 'Retrofit Turbine Control Panel', contractNo: 'C-001', customer: 'PT Client', contractor: 'PT Contractor',
    workLocation: 'Field X', documentNoDaily: 'DOC-001',
    signatureLeft: { company: 'PT Client', name: 'Client Person' },
    signatureRight: { company: 'PT Contractor', name: 'Contractor Person' },
  },
  report: {
    date: '2026-03-12', hariKe: null,
    weather: { hujanDeras: false, hujanDerasJam: '', hujanSedang: false, hujanSedangJam: '', berawanMendung: false, berawanMendungJam: '', cerahTerang: true, cerahTerangJam: '', waktuMulai: '06:00', waktuSelesai: '18:00' },
    manHours: [], nonEffective: [], ptw: [], hseInput: [], activitiesToday: '', activitiesTomorrow: '',
    planPct: 0, actualPct: 0, photos: [null, null, null, null, null, null],
  } as DailyReport,
  dayNo: 74,
};

await check('an export is a sound package; only sheet1, the ctrlProps and the VML differ from the template', async () => {
  const { bytes } = await buildDailyWorkbook(EMPTY);
  const out = await packageIsSound(bytes);
  const tpl = await partsOf(TEMPLATE);
  assert.deepEqual([...out.keys()].sort(), [...tpl.keys()].sort());
  const changed = [...out.keys()].filter((n) => !out.get(n)!.equals(tpl.get(n)!));
  const allowed = (n: string) => n === 'xl/worksheets/sheet1.xml' || n === 'xl/drawings/vmlDrawing1.vml' || /^xl\/ctrlProps\/ctrlProp\d\.xml$/.test(n);
  assert.deepEqual(changed.filter((n) => !allowed(n)), [], 'a part changed that should have been copied through');
  // Inside sheet1.xml nothing outside sheetData moved: merges, columns, cf, page setup, drawings.
  const cut = (x: string) => [x.slice(0, x.indexOf('<sheetData')), x.slice(x.indexOf('</sheetData>'))];
  const [a1, a2] = cut(out.get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  const [b1, b2] = cut(tpl.get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  assert.equal(a1, b1);
  assert.equal(a2, b2);
});

await check('the weather checkbox follows the picked condition, in the control and in the VML', async () => {
  const { bytes } = await buildDailyWorkbook(EMPTY);
  const out = await partsOf(bytes);
  const state = (n: number) => /checked="Checked"/.test(out.get(`xl/ctrlProps/ctrlProp${n}.xml`)!.toString('utf8'));
  // ctrlProp3 is Cerah/Terang; the other three are unticked.
  assert.deepEqual([1, 2, 3, 4].map(state), [false, false, true, false]);
  const vml = out.get('xl/drawings/vmlDrawing1.vml')!.toString('utf8');
  assert.equal((vml.match(/<x:Checked>1<\/x:Checked>/g) ?? []).length, 1);
  const cerah = vml.slice(vml.indexOf('_x0000_s1027'), vml.indexOf('</v:shape>', vml.indexOf('_x0000_s1027')));
  assert.match(cerah, /<x:Checked>1<\/x:Checked>/);
});

/* ------------------------------------- the client's own 12 March workbook */

if (haveSample) {
  const orig = new ExcelJS.Workbook();
  await orig.xlsx.readFile(sample('12032026'));
  const ws = orig.worksheets[0];
  type V = ExcelJS.CellValue;
  const plain = (v: V): unknown => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
      // ExcelJS leaves `result` out when the cached value is 0, so a formula cell with none reads as 0.
      if ('formula' in v || 'sharedFormula' in v) return (v as { result?: unknown }).result ?? 0;
    }
    return v;
  };
  const val = (a: string) => plain(ws.getCell(a).value);
  const txt = (a: string) => String(val(a) ?? '').trim();
  const num = (a: string) => Number(val(a) ?? 0);
  const iso = (a: string) => (val(a) instanceof Date ? (val(a) as Date).toISOString().slice(0, 10) : '');
  const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // Built from explicit addresses HERE, not from lib/xlsx/daily-cells.ts, so a wrong cell in the map cannot cancel itself out.
  const input: DailyExportInput = {
    project: {
      name: txt('F2').replace(/^DAILY REPORT\s*/, ''),
      contractNo: txt('E6'), customer: txt('N5').replace(/^:\s*/, ''), contractor: txt('E5'), workLocation: txt('E7'),
      documentNoDaily: txt('N6').replace(/^:\s*/, ''),
      // The project stores the client on the left and the contractor on the right; the daily sheet reads them the other way round.
      signatureLeft: { company: txt('N60'), name: txt('N65') },
      signatureRight: { company: txt('C60'), name: txt('C65') },
    },
    report: {
      date: '2026-03-12', hariKe: null,
      weather: { hujanDeras: false, hujanDerasJam: '', hujanSedang: false, hujanSedangJam: '', berawanMendung: false, berawanMendungJam: '', cerahTerang: true, cerahTerangJam: '', waktuMulai: '06:00', waktuSelesai: '18:00' },
      manHours: rows(17, 19).map((r) => ({ id: `c${r}`, company: txt('C' + r), pobQty: num('E' + r), hoursEach: num('G' + r) / num('E' + r), previousHours: num('F' + r), todayHours: num('G' + r) })),
      nonEffective: rows(24, 28).map((r) => ({ id: `n${r}`, cause: txt('C' + r), previous: num('E' + r), today: num('F' + r), remark: txt('H' + r) })),
      ptw: [{ id: 'p1', description: txt('L16'), type: txt('N16'), pwtNo: txt('O16'), pa: txt('P16'), issued: iso('Q16'), validity: iso('R16'), status: txt('S16') }],
      hseInput: rows(24, 29).map((r) => ({ id: `h${r}`, activity: txt('L' + r), previous: num('O' + r), today: num('P' + r) })),
      activitiesToday: '', activitiesTomorrow: '',
      todayItems: rows(32, 39).filter((r) => txt('C' + r)).map((r) => ({ id: `t${r}`, text: txt('C' + r), done: true })),
      tomorrowItems: rows(32, 39).filter((r) => txt('M' + r)).map((r) => ({ id: `m${r}`, text: txt('M' + r), done: false })),
      planPct: 0, actualPct: 0, photos: [null, null, null, null, null, null],
    } as DailyReport,
    dayNo: 74,
  };

  const { bytes, overflow } = await buildDailyWorkbook(input);
  // DAILY_WRITE_SAMPLE=<path> also saves this export, so a person can open it in Excel beside the original.
  if (process.env.DAILY_WRITE_SAMPLE) fs.writeFileSync(process.env.DAILY_WRITE_SAMPLE, bytes);
  const outWb = new ExcelJS.Workbook();
  // ExcelJS still types its input as the pre-generic `Buffer`.
  await outWb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const out = outWb.worksheets[0];
  const oval = (a: string) => plain(out.getCell(a).value);
  const otxt = (a: string) => String(oval(a) ?? '').trim();
  const onum = (a: string) => Number(oval(a) ?? 0);

  await check('nothing overflowed: the 12 March day fits the sheet', () => {
    assert.deepEqual(overflow, []);
  });

  await check('12 March: the header, date and signatures come out as in the original', () => {
    for (const a of ['E5', 'E6', 'E7', 'N5', 'N6', 'C60', 'C65', 'N60', 'N65']) assert.equal(otxt(a), txt(a), a);
    // The title keeps its two runs; the original also has a blank line and indent before the work, which is not carried over.
    assert.equal(otxt('F2'), `DAILY REPORT\n${input.project.name}`);
    const runs = (out.getCell('F2').value as { richText: Array<{ font?: { underline?: unknown }; text: string }> }).richText;
    assert.equal(runs.length, 2);
    assert.ok(runs[0].font?.underline && !runs[1].font?.underline, 'only "DAILY REPORT" is underlined');
    assert.equal((oval('E4') as Date).toISOString().slice(0, 10), '2026-03-12');
    assert.equal(onum('S4'), 74);
  });

  await check('12 March: weather row 13 is the original (Cerah 06:00 to 18:00, the rest zero)', () => {
    for (const a of ['I13', 'K13', 'L13', 'M13', 'N13', 'O13', 'R13']) assert.equal(otxt(a), txt(a), a);
    // The original stores Cerah's start as the number 0.25 in a time cell (06:00); the export writes the text.
    assert.equal(otxt('P13'), '06:00');
    assert.equal((val('P13') as Date).getUTCHours(), 6);
  });

  await check('12 March: crew, hours, totals and the workbook\'s own formulas', () => {
    for (const r of rows(17, 19)) {
      assert.equal(otxt('C' + r), txt('C' + r));
      for (const c of 'EFGH') assert.equal(onum(c + r), num(c + r), c + r);
    }
    for (const c of 'EFGH') assert.equal(onum(c + '21'), num(c + '21'), c + '21');
    const f = (a: string) => (out.getCell(a).value as { formula?: string }).formula;
    assert.equal(f('G17'), 'E17*8');
    assert.equal(f('G18'), 'E18*12');
    assert.equal(f('G19'), 'E19*12');
    assert.equal(f('H17'), 'F17+G17');
    assert.equal(f('E21'), 'SUM(E17:E20)');
  });

  await check('12 March: non effective hours', () => {
    for (const r of rows(24, 28)) {
      assert.equal(otxt('C' + r), txt('C' + r));
      for (const c of 'EFG') assert.equal(onum(c + r), num(c + r), c + r);
    }
    for (const c of 'EFG') assert.equal(onum(c + '29'), num(c + '29'));
  });

  await check('12 March: the permit to work, dates included', () => {
    for (const a of ['L16', 'N16', 'O16', 'P16', 'S16']) assert.equal(otxt(a), txt(a), a);
    assert.equal(String(oval('K16')), '1');
    assert.equal((oval('Q16') as Date).toISOString().slice(0, 10), '2025-11-17');
    assert.equal((oval('R16') as Date).toISOString().slice(0, 10), '2025-11-23');
    for (const r of [17, 18, 19]) assert.equal(otxt('L' + r), '');
  });

  await check('12 March: HSE, with the cumulative the template got wrong now correct', () => {
    for (const r of rows(24, 29)) {
      assert.equal(otxt('L' + r), txt('L' + r));
      assert.equal(onum('O' + r), num('O' + r));
      assert.equal(onum('P' + r), num('P' + r));
      assert.equal(onum('R' + r), num('O' + r) + num('P' + r), 'R' + r);
      assert.equal((out.getCell('R' + r).value as { formula?: string }).formula, `O${r}+P${r}`);
    }
  });

  await check('12 March: today and tomorrow activities, in order', () => {
    for (const r of rows(32, 39)) {
      assert.equal(otxt('C' + r), txt('C' + r), 'C' + r);
      assert.equal(otxt('M' + r), txt('M' + r), 'M' + r);
    }
    assert.equal(otxt('B32'), '1.');
    assert.equal(otxt('L39'), '8.');
  });

  await check('12 March: the progress summary is hidden and empty, and the photographs are section 6', () => {
    for (let r = 46; r <= 56; r++) assert.ok(out.getRow(r).hidden, `row ${r} hidden`);
    for (const r of [45, 57, 59, 67]) assert.ok(!out.getRow(r).hidden, `row ${r} shown`);
    for (const a of ['D50', 'D51', 'D52']) assert.equal(oval(a) ?? null, null, a);
    assert.equal(onum('D53'), 0);
    assert.equal((out.getCell('D53').value as { formula?: string }).formula, 'D52-D51');
    assert.equal(otxt('B67'), '6. Progress Photograph');
    assert.equal(txt('B67'), '7. Progress Photograph');
  });
} else {
  skip('12 March round trip', 'sample not found');
}

/* ---------------------------------------- more than the sheet holds, and edges */

async function exportSheet(patch: Partial<DailyReport>, extra: Partial<DailyExportInput> = {}) {
  const input: DailyExportInput = { ...EMPTY, ...extra, report: { ...EMPTY.report, ...patch } as DailyReport };
  const { bytes, overflow } = await buildDailyWorkbook(input);
  const sheet = SheetXml.parse((await partsOf(bytes)).get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  return { sheet, overflow };
}
const items = (n: number, done = true) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: `Aktivitas ${i + 1}`, done }));

await check('ten done activities: seven shown and "+3 lagi (lihat app)" on the last line; tomorrow unaffected', async () => {
  const { sheet, overflow } = await exportSheet({ todayItems: items(10), tomorrowItems: items(3, false) });
  for (let i = 0; i < 7; i++) assert.equal(sheet.inlineText(`C${32 + i}`), `Aktivitas ${i + 1}`);
  assert.equal(sheet.inlineText('C39'), '+3 lagi (lihat app)');
  assert.equal(sheet.inlineText('M34'), 'Aktivitas 3');
  assert.equal(sheet.inlineText('M35'), null);
  assert.deepEqual(overflow, [{ block: 'activitiesToday', total: 10, capacity: 8 }]);
});

await check('exactly eight activities fit with no note; unticked plans are not printed as done', async () => {
  const eight = await exportSheet({ todayItems: items(8) });
  assert.equal(eight.sheet.inlineText('C39'), 'Aktivitas 8');
  assert.deepEqual(eight.overflow, []);
  const mixed = await exportSheet({ todayItems: [{ id: 'a', text: 'Done', done: true }, { id: 'b', text: 'Not done', done: false }] });
  assert.equal(mixed.sheet.inlineText('C32'), 'Done');
  assert.equal(mixed.sheet.inlineText('C33'), null);
});

await check('five companies: the overflow folds into "Lainnya (3)" and the sheet totals still equal the app\'s', async () => {
  const crew = [3, 7, 1, 2, 4].map((pob, i) => ({ id: `m${i}`, company: `PT ${i + 1}`, pobQty: pob, hoursEach: 10, previousHours: 100 * (i + 1), todayHours: pob * 10 }));
  const { sheet, overflow } = await exportSheet({ manHours: crew });
  assert.equal(sheet.inlineText('C18'), 'PT 2');
  assert.equal(sheet.inlineText('C19'), 'Lainnya (3)');
  assert.equal(sheet.rawValue('E19'), String(1 + 2 + 4));
  assert.equal(sheet.rawValue('F19'), String(300 + 400 + 500));
  assert.equal(sheet.rawValue('G19'), String(10 + 20 + 40)); // a plain number: no single hours-each for a group
  assert.equal(sheet.formula('G19'), null);
  assert.equal(sheet.rawValue('E21'), String(3 + 7 + 1 + 2 + 4));
  assert.equal(sheet.rawValue('G21'), String(crew.reduce((s, r) => s + r.todayHours, 0)));
  assert.equal(sheet.rawValue('H21'), String(crew.reduce((s, r) => s + r.previousHours + r.todayHours, 0)));
  assert.deepEqual(overflow, [{ block: 'crew', total: 5, capacity: 3 }]);
});

await check('crew hours stay the workbook\'s formula only when people times hours is the hours', async () => {
  const { sheet } = await exportSheet({
    manHours: [
      { id: 'a', company: 'A', pobQty: 3, hoursEach: 8, previousHours: 0, todayHours: 24 },
      { id: 'b', company: 'B', pobQty: 3, hoursEach: 8, previousHours: 0, todayHours: 20 }, // typed by hand, not 3 x 8
    ],
  });
  assert.equal(sheet.formula('G17'), 'E17*8');
  assert.equal(sheet.rawValue('G17'), '24');
  assert.equal(sheet.formula('G18'), null);
  assert.equal(sheet.rawValue('G18'), '20');
  // The unused third row loses its formulas rather than showing 0 beside no company.
  assert.equal(sheet.formula('G19'), null);
  assert.equal(sheet.formula('H19'), null);
  assert.equal(sheet.inlineText('C19'), null);
});

await check('HSE and non effective overflow fold too; unused HSE rows are emptied, formulas included', async () => {
  const hse = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, activity: `Kejadian ${i + 1}`, previous: i, today: 1 }));
  const a = await exportSheet({ hseInput: hse, nonEffective: Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, cause: `Sebab ${i + 1}`, previous: 1, today: 2, remark: '' })) });
  assert.equal(a.sheet.inlineText('L29'), 'Lainnya (3)');
  assert.equal(a.sheet.rawValue('P29'), '3');
  assert.equal(a.sheet.rawValue('R29'), String(5 + 6 + 7 + 3));
  assert.equal(a.sheet.inlineText('C28'), 'Lainnya (3)');
  assert.equal(a.sheet.rawValue('G28'), String(3 * 3));
  assert.deepEqual(a.overflow.map((o) => o.block).sort(), ['hse', 'nonEffective']);
  const b = await exportSheet({ hseInput: hse.slice(0, 2) });
  assert.equal(b.sheet.formula('R24'), 'O24+P24');
  assert.equal(b.sheet.formula('R26'), null);
  assert.equal(b.sheet.rawValue('P26'), null);
  assert.equal(b.sheet.formula('R25'), 'O25+P25');
});

await check('six permits and five concerns show what fits and a "+N lagi" line', async () => {
  const ptw = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, description: `Izin ${i + 1}`, type: 'Cold Work', pwtNo: `PW-${i + 1}`, pa: 'PA', issued: '2026-03-01', validity: '2026-03-20', status: 'OPEN' }));
  const aoc = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, type: 'AOC' as const, description: `Masalah ${i + 1}`, date: '2026-03-12', actionBy: 'Budi', status: 'OPEN' }));
  const { sheet, overflow } = await exportSheet({ ptw, aoc });
  assert.equal(sheet.inlineText('L18'), 'Izin 3');
  assert.equal(sheet.inlineText('L19'), '+3 lagi (lihat app)');
  assert.equal(sheet.inlineText('O19'), null);
  assert.equal(sheet.rawValue('Q16'), String(excelSerial('2026-03-01')));
  assert.equal(sheet.inlineText('E44'), 'Masalah 2');
  assert.equal(sheet.inlineText('E45'), '+3 lagi (lihat app)');
  assert.deepEqual(overflow.map((o) => o.block).sort(), ['aoc', 'ptw']);
});

await check('row heights grow to fit long text and never shrink below the template\'s', async () => {
  const long = 'Pembongkaran saluran udara masuk turbin dan pemasangan scaffolding di sekeliling unit '.repeat(5);
  const a = await exportSheet({ ptw: [{ id: 'p', description: long, type: 'x', pwtNo: 'x', pa: 'x', issued: '', validity: '', status: 'OPEN' }] });
  const tpl = SheetXml.parse((await partsOf(TEMPLATE)).get('xl/worksheets/sheet1.xml')!.toString('utf8'));
  assert.ok((a.sheet.rowHeight(16) ?? 0) > (tpl.rowHeight(16) ?? 0), `row 16: ${a.sheet.rowHeight(16)} vs ${tpl.rowHeight(16)}`);
  const b = await exportSheet({ ptw: [{ id: 'p', description: 'Pendek', type: 'x', pwtNo: 'x', pa: 'x', issued: '', validity: '', status: 'OPEN' }] });
  assert.equal(b.sheet.rowHeight(16), tpl.rowHeight(16));
  const c = await exportSheet({ todayItems: [{ id: 'a', text: 'Kalimat aktivitas yang sangat panjang '.repeat(12), done: true }] });
  assert.ok((c.sheet.rowHeight(32) ?? 0) > 21);
  assert.equal(linesFor('a\nb\nc', 30), 3);
  assert.equal(linesFor('x'.repeat(100), 10), 12);
});

await check('no progress figure: rows 46-56 hidden, their cells empty, the deviation formula at 0, photographs renumbered', async () => {
  const { sheet } = await exportSheet({});
  for (let r = 44; r <= 58; r++) assert.equal(sheet.rowHidden(r), r >= 46 && r <= 56, `row ${r}`);
  for (const a of ['D50', 'D51', 'D52']) assert.equal(sheet.rawValue(a), null, a);
  assert.equal(sheet.formula('D53'), 'D52-D51');
  assert.equal(sheet.rawValue('D53'), '0');
  assert.equal(sheet.inlineText('B67'), '6. Progress Photograph');
  const none = await exportSheet({}, { dayNo: null });
  assert.equal(none.sheet.rawValue('S4'), null);
});

/* ------------------------------------------------------------------ photos */

import sharp from 'sharp';
import { coverCrop, imageInfo } from '../lib/xlsx/daily-photos.ts';

const shot = (w: number, h: number, format: 'jpeg' | 'png', hue: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } })[format]().toBuffer();
const landscape = await shot(1600, 1200, 'jpeg', 40);
const portrait = await shot(1131, 1600, 'jpeg', 90);
const wide = await shot(1920, 1080, 'jpeg', 140);
const square = await shot(800, 800, 'png', 190);
const PHOTOS = [landscape, portrait, wide, square, landscape, portrait, wide, square];

await check('image headers: JPEG and PNG sizes are read, anything else is passed over', () => {
  assert.deepEqual(imageInfo(landscape), { ext: 'jpeg', width: 1600, height: 1200 });
  assert.deepEqual(imageInfo(portrait), { ext: 'jpeg', width: 1131, height: 1600 });
  assert.deepEqual(imageInfo(square), { ext: 'png', width: 800, height: 800 });
  assert.equal(imageInfo(Buffer.from('RIFF....WEBPVP8 ')), null);
  assert.equal(imageInfo(Buffer.alloc(0)), null);
});

await check('cover crop: centred, only on the side that is too long', () => {
  assert.equal(coverCrop(1600, 1200, 100, 50), ' t="16667" b="16667"'); // 4:3 into 2:1 loses a sixth top and bottom
  assert.equal(coverCrop(1600, 800, 100, 100), ' l="25000" r="25000"'); // 2:1 into a square loses a quarter each side
  assert.equal(coverCrop(400, 300, 800, 600), '');
});

await check('eight photos: the first six go into the six boxes, in order, and two are reported as left out', async () => {
  // DAILY_WRITE_PHOTOS=<path> saves this export so a person can open it in Excel.
  const { bytes, overflow } = await buildDailyWorkbook(EMPTY, PHOTOS, PHOTOS.length);
  if (process.env.DAILY_WRITE_PHOTOS) fs.writeFileSync(process.env.DAILY_WRITE_PHOTOS, bytes);
  assert.deepEqual(overflow, [{ block: 'photos', total: 8, capacity: 6 }]);
  const out = await packageIsSound(bytes);
  const tpl = await partsOf(TEMPLATE);
  const added = [...out.keys()].filter((n) => !tpl.has(n)).sort();
  assert.deepEqual(added, ['xl/media/image1.jpeg', 'xl/media/image2.jpeg', 'xl/media/image3.jpeg', 'xl/media/image4.png', 'xl/media/image5.jpeg', 'xl/media/image6.jpeg']);
  assert.ok(out.get('xl/media/image2.jpeg')!.equals(portrait), 'the photo is stored as uploaded');
  const changed = [...tpl.keys()].filter((n) => !out.get(n)!.equals(tpl.get(n)!));
  const allowed = (n: string) =>
    ['xl/worksheets/sheet1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels'].includes(n) ||
    /^xl\/ctrlProps\/ctrlProp\d\.xml$/.test(n);
  assert.deepEqual(changed.filter((n) => !allowed(n)), []);

  const drawing = out.get('xl/drawings/drawing1.xml')!.toString('utf8');
  assert.equal((drawing.match(/Check Box \d/g) ?? []).length, 4, 'the weather checkboxes are still there');
  // One anchor at a time: the checkboxes are twoCellAnchors too.
  const pics = drawing
    .split('</xdr:twoCellAnchor>')
    .filter((a) => a.includes('<xdr:pic>'))
    .map((a) => /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>[\s\S]*?<xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>[\s\S]*?r:embed="([^"]+)"\/><a:srcRect([^/]*)\/>/.exec(a)!);
  assert.equal(pics.length, 6);
  // Zero-based: C71:K90, L71:R90, C92:K111, L92:R111, C113:K132, L113:R132.
  assert.deepEqual(pics.map((m) => [m[1], m[2], m[3], m[4]].map(Number)), [
    [2, 70, 10, 89], [11, 70, 17, 89], [2, 91, 10, 110], [11, 91, 17, 110], [2, 112, 10, 131], [11, 112, 17, 131],
  ]);
  const rels = out.get('xl/drawings/_rels/drawing1.xml.rels')!.toString('utf8');
  pics.forEach((m, i) => assert.match(rels, new RegExp(`Id="${m[5]}"[^>]*Target="\\.\\./media/image${i + 1}\\.`)));
  // The boxes are wider than tall (about 1.36 to 1.43): the portrait and the square lose top and bottom, the 16:9 its sides.
  assert.match(pics[1][6], /^ t="\d+" b="\d+"$/);
  assert.match(pics[2][6], /^ l="\d+" r="\d+"$/);
  assert.match(pics[3][6], /^ t="\d+" b="\d+"$/);
  assert.match(drawing.slice(0, drawing.indexOf('>', drawing.indexOf('<xdr:wsDr'))), /xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/);
});

await check('no photos: the drawing and its relationships are the template\'s, byte for byte', async () => {
  const out = await partsOf((await buildDailyWorkbook(EMPTY, [], 0)).bytes);
  const tpl = await partsOf(TEMPLATE);
  for (const n of ['xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels']) assert.ok(out.get(n)!.equals(tpl.get(n)!), n);
  assert.ok(![...out.keys()].some((n) => n.startsWith('xl/media/')));
});

await check('weather: rain picked takes the working hours; unpicked slots keep the template\'s zeros', async () => {
  const { sheet } = await exportSheet({ weather: { ...EMPTY.report.weather, cerahTerang: false, hujanSedang: true, waktuMulai: '13:00', waktuSelesai: '15:30' } });
  assert.equal(sheet.inlineText('L13'), '13:00');
  assert.equal(sheet.inlineText('M13'), '15:30');
  assert.equal(sheet.inlineText('I13'), '0.00');
  assert.equal(sheet.inlineText('P13'), '00.00');
  assert.equal(sheet.inlineText('R13'), '00.00');
});

// LATER TASKS APPEND CHECKS ABOVE THIS LINE.
if (failed) {
  console.log(`\n${failed} check(s) failed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(1);
}
console.log(`\nall checks passed${skipped ? ` (${skipped} skipped)` : ''}`);
