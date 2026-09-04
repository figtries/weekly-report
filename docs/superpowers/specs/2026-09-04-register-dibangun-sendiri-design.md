# Register yang dibangun sendiri — desain

Tanggal: 4 September 2026 · Cabang: `v2-foundation` · Lanjutan nomor 15

## Tujuan

Sebuah proyek baru harus bisa punya register dokumen tanpa menyentuh terminal.
Hari ini tidak bisa: kalau `documents` kosong, keempat layar Document Control
menampilkan `EmptyRegister`, yang isinya perintah menjalankan
`node scripts/import-edl.ts` — script yang membaca workbook Gundih dan tidak
akan pernah cocok dengan proyek lain. Modul yang sudah jadi karena itu hanya
bisa dipakai oleh satu proyek: yang datanya sudah diimpor.

Yang dibangun: satu jalan masuk yang cukup mudah untuk mengisi 143 dokumen
sekali duduk, plus tombol-tombol yang membuat register itu bisa dirawat
sesudahnya.

## Keadaan sekarang, dan tiga hal yang menghalangi

Jalur tulis register sudah ada sejak nomor 15 (`lib/doc-actions.ts`): tanggal,
transmittal, kode kembali, dan `addDocument` untuk menambah satu dokumen ke
kategori yang **sudah ada**. Yang tidak ada: membuat kategori, menetapkan bobot
tahap, dan menghapus apa pun.

Tiga hal di kode saat ini yang akan menjegal alur ini kalau tidak diubah lebih
dulu:

1. **`loadRegister` menyerah pada nol dokumen** (`lib/register.ts:78`). Kategori
   yang baru dibuat tapi belum diisi membuat layar tetap berkata "kosong", dan
   pekerjaan orang hilang dari pandangan.
2. **Kolom kiri menyembunyikan kategori kosong**
   (`components/dokumen/RegisterWorkbench.tsx:155` — `if (node.documents > 0)`).
   Kategori yang baru dibuat tidak akan muncul, jadi tidak ada tempat untuk
   menekan "Add".
3. **`docNo` unik per proyek untuk EDL** (`lib/schema.ts:327`). Tempelan berisi
   nomor ganda akan gagal di tengah penulisan kalau tidak ditolak lebih dulu.

## Keputusan yang dikunci 4 September 2026

1. **Tempel daftar, bukan wizard.** Orang sudah punya daftarnya di Excel; jalur
   tercepat adalah menerima daftar itu apa adanya. Form satu-satu tetap ada
   untuk menambah dan mengoreksi, bukan untuk mengisi awal.
2. **Tempatnya di layar EDL Data / VDRL Data itu sendiri.** Tidak ada layar
   setup baru yang harus dicari. Mengisi dan mengelola terjadi di tempat yang
   sama dengan bekerja.
3. **Bobot tahap terisi default 50/30/20 dan bisa diubah.** Register baru
   menghasilkan angka sejak hari pertama; kontrak yang tahapnya berbeda punya
   satu tempat kecil untuk membetulkannya.
4. **Hapus boleh, dengan syarat.** Dokumen kapan saja; kategori hanya ketika
   sudah kosong. `docCategories` punya `onDelete: cascade` ke `documents`, jadi
   menghapus kategori berisi akan melenyapkan dokumen tanpa ada yang bertanya —
   syarat itu yang mencegahnya.
5. **Excel menunggu.** Impor dan ekspor `.xlsx` (papan nomor 20) tidak dibangun
   di ronde ini. Formatnya akan dikirim, dan format bikinan sendiri hari ini
   hanya akan jadi bongkaran besok. Parser tempelan sengaja dipisah dari
   layarnya supaya importer Excel nanti masuk lewat pintu yang sama.
6. **Tidak ada tanggal rencana.** Kurva rencana register lahir dari
   `planSubmitDate` per tahap (`lib/register.ts:208`). Register yang diketik
   sendiri belum punya, jadi ia tampil `plan: null` — chip **unplanned** — bukan
   0% yang berbohong. Perilaku itu sudah ada dan sudah benar.
7. **VDRL ikut tanpa biaya tambahan.** Satu mesin, dua register; semuanya
   diparameterkan `RegisterKind` seperti kode di sekitarnya.

## Bentuk

### `lib/register-paste.ts` — parser, tanpa database

Fungsi murni: teks masuk, rencana keluar. Tidak menyentuh SQLite, tidak
menyentuh React, bisa diuji sendirian.

```ts
parseRegisterPaste(text: string): PastePlan

interface PastePlan {
  categories: { name: string; documents: { docNo: string | null; title: string }[] }[];
  counts: { categories: number; documents: number };
  problems: PasteProblem[];   // baris yang ditolak, dengan nomor barisnya
}
```

Aturannya satu kalimat: **satu kolom berarti kategori, dua kolom berarti
dokumen.**

- Pemisah kolom: tab, pipa, atau dua spasi atau lebih. Ketiganya karena tempelan
  datang dari Excel (tab), tabel Markdown (pipa), dan PDF atau Word yang
  kolomnya jadi spasi.
- Baris kosong dilewati. Spasi di ujung dibuang.
- Baris berkolom satu menjadi kategori baru; dokumen sesudahnya masuk ke sana.
- Baris berkolom dua menjadi `docNo` + `title`. Kolom ketiga dan seterusnya
  disambung kembali ke judul, supaya judul yang mengandung dua spasi tidak
  terpotong.
- Baris yang dimulai dengan pemisah menjadi dokumen **tanpa nomor**. VDRL
  Gundih punya 115 baris seperti itu; menolaknya berarti menolak register apa
  adanya.
- Dokumen sebelum kategori mana pun masuk ke kategori `GENERAL` yang dibuatkan
  otomatis, supaya tempelan tanpa heading tetap berhasil.
- Hirarki dua tingkat lewat indentasi: baris kategori yang menjorok menjadi anak
  dari baris kategori tak-menjorok terakhir. Tempelan rata kiri semuanya
  menghasilkan kategori satu tingkat, dan itu sah.

`problems` berisi nomor ganda di dalam tempelan itu sendiri, judul kosong, dan
baris yang tidak bisa dibaca. Semuanya dilaporkan sekaligus, bukan satu per
penulisan.

### `seedRegister` — satu action, satu transaksi

Di `lib/doc-actions.ts`, bertetangga dengan `addDocument` yang sudah ada.

```ts
seedRegister({ projectId, register, text }): Promise<ActionResult>
```

Urutannya: parse, tolak kalau ada `problems`, cek nomor ganda terhadap dokumen
yang **sudah** ada di database, lalu tulis dalam satu `db.transaction`: bobot
tahap default kalau proyek/register itu belum punya, lalu kategori, lalu
dokumen. Gagal di baris ke-90 berarti tidak ada satu pun baris yang tertulis.

Kategori dicocokkan **berdasarkan nama, tanpa membedakan huruf besar-kecil**,
sehingga menempel daftar kedua ke register yang sudah berisi akan menambah ke
kategori yang sama, bukan membuat kembarannya. `code` — yang `notNull` dan unik
per (proyek, register) — dibuat dari nama: huruf besar, non-alfanumerik jadi
tanda hubung, dengan akhiran angka bila bentrok.

Tidak ada persentase yang ditulis di sini. Bobot kategori tetap jumlah dokumen
dibagi total dokumen, dihitung ulang oleh `lib/register.ts` seperti sekarang —
menambah dokumen memang menggeser penyebutnya, dan itu memang yang benar.

### Action pendamping

Semuanya di `lib/doc-actions.ts`, mengikuti bentuk `ActionResult` yang sudah
dipakai:

- `addCategory({ projectId, register, name, parentId })`
- `renameCategory({ projectId, register, categoryId, name })`
- `deleteCategory({ projectId, register, categoryId })` — menolak bila masih
  berisi dokumen atau punya anak
- `deleteDocument({ projectId, register, documentId })`
- `saveStageWeights({ projectId, register, weights })` — menolak bila jumlah
  tahap berbobot tidak 100

### Layar

**`RegisterSeed`** (`components/dokumen/RegisterSeed.tsx`, klien): satu
textarea, satu contoh format yang bisa dibaca sekilas, dan pratinjau langsung —
"18 kategori · 143 dokumen" atau daftar masalah dengan nomor barisnya. Tombol
tulis mati selama masih ada masalah. Pratinjau dihitung di klien oleh parser
yang sama dengan yang dipakai server, jadi yang dilihat orang persis yang akan
ditulis.

**Empat halaman `app/dokumen/[week]/*`**: syarat "kosong" berubah dari
`getRegisterSummary(...) === null` menjadi bentuk register yang sebenarnya —
sebuah fungsi baru `getRegisterShape(projectId, register)` yang mengembalikan
`{ documents, categories }` dengan dua query murah. Kategori nol dan dokumen nol
menampilkan `RegisterSeed`; selain itu workbench seperti biasa. `EmptyRegister`
dihapus.

**`RegisterWorkbench`**: kategori berdokumen-nol ikut tampil di kolom kiri
(baris 155), dengan "0 documents" dan tombol Add-nya sendiri; tombol
`+ Category` di kaki kolom kiri; ganti nama dan hapus lewat satu DropdownMenu di
header grup — satu instance untuk grup yang sedang dibuka, bukan satu per baris,
sesuai aturan Radix di AGENTS.md.

**Bobot tahap**: satu kartu kecil di layar Summary — tiga angka dan satu tombol,
menolak bila tidak berjumlah 100.

## Batas antar unit

- `register-paste.ts` tidak tahu apa-apa tentang database atau React. Ia bisa
  diuji dengan string dan dibaca oleh importer Excel nanti.
- `doc-actions.ts` satu-satunya yang menulis, seperti sekarang. Ia memakai
  parser, tidak menirunya.
- `register.ts` tidak berubah selain `getRegisterShape` dan syarat nol-dokumen;
  semua perhitungan tetap di sana, dan tidak satu pun action menulis persentase.
- Komponen tidak menghitung apa pun kecuali pratinjau tempelan.

## Kesalahan dan penolakan

| Keadaan | Yang terjadi |
|---|---|
| Nomor ganda di dalam tempelan | Ditolak di pratinjau, dengan nomor barisnya |
| Nomor sudah dipakai di database | Ditolak sebelum transaksi dimulai |
| Judul kosong | Baris ditolak; sisanya tetap bisa ditulis setelah dibetulkan |
| Hapus kategori berisi | Ditolak, dengan alasan kosongkan dulu |
| Bobot tahap tidak berjumlah 100 | Ditolak |
| Tempelan kosong | Tombol tulis mati |

## Pengujian

- Parser: uji langsung — tab, pipa, dua spasi, baris tanpa nomor, dokumen
  sebelum heading, indentasi dua tingkat, nomor ganda, baris kosong.
- Bulat-balik: tempel potongan EDL Gundih ke proyek kosong, lalu bandingkan
  jumlah kategori dan dokumennya dengan hasil `scripts/import-edl.ts`.
- Transaksi: tempelan yang bentrok di baris terakhir harus meninggalkan
  database persis seperti sebelumnya (hitung barisnya).
- Layar: `scripts/shoot.mjs` pada 390px dan desktop untuk layar kosong,
  pratinjau, dan workbench dengan kategori kosong — dilihat, bukan cuma
  diekstrak teksnya.
- `next build` sebelum push, keluarannya ditulis ke berkas lalu dicek kode
  keluarnya.

## Yang sengaja tidak masuk

Impor dan ekspor Excel (nomor 20, menunggu format). Tanggal rencana dan kurva
rencana untuk register buatan tangan. Memindahkan dokumen antar kategori.
Mengurutkan ulang. Undo — transaksi dan syarat hapus yang menggantikannya.
