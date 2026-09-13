# Data Overall — tempat mengolah datanya

13 September 2026 · papan 12 · cabang `v2-foundation`

> *"data overall sebenarnya buat project dari awal mulai sampai selesai, itu
> sebenarnya lah tempat kita olah data, kita taruh bobot, kita taruh harga,
> kita tahu timeline, kita update-nya juga di situ."*
>
> *"yang bikin susah kan orang nggak tahu gimana cara ngerumusnya itu. aku mau
> itu adalah hal termudah yang pernah orang rasakan ketika bikin data overall
> untuk project apa pun."*

## Masalahnya bukan rumusnya belum ada

Rumusnya sudah ditulis, lengkap, dan sudah diuji terhadap data Gundih. Yang
tidak ada adalah **layar untuk memasukkan harganya** dan **alasan bagi orang
untuk percaya angka yang keluar**.

Empat hal yang bikin orang mentok waktu bikin Data Overall di Excel — semuanya
disebut sendiri oleh pemiliknya, dan semuanya sudah punya mesinnya di sini:

| Yang bikin mentok | Mesinnya sudah ada di | Layarnya |
|---|---|---|
| Bobot tiap pekerjaan, dan bikin totalnya pas 100 | `deriveWeights()` — `lib/weights.ts` | belum ada |
| Harga per SPK / per baris | `topLevelPricedTotal()`, `computeContractValue()` | dicabut dari planner 12 Sep |
| Target mingguan (kurva rencana) | `generatePlanCurve()` — diturunkan dari tanggal | ada, tapi tidak menjelaskan diri |
| Progress aktual jadi persen | `lib/progress.ts` + `lib/rollup.ts` | ada (Fill in) |

Jadi pekerjaan ini sebagian besar **memberi layar pada mesin yang sudah jalan**,
bukan membangun mesin baru.

## Keputusan

1. **Menunya bertukar, bukan berganti.** Sidebar `Weekly Progress` jadi
   **Data Overall** (isi: Fill in · Check), dan sidebar `Reports` jadi
   **Weekly Progress** (isi: Summary · Detail · S-Curve · Photos). Efek
   sampingnya menyenangkan: empat halaman laporan sudah menulis
   `section="Weekly Progress"` selama ini — di bawah nama baru mereka jadi
   benar tanpa disentuh. Yang berubah cuma dua halaman Data Overall.

2. **URL tidak ikut pindah sekarang.** Keenamnya tetap di `/weekly/[week]/`.
   Untuk empat lembar laporan kata "weekly" memang tepat. Untuk dua halaman
   Data Overall dia jadi tidak akurat, dan itu diterima **sementara**:
   memindahkannya berarti memecah `app/weekly/[week]/layout.tsx` jadi dua, yang
   berarti pemilih minggu + stepper + baris tab dirobohkan dan dibangun ulang
   tiap kali orang pindah antar dua menu itu — regresi yang persis sama dengan
   yang dulu bikin `app/template.tsx` dibuang dari repo ini. Pemindahan rute
   adalah **pekerjaan sendiri, setelah isinya jadi dan terbukti.**

3. **Nama aplikasi tidak berubah.** `metadata.title` dan `manifest.ts` tetap
   "Weekly Progress Report". Data Overall adalah nama satu bagian, bukan nama
   produknya.

4. **Bentuknya workbench + pemandu, bukan wizard.** Kartu SPK selalu jadi layar
   utama; di atasnya satu kartu ajakan yang muncul HANYA kalau ada yang belum
   beres dan hilang begitu beres. Wizard enak sekali, satu kali — minggu ke-12
   orang cuma mau langkah terakhir dan stepper-nya jadi perabot mati.

5. **Tiap angka turunan harus bisa menjelaskan dirinya sendiri, di tempat.**
   Ini tulang punggungnya, bukan hiasan. Orang tidak perlu tahu rumusnya;
   mereka perlu bisa menanyakannya ke angkanya. Tidak ada halaman bantuan, dan
   tidak ada penjelasan yang cuma muncul saat hover — aplikasi ini dipakai
   orang 22 sampai 60 tahun di ponsel.

6. **Harga boleh seadanya, dan itu fiturnya.** Realitanya campur: kadang cuma
   nilai kontrak, kadang per SPK, kadang BOQ lengkap, sering campur dalam satu
   proyek. `deriveWeights()` sudah menangani ini persis — nilai mengalir ke
   bawah pohon, anak yang berharga duduk DI DALAM angka induknya, dan baris
   tanpa harga mengambil jatah dari sisa induknya. Layarnya harus menampilkan
   pembagian itu, bukan menampilkan sel kosong.

7. **Target mingguan tetap tidak bisa diketik.** Dia turunan dari tanggal,
   titik. Kolom PLAN yang diketik tangan adalah temuan nomor satu waktu data
   Gundih dibaca baris demi baris: 126 dari 176 leaf (88,38% bobot proyek)
   punya kolom PLAN yang bertengkar dengan kolom tanggal di sebelahnya, karena
   diketik sekali lalu tidak pernah diperbarui. Membuka pintu itu lagi sama
   dengan mengundang balik bug termahal di data sumbernya.

8. **Weights bukan langkah di stepper.** Stepper `WeekSteps` adalah urutan yang
   dikerjakan TIAP MINGGU (Fill in → Check → Report). Harga dan bobot milik
   proyek, dikerjakan sekali di awal lalu jarang disentuh. Dia tab tersendiri
   di dalam Data Overall.

## Yang sudah ada dan dipakai ulang

Ini bagian yang paling menentukan besar kerjaan, jadi ditulis eksplisit supaya
tidak ada yang dibangun dua kali.

| Sudah ada | Di mana | Dipakai untuk |
|---|---|---|
| `deriveWeights(nodes, contractValue)` | `lib/weights.ts:139` | bobot hidup sambil orang mengetik harga |
| `previewWeights(nodes, signed)` | `lib/weights.ts:276` | isi dialog preview |
| `summariseWeights()` / `WeightSummary` | `lib/weights.ts:336` | strip kontrak + isi kartu pemandu |
| `getWeightSummary(projectId)` | `lib/weights-read.ts` | satu bacaan untuk seluruh layar |
| `previewWeightsAction` / `applyWeightsAction` | `lib/weights-actions.ts` | tombol Derive weights |
| `updateRowTextAction(id, 'price', v)` | `lib/sheet-actions.ts:65` | **menulis harga per baris — sudah ada, sudah memanggil `syncDerivedWeights`** |
| `setReportingUnitAction(id, on, label, value)` | `lib/sheet-structure.ts:600` | menandai SPK dan nilai kontraknya |
| `syncDerivedWeights(projectId, tx)` | `lib/weights-auto.ts` | bobot ikut harga, kecuali terkunci `boq` |

**Tidak ada action tulis baru untuk harga.** Tidak ada tabel baru. Tidak ada
kolom baru. Ini penting karena tabel baru di app ini adalah pertanyaan
deployment sebelum jadi pertanyaan kode — deployment memulihkan skemanya dari
snapshot blob, bukan dari migration.

`WeightSummary` sudah membawa semua yang dibutuhkan kartu pemandu tanpa
perhitungan tambahan: `basis`, `storedTotal`, `wouldChange`, `gap`,
`pricedRows`, `unitCount`, `derivedTotal`.

## Yang dibangun

### 1 · Tukar nama (empat tempat)

- `components/layout/Sidebar.tsx:55` — `'Weekly Progress'` → `'Data Overall'`
- `components/layout/Sidebar.tsx:67` — `'Reports'` → `'Weekly Progress'`
- `app/weekly/[week]/overall/page.tsx:88` — `section="Data Overall"`
- `app/weekly/[week]/control/page.tsx:65` — `section="Data Overall"`
- `components/projects/NoLegacyData.tsx:40` — "Go to Weekly Progress" →
  "Go to Data Overall" (tujuannya `/weekly` = layar Fill in, jadi kalimatnya
  yang salah, bukan tautannya)

Empat halaman laporan tidak disentuh. Konstanta `WEEKLY_PROGRESS` dan
`WEEKLY_REPORT` di Sidebar dinamai ulang mengikuti maknanya yang baru.

### 2 · Tab Weights (baru)

Rute `/weekly/[week]/weights`. Isinya milik proyek, bukan milik minggu —
pemilih minggu di atasnya diabaikan, dan itu disebut di layar dengan satu baris
("Berlaku untuk seluruh proyek") supaya tidak terbaca sebagai bug.

Ditambahkan ke `GROUPS.progress` di `components/weekly/WeekTabs.tsx` dengan
**`printable: false`** — bendera itu harus cocok dengan union `ReportKey` di
`app/print/weekly/[week]/page.tsx`, dan tab yang mengaku printable tanpa punya
lembar di sana membuat `lib/pdf.ts` menunggu `.print-sheet-a4` yang tidak
pernah datang, jadi permintaan PDF-nya menggantung, bukan gagal.

**Tapi masuk ke `GROUPS` saja tidak membuatnya kelihatan, dan ini perlu
diluruskan.** Array `steps` di `WeekTabs` ditulis tangan bertiga (Fill in ·
Check · Report) dan tidak diturunkan dari `GROUPS`; `GROUPS` cuma dipakai untuk
`ALL` — deteksi tab aktif dan prefetch — sementara satu-satunya baris tab yang
benar-benar dirender adalah `GROUPS.laporan`, dan itu pun hanya saat
`onReport`. Jadi mendaftarkan `weights` di sana memang **tidak** menjadikannya
langkah stepper (itu yang kita mau, keputusan 8), tapi juga tidak memberinya
pintu masuk.

Pintu masuknya: **satu pil `Weights` di kelompok aksi kanan header**, setinggi
44px, muncul hanya di halaman Data Overall (`!onReport`), di kiri tombol "Set
as Current". Di bawah `sm` labelnya menyusut jadi ikon saja, mengikuti pola
yang sudah dipakai tombol Set-as-Current di baris yang sama. Dia sengaja di
LUAR stepper, karena itulah yang memberi tahu orang bahwa ini bukan pekerjaan
mingguan.

Header ini sudah dua kali jadi sumber masalah tata letak (10 Sep 2026, "g
rapih"), jadi barisnya **diukur ulang di 390px sebelum dianggap selesai** —
bukan cuma dicek tidak meluber, tapi dilihat gambarnya. Cadangannya kalau
ternyata sesak: pintu masuknya turun ke badan halaman Fill in sebagai kartu
sendiri, dan header tidak disentuh sama sekali.

Isinya, dari atas:

1. **Strip nilai kontrak.** `contractValue` + currency + `gap` ("Rp 1,2 M
   belum ada harganya"). Sama sumbernya dengan `ValueStrip` di planner supaya
   dua layar tidak pernah menyebut dua angka berbeda untuk satu proyek.

2. **Kartu per SPK** (`isReportingUnit`). Tiap kartu: nama unit · nilai unit
   (bisa diketik, lewat `setReportingUnitAction`) · bobotnya terhadap proyek ·
   "12 dari 40 pekerjaan sudah berharga". Tap → turun satu tingkat. Proyek
   tanpa SPK menampilkan akar WBS-nya sebagai ganti, plus ajakan menandai SPK.

3. **Di dalam SPK: daftar pekerjaan.** Kolom harga pakai `<input>` native —
   daftar ini bisa lebih dari 20 baris, dan aturan repo ini jelas: Radix per
   layar, tidak per baris. Bobot hasilnya muncul hidup di sebelahnya sambil
   diketik (`deriveWeights` dipanggil di klien atas salinan datanya; yang
   ditulis ke server tetap lewat `updateRowTextAction` dengan debounce ~1 detik
   setelah orang berhenti mengetik, pola yang sudah dipakai workbench).

4. **Baris tanpa harga tidak pernah kosong.** Dia menampilkan bobot abu-abu
   berlabel *"jatah sisa"*, karena memang itulah yang terjadi. Ini yang menjawab
   "harga campur": ketik yang kamu punya, sisanya sudah dibagi.

5. **Dua bobot, bukan satu.** `WF per SPK` dan `WF Overall` adalah dua kolom
   terpisah di sheet aslinya karena memang dua pertanyaan berbeda. Ditampilkan
   berdampingan: *"di dalam SPK-002: 8,50% · terhadap proyek: 3,42%"*. Tanpa ini
   orang bingung kenapa angka di laporan per-SPK beda dengan laporan overall.

6. **Tombol Derive weights.** `previewWeightsAction` → dialog preview (berapa
   baris berubah, dari berapa ke berapa, `storedTotal` → `derivedTotal`,
   `biggest` menyebut nama bukan cuma jumlah) → `applyWeightsAction`, yang
   mengunci `weight_basis` ke `'boq'` **hanya kalau harganya benar-benar
   menutupi seluruh rencana**. Tombol pengunci ini ditarik keluar dari
   `ValueStrip`; planner kembali murni jadwal.

### 3 · Kartu pemandu (di Fill in)

Satu kartu, yang paling atas yang belum beres, dengan satu tombol yang
benar-benar bisa ditekan. Bukan checklist — memori repo ini mencatat bahwa
konten yang kalem terbaca hilang oleh pemiliknya, jadi ini kartu penuh dengan
kontrol, bukan baris abu-abu.

```
belum ada WBS       → "Susun pekerjaannya dulu"        → Planner
tanggal kosong      → "18 pekerjaan belum berjadwal"   → Planner
bobot masih rata    → "176 pekerjaan belum ditimbang"  → Weights
minggu ini kosong   → "Minggu 44: 23 menunggu diisi"   → gulir ke daftar
semua beres         → tidak ada kartu sama sekali
```

Urutannya adalah urutan ketergantungannya: tidak ada gunanya menimbang rencana
yang belum punya baris.

Deteksinya dibuat eksplisit di sini supaya tidak ditebak waktu koding, dan
semuanya dari bacaan yang sudah ada — tidak ada perhitungan baru:

| Kartu | Syarat munculnya | Sumber |
|---|---|---|
| belum ada WBS | `summary.leaves === 0` | `getWeightSummary()` |
| tanggal kosong | jumlah leaf dengan `start` atau `finish` null | baris sheet proyek |
| bobot masih rata | `summary.basis !== 'boq'` **dan** `summary.wouldChange > 0` | `getWeightSummary()` |
| minggu ini kosong | `worklist.due.length > 0` | `buildWorklist()`, sudah dipanggil halaman ini |

Syarat "bobot masih rata" sengaja dua-duanya. `basis !== 'boq'` sendirian akan
memunculkan kartu selamanya pada proyek yang harganya memang tidak pernah
menutupi seluruh rencana — kartu yang tidak bisa dihilangkan lebih buruk
daripada tidak ada kartu. `wouldChange > 0` yang membuatnya bisa selesai.

### 4 · Angka yang menjelaskan dirinya

Empat kartu statistik di atas Fill in jadi bisa ditap:

```
Plan       75,37%  → "Target minggu 43. Dijumlah dari tanggal tiap pekerjaan,
                      bukan diketik. 126 pekerjaan berjalan minggu ini."
Actual     71,20%  → "Σ (bobot × persen selesai) dari 176 pekerjaan."
Added       2,05%  → "Yang bertambah minggu ini saja."
Deviation  −4,17%  → "Actual − Plan. Di bawah rencana."
```

Dan tiap baris di workbench: tap bobotnya →
`3,42% × 60% selesai = 2,05% dari proyek`. Satu kalimat itu menjawab pertanyaan
yang paling sering bikin orang tidak percaya laporannya sendiri: *"kok
pekerjaanku sudah 60% tapi proyeknya cuma naik 2%?"*

Bentuknya: sheet/panel yang sudah dipakai workbench untuk panel baris, bukan
tooltip. Sekali tap, bisa ditutup, terbaca di 390px.

## Amandemen, 13 Sep sore: Data Overall bukan layar harga

Setelah layar Weights berdiri dan dilihat, pemiliknya menolaknya — *"orang pasti
bingung pakainya; yang susah itu kan BIKIN data overall"* — dan menunjuk ke
workbook W31 Gundih yang asli. Membacanya mengubah keputusan 4 dan seluruh
bagian 2 di atas. Tiga temuan, semuanya dari berkasnya sendiri:

**Modelnya sudah cocok, jadi rumusnya memang bukan masalahnya.** Kolom di
`Data Overall`: `WF Overall = F13/F293` (harga baris ÷ total harga) dan
`WF per SPK = E13/$E$11` (bobot baris ÷ bobot SPK-nya), cabang pakai
`SUBTOTAL(9,…)`. Itu persis `bobotOverall` dan `bobotInUnit`.

**Tapi layarnya cuma memperlihatkan separuh sheet-nya.** Di Excel, Duration /
Start / Finish duduk TEPAT di sebelah Price, karena dari tanggal itulah blok
PLAN mingguan lahir: `DATA PLAN = M13*$E13`, yaitu persen rencana × bobot. Layar
Weights tidak menampilkan tanggal sama sekali, jadi ia terbaca seperti
mengerjakan sepertiga pekerjaan — padahal aplikasi ini sudah menurunkan harga →
bobot DAN tanggal → kurva. Yang hilang bukan mesinnya; orang tidak pernah
melihat bahwa mesinnya sudah jalan.

**Dan yang benar-benar bikin bingung tiap minggu adalah persennya.** Blok
`ACTUAL` di workbook itu 176 baris × 60 minggu berisi angka yang diketik tangan
dan diseed dari `PLAN` — jadi orang menaksir, bukan mengukur. Aplikasi ini punya
obatnya sejak awal (`qty` dan `milestone` di `lib/progress.ts`, ditulis lewat
`applyFieldProgress` sehingga bukti yang memutuskan persentase) dan **tidak ada
satu baris pun yang memakainya: 233 dari 236 leaf berstatus `lumpsum`**, tiga
sisanya `linked`. Tidak pernah ada tempat untuk menyetelnya.

Maka:

9. **Data Overall adalah tempat menyiapkan tiap pekerjaan SEKALI**, bukan layar
   harga. Satu baris memperlihatkan rantai penuhnya — harga → bobot · tanggal →
   target minggu ini · cara ukur → bagaimana aktual diisi nanti — dan hanya DUA
   yang bisa diketik: harga, dan cara mengukurnya. Sisanya diturunkan, dan
   layarnya menyebutkan mana yang dikerjakan aplikasi. Orang yang datang dari
   Excel mengira harus mengisi lima kolom; layar ini memberi tahu bahwa dia
   mengisi dua.

10. **Tiga cara ukur ditawarkan, bukan empat.** Kuantitas ("3 dari 8 unit"),
    tahapan ("Material · Fabrikasi · Terpasang · Tested"), dan persen langsung —
    yang tetap boleh, tapi **ditandai sebagai taksiran, bukan sebagai ukuran**.
    `linked` (leaf engineering membaca register dokumen) tidak ditawarkan di
    pemilih: tiga baris yang sudah memakainya tetap jalan dan tidak diganggu,
    tapi menawarkannya sebagai pilihan bebas mengundang orang menautkan baris
    yang tidak punya dokumen.

11. **Pemilih cara ukur adalah SATU panel bersama**, dibuka oleh chip di baris
    dan dikemudikan id baris aktif — bukan satu panel per baris. Daftar ini bisa
    285 baris; aturan repo ini soal Radix adalah per layar, tidak per baris.

Tidak ada action tulis baru untuk ini juga: `setProgressMethodAction(leafId,
method, { vol, satuan, milestones })` sudah ada, sudah bercabang ke
`setProgressMethodSqlite`, sudah menolak `vol: 1, satuan: 'Ls'` lewat
`hasRealQuantity()`, dan sudah membawa progress MELINTASI perubahan metode
alih-alih menghitung ulang menembusnya.

## Batas yang harus disebut, bukan disembunyikan

**Gundih tidak kebagian tab Weights.** Dia proyek `legacyJsonId` yang membaca
`db.json` dan tidak punya baris `wbs_nodes` untuk dihargai; seluruh
`lib/weights*.ts` membaca SQLite. Tab Weights kena `LegacyGate` seperti layar
lain yang belum bercabang, dan kalimatnya mengatakan alasannya — bukan layar
kosong. Ini keluarga pengakuan yang sama dengan yang sudah dilakukan `/klaim`
soal foto tanpa timestamp, dan dengan peringatan di Project details soal nomor
dokumen proyek impor.

Proyek yang dibuat di dalam aplikasi kebagian penuh. Itu juga yang selama ini
rusak: sejak kolom harga dicabut dari planner 12 Sep, proyek baru **tidak bisa
dinyatakan value-based dari dalam aplikasi sama sekali** dan bobotnya rata.
Layar ini yang menutup lubang itu.

## Verifikasi

- `scripts/verify-weights.ts` yang sudah ada tetap hijau — rumusnya tidak
  disentuh, cuma dipanggil dari tempat baru.
- Satu skrip baru yang membuktikan klaim inti layarnya: pada fixture salinan
  (`copyDbFixture` dari `scripts/db-fixture.ts` — **bukan** `fs.copyFileSync`,
  yang pada database WAL diam-diam menyalin masa lalu), ketik harga di sebagian
  baris saja, lalu tegaskan total bobotnya tetap 100,00 dan baris tanpa harga
  memang menerima sisanya.
- Gambar, bukan teks: `scripts/shoot.mjs` pada layar Weights kosong, Weights
  terisi sebagian, dan kartu pemandu — desktop dan 390px, lalu dilihat.
- `npx tsc` dengan tsconfig tersaring, dan `next build` **ke berkas lalu
  `echo $?`**, bukan lewat pipe.

## Di luar lingkup

- Pemindahan rute `/weekly/` → `/data-overall/`. Diputuskan: nanti, pekerjaan
  sendiri.
- Memindahkan Gundih ke SQLite. Itu papan 08, dan dua store-nya berbeda sampai
  12,85 poin per minggu — memindahkan laporan yang sudah ditandatangani ke
  angka lain bukan migration.
- Impor/ekspor Excel untuk BOQ (papan 20). Tempel dari Excel yang sudah ada di
  planner tetap membaca kolom harga dan tidak disentuh.
- Tabel baru mana pun.

## Pertanyaan terbuka

- Proyek tanpa satu pun SPK ditandai: layar Weights menampilkan akar WBS-nya
  sebagai kartu. Apakah menandai SPK sebaiknya dituntun dari sini juga, atau
  tetap tinggal di planner? Ditunda sampai ada yang benar-benar mengalaminya.
- `unitContractValue` dan `price` ditulis bersamaan oleh
  `setReportingUnitAction` waktu unit ditandai, tapi mengetik ulang harga unit
  lewat kolom harga biasa hanya mengubah `price`. Keduanya perlu tetap seiring;
  diselesaikan di rencana implementasi, bukan di sini.
