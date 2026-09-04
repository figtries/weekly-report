/**
 * Daftar yang ditempel orang, dibaca menjadi register.
 *
 * Ada dua bentuk tempelan dan keduanya harus jalan: yang diketik tangan (dua
 * kolom) dan yang disalin dari sheet EDL (tujuh puluh lima kolom, berkode
 * outline, dengan empat baris judul di atasnya). Karena itu parser bekerja dua
 * langkah — pecah menjadi kisi, lalu putuskan arti tiap kolom — dan tebakan itu
 * boleh dibetulkan orang lewat `override`.
 *
 * Berkas ini tidak menyentuh database dan tidak menyentuh React. Itu disengaja:
 * ia diuji dengan sebuah string (`scripts/verify-register-paste.ts`), dipakai di
 * browser untuk pratinjau, dipakai di server untuk menulis, dan nanti akan
 * dipakai importer Excel — sebuah sheet hanya akan menjadi sumber kisi yang
 * lain, bukan jalur kedua yang harus dirawat sendiri.
 */

export interface PasteDocument { docNo: string | null; title: string; kind: string | null }
export interface PasteCategory { name: string; depth: number; documents: PasteDocument[] }
export interface ColumnMapping { outline: number | null; docNo: number | null; title: number | null; kind: number | null }
export interface ColumnSample { index: number; values: string[] }
export interface PasteProblem { line: number; message: string }

export interface PastePlan {
  columns: ColumnSample[];
  mapping: ColumnMapping;
  categories: PasteCategory[];
  counts: { categories: number; documents: number; duplicateNumbers: number };
  problems: PasteProblem[];
}

/** `A`, `A.2`, `B.5.7` — penomoran outline, bukan nomor dokumen. */
const OUTLINE = /^[A-Z](\.\d+)*$/;
/** Nomor urut baris dokumen, di kolom yang sama dengan kode outline. */
const SEQ = /^\d{1,3}$/;
/** `WPP-GN-DRE-001` — cukup untuk membedakan kolom nomor dari kolom lain. */
const CODEISH = /^[A-Za-z]{2,}[-/][A-Za-z0-9\-/.]+$/;
/** Tab, pipa, atau dua spasi ke atas: Excel, tabel Markdown, dan salinan PDF. */
const SPLIT = /\t|\s*\|\s*|\s{2,}/;

interface RawRow { line: number; indent: number; cells: string[] }

function toRows(text: string): RawRow[] {
  const out: RawRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const cells = raw.split(SPLIT).map((c) => c.trim());
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.every((c) => c === '')) return;
    out.push({ line: i + 1, indent: raw.length - raw.trimStart().length, cells });
  });
  return out;
}

const at = (row: RawRow, col: number) => row.cells[col] ?? '';

function guessColumns(rows: RawRow[], width: number): ColumnMapping {
  const none: ColumnMapping = { outline: null, docNo: null, title: null, kind: null };

  // Kolom outline dinilai dari kode outline DAN nomor urut sekaligus.
  //
  // Menilai dari kode outline saja terlihat cukup sampai sebuah sheet nyata
  // dibaca: kolom REV berisi huruf tunggal `A` dan `B`, yang cocok dengan pola
  // kode outline dan hampir menang atas kolom yang benar. Yang membedakan
  // keduanya adalah baris dokumennya — kolom outline yang asli juga memuat
  // seluruh nomor urut, kolom REV tidak memuat satu pun.
  //
  // Syarat dua kode outline menjaga daftar ketikan tangan tetap jatuh ke mode
  // datar: daftar begitu tidak punya kode outline sama sekali.
  let outline: number | null = null;
  let best = 0;
  for (let c = 0; c < width; c += 1) {
    const outlineHits = rows.filter((r) => OUTLINE.test(at(r, c))).length;
    if (outlineHits < 2) continue;
    const score = outlineHits + rows.filter((r) => SEQ.test(at(r, c))).length;
    if (score > best) { best = score; outline = c; }
  }
  if (outline === null) return none;

  const docRows = rows.filter((r) => SEQ.test(at(r, outline!)));
  if (docRows.length === 0) return none;

  let docNo: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline) continue;
    const hits = docRows.filter((r) => CODEISH.test(at(r, c))).length;
    if (hits > best) { best = hits; docNo = c; }
  }

  // Judul = teks terpanjang rata-rata. Dihitung terhadap SELURUH baris dokumen,
  // bukan hanya yang terisi, supaya kolom yang jarang diisi tapi panjang
  // (REMARKS) tidak mengalahkan kolom judul.
  let title: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline || c === docNo) continue;
    const avg = docRows.reduce((sum, r) => sum + at(r, c).length, 0) / docRows.length;
    if (avg > best) { best = avg; title = c; }
  }

  let kind: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline || c === docNo || c === title) continue;
    const hits = docRows.filter((r) => /^(doc|dwg)$/i.test(at(r, c))).length;
    if (hits > best) { best = hits; kind = c; }
  }

  return { outline, docNo, title, kind };
}

function sample(rows: RawRow[], width: number): ColumnSample[] {
  const out: ColumnSample[] = [];
  for (let c = 0; c < width; c += 1) {
    out.push({ index: c, values: rows.map((r) => at(r, c)).filter(Boolean).slice(0, 3) });
  }
  return out;
}

interface Build { categories: PasteCategory[]; problems: PasteProblem[] }

/** Kategori yang sedang terbuka, atau `GENERAL` kalau daftarnya belum punya satu pun. */
function opener(categories: PasteCategory[], stack: PasteCategory[]) {
  return (): PasteCategory => {
    const open = stack[stack.length - 1];
    if (open) return open;
    const general: PasteCategory = { name: 'GENERAL', depth: 1, documents: [] };
    categories.push(general);
    stack.push(general);
    return general;
  };
}

function fromGrid(rows: RawRow[], m: ColumnMapping): Build {
  const categories: PasteCategory[] = [];
  const problems: PasteProblem[] = [];
  const stack: PasteCategory[] = [];
  const current = opener(categories, stack);

  for (const row of rows) {
    const key = at(row, m.outline!);

    if (OUTLINE.test(key)) {
      // Nama kategori duduk di sel terisi pertama di kanan kolom outline — pada
      // sheet EDL itu kolom yang sama dengan nomor dokumen.
      const name = row.cells.slice(m.outline! + 1).find((c) => c !== '') ?? '';
      if (!name) { problems.push({ line: row.line, message: 'Category has no name' }); continue; }
      const depth = key.split('.').length;
      const category: PasteCategory = { name, depth, documents: [] };
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = category;
      categories.push(category);
      continue;
    }

    // Baris judul sheet, baris catatan, baris kosong: bukan keduanya, lewati
    // diam-diam. Menyebutnya sebagai masalah akan membuat setiap tempelan sheet
    // utuh mengeluh empat kali sebelum baris pertamanya terbaca.
    if (!SEQ.test(key)) continue;

    const docNo = m.docNo === null ? '' : at(row, m.docNo);
    const title = m.title === null ? '' : at(row, m.title);
    if (!docNo && !title) {
      problems.push({ line: row.line, message: 'Row has neither a number nor a title' });
      continue;
    }
    current().documents.push({
      docNo: docNo || null,
      title: title || docNo,
      kind: m.kind === null ? null : at(row, m.kind) || null,
    });
  }

  return { categories, problems };
}

function fromFlat(rows: RawRow[]): Build {
  const categories: PasteCategory[] = [];
  const problems: PasteProblem[] = [];
  const stack: PasteCategory[] = [];
  const current = opener(categories, stack);

  for (const row of rows) {
    const filled = row.cells.filter((c) => c !== '');
    // Baris yang dimulai dengan pemisah adalah dokumen yang belum bernomor.
    // VDRL Gundih punya 115 baris seperti itu: vendornya berutang dokumen yang
    // belum diberi nomor oleh siapa pun, dan itu tetap dokumen.
    const headless = row.cells[0] === '';

    if (!headless && filled.length === 1) {
      const depth = row.indent === 0 ? 1 : 2;
      const category: PasteCategory = { name: filled[0], depth, documents: [] };
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = category;
      categories.push(category);
      continue;
    }

    const docNo = headless ? '' : row.cells[0];
    const title = row.cells.slice(1).filter(Boolean).join(' ');
    if (!docNo && !title) {
      problems.push({ line: row.line, message: 'Row has neither a number nor a title' });
      continue;
    }
    current().documents.push({ docNo: docNo || null, title: title || docNo, kind: null });
  }

  return { categories, problems };
}

export function parseRegisterPaste(text: string, override?: Partial<ColumnMapping>): PastePlan {
  const rows = toRows(text);
  const width = rows.reduce((w, r) => Math.max(w, r.cells.length), 0);
  const mapping: ColumnMapping = { ...guessColumns(rows, width), ...override };

  const { categories, problems } = mapping.outline === null
    ? fromFlat(rows)
    : fromGrid(rows, mapping);

  const seen = new Map<string, number>();
  let documents = 0;
  for (const category of categories) {
    documents += category.documents.length;
    for (const doc of category.documents) {
      if (doc.docNo) seen.set(doc.docNo, (seen.get(doc.docNo) ?? 0) + 1);
    }
  }

  return {
    columns: sample(rows, width),
    mapping,
    categories,
    counts: {
      categories: categories.length,
      documents,
      duplicateNumbers: [...seen.values()].filter((n) => n > 1).length,
    },
    problems,
  };
}
