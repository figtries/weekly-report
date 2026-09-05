# Projects sebagai tumpuan pertama — desain

Tanggal: 5 September 2026 · Cabang: `v2-foundation` · Papan nomor 16 (irisan A)

## Tujuan

Projects harus jadi tempat pertama yang orang buka: menyimpan proyek, memilih
salah satunya, dan membuat yang baru. Hari ini tidak satu pun dari ketiganya
berjalan benar.

`/portfolio` bukan tempat mengurus proyek — ia laporan **tentang** proyek. Tabel
uang sembilan kolom untuk dibaca direksi, dengan tombol Switch dan Delete
dijejalkan ke satu sel yang menempel di tepi kanan, dan Setup sebagai tab
tetangga seolah ia tempat sejajar. Tidak ada arsip, tidak ada pencarian, tidak
ada duplikat, tidak ada tanda kapan sebuah proyek terakhir disentuh, dan tidak
ada satu halaman pun yang menjawab "proyek ini isinya apa".

Dan memilih proyek hanya memindahkan setengah aplikasi: `PROJECT_ID = 'gundih'`
ditulis tangan di empat berkas, jadi Document Control tetap menampilkan Gundih
apa pun yang dipilih.

Yang dibangun di irisan A: halaman daftar yang benar, halaman rumah per proyek,
alur membuat proyek yang menghasilkan proyek hidup, dan satu penunjuk proyek
aktif yang diikuti seluruh aplikasi.

## Konsepnya: Microsoft Project, dikurangi yang jelek

Ditetapkan bersama pengguna 5 September 2026. Yang membuat MS Project kuat
adalah gagasannya — pekerjaan punya urutan, dan urutan itu yang menentukan kapan
proyek selesai. Yang membuatnya dibenci adalah tiga hal spesifik, dan ketiganya
bisa dibuang:

1. **Semua tautan harus digambar tangan lebih dulu**, dan sebelum itu selesai ia
   tidak memberi apa-apa. Dibalik: **aplikasi yang menebak, orang yang
   mengiyakan.** Datanya sudah bercerita — di Gundih `1.3.1.2.1.3.2` PO Unprice
   selesai 11 Jan 2026 dan `1.3.1.2.1.3.3` Manufacturing Process mulai 12 Jan,
   satu induk, menempel persis. Rantai itu sudah ada di kepala orang yang
   menyusun jadwal; ia hanya tidak pernah dituliskan sebagai hubungan.
   Pertanyaannya berbentuk kalimat: *"Manufacturing Process sepertinya menunggu
   PO Unprice. Betul?"* → Iya / Bukan.
2. **Pergeseran terjadi diam-diam** dan tidak ada yang tahu apa yang barusan
   berubah. Dibalik: **tidak ada yang berjalan sebelum akibatnya dilihat.**
   "6 pekerjaan ikut mundur. Selesai proyek 15 Des → 24 Des." Terapkan atau
   batal.
3. **Tampilannya spreadsheet berisi baris kecil-kecil.** Ini sudah jadi aturan di
   repo ini: ringkasan dulu, baru turun ke detail.

**Keputusan 15 pada papan v2 — "Planner has NO dependencies" — dicabut.** Ia
dikunci 27 Agustus 2026 dengan alasan jadwal Gundih tidak memakai satu pun relasi
FS/SS. Alasan itu masih benar sebagai pembacaan data, tapi kesimpulannya salah:
relasi itu tidak ada **sebagai kolom**, ia ada **sebagai tanggal yang menempel**.
Mesin dependency-nya sendiri adalah irisan C, bukan pekerjaan ini — yang dicabut
sekarang adalah larangannya, supaya sesi lain tidak membangun di atas aturan yang
sudah mati. `AGENTS.md`, memori blueprint, dan artefak rencana diperbarui
**setelah spec ini disetujui** — bukan bersama commit ini, supaya aturan repo
tidak terlanjur berubah kalau desainnya masih direvisi.

## Keadaan hari ini — dibaca 5 September 2026

### Dua penyimpanan berjalan berdampingan, dan Gundih ada di dua-duanya

| | `data/db.json` | `data/report.db` (SQLite v2) |
|---|---|---|
| proyek | 2 — `p-utama` (Gundih), `pmtmlf3jfnec1` ("adasd") | 1 — `gundih` |
| baris WBS | 285 | 285 (`wbs_nodes`) |
| **tanggal per baris** | **tidak ada** | 570 (`node_schedules`) |
| baseline | — | 2 (`gundih:contractual`, `gundih:active`) |
| unit pelaporan | tidak ada | 4 (`is_reporting_unit`) |
| minggu | 60 | 60 (`weeks`) |
| progress per leaf | di `weeks[].leafData` | 7.568 (`leaf_progress`) |
| dokumen | — | 454 dok · 512 tahap · 108 transmittal · 119 kategori |

`db.json` menghidupi Dashboard, Weekly, Daily, Klaim, Portfolio dan Setup.
SQLite hanya menghidupi Document Control dan importer.

**Planner dan Gantt mustahil di atas `db.json`.** `WbsItem` (`lib/types.ts:19`)
berisi kode, deskripsi, bobot, volume, satuan, urutan — dan tidak satu pun
tanggal. Tidak ada yang bisa digambar sebagai batang di kalender. Fakta tunggal
inilah yang memaksa keputusan 3 di bawah.

### Angka-angkanya selamat pindah ke SQLite

Diverifikasi dengan query langsung, bukan diperkirakan:

```
SUM(leaf_progress.cum_progress_pct × wbs_nodes.bobot) / 100   →  W43 = 80,0365%
SUM(wbs_nodes.bobot) WHERE is_leaf                            →  100,000000
```

80,04% adalah angka aktual W43 yang sama dengan yang dicatat `AGENTS.md` untuk
importer nomor 06. Kurva rencana datang dari `lib/plan-curve.ts`, yang fungsinya
murni (`planCurve(leaves, weekEndsISO)`) dan tidak tahu-menahu soal penyimpanan —
ia cukup disuapi `node_schedules` + `wbs_nodes.bobot` + `weeks.end_date`. Jadi
tampilan Angka tidak perlu dikorbankan.

### Gundih adalah empat SPK, bukan satu kontrak

```
SPK-002  WBS 1.2        418.400,00
SPK-003  WBS 1.3      2.821.067,281925
SPK-004  WBS 1.4      1.837.809,00
SPK-007  WBS 1.4.4      842.723,72448
                     ─────────────────
                      5.920.000,006405   = projects.contract_value, persis
```

`unit_contract_value` sudah terisi benar pada keempat unit. `unit_contract_no`
**kosong pada keempatnya** — importer tidak pernah mengisinya. Sementara
`projects.contract_no` memuat keempat nomor sebagai satu string dipisah koma:
`002/PPC60000/2025-SO, 003/PPC60000/2025-SO, 004/PPC60000/2025-SO,
007/PPC62300/2025-SO`. Pasangannya mekanis — angka depan nomor cocok dengan angka
label SPK.

### Dua cacat yang sudah tayang hari ini

1. **Mata uang Gundih adalah USD** (`projects.currency = 'USD'`), sementara
   `app/portfolio/page.tsx` mencetak nilainya lewat `formatRupiah()`. Kontrak
   $5,92 juta tampil sebagai "Rp 5.920.000".
2. **Document Control tidak ikut berpindah proyek.** `PROJECT_ID = 'gundih'`
   ditulis tangan di `app/dokumen/[week]/layout.tsx:8`,
   `app/dokumen/[week]/summary/page.tsx:11`,
   `app/dokumen/[week]/data/page.tsx:10` dan
   `app/api/register/export/route.ts:24`.

### Tidak ada autentikasi sama sekali

Tidak ada `next-auth`, tidak ada session, tidak ada `auth()`. Tabel `users` dan
`memberships` sama-sama 0 baris. Karena itu "Tim & peran" — yang ikut dipilih
pengguna sebagai isi subpage — **ditunda**: tanpa login ia hanya daftar nama yang
tidak menjaga apa pun. Itu papan nomor 22.

## Sepuluh keputusan

Semuanya disetujui pengguna satu per satu, 5 September 2026.

**1. Projects adalah lapisan sendiri.** Mengklik proyek tidak melempar orang ke
Dashboard; ia masuk ke rumah proyek itu.

```
/projects            daftar — cari, buat, pilih, arsipkan
/projects/[id]       rumah satu proyek — ikhtisar + pengaturan
```

Irisan B dan C menambah tab di bawah `/projects/[id]/`: `planner`, `timeline`,
`baseline`. Rutenya dibentuk sekarang supaya tidak ada yang dibongkar nanti.

**2. `/portfolio` dialihkan ke `/projects`, dan tabel uangnya jadi tampilan kedua
di sana.** Satu halaman, dua cara memandang, satu sakelar: **Kartu** (bawaan —
untuk memilih dan mengurus) dan **Angka** (tabel lintas-proyek untuk dibaca
direksi). Dua halaman yang sama-sama mengaku "daftar proyek" adalah masalah yang
sedang diperbaiki, bukan pola yang diteruskan. Redirect dipakai, bukan
penghapusan, supaya tautan yang sudah beredar tidak mati. Tab `PROJECT_TABS`
(`Portfolio | Setup`) dihapus — Setup adalah tindakan pada satu proyek, bukan
tetangga daftar proyek.

**3. SQLite jadi sumber tunggal daftar proyek.** Penunjuk proyek aktif pindah ke
tabel baru `app_state`, dan dibaca lewat **satu** fungsi `getActiveProjectId()`.

Yang ditolak dan alasannya:

- **Cookie per-browser** — membaca cookie adalah bacaan dinamis; di bawah
  `cacheComponents: true` ia memaksa `<Suspense>` mengelilingi setiap bacaan di
  aplikasi. Tembok itu sudah ditabrak dua kali (lihat `AGENTS.md`). Dan tanpa
  login, "per orang" belum berarti apa-apa.
- **Id proyek pada semua rute** (`/p/[id]/weekly/…`) — paling benar dan paling
  ramah cache, tapi itu mengganti nama tiap rute di aplikasi. Menaruh bacaannya
  di satu fungsi membuat perpindahan itu, kalau nanti diambil, menyentuh satu
  berkas dan bukan empat puluh halaman.

**4. Membuka bukan memilih.** `/projects/[id]` boleh diintip bebas; yang
memindahkan seluruh aplikasi hanya tombol **"Buka proyek ini"**. Penunjuknya
global dan belum ada login — kalau sekadar melihat proyek tetangga ikut
memindahkan konteks orang yang sedang mengisi laporan, itu jebakan.

**5. Kartu proyek menyeimbangkan identitas dan angka.** Separuh atas: nama utuh,
klien, kontrak, nilai + mata uang, rentang tanggal. Separuh bawah: batang
aktual-vs-rencana, minggu ke-N dari M, deviasi. Kartu **tidak pernah** mencetak
empat nomor SPK berjejer: satu kontrak ditulis nomornya, lebih dari satu ditulis
`4 SPK` dan nomor lengkapnya tinggal di halaman proyek. Dua koreksi yang menyertainya,
keduanya soal kebenaran:

- Di 390px separuh angka menjadi **satu jalur mendatar** yang rapat; di desktop ia
  melebar jadi tiga kolom. Kartu setinggi dua blok penuh hanya memuat satu
  setengah kartu per layar ponsel.
- Proyek yang belum disiapkan **tidak menampilkan 0,00% merah**. Separuh angkanya
  diganti "Belum disiapkan → Siapkan sekarang", satu kontrol yang bisa ditekan.
  Proyek baru harus terlihat *kosong*, bukan *rusak* — itulah yang terjadi pada
  "adasd" hari ini.

**6. Proyek punya banyak SPK, dan nilai proyek adalah jumlahnya.** Blok Kontrak
menjadi daftar: tiap SPK dengan nomor, nilai, dan node WBS tempatnya menempel.
`contract_value` **dihitung** dari jumlah `unit_contract_value`, tidak diketik —
filosofi yang sama dengan bobot yang diturunkan dari harga BOQ. Sebuah backfill
sekali jalan memecah string koma itu ke `unit_contract_no`; hasilnya
**ditampilkan untuk dicek manusia sebelum ditulis**, karena pencocokan
002→SPK-002 adalah heuristik khas Gundih, bukan aturan umum.

**7. Membuat proyek adalah satu layar, enam isian.** Nama · klien · kontraktor ·
mulai · selesai · mata uang. Bukan wizard bertahap. Cukup untuk membangkitkan
baris-baris `weeks` dari tanggalnya, sehingga proyeknya langsung hidup: bisa
dibuka, bisa dinavigasi, dan kurva rencananya bisa diturunkan begitu WBS-nya ada.
WBS, harga dan baseline tidak diminta di sini — itu Planner, irisan B, dan
halaman proyeklah yang mengatakan "lanjutkan di sini".

**Nilai kontrak juga tidak diminta**, dan itu konsekuensi langsung keputusan 6:
nilai proyek adalah jumlah SPK-nya, jadi ia lahir kosong dan terisi sendiri
begitu SPK pertama ditambahkan di halaman proyek. Proyek baru menampilkan "—",
bukan "Rp 0" — nol adalah pernyataan, kosong adalah kejujuran.

Yang ditolak: satu kotak nama saja (menghasilkan "adasd" — proyek tanpa tanggal
tidak bisa punya minggu, tidak bisa punya kurva, tidak bisa dibuka jadi apa-apa)
dan wizard 5 langkah (menulis ulang editor WBS + harga BOQ di atas SQLite
sekarang, yang membengkakkan irisan A jadi dua kali lipat).

**8. Halaman v1 mendapat panel jujur, bukan angka orang lain.** Kolom sementara
`legacy_json_id` pada `projects`; Gundih diisi `'p-utama'`, proyek baru mana pun
`null`. Dashboard, Weekly, Daily dan Klaim membacanya: ada isinya berarti aman,
`null` berarti tampilkan panel — *"Proyek [X] belum punya laporan mingguan"* —
dengan dua tombol nyata: **Susun WBS proyek ini** dan **Kembali ke Gundih**.

Yang ditolak: menampilkan angka Gundih di bawah spanduk peringatan (menaruh angka
salah di layar dan berharap orang membaca spanduknya), dan meredupkan entri
sidebar (aplikasi yang separuhnya mati, tanpa memberi tahu apa yang harus
dilakukan). Aturan repo ini berlaku: yang diam terbaca sebagai hilang, jadi
keadaan kosong harus punya kontrol yang bisa ditekan.

Kolom itu **mati** ketika papan 08–14 selesai. Ia ditandai demikian di schema.

**9. "adasd" tidak dibawa.** SQLite mulai dengan Gundih saja. Datanya tetap utuh
di `db.json` — tidak ada yang dihapus, ia hanya tidak ikut pindah.

**10. Document Control ikut berpindah proyek.** Keempat `PROJECT_ID = 'gundih'`
diganti `getActiveProjectId()`. Proyek tanpa dokumen jatuh ke `EmptyRegister` yang
sudah ada, yang sejak 4 September sudah menawarkan jalan membangun register
sendiri, bukan perintah terminal.

## Bentuk layar

### `/projects` — daftar

Dari atas: judul + tombol **Proyek baru** · kotak cari (nama, klien, no. kontrak)
· sakelar **Kartu / Angka**.

**Tampilan Kartu.** Proyek yang sedang terbuka selalu paling atas dan ditandai
jelas — bukan chip abu-abu kecil seperti sekarang. Sisanya urut terakhir
disentuh. Arsip disembunyikan di balik tautan `Arsip (n)`. Tiap kartu punya
tombol **Buka proyek ini** dan menu `⋯`: Ganti nama · Duplikat · Arsipkan ·
Hapus. Belum ada proyek sama sekali → satu kartu besar "Bikin proyek pertama",
bukan tabel kosong.

**Tampilan Angka.** Kolomnya: Proyek · Minggu · Rencana · Aktual · Deviasi ·
Tertunda · Perkiraan selesai · Nilai kontrak · Status. Semuanya dari SQLite:
aktual dari agregat di atas, rencana dari `lib/plan-curve.ts`, tertunda = deviasi
× nilai kontrak, perkiraan selesai dari laju beberapa minggu terakhir (deret
aktual per minggu keluar dari satu `GROUP BY`, sudah diuji). Nilai dicetak dengan
mata uang proyeknya, bukan diasumsikan rupiah.

Pilihan tampilan diingat di `localStorage` — kenyamanan per-orang, bukan keadaan
yang harus bertahan.

### `/projects/[id]` — rumah proyek

Lima blok:

1. **Kepala** — nama utuh · klien · chip "Sedang dibuka" atau tombol "Buka proyek
   ini".
2. **Keadaan** — Minggu 43 dari 60 · aktual 80,04% vs rencana 75,37% · deviasi ·
   batang. Aktual biru `--chart-1`, rencana merah `--chart-2`, seperti di seluruh
   aplikasi.
3. **Identitas & kontrak** — klien, kontraktor, prefix nomor dokumen, mulai,
   selesai, durasi; lalu daftar SPK dengan nomor, nilai dan node WBS-nya, dan
   jumlahnya sebagai nilai proyek. Bisa diedit di tempat.
4. **Isi proyek** — 285 baris WBS (218 leaf, 67 cabang) · 4 unit pelaporan ·
   2 baseline · 454 dokumen · 60 minggu. Ini yang membuat orang percaya proyeknya
   berisi, dan tiap baris menjadi pintu ke irisan B dan C. Keseluruhan 285 node
   berjadwal di **kedua** baseline — itulah 570 baris `node_schedules`, bukan
   sebagian yang berjadwal dan sebagian tidak.
5. **Pengaturan** — ganti nama · duplikat · arsipkan · hapus, dengan konfirmasi
   yang **menyebut apa yang ikut hilang** ("285 baris WBS, 454 dokumen, 60 minggu
   progress"), bukan "Yakin?".

### Proyek baru

Satu layar, enam isian, satu tombol Simpan. Sesudahnya: langsung ke
`/projects/[id]` proyek itu, sudah terbuka, dengan blok Isi proyek yang jujur
kosong dan menunjuk ke langkah berikutnya.

## Perubahan data

Ketiganya jenis migrasi yang aman — satu tabel baru dan dua kolom nullable, yang
di SQLite menjadi `CREATE TABLE` dan `ALTER TABLE ADD COLUMN`. Yang berbahaya
adalah migrasi yang **membangun ulang** tabel yang sudah ada; itu yang menyeret
357 baris `doc_stages` ikut terhapus pada Agustus 2026. Tetap salin
`data/report.db` sebelum `drizzle-kit migrate`, dan hitung baris anaknya
sesudahnya.

```ts
// tabel baru — satu baris, penunjuk proyek yang sedang terbuka
export const appState = sqliteTable('app_state', {
  id: text('id').primaryKey().default('singleton'),
  activeProjectId: text('active_project_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  updatedAt: now(),
});

// projects bertambah dua kolom
updatedAt:    text('updated_at'),      // urutan "terakhir disentuh" di daftar
legacyJsonId: text('legacy_json_id'),  // SEMENTARA — mati saat papan 08-14 selesai
```

`onDelete: 'set null'` dipilih sengaja: menghapus proyek yang sedang terbuka
membuat penunjuknya kosong, dan `getActiveProjectId()` jatuh ke proyek pertama
yang tidak terarsip — persis perilaku `activeProject()` di `lib/workspace.ts:52`
hari ini, yang menolak membiarkan aplikasi jadi kosong.

Backfill sekali jalan: `gundih.legacy_json_id = 'p-utama'`,
`app_state.active_project_id = 'gundih'`, dan keempat `unit_contract_no` diisi
dari string koma **setelah hasilnya dicetak dan disetujui**.

## Yang TIDAK dibangun di irisan A

Pagar ini bagian dari desain. Papan v2 ada justru untuk mencegah pekerjaan
menyebar.

- Editor WBS, harga BOQ → bobot, mulai/selesai per baris, Gantt — **irisan B**
  (papan 17).
- Deteksi rantai, geser-dengan-pratinjau, baseline berversi — **irisan C**
  (papan 18 + dependency).
- Login, tim dan peran — **papan 22**. Tidak ada autentikasi untuk dibangun di
  atasnya.
- Wizard `/setup` **tidak ditulis ulang**. Ia dibiarkan utuh dan masih menulis ke
  `db.json`; ia hanya berhenti jadi tab tingkat atas dan ditautkan dari halaman
  proyek. Penggantinya adalah irisan B.
- Halaman v1 **tidak dipindahkan** ke SQLite. Mereka mendapat panel keputusan 8
  dan tidak lebih.

## Verifikasi

1. **`next build` hijau**, ditulis ke berkas lalu `echo $?` — jangan pernah lewat
   pipe, karena `next build | grep` melaporkan exit code grep. `cacheComponents`
   adalah bahaya nyata di sini: `app/layout.tsx` membaca daftar proyek, jadi jalur
   baca yang baru **harus** tetap ter-cache atau setiap rute di aplikasi gagal
   build di `/_not-found`.
2. **Hitung baris anak sesudah migrasi**: `doc_stages` 512 · `documents` 454 ·
   `leaf_progress` 7.568 · `node_schedules` 570 · `wbs_nodes` 285 · `weeks` 60.
   Angka yang sama sebelum dan sesudah, atau migrasinya dibatalkan.
3. **Angka tidak bergerak**: W43 tetap aktual 80,04% / rencana 75,37%, dan bobot
   tetap tutup di 100,000000.
4. **Gambar, bukan teks** — `scripts/shoot.mjs` pada `/projects`,
   `/projects/gundih`, layar proyek baru, dan panel keputusan 8; desktop dan
   390px; lalu benar-benar dilihat. Browser pane di lingkungan ini tidak pernah
   melakukan komposit, jadi `computer{action:"screenshot"}` selalu gagal.
5. **Berpindah proyek benar-benar memindahkan Document Control** — buka proyek
   kedua, lalu `/dokumen`, dan pastikan yang muncul register proyek itu (atau
   `EmptyRegister`-nya), bukan 454 dokumen Gundih.
6. **Menghapus proyek yang sedang terbuka tidak mengosongkan aplikasi** —
   penunjuknya jatuh ke proyek berikutnya.

## Dokumen yang ikut diperbarui

`AGENTS.md` (keputusan "Planner tanpa dependency" dicabut; papan 16 ditandai
jalan), memori blueprint, dan artefak rencana
`https://claude.ai/code/artifact/d3dfeed6-8a05-4ba8-87f5-2affe3da7c47` —
diterbitkan dengan URL itu sebagai `url`, atau yang tercipta duplikat.
