# Data Overall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menukar nama Data Overall ⇄ Weekly Progress di navigasi, lalu memberi Data Overall layar tempat harga diketik, bobot diturunkan, dan tiap angka turunan bisa ditanya asal-usulnya.

**Architecture:** Hampir semua mesinnya sudah ada dan sudah diuji terhadap data Gundih — `deriveWeights()`, `previewWeights()`, `updateRowTextAction()`, `syncDerivedWeights()`. Yang dibangun adalah satu modul baca baru (`lib/weights-screen.ts`) yang membentuk hasil `deriveWeights` jadi bentuk yang dipakai layar, satu rute baru (`/weekly/[week]/weights`), dan tiga sentuhan pada layar Fill in yang sudah ada. Tidak ada action tulis baru, tidak ada tabel baru, tidak ada kolom baru.

**Tech Stack:** Next.js (cacheComponents), React server components, Drizzle + better-sqlite3 (driver SINKRON — wajib), Tailwind + shadcn (`radix-nova`), framer-motion untuk gerak yang dipicu state saja.

**Spec:** `docs/superpowers/specs/2026-09-13-data-overall-design.md`

## Cara repo ini memverifikasi

Repo ini **tidak punya test runner**. Jangan cari jest/vitest dan jangan memasangnya. Yang dipakai:

- Logika murni → skrip di `scripts/verify-*.ts`, dijalankan
  `node --import ./scripts/ts-resolve.mjs scripts/verify-X.ts`, memakai helper
  `check(name, ok, detail)` dan keluar dengan kode 1 kalau ada yang gagal.
  Tulis skripnya DULU, jalankan, pastikan GAGAL, baru implementasi.
- Layar → **gambar**, `node scripts/shoot.mjs <url> <out.png> [w] [h]`, lalu
  gambarnya benar-benar dilihat. Teks hasil ekstraksi menunjukkan isi, tidak
  pernah menunjukkan komposisi. Selalu dua ukuran: desktop 1280 dan 390.
- Tipe → `npx tsc --noEmit -p tsconfig.verify.json` (scratchpad, dibuat di
  Task 1 Step 5 dan dipakai ulang seterusnya).
- Build → `next build` **ke berkas lalu `echo $?`**, tidak pernah lewat pipe.
  `next build | grep` melaporkan exit code milik grep.

## Global Constraints

- **Aplikasinya berbahasa Inggris.** Setiap label, tombol, dan pesan galat di layar ditulis dalam bahasa Inggris. Format angka `en-GB`, titik desimal, lewat `fmtPct` / `fmtNum` di `lib/analysis.ts`. Yang tetap apa adanya: isi data (nama WBS, judul dokumen) dan seluruh `/print/*`.
- **Tidak ada karakter em dash (—) di string yang terlihat pengguna.** Pakai koma, titik, atau tanda hubung biasa.
- **Radix per layar, tidak per baris.** Di dalam `.map()` mana pun yang bisa melebihi ~20 baris: `<input>` / `<select>` native yang digayakan dengan kelas shadcn. Select, Dialog, Popover, DropdownMenu, Tooltip, Command, Sheet, Tabs semuanya menarik Radix. Button, Input, Card, Badge, Skeleton, Alert tidak — bebas dipakai.
- **Target sentuh minimal 44px** — `min-h-11`, bukan `h-11`.
- **Tidak ada informasi yang cuma muncul saat hover.** Aplikasi ini dipakai orang 22 sampai 60 tahun di ponsel.
- **Animasi masuk halaman adalah keyframe CSS** (`.animate-enter` lewat `Reveal`, `.animate-fade-in-up`, kelas `.stagger-1`…`.stagger-8`), BUKAN `motion.div` dengan prop `initial` — itu menuliskan `opacity: 0` ke HTML server dan halamannya tak terlihat sampai hidrasi selesai. framer-motion hanya untuk gerak yang dipicu state setelah halaman hidup.
- **Tidak ada tabel baru, kolom baru, atau migration.** Deployment memulihkan skemanya dari snapshot blob, bukan dari migration.
- **`/print/*` tidak disentuh sama sekali** dalam pekerjaan ini.
- **Tab baru mana pun di `WeekTabs` harus menyetel `printable` secara sengaja** dan cocok dengan union `ReportKey` di `app/print/weekly/[week]/page.tsx`. `weights` adalah `printable: false`.
- **Pesan commit di repo ini adalah kalimat masalah, bukan Conventional Commits.** Contoh nyata dari riwayat: *"The delete toast offered a button that was already on screen"*. Tiap commit diakhiri baris `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **`git diff tsconfig.json` diperiksa sebelum tiap commit** dan churn dari `next build` / `next dev` dikembalikan. Keduanya menambahkan tipe `NEXT_DIST_DIR` ke `include` secara diam-diam.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `lib/weights-screen.ts` **(baru)** | Satu bacaan yang membentuk hasil `deriveWeights` jadi bentuk yang dipakai layar: daftar unit, baris per unit, dua bobot per baris, dan penanda "jatah sisa". Murni, tanpa React. |
| `scripts/verify-weights-screen.ts` **(baru)** | Membuktikan klaim inti: total tetap 100 walau harga cuma sebagian, dan baris tanpa harga menerima sisanya. |
| `app/weekly/[week]/weights/page.tsx` **(baru)** | Rute server: gate legacy, baca proyek terbuka, serahkan ke komponen klien. |
| `components/weekly/WeightsWorkbench.tsx` **(baru)** | Layar Weights: kartu unit, drill satu tingkat, kolom harga, bobot hidup, tombol Derive. |
| `components/weekly/DeriveWeightsDialog.tsx` **(baru)** | Dialog preview + apply. Dimuat lewat `next/dynamic` karena Dialog menarik Radix. |
| `components/weekly/SetupGuideCard.tsx` **(baru)** | Kartu pemandu di Fill in. Satu kartu, yang paling atas yang belum beres. |
| `components/weekly/ExplainSheet.tsx` **(baru)** | Panel "dari mana angka ini" yang dipakai kartu statistik dan baris workbench. |
| `components/layout/Sidebar.tsx` (ubah) | Tukar dua label. |
| `app/weekly/[week]/overall/page.tsx` (ubah) | `section`, kartu pemandu, kartu statistik yang bisa ditap. |
| `app/weekly/[week]/control/page.tsx` (ubah) | `section` saja. |
| `components/weekly/WeekTabs.tsx` (ubah) | Daftarkan `weights` di `GROUPS.progress`, render pil pintu masuknya. |
| `components/projects/ValueStrip.tsx` (ubah) | Tidak ada perubahan kode; komentarnya diperbarui setelah tombol pengunci punya rumah. |

---

## Task 1: Tukar nama Data Overall ⇄ Weekly Progress

Berdiri sendiri dan bisa dikirim sendiri. Tidak ada yang lain bergantung padanya.

**Files:**
- Modify: `components/layout/Sidebar.tsx:44-56` dan `:64-73`
- Modify: `app/weekly/[week]/overall/page.tsx:88`
- Modify: `app/weekly/[week]/control/page.tsx:65`
- Modify: `components/projects/NoLegacyData.tsx:40`
- Modify: `components/layout/PageHeader.tsx:10` (komentar)

**Interfaces:**
- Consumes: tidak ada.
- Produces: tidak ada API baru. Task berikutnya mengandaikan sidebar sudah menyebut `Data Overall`.

- [ ] **Step 1: Buat cabang kerja**

Sesi ini mulai di `main`. Jangan menumpuk di sana.

```bash
git checkout -b data-overall && git status --short && git branch --show-current
```

Expected: cabang `data-overall`, working tree bersih.

- [ ] **Step 2: Tukar dua label sidebar**

Di `components/layout/Sidebar.tsx`, konstanta di atas `DESTINATIONS` dinamai ulang mengikuti maknanya yang baru, lalu dua label ditukar. Namanya diganti juga supaya tidak ada `WEEKLY_PROGRESS` yang isinya justru halaman Data Overall.

```ts
const DATA_OVERALL = ['overall', 'control'];
const WEEKLY_PROGRESS = ['summary', 'detail', 'scurve', 'documentation', 'print'];
```

Lalu di `DESTINATIONS`, entri yang sekarang berlabel `'Weekly Progress'`:

```ts
  {
    label: 'Data Overall',
    icon: Activity,
    href: (w) => `/weekly/${w}/overall`,
    match: (p) => DATA_OVERALL.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
```

dan entri yang sekarang berlabel `'Reports'`:

```ts
  {
    label: 'Weekly Progress',
    icon: FileText,
    href: (w) => `/weekly/${w}/summary`,
    // `/weekly/` is load-bearing, not decoration: Document Control's tabs are
    // named `summary` and `detail` too, so a bare endsWith lit this entry as
    // well on every /dokumen page — two destinations highlighted at once.
    match: (p) => WEEKLY_PROGRESS.some((k) => p.startsWith('/weekly/') && p.endsWith(`/${k}`)),
  },
```

Ikon dibiarkan seperti adanya: `Activity` untuk Data Overall (tempat angka bergerak) dan `FileText` untuk Weekly Progress (lembar laporan) tetap membaca benar setelah ditukar.

- [ ] **Step 3: Ubah dua `section`**

`app/weekly/[week]/overall/page.tsx:88` dan `app/weekly/[week]/control/page.tsx:65`:

```tsx
section="Data Overall"
```

Empat halaman laporan (`summary`, `detail`, `scurve`, `documentation`) **tidak disentuh** — mereka sudah menulis `section="Weekly Progress"` dan di bawah nama baru itu justru jadi benar.

- [ ] **Step 4: Perbaiki dua kalimat yang menyebut nama lama**

`components/projects/NoLegacyData.tsx:40` — tautannya benar (`/weekly` mendarat di Fill in), kalimatnya yang salah:

```tsx
primary={open ? { href: '/weekly', label: 'Go to Data Overall' } : undefined}
```

`components/layout/PageHeader.tsx:10` — komentar, bukan kode:

```
 * `section` is the group the page belongs to — "Data Overall" above Fill in and
 * Check, "Weekly Progress" above the four report sheets — so that screens
 * sharing a sidebar entry say so on the page as well as in the nav.
```

- [ ] **Step 5: Buat scratchpad tsconfig dan periksa tipe**

Dibuat sekali di sini, dipakai ulang oleh setiap task berikutnya.

```bash
cat > tsconfig.verify.json <<'JSON'
{
  "extends": "./tsconfig.json",
  "include": ["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx", "lib/**/*.ts", "types/**/*.ts", "next-env.d.ts"]
}
JSON
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
```

Expected: `exit=0`. Kalau menyebut `WEEKLY_PROGRESS` tidak terdefinisi, ada pemakaian konstanta lama yang terlewat di Step 2.

`tsconfig.verify.json` dan `tsc.log` adalah berkas kerja. Jangan di-commit.

- [ ] **Step 6: Buktikan tidak ada sisa nama lama di layar**

```bash
grep -rn "Weekly Progress" --include=*.tsx app components | grep -v "summary\|detail\|scurve\|documentation"
```

Expected: hanya baris `label: 'Weekly Progress'` di Sidebar dan komentar di PageHeader. Kalau `overall/page.tsx` atau `control/page.tsx` masih muncul, Step 3 belum lengkap.

- [ ] **Step 7: Lihat gambarnya**

```bash
npm run dev
```

Di terminal lain, dua ukuran, lalu **buka berkasnya dan lihat**:

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t1-overall-desktop.png 1280 900
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t1-overall-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/summary .tmp/t1-summary-390.png 390 844
```

Yang harus terlihat: sidebar menulis **Data Overall** lalu **Weekly Progress**; di layar Fill in kapital kecil di atas judul menulis **Data Overall**; di layar Summary menulis **Weekly Progress**; dan entri sidebar yang menyala cocok dengan halaman yang dibuka (persis satu, tidak dua).

- [ ] **Step 8: Commit**

```bash
git diff tsconfig.json
git add components/layout/Sidebar.tsx components/layout/PageHeader.tsx components/projects/NoLegacyData.tsx "app/weekly/[week]/overall/page.tsx" "app/weekly/[week]/control/page.tsx"
git commit -m "The menu called the report sheets by the name of the screen that fills them in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

`git diff tsconfig.json` harus kosong sebelum `git add`. Kalau `next dev` menambahkan tipe ke `include`, kembalikan dulu.

---

## Task 2: `lib/weights-screen.ts` dan skrip pembuktinya

Logika murni, bisa diuji tanpa React dan tanpa browser. Task inilah yang membuktikan janji utama layarnya, jadi dia yang ditulis dengan tesnya lebih dulu.

**Files:**
- Create: `lib/weights-screen.ts`
- Create: `scripts/verify-weights-screen.ts`

**Interfaces:**
- Consumes: `loadWeightNodes(projectId)` dari `lib/weights-read.ts`; `deriveWeights(nodes, contractValue)`, `summariseWeights(nodes, currency, signedValue)`, tipe `WeightNode` dan `WeightSummary` dari `lib/weights.ts`; `db`, `schema` dari `lib/sqlite.ts`.
- Produces:
  - `interface WeightsRow { id: string; code: string; name: string; depth: number; isLeaf: boolean; price: number | null; bobotOverall: number; bobotInUnit: number; fromGap: boolean }`
  - `interface WeightsUnit { id: string; code: string; name: string; unitValue: number | null; bobotOverall: number; pricedRows: number; totalRows: number; rows: WeightsRow[] }`
  - `interface WeightsScreen { summary: WeightSummary; units: WeightsUnit[]; hasUnits: boolean }`
  - `export function buildWeightsScreen(nodes: WeightNode[], meta: Map<string, { code: string; name: string }>, currency: string, signedValue: number | null): WeightsScreen`
  - `export function loadWeightsScreen(projectId: string): WeightsScreen | null`

- [ ] **Step 1: Tulis skrip yang gagal**

`scripts/verify-weights-screen.ts`. Dia membangun pohon buatan sendiri — tidak menyentuh database sama sekali — supaya klaimnya bisa dibaca tanpa tahu isi Gundih.

```ts
/**
 * Proves the two claims the Weights screen makes to the person using it.
 *
 * One: type a price on SOME rows and the total still closes at 100. Two: a row
 * you never priced is not blank — it takes a share of what is left, and the
 * screen can tell which rows those are so it can label them.
 *
 * `WeightResult.fromGap` is a COUNT, not a per-row flag, so "took a share of
 * the remainder" has to be worked out here: a leaf with no price of its own and
 * no priced ancestor.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights-screen.ts
 */
import type { WeightNode } from '../lib/weights.ts';
import { buildWeightsScreen } from '../lib/weights-screen.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

/** Two units of two leaves each. Only the first unit is priced. */
function node(p: Partial<WeightNode> & { id: string; order: number }): WeightNode {
  return {
    parentId: null,
    price: null,
    workstepFactor: null,
    isReportingUnit: false,
    unitContractValue: null,
    bobot: null,
    isLeaf: false,
    ...p,
  };
}

const nodes: WeightNode[] = [
  node({ id: 'A', order: 1, isReportingUnit: true, unitContractValue: 600, price: 600 }),
  node({ id: 'A1', order: 2, parentId: 'A', isLeaf: true, price: 400 }),
  node({ id: 'A2', order: 3, parentId: 'A', isLeaf: true, price: 200 }),
  node({ id: 'B', order: 4, isReportingUnit: true, unitContractValue: 400, price: 400 }),
  node({ id: 'B1', order: 5, parentId: 'B', isLeaf: true }),
  node({ id: 'B2', order: 6, parentId: 'B', isLeaf: true }),
];

const meta = new Map(nodes.map((n) => [n.id, { code: n.id, name: `Row ${n.id}` }]));
const screen = buildWeightsScreen(nodes, meta, 'IDR', 1000);

const all = screen.units.flatMap((u) => u.rows).filter((r) => r.isLeaf);
const total = all.reduce((s, r) => s + r.bobotOverall, 0);

check('two units are found', screen.units.length === 2 && screen.hasUnits, `${screen.units.length} units`);

check('the total closes at 100 with only half the rows priced', Math.abs(total - 100) < 0.01, `total ${total.toFixed(4)}`);

check(
  'a priced leaf is weighted by its own price',
  Math.abs((all.find((r) => r.id === 'A1')?.bobotOverall ?? 0) - 40) < 0.01,
  `A1 ${all.find((r) => r.id === 'A1')?.bobotOverall.toFixed(2)}`
);

check(
  'an unpriced leaf is never blank',
  all.filter((r) => r.id.startsWith('B')).every((r) => r.bobotOverall > 0),
  `B1 ${all.find((r) => r.id === 'B1')?.bobotOverall.toFixed(2)}, B2 ${all.find((r) => r.id === 'B2')?.bobotOverall.toFixed(2)}`
);

check(
  'the screen can tell which rows took a share of the remainder',
  all.filter((r) => r.fromGap).map((r) => r.id).join(',') === 'B1,B2',
  all.filter((r) => r.fromGap).map((r) => r.id).join(',') || 'none'
);

check(
  'weight within a unit is measured against that unit, not the project',
  Math.abs((all.find((r) => r.id === 'A1')?.bobotInUnit ?? 0) - 66.6667) < 0.01,
  `A1 in-unit ${all.find((r) => r.id === 'A1')?.bobotInUnit.toFixed(4)}`
);

check(
  "each unit's rows add up to 100 within that unit",
  screen.units.every(
    (u) => Math.abs(u.rows.filter((r) => r.isLeaf).reduce((s, r) => s + r.bobotInUnit, 0) - 100) < 0.01
  )
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-weights-screen.ts; echo "exit=$?"
```

Expected: gagal memuat `../lib/weights-screen.ts` — berkasnya belum ada. Kalau dia malah lolos, berarti ada berkas lain bernama sama; cari dan hapus sebelum lanjut.

- [ ] **Step 3: Tulis `lib/weights-screen.ts`**

```ts
/**
 * The shape the Weights screen needs, built out of the derivation that already
 * exists.
 *
 * `lib/weights.ts` answers "what is every leaf worth"; this answers the two
 * questions the SCREEN asks on top of that. Which reporting unit does a row
 * belong to, and what is its weight WITHIN that unit — the source workbook
 * carries `WF per SPK` and `WF Overall` as two separate columns because they
 * are two separate questions, and a person reading a per-SPK report next to an
 * overall one has to be able to reconcile them.
 *
 * And: did this row get its weight from a price of its own, or from a share of
 * what was left over? `WeightResult.fromGap` is a COUNT, so that has to be
 * worked out per row here — a leaf with no price and no priced ancestor. The
 * screen labels those rather than leaving them looking like a typed figure.
 *
 * Pure over plain rows, like `lib/weights.ts`, so `scripts/verify-weights-
 * screen.ts` can exercise it without a database.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { deriveWeights, summariseWeights, type WeightNode, type WeightSummary } from './weights';
import { loadWeightNodes } from './weights-read';

export interface WeightsRow {
  id: string;
  code: string;
  name: string;
  depth: number;
  isLeaf: boolean;
  price: number | null;
  /** Percent of the whole project. */
  bobotOverall: number;
  /** Percent within this row's own reporting unit. */
  bobotInUnit: number;
  /** Weighted by a share of the unpriced remainder rather than by a price. */
  fromGap: boolean;
}

export interface WeightsUnit {
  id: string;
  code: string;
  name: string;
  unitValue: number | null;
  bobotOverall: number;
  pricedRows: number;
  totalRows: number;
  rows: WeightsRow[];
}

export interface WeightsScreen {
  summary: WeightSummary;
  units: WeightsUnit[];
  /**
   * False where nobody has marked an SPK yet. The screen then shows the WBS
   * roots as its cards instead of an empty list, and offers to mark one — a
   * plan with no units still has weights, and refusing to show them would hide
   * the whole screen behind a step most people have not heard of.
   */
  hasUnits: boolean;
}

export function buildWeightsScreen(
  nodes: WeightNode[],
  meta: Map<string, { code: string; name: string }>,
  currency: string,
  signedValue: number | null
): WeightsScreen {
  const summary = summariseWeights(nodes, currency, signedValue);
  const result = deriveWeights(nodes, signedValue ?? undefined);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const depthOf = (n: WeightNode): number => {
    let d = 0;
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    while (cur) {
      d += 1;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return d;
  };

  /** The nearest ancestor-or-self that is a reporting unit. */
  const unitOf = (n: WeightNode): WeightNode | null => {
    let cur: WeightNode | undefined = n;
    while (cur) {
      if (cur.isReportingUnit) return cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };

  /** A price of its own, or any ancestor carrying one. */
  const reachedByPrice = (n: WeightNode): boolean => {
    let cur: WeightNode | undefined = n;
    while (cur) {
      if ((cur.price ?? 0) > 0) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  const unitNodes = nodes.filter((n) => n.isReportingUnit);
  const hasUnits = unitNodes.length > 0;
  // Without units the WBS roots stand in, so the screen always has cards.
  const anchors = hasUnits ? unitNodes : nodes.filter((n) => n.parentId == null);

  const units: WeightsUnit[] = anchors.map((anchor) => {
    const members = nodes.filter((n) => {
      if (n.id === anchor.id) return false;
      const owner = hasUnits ? unitOf(n) : rootOf(n, byId);
      return owner?.id === anchor.id;
    });

    const leafTotal = members
      .filter((n) => n.isLeaf)
      .reduce((s, n) => s + (result.bobotOf.get(n.id) ?? 0), 0);

    const rows: WeightsRow[] = members
      .sort((a, b) => a.order - b.order)
      .map((n) => {
        const overall = n.isLeaf ? (result.bobotOf.get(n.id) ?? 0) : subtreeWeight(n, nodes, byId, result.bobotOf);
        return {
          id: n.id,
          code: meta.get(n.id)?.code ?? '',
          name: meta.get(n.id)?.name ?? '',
          depth: depthOf(n) - depthOf(anchor),
          isLeaf: n.isLeaf,
          price: n.price,
          bobotOverall: overall,
          // Guarded: a unit whose leaves all weigh zero must not produce NaN.
          bobotInUnit: leafTotal > 0 ? (overall / leafTotal) * 100 : 0,
          fromGap: n.isLeaf && !reachedByPrice(n),
        };
      });

    return {
      id: anchor.id,
      code: meta.get(anchor.id)?.code ?? '',
      name: meta.get(anchor.id)?.name ?? '',
      unitValue: anchor.unitContractValue ?? anchor.price,
      bobotOverall: leafTotal,
      pricedRows: members.filter((n) => (n.price ?? 0) > 0).length,
      totalRows: members.length,
      rows,
    };
  });

  return { summary, units, hasUnits };
}

function rootOf(n: WeightNode, byId: Map<string, WeightNode>): WeightNode {
  let cur = n;
  while (cur.parentId) {
    const next = byId.get(cur.parentId);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/** A branch carries no weight of its own; its figure is its leaves added up. */
function subtreeWeight(
  branch: WeightNode,
  nodes: WeightNode[],
  byId: Map<string, WeightNode>,
  bobotOf: Map<string, number>
): number {
  let sum = 0;
  for (const n of nodes) {
    if (!n.isLeaf) continue;
    let cur: WeightNode | undefined = n;
    while (cur) {
      if (cur.id === branch.id) {
        sum += bobotOf.get(n.id) ?? 0;
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return sum;
}

export function loadWeightsScreen(projectId: string): WeightsScreen | null {
  const project = db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;

  const nodes = loadWeightNodes(projectId);
  const meta = new Map(
    db
      .select({
        id: schema.wbsNodes.id,
        code: schema.wbsNodes.kode,
        name: schema.wbsNodes.deskripsi,
      })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .all()
      .map((r) => [r.id, { code: r.code ?? '', name: r.name ?? '' }])
  );

  return buildWeightsScreen(nodes, meta, project.currency, project.contractValue);
}
```

Sebelum menjalankan: pastikan nama kolom `kode` dan `deskripsi` benar-benar ada di `schema.wbsNodes`.

```bash
grep -n "kode\|deskripsi" lib/schema.ts | head
```

Kalau namanya lain, sesuaikan dua baris `select` itu saja — jangan mengubah `WeightsRow`.

- [ ] **Step 4: Jalankan, pastikan LULUS**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-weights-screen.ts; echo "exit=$?"
```

Expected: tujuh baris `PASS`, `ALL PASS`, `exit=0`.

- [ ] **Step 5: Jalankan skrip bobot yang sudah ada, pastikan tidak ada yang rusak**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-weights.ts; echo "exit=$?"
node --import ./scripts/ts-resolve.mjs scripts/verify-weights-auto.ts; echo "exit=$?"
```

Expected: dua-duanya `exit=0`. Task ini tidak menyentuh rumusnya, jadi keduanya harus tetap hijau apa adanya.

- [ ] **Step 6: Periksa tipe dan commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
git add lib/weights-screen.ts scripts/verify-weights-screen.ts
git commit -m "The weight a row carries inside its SPK had no way to be read

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Layar Weights

**Files:**
- Create: `app/weekly/[week]/weights/page.tsx`
- Create: `components/weekly/WeightsWorkbench.tsx`

**Interfaces:**
- Consumes: `loadWeightsScreen(projectId)`, tipe `WeightsScreen` / `WeightsUnit` / `WeightsRow` dari Task 2; `getOpenProject()` dari `lib/legacy-bridge.ts`; `updateRowTextAction(nodeId, 'price', value)` dari `lib/sheet-actions.ts`; `deriveWeights` dari `lib/weights.ts`; `formatMoney` dari `lib/currency.ts`; `LegacyGate` dari `components/projects/LegacyGate.tsx`; `PageHeader`, `Reveal`, `RouteTransition`, `Card`, `CardContent`, `Badge`.
- Produces: rute `/weekly/[week]/weights`. Task 4 menautkan ke sana; Task 5 menautkan ke sana dari kartu pemandu.

- [ ] **Step 1: Rute server**

`app/weekly/[week]/weights/page.tsx`. Menyalin bentuk `overall/page.tsx` persis: `unstable_instant` dengan sampel yang sama, `LegacyGate` di luar, badan async di dalam.

```tsx
import { getOpenProject } from '@/lib/legacy-bridge';
import { loadWeightsScreen } from '@/lib/weights-screen';
import WeightsWorkbench from '@/components/weekly/WeightsWorkbench';
import PageHeader from '@/components/layout/PageHeader';
import { Reveal } from '@/components/motion/Reveal';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { MOTION } from '@/lib/design';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
  unstable_disableValidation: true,
};

export default function WeightsPage() {
  return (
    <LegacyGate what="prices and weights" planned>
      <WeightsPageBody />
    </LegacyGate>
  );
}

async function WeightsPageBody() {
  const open = await getOpenProject();
  const screen = open ? loadWeightsScreen(open.id) : null;

  return (
    <RouteTransition id="weekly-weights">
      <div className="flex flex-col gap-4 px-3 py-4 sm:p-6 lg:p-8">
        <PageHeader section="Data Overall" title="Weights" className="mb-0 animate-enter">
          {/* Said out loud because a week picker sits right above this screen
              and does nothing to it. Silence there reads as a bug. */}
          <span className="font-semibold text-foreground">
            Prices and weights belong to the project, not to one week.
          </span>
        </PageHeader>

        <Reveal delay={MOTION.stagger}>
          {screen ? (
            <WeightsWorkbench screen={screen} />
          ) : (
            <p className="text-sm text-muted-foreground">Open a project first.</p>
          )}
        </Reveal>
      </div>
    </RouteTransition>
  );
}
```

- [ ] **Step 2: Komponen klien**

`components/weekly/WeightsWorkbench.tsx`. Tiga aturan yang tidak boleh dilanggar dan sudah membuat kerusakan di repo ini sebelumnya: `<input>` NATIVE untuk kolom harga (daftar bisa lebih dari 20 baris), turun SATU tingkat saja (bukan pohon penuh), dan hitung ulang bobot di klien atas salinan datanya supaya angkanya bergerak sambil orang mengetik tanpa menunggu server.

Kerangkanya, lengkap dengan bagian yang mudah salah:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { updateRowTextAction } from '@/lib/sheet-actions';
import type { WeightsScreen, WeightsUnit } from '@/lib/weights-screen';
import { formatMoney } from '@/lib/currency';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function WeightsWorkbench({ screen }: { screen: WeightsScreen }) {
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  // Prices typed since the page loaded, so the weights beside them can move
  // before the server has answered. Keyed by node id.
  const [typed, setTyped] = useState<Record<string, number | null>>({});
  const [, startTransition] = useTransition();

  const unit = openUnit ? screen.units.find((u) => u.id === openUnit) ?? null : null;

  if (unit) return <UnitRows unit={unit} typed={typed} setTyped={setTyped} onBack={() => setOpenUnit(null)} startTransition={startTransition} currency={screen.summary.currency} />;

  return (
    <div className="flex flex-col gap-3">
      <ContractStrip screen={screen} />
      {!screen.hasUnits && (
        <p className="text-sm text-muted-foreground">
          No SPK marked yet, so the WBS roots stand in. Mark one in the planner to report on it separately.
        </p>
      )}
      {screen.units.map((u) => (
        <UnitCard key={u.id} unit={u} currency={screen.summary.currency} onOpen={() => setOpenUnit(u.id)} />
      ))}
    </div>
  );
}
```

Tiga sub-komponen di berkas yang sama, dengan tanda tangan persis ini supaya tidak ada yang ditebak:

```tsx
function ContractStrip({ screen }: { screen: WeightsScreen }): JSX.Element;

function UnitCard({
  unit,
  currency,
  onOpen,
}: {
  unit: WeightsUnit;
  currency: string;
  onOpen: () => void;
}): JSX.Element;

function UnitRows({
  unit,
  typed,
  setTyped,
  onBack,
  startTransition,
  currency,
}: {
  unit: WeightsUnit;
  typed: Record<string, number | null>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  onBack: () => void;
  startTransition: React.TransitionStartFunction;
  currency: string;
}): JSX.Element;
```

`ContractStrip` menampilkan tiga hal dari `screen.summary` dan tidak menghitung apa pun sendiri:

```tsx
<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
  <strong className="text-lg font-semibold tabular-nums">
    {formatMoney(screen.summary.contractValue, screen.summary.currency)}
  </strong>
  {screen.summary.gap > 0 && (
    <span className="text-sm text-muted-foreground">
      {formatMoney(screen.summary.gap, screen.summary.currency)} has no price on it yet
    </span>
  )}
  <span className="text-sm tabular-nums text-muted-foreground">
    Weights total {screen.summary.derivedTotal.toFixed(2)}%
  </span>
</div>
```

Total itu harus selalu terbaca `100.00`. Kalau tidak, itu bug di sini, bukan tugas orang yang memakainya.

`UnitCard` menampilkan dua bobot dan sejauh mana unitnya berharga:

```tsx
<Card size="sm" className="cursor-pointer" onClick={onOpen}>
  <CardContent className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="truncate font-semibold">{unit.code} {unit.name}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {unit.unitValue != null ? formatMoney(unit.unitValue, currency) : 'No value yet'}
        {' · '}
        {unit.pricedRows} of {unit.totalRows} rows priced
      </p>
    </div>
    <span className="shrink-0 text-lg font-semibold tabular-nums">
      {unit.bobotOverall.toFixed(2)}%
    </span>
  </CardContent>
</Card>
```

`UnitRows` merender daftar barisnya. Kolom harganya, per baris:

```tsx
<input
  type="text"
  inputMode="numeric"
  defaultValue={row.price ?? ''}
  onChange={(e) => onPrice(row.id, e.target.value)}
  // Native, not shadcn's Input-with-Radix siblings: this list can exceed 20
  // rows and Radix costs are per mounted instance, not per library.
  className="min-h-11 w-full rounded-lg border bg-background px-3 text-right text-sm tabular-nums"
  aria-label={`Price for ${row.name}`}
/>
```

dan di sebelahnya **dua bobot**, plus label untuk baris yang tidak diketik. Dua, bukan satu: sheet aslinya membawa `WF per SPK` dan `WF Overall` sebagai dua kolom karena itu dua pertanyaan berbeda, dan orang yang membaca laporan per-SPK di sebelah laporan overall harus bisa mencocokkan keduanya.

```tsx
<div className="flex shrink-0 flex-col items-end">
  <span className={cn('text-sm font-semibold tabular-nums', row.fromGap && 'text-muted-foreground')}>
    {liveInUnit(row).toFixed(2)}%
  </span>
  <span className="text-xs tabular-nums text-muted-foreground">
    {liveOverall(row).toFixed(2)}% of project
  </span>
</div>
{row.fromGap && <Badge variant="secondary">even share</Badge>}
```

Judul kolomnya menyebut keduanya sekali di atas daftar, jadi angka kecil di bawah tidak perlu mengulang kata "in {unit.code}":

```tsx
<div className="flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">
  <span>Price</span>
  <span>Weight in {unit.code} / of project</span>
</div>
```

`liveInUnit` dan `liveOverall` membaca `row.bobotInUnit` / `row.bobotOverall` selama baris itu belum diketik, dan hasil `deriveWeights` di klien begitu sudah. Keduanya berasal dari SATU pemanggilan `deriveWeights` per ketikan, bukan dua.

Penulisan ke server dengan debounce ~1 detik setelah orang berhenti mengetik, pola yang sudah dipakai `DataOverallWorkbench` — salin pendekatannya dari sana, jangan menemukan yang baru:

```bash
grep -n "setTimeout\|debounce\|useRef<ReturnType" components/weekly/DataOverallWorkbench.tsx | head
```

```tsx
startTransition(async () => {
  const res = await updateRowTextAction(rowId, 'price', raw);
  if (!res.ok) setError(res.error);
});
```

Bobot hidup dihitung dengan memanggil `deriveWeights` lagi di klien atas salinan `nodes` yang harganya sudah ditimpa `typed`. Supaya itu mungkin, `WeightsScreen` sudah membawa semua barisnya; jangan menambah bacaan server untuk ini.

- [ ] **Step 3: Daftarkan tabnya**

Di `components/weekly/WeekTabs.tsx`, tambahkan ke `GROUPS.progress`:

```ts
    { key: 'weights', label: 'Weights', short: 'Weights', printable: false },
```

`printable: false` bukan pilihan gaya. Tab yang mengaku printable tanpa punya lembar di `app/print/weekly/[week]/page.tsx` membuat `lib/pdf.ts` menunggu selector `.print-sheet-a4` yang tidak pernah datang, jadi permintaan PDF-nya MENGGANTUNG, bukan gagal.

Ini membuat `weights` ikut ke `ALL`, sehingga tab aktif terdeteksi benar dan rutenya ikut di-prefetch. Pintu masuk yang terlihat baru dipasang di Task 4.

- [ ] **Step 4: Periksa tipe**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
```

Expected: `exit=0`.

- [ ] **Step 5: Lihat gambarnya, tiga keadaan**

Rutenya belum punya tombol, jadi buka langsung lewat URL.

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/weights .tmp/t3-weights-desktop.png 1280 900
node scripts/shoot.mjs http://localhost:3000/weekly/43/weights .tmp/t3-weights-390.png 390 844
```

Yang harus terlihat, dan **benar-benar dilihat, bukan diasumsikan**: kartu unit terbaca di 390px tanpa nama yang terpotong jadi "Relok…"; kolom harga setinggi 44px; angka bobot rata kanan dan `tabular-nums` sehingga digitnya sejajar antar baris; baris "even share" jelas berbeda dari baris berharga tanpa mengandalkan warna saja.

Untuk keadaan kosong, buka proyek yang belum punya harga sama sekali dan foto lagi. Untuk Gundih (`legacyJsonId`), foto juga — yang harus muncul adalah kalimat `LegacyGate`, bukan layar kosong.

- [ ] **Step 6: Commit**

```bash
git diff tsconfig.json
git add "app/weekly/[week]/weights/page.tsx" components/weekly/WeightsWorkbench.tsx components/weekly/WeekTabs.tsx
git commit -m "A project made in the app had no way to say what its work was worth

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Pintu masuk Weights, dan tombol Derive

**Files:**
- Modify: `components/weekly/WeekTabs.tsx:180-195` (kelompok aksi kanan)
- Create: `components/weekly/DeriveWeightsDialog.tsx`
- Modify: `components/weekly/WeightsWorkbench.tsx` (memasang tombolnya)
- Modify: `components/projects/ValueStrip.tsx` (komentar saja)

**Interfaces:**
- Consumes: `previewWeightsAction(projectId)` dan `applyWeightsAction(projectId)` dari `lib/weights-actions.ts`; tipe `WeightPreview` dari berkas yang sama.
- Produces: tidak ada API baru.

- [ ] **Step 1: Pil Weights di header**

Di `WeekTabs`, kelompok aksi kanan (`col-start-2 row-start-1 flex shrink-0 …`), sebelum tombol "Set as Current":

```tsx
{!onReport && (
  <PressLink
    href={`/weekly/${selectedWeek}/weights`}
    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm font-medium transition-colors duration-300 ease-ios hover:bg-accent"
    title="Prices and weights for this project"
  >
    <Scale className="h-4 w-4" />
    <span className="hidden sm:inline">Weights</span>
  </PressLink>
)}
```

`Scale` diimpor dari `lucide-react`. `PressLink` sudah diimpor di berkas ini. Di bawah `sm` labelnya hilang dan tinggal ikonnya, pola yang sudah dipakai tombol Set-as-Current pada baris yang sama.

Dia sengaja di luar `WeekSteps`: stepper adalah urutan yang dikerjakan tiap minggu, dan ini bukan.

- [ ] **Step 2: Ukur barisnya di 390px SEBELUM apa pun ditambahkan lagi**

Header ini yang tanggal 10 September 2026 dikeluhkan "g rapih", jadi ini gerbangnya, bukan formalitas.

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t4-header-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t4-header-desktop.png 1280 900
```

Yang harus benar: pemilih minggu tidak menyusut, pil Weights dan tombol Set-as-Current tidak saling menabrak, dan tidak ada yang meluber ke luar layar. **Kalau sesak di 390px, JANGAN dipaksakan** — pindahkan pintu masuknya ke badan halaman Fill in sebagai kartu sendiri (cadangan yang sudah disebut spec) dan biarkan header seperti semula. Catat pilihannya di pesan commit.

- [ ] **Step 3: Dialog preview**

`components/weekly/DeriveWeightsDialog.tsx`. Dialog menarik Radix, jadi dia dimuat lewat `next/dynamic` dari `WeightsWorkbench`:

```tsx
const DeriveWeightsDialog = dynamic(() => import('./DeriveWeightsDialog'), { ssr: false });
```

Isinya membaca `WeightPreview` apa adanya, tanpa menghitung ulang apa pun:

```tsx
<p>
  {preview.changes} of {preview.leaves} rows would move. Total {preview.storedTotal.toFixed(2)}% becomes {preview.derivedTotal.toFixed(2)}%.
</p>
{preview.basis !== 'boq' && (
  <p className="text-warn">
    Prices reach {preview.covers} of {preview.leaves} rows. The rest take an even share, so this plan is not value based yet.
  </p>
)}
<ul>
  {preview.biggest.map((b) => (
    <li key={b.code}>
      {b.code} {b.name}: {b.before?.toFixed(2) ?? 'none'} to {b.after?.toFixed(2) ?? 'none'}
    </li>
  ))}
</ul>
```

Tombol Apply memanggil `applyWeightsAction(projectId)`, lalu `router.refresh()`.

- [ ] **Step 4: Perbarui komentar ValueStrip**

`components/projects/ValueStrip.tsx` baris 25: kalimat *"`lib/weights-actions.ts` and the summary this component still reads are untouched, and are what Data Overall will pick up"* sekarang sudah lampau. Ganti jadi menyebut di mana tombol itu berada sekarang:

```
 * The button that derives weights from prices now lives on Data Overall's
 * Weights screen (`/weekly/[week]/weights`), which is where prices are typed.
 * This line keeps the one question it was always answering first: how much is
 * this contract worth.
```

Tidak ada kode yang berubah di berkas ini.

- [ ] **Step 5: Buktikan preview tidak menulis apa pun**

Buka layar Weights, tekan Derive, TUTUP dialognya tanpa Apply, lalu:

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-weights.ts; echo "exit=$?"
```

Expected: `exit=0` dan total tersimpan tidak berubah. `previewWeightsAction` memang tidak menulis; ini memastikan tidak ada yang tidak sengaja memanggil `apply`.

- [ ] **Step 6: Periksa tipe, foto, commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
node scripts/shoot.mjs http://localhost:3000/weekly/43/weights .tmp/t4-derive-390.png 390 844
git diff tsconfig.json
git add components/weekly/WeekTabs.tsx components/weekly/DeriveWeightsDialog.tsx components/weekly/WeightsWorkbench.tsx components/projects/ValueStrip.tsx
git commit -m "Deriving weights from prices was two taps deep behind a panel the planner no longer has

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Kartu pemandu di Fill in

**Files:**
- Create: `components/weekly/SetupGuideCard.tsx`
- Modify: `app/weekly/[week]/overall/page.tsx`

**Interfaces:**
- Consumes: `getWeightSummary(projectId)` dari `lib/weights-read.ts`; `buildWorklist()` yang SUDAH dipanggil halaman ini; `getOpenProject()`.
- Produces: `<SetupGuideCard step={…} count={…} href={…} />` — server component, tidak ada state.

- [ ] **Step 1: Tentukan kartunya di server, bukan di klien**

Di `DataOverallPageBody`, setelah `worklist` dibangun. Urutannya adalah urutan ketergantungannya: tidak ada gunanya menimbang rencana yang belum punya baris.

```tsx
const open = await getOpenProject();
const summary = open && !open.legacyJsonId ? getWeightSummary(open.id) : null;

const guide =
  summary == null
    ? null
    : summary.leaves === 0
      ? { title: 'Lay out the work first', body: 'This project has no WBS rows yet.', cta: 'Open the planner', href: `/projects/${open!.id}` }
      : summary.basis !== 'boq' && summary.wouldChange > 0
        ? {
            title: `${summary.leaves} rows are not weighted from prices yet`,
            body: 'Every row counts the same until prices say otherwise, so the report cannot tell big work from small.',
            cta: 'Set prices and weights',
            href: `/weekly/${week}/weights`,
          }
        : worklist.due.length > 0
          ? { title: `Week ${week} has ${worklist.due.length} items waiting`, body: 'The schedule says these are due and they have not been dealt with.', cta: 'Jump to the list', href: '#worklist' }
          : null;
```

Dua syarat pada kartu bobot, dan keduanya perlu. `basis !== 'boq'` sendirian akan memunculkan kartu SELAMANYA pada proyek yang harganya memang tidak pernah menutupi seluruh rencana, dan kartu yang tidak bisa dihilangkan lebih buruk daripada tidak ada kartu. `wouldChange > 0` yang membuatnya bisa selesai.

Kartu "tanggal kosong" dari spec tidak dipasang di sini: `WeightSummary` tidak membawa hitungan tanggal, dan menambah bacaan baru untuk satu kartu tidak sepadan. Dicatat di bagian Pertanyaan terbuka rencana ini.

- [ ] **Step 2: Komponennya**

`components/weekly/SetupGuideCard.tsx`. Kartu penuh dengan tombol yang benar-benar bisa ditekan — bukan baris abu-abu. Konten yang kalem terbaca hilang oleh pemilik aplikasi ini, dan itu sudah dicatat sebagai temuan berulang.

```tsx
import { PressLink } from '@/components/motion/Press';
import { Card, CardContent } from '@/components/ui/card';

export default function SetupGuideCard({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <Card size="sm" className="animate-enter border-chart-1/40 bg-chart-1/5">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
        <PressLink
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-chart-1 px-4 py-2 text-sm font-medium text-white"
        >
          {cta}
        </PressLink>
      </CardContent>
    </Card>
  );
}
```

`Card` membawa `py-(--card-spacing)` sendiri, jadi kalau `CardContent` di sini diberi padding vertikal sendiri, oper `py-0` pada `Card` supaya tidak dobel.

- [ ] **Step 3: Pasang di halaman**

Di atas grid empat kartu statistik, di dalam `Reveal` sendiri:

```tsx
{guide && (
  <Reveal delay={MOTION.stagger}>
    <SetupGuideCard {...guide} />
  </Reveal>
)}
```

dan naikkan `delay` `Reveal` di bawahnya satu tingkat supaya urutan masuknya tetap berurutan.

- [ ] **Step 4: Foto ketiga keadaannya**

Ini yang menentukan apakah kartunya berguna atau jadi perabot.

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t5-guide-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t5-guide-desktop.png 1280 900
```

Tiga keadaan yang harus dilihat: proyek baru tanpa harga (kartu bobot muncul), proyek yang sudah dikunci `boq` dengan minggu terisi (**tidak ada kartu sama sekali** — ini yang paling penting), dan proyek dengan pekerjaan menunggu (kartu minggu).

Kalau kartu muncul pada proyek yang sudah beres, syarat di Step 1 salah. Perbaiki sebelum lanjut.

- [ ] **Step 5: Periksa tipe dan commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
git diff tsconfig.json
git add components/weekly/SetupGuideCard.tsx "app/weekly/[week]/overall/page.tsx"
git commit -m "A project with no weights looked finished and said nothing about it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Angka yang menjelaskan dirinya

**Files:**
- Create: `components/weekly/ExplainSheet.tsx`
- Modify: `app/weekly/[week]/overall/page.tsx` (empat kartu statistik)
- Modify: `components/weekly/DataOverallWorkbench.tsx` (bobot per baris)

**Interfaces:**
- Consumes: `grandTotal` (`targetWF`, `curProgressPct`, `thisWeekProgressPct`, `variance`) yang sudah dibaca halaman ini; `RollupNode` untuk baris.
- Produces: `<ExplainSheet label={…} value={…} formula={…} note={…} />`.

- [ ] **Step 1: Panelnya**

`components/weekly/ExplainSheet.tsx`. Sekali tap membuka, sekali tap menutup, terbaca di 390px. **Bukan tooltip** — tidak ada informasi di aplikasi ini yang boleh hanya muncul saat hover.

Pakai panel baris yang sudah ada di `DataOverallWorkbench` sebagai acuan bentuk, jangan menemukan pola baru:

```bash
grep -n "panel\|Panel\|expanded\|setOpen" components/weekly/DataOverallWorkbench.tsx | head -20
```

- [ ] **Step 2: Empat kartu statistik jadi bisa ditap**

Struktur `stats` di `overall/page.tsx` sudah berupa array objek. Tambahkan satu field:

```tsx
const stats = [
  {
    label: 'Plan',
    value: grandTotal.targetWF,
    tone: 'text-chart-2',
    sub: undefined as string | undefined,
    explain: 'Target for this week. Added up from each row’s own dates, never typed.',
  },
  {
    label: 'Actual',
    value: grandTotal.curProgressPct,
    tone: 'text-chart-1',
    sub: undefined,
    explain: 'The sum of weight times percent done, across every row.',
  },
  {
    label: 'Added this week',
    value: grandTotal.thisWeekProgressPct,
    tone: 'text-ok',
    sub: undefined,
    explain: 'What moved this week alone, not the running total.',
  },
  {
    label: 'Deviation',
    value: grandTotal.variance,
    tone: 'text-deviation',
    sub: grandTotal.variance < 0 ? 'behind plan' : grandTotal.variance > 0 ? 'ahead of plan' : 'on plan',
    explain: 'Actual minus Plan.',
  },
];
```

Kartunya membungkus isinya dengan `ExplainSheet`. Perhatikan: `AnimatedNumber` di dalamnya tetap seperti sekarang, dan tidak ada `motion.div` dengan prop `initial` yang ditambahkan — animasi masuk halaman di sini adalah keyframe CSS.

- [ ] **Step 3: Bobot per baris di workbench**

Di baris workbench, angka bobotnya jadi bisa ditap dan membuka satu kalimat:

```
3.42% of the project, and this row is 60% done, so it has contributed 2.05%.
```

Angkanya dihitung dari data yang sudah ada di baris itu (`node.bobot` dan persen dari `pctOf`) — jangan menambah bacaan server.

`DataOverallWorkbench.tsx` sudah 1988 baris. Jangan menambah blok besar ke dalamnya: taruh kalimatnya di `ExplainSheet` dan panggil dari sana.

- [ ] **Step 4: Foto dua-duanya, dua ukuran**

```bash
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t6-explain-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/weekly/43/overall .tmp/t6-explain-desktop.png 1280 900
```

Yang harus benar: panel terbuka tidak menggeser kartu di sebelahnya sehingga baris statistiknya melompat; kalimatnya utuh di 390px tanpa terpotong; dan panel bisa ditutup dengan tap yang sama.

- [ ] **Step 5: Periksa tipe dan commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
git diff tsconfig.json
git add components/weekly/ExplainSheet.tsx "app/weekly/[week]/overall/page.tsx" components/weekly/DataOverallWorkbench.tsx
git commit -m "Nobody could ask a number where it came from

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Gerbang terakhir

Tidak menambah fitur. Ini yang membuktikan seluruhnya benar-benar berdiri.

- [ ] **Step 1: Semua skrip verifikasi**

```bash
for s in weights weights-auto weights-screen worklist plan-curve sheet-columns; do
  echo "--- $s"
  node --import ./scripts/ts-resolve.mjs scripts/verify-$s.ts > /dev/null 2>&1; echo "exit=$?"
done
```

Expected: semuanya `exit=0`.

- [ ] **Step 2: `next build`, ke berkas, lalu `echo $?`**

Jangan lewat pipe. `next build | grep` melaporkan exit code milik grep, dan dua kegagalan build dalam riwayat fitur ini hanya muncul di sini.

```bash
npx next build > build.log 2>&1; echo "exit=$?"; tail -40 build.log
```

Expected: `exit=0`. Kegagalan yang paling mungkin dan artinya:
- *"Uncached data was accessed outside of `<Suspense>`"* — ada bacaan tak-ter-cache di badan halaman Weights yang tidak berada di balik `LegacyGate`.
- Kegagalan validasi `unstable_instant` menyebut sebuah searchParam — halaman Weights membaca searchParam yang tidak didaftarkan di `samples`.

- [ ] **Step 3: PDF masih utuh**

Tab baru menyentuh `WeekTabs`, dan itu berkas yang memutuskan tombol PDF menunjuk ke mana. Bagian ini yang paling sering regresi.

```bash
curl -s -o .tmp/w43.pdf -w "%{http_code}\n" "http://localhost:3000/api/pdf/weekly/43?only=summary"
node -e "const b=require('fs').readFileSync('.tmp/w43.pdf').toString('latin1');console.log('pages:',(b.match(/\/Type\s*\/Page[^s]/g)||[]).length)"
```

Expected: `200`, dan jumlah halaman sama dengan jumlah `.print-sheet-a4` yang dirender Summary. Hitung `/Type /Page`, BUKAN `/Count` — yang terakhir juga muncul pada simpul page-tree.

Lalu tekan tombol Save yang sebenarnya SEKALI, segera setelah React menghidrasinya, dan pastikan tombolnya berjalan Save as PDF → Preparing PDF… → Saved! dan berkasnya mendarat.

- [ ] **Step 4: Bersihkan berkas kerja**

```bash
rm -f tsconfig.verify.json tsc.log build.log
git status --short
```

Expected: tidak ada berkas kerja yang tertinggal sebagai untracked, dan `tsconfig.json` bersih.

- [ ] **Step 5: Laporkan, jangan langsung push**

Sebutkan: berapa task selesai, apa yang berubah dari rencana ini dan kenapa (terutama kalau pintu masuk Weights turun ke badan halaman di Task 4 Step 2), dan gambar mana yang sudah dilihat. Tanya dulu sebelum push atau merge.

---

## Pertanyaan terbuka yang ditinggalkan rencana ini

- **Kartu pemandu "tanggal kosong" tidak dipasang.** `WeightSummary` tidak membawa hitungan leaf tanpa tanggal, dan menambah bacaan server baru untuk satu kartu tidak sepadan sekarang. Kalau nanti diinginkan, sumbernya adalah baris sheet proyek, bukan `WeightSummary`.
- **`unitContractValue` dan `price` bisa berpisah.** `setReportingUnitAction` menulis keduanya waktu unit ditandai, tapi mengetik ulang harga unit lewat kolom harga biasa hanya mengubah `price`. Layar Weights saat ini menampilkan `unitContractValue ?? price`, yang benar untuk dibaca tapi tidak menyembuhkan perpisahannya. Perlu keputusan sendiri: apakah mengetik harga pada baris unit juga harus memperbarui `unitContractValue`.
- **Rute `/weekly/` → `/data-overall/`** ditunda dengan sengaja. Lihat keputusan 2 di spec.
