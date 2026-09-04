# Register yang dibangun sendiri — desain

Tanggal: 4 September 2026 · Cabang: `v2-foundation` · Lanjutan nomor 15

## Tujuan

Sebuah proyek baru harus bisa punya register dokumen tanpa menyentuh terminal.
Hari ini tidak bisa: kalau `documents` kosong, keempat layar Document Control
menampilkan `EmptyRegister`, yang isinya perintah menjalankan
`node scripts/import-edl.ts` — script yang membaca workbook Gundih dan tidak
akan pernah cocok dengan proyek lain. Modul yang sudah jadi karena itu hanya
bisa dipakai oleh satu proyek: yang datanya sudah diimpor.

Yang dibangun: satu jalan masuk yang cukup mudah untuk mengisi 132 dokumen
sekali duduk, plus tombol-tombol yang membuat register itu bisa dirawat
sesudahnya.

## Data acuan kedua: EDL Petrogas

`Petrogas_Engineering Drawing List~RB3_020926_W7.xlsx`, sheet **EDL** —
proyek Sorong, contractor INDOTURBINE (PTI), client PETROGAS. Dibaca baris demi
baris 4 September 2026. Ia acuan yang lebih baik daripada Gundih untuk pekerjaan
ini justru karena ia **bukan** file yang importer kita dibuat untuknya.

Yang ditemukan:

- **36 kategori, tiga tingkat**: `A` GENERAL → `A.2` PROCEDURE → `A.2.1`
  General Prosedur. Spec sebelumnya hanya merancang dua tingkat.
- **132 dokumen, 75 kolom.** Kode outline dan nomor urut dokumen berbagi satu
  kolom: `A.2.1` berarti baris kategori, `4` berarti baris dokumen.
- **Kode outline tidak unik.** `B.2.3` dipakai dua kali (Civil Drawing, Civil
  Boq), `B.4.2` tiga kali. Karena itu `code` di database dibuat dari nama
  kategori, bukan dari kode yang ditempel.
- **Satu nomor dokumen dipakai dua kali** (`WPP-IN-LAY-003`), yang ditolak
  `documents_project_no_idx` (`lib/schema.ts:327`). Lihat keputusan 8.
- **Nama kedua pihak adalah label kolomnya**: "INDOTURBINE Submission IFR"
  lawan "PETROGAS Response (IFR)", dan status ditulis "PTI ISSUED FOR REVIEW".
  Register memang punya dua sisi, dan sisi itu bernama.
- **Rantai tahapnya persis milik kita**: IFR · RE-IFR · IFA · RE-IFA · AFC ·
  RE-AFC1 · RE-AFC2 · AS-BUILT (`lib/register-shared.ts:309`), dengan bobot
  0,5 / 0,3 / 0,2 seperti Gundih. Tidak ada yang perlu ditambah.

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
3. **`docNo` unik per proyek untuk EDL** (`lib/schema.ts:327`). Data acuan
   melanggarnya. Lihat keputusan 8.

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
8. **Nomor ganda diterima, lalu dikatakan.** `documents_project_no_idx` dilepas
   (`DROP INDEX` — tidak membangun ulang tabel, jadi tidak ada baris anak yang
   ikut terhapus; bandingkan peringatan migrasi di AGENTS.md). Sebagai gantinya
   pratinjau menghitungnya sebelum menulis dan layar register menandainya
   sesudahnya. Alasannya sudah jadi aturan repo ini untuk VDRL: menolak register
   apa adanya berarti menolak kenyataan, dan yang benar adalah menuliskannya
   lalu mengatakannya dengan jelas.
9. **Nama client dan contractor ditanyakan setiap kali register dibuat.**
   Kolomnya sudah ada (`projects.clientName`, `projects.contractorName`) tapi
   belum pernah dipakai di layar mana pun. Keduanya prefill dari proyek bila
   sudah terisi, tetap terlihat, tetap bisa diubah — "selalu ditanya" tanpa
   menjadi cerewet.

## Bentuk

### `lib/register-paste.ts` — parser, tanpa database

Fungsi murni: teks masuk, rencana keluar. Tidak menyentuh SQLite, tidak
menyentuh React, bisa diuji sendirian, dan nanti dipakai ulang oleh importer
Excel.

```ts
parseRegisterPaste(text: string, mapping?: ColumnMapping): PastePlan

interface PastePlan {
  columns: ColumnSample[];   // isi contoh tiap kolom, untuk pemeta kolom
  mapping: ColumnMapping;    // yang dipakai — tebakan otomatis atau pilihan orang
  categories: { name: string; depth: number; documents: PasteDocument[] }[];
  counts: { categories: number; documents: number; duplicateNumbers: number };
  problems: PasteProblem[];  // baris yang ditolak, dengan nomor barisnya
}
```

**Dua bentuk tempelan yang harus sama-sama jalan.** Yang diketik tangan
(dua kolom) dan yang disalin dari sheet EDL (75 kolom, berkode outline).
Parsernya karena itu bekerja dua langkah: pecah jadi kisi, lalu putuskan arti
tiap kolom.

*Langkah 1 — kisi.* Baris dipecah dengan tab, pipa, atau dua spasi atau lebih.
Kolom kosong di kiri dibuang (sheet EDL mulai di kolom B). Baris kosong
dilewati.

*Langkah 2 — arti kolom,* ditebak lalu boleh dibetulkan orang:

- **Kolom outline/nomor urut**: kolom yang isinya cocok `^[A-Z](\.\d+)*$`
  (baris kategori) atau bilangan bulat berurutan (baris dokumen). Tingkat
  kategori = jumlah titik + 1, jadi tiga tingkat Petrogas terbaca apa adanya.
- **Kolom nomor dokumen**: rasio tertinggi nilai berbentuk kode
  (huruf besar, tanda hubung, angka).
- **Kolom judul**: teks terpanjang rata-rata.
- **Kolom jenis** (opsional): isinya `Doc`/`Dwg`. Ikut disimpan kalau ada,
  karena ia yang menggerakkan hitungan lembar. `size`, `revision` dan
  `priority` **tidak** ikut meski kolomnya ada di tabel: tebakan kolom untuk
  ketiganya tidak cukup andal, dan salah tebak yang diam lebih buruk daripada
  kolom yang kosong.

Tempelan tanpa kolom outline jatuh ke aturan sederhana: **satu kolom berarti
kategori, dua kolom berarti dokumen**; baris yang dimulai dengan pemisah adalah
dokumen tanpa nomor (VDRL Gundih punya 115 baris seperti itu); indentasi
menyatakan tingkat; dokumen sebelum kategori mana pun masuk ke `GENERAL` yang
dibuatkan otomatis.

`problems` berisi judul kosong dan baris yang tidak bisa dibaca — dilaporkan
sekaligus, bukan satu per penulisan. Nomor ganda **bukan** problem: ia dihitung
di `counts.duplicateNumbers` dan ditampilkan sebagai peringatan (keputusan 8).

### `seedRegister` — satu action, satu transaksi

Di `lib/doc-actions.ts`, bertetangga dengan `addDocument` yang sudah ada.

```ts
seedRegister({ projectId, register, text, mapping, clientName, contractorName }): Promise<ActionResult>
```

Urutannya: parse, tolak kalau ada `problems`, lalu tulis dalam satu
`db.transaction` — nama client/contractor ke `projects`, bobot tahap default
kalau proyek/register itu belum punya, kategori (induk sebelum anak, memakai
`parentId`), lalu dokumen. Gagal di baris ke-90 berarti tidak ada satu pun baris
yang tertulis.

Kategori dicocokkan **berdasarkan nama dalam induk yang sama, tanpa membedakan
huruf besar-kecil**, sehingga menempel daftar kedua ke register yang sudah
berisi akan menambah ke kategori yang sama, bukan membuat kembarannya. `code` —
yang `notNull` dan unik per (proyek, register) — dibuat dari nama: huruf besar,
non-alfanumerik jadi tanda hubung, dengan akhiran angka bila bentrok. Kode
outline yang ditempel **tidak** dipakai sebagai `code`, karena data acuan
membuktikan ia bisa dobel.

Tidak ada persentase yang ditulis di sini. Bobot kategori tetap jumlah dokumen
dibagi total dokumen, dihitung ulang oleh `lib/register.ts` seperti sekarang.

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

### Migrasi

Satu migrasi drizzle, isinya satu perintah: `DROP INDEX documents_project_no_idx`.
Salin `data/report.db` lebih dulu dan hitung baris `doc_stages` sesudahnya,
sesuai aturan AGENTS.md — meski `DROP INDEX` tidak membangun ulang tabel dan
karena itu tidak bisa membawa baris anak ikut terhapus.

### Layar — dan ia tidak boleh terasa seperti Excel

`RegisterSeed` (`components/dokumen/RegisterSeed.tsx`, klien) menggantikan
`EmptyRegister`. Satu halaman yang membuka diri sendiri, bukan wizard berhalaman
dan bukan kisi sel:

1. **Dua pihaknya.** Dua field: nama client, nama contractor, dengan satu
   kalimat yang menjelaskan kenapa ditanya — keduanya menjadi nama kedua sisi
   register ("INDOTURBINE mengirim · PETROGAS menjawab"). Prefill dari proyek.
2. **Daftarnya.** Satu textarea besar dengan contoh dua baris di bawahnya.
   Menempel dari Excel, Word, atau mengetik sendiri sama-sama diterima.
3. **Kolom mana yang mana** — muncul hanya kalau tempelannya lebih dari dua
   kolom. Dua sampai empat dropdown (Nomor · Judul · Jenis), sudah ditebak, tiap
   pilihan memperlihatkan contoh isinya. Bukan tabel: satu baris kontrol.
4. **Pratinjau, dalam bentuk yang sama dengan tempat kerjanya.** Bukan kisi
   baris-kolom, melainkan daftar kategori seperti kolom kiri workbench —
   "PROCEDURE · 14 dokumen", bisa dibuka untuk melihat isinya. Di atasnya satu
   baris: "36 kategori · 132 dokumen · 1 nomor dipakai dua kali".
5. Satu tombol: **Create this register**.

Empat halaman `app/dokumen/[week]/*` memutuskan "kosong" dari bentuk register
yang sebenarnya — fungsi baru `getRegisterShape(projectId, register)` yang
mengembalikan `{ documents, categories }` dengan dua query murah. Nol dan nol
menampilkan `RegisterSeed`; selain itu workbench seperti biasa. `EmptyRegister`
dihapus.

`RegisterWorkbench`: kategori berdokumen-nol ikut tampil di kolom kiri (baris
155), dengan "0 documents" dan tombol Add-nya sendiri; tombol `+ Category` di
kaki kolom kiri; ganti nama dan hapus lewat satu DropdownMenu di header grup —
satu instance untuk grup yang sedang dibuka, bukan satu per baris, sesuai aturan
Radix di AGENTS.md. Nomor yang dipakai dua kali diberi tanda di kartunya.

Bobot tahap: satu kartu kecil di layar Summary — tiga angka dan satu tombol,
menolak bila tidak berjumlah 100.

Semua teks layar dalam bahasa Inggris, seperti seluruh aplikasi; yang berbahasa
Indonesia hanya yang datang dari data orang sendiri.

## Batas antar unit

- `register-paste.ts` tidak tahu apa-apa tentang database atau React. Ia bisa
  diuji dengan string dan dibaca oleh importer Excel nanti — sheet Excel hanya
  akan menjadi sumber kisi yang lain, bukan jalur kedua.
- `doc-actions.ts` satu-satunya yang menulis, seperti sekarang. Ia memakai
  parser, tidak menirunya.
- `register.ts` tidak berubah selain `getRegisterShape` dan syarat nol-dokumen;
  semua perhitungan tetap di sana, dan tidak satu pun action menulis persentase.
- Komponen tidak menghitung apa pun kecuali pratinjau tempelan, yang memanggil
  parser yang sama dengan yang dipakai server — jadi yang dilihat orang persis
  yang akan ditulis.

## Kesalahan dan penolakan

| Keadaan | Yang terjadi |
|---|---|
| Judul kosong | Baris ditolak, nomor barisnya disebut; sisanya tetap bisa ditulis |
| Nomor dipakai dua kali | Diterima, dihitung, ditandai di pratinjau dan di layar |
| Kolom salah tebak | Dibetulkan lewat dropdown; pratinjau ikut berubah |
| Hapus kategori berisi | Ditolak, dengan alasan kosongkan dulu |
| Bobot tahap tidak berjumlah 100 | Ditolak |
| Nama client atau contractor kosong | Tombol tulis mati |
| Tempelan kosong | Tombol tulis mati |

## Pengujian

- Parser: uji langsung dengan potongan **asli** sheet EDL Petrogas — kode
  outline tiga tingkat, kolom kosong di kiri, nomor ganda — dan dengan daftar
  ketikan dua kolom, tab, pipa, dua spasi, baris tanpa nomor, dokumen sebelum
  heading, baris kosong.
- Bulat-balik: tempel seluruh sheet EDL Petrogas ke register kosong dan
  pastikan hasilnya **36 kategori dan 132 dokumen**, tiga tingkat, dengan
  `B.4.2` menjadi tiga kategori berbeda.
- Transaksi: tempelan yang gagal di baris terakhir harus meninggalkan database
  persis seperti sebelumnya (hitung barisnya).
- Migrasi: salin `data/report.db`, jalankan, lalu hitung `doc_stages` dan
  `documents` sebelum dan sesudah.
- Layar: `scripts/shoot.mjs` pada 390px dan desktop untuk layar kosong,
  pemeta kolom, pratinjau, dan workbench dengan kategori kosong — dilihat, bukan
  cuma diekstrak teksnya.
- `next build` sebelum push, keluarannya ditulis ke berkas lalu dicek kode
  keluarnya.

## Yang sengaja tidak masuk

Impor dan ekspor Excel (nomor 20, menunggu format). Tanggal rencana dan kurva
rencana untuk register buatan tangan. Memindahkan dokumen antar kategori.
Mengurutkan ulang. Undo — transaksi dan syarat hapus yang menggantikannya.
