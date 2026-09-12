# Planner: jadwal dulu, uang belakangan

Tanggal: 12 September 2026 · Cabang: `main` · Papan 16 + 17 (revisi)

Yang diminta, kata usernya sendiri:

> "untuk project planing aku mau isiianya kek gini aja Task Name, Duration,
> Start, Finish ... biar bobot, dan harga per spk/pengerjaan kita limpahkan di
> data overall aja ... animasi dan transisi juga aku maunya semua smooth dan
> soft di project planingnya ini kadang masih kaku gitu gerakanya kalo nambah
> row apus dllnya juga masih bgt kurang cantik"

Dan waktu ditanya apa yang harus dikalahkan dari Microsoft Project, jawabannya
bukan satu fitur:

> "bikin org beralih seperti halnya canva yg ngalahin adobe"

Dokumen ini menjawab dua-duanya, dan jawabannya ternyata satu perubahan yang
sama.

## Kenapa "kaku" itu bukan soal animasi

Canva tidak mengalahkan Adobe dengan menambah fitur. Dia menang di tiga hal,
dan dua di antaranya sudah dimenangkan repo ini tanpa disadari:

1. **Tidak ada kanvas kosong.** `PasteRows` sudah ada: rencana yang sudah
   dipunya orang, dalam bentuk apa pun, jadi rencana di sini dalam satu tempel.
2. **Tidak ada jargon.** MS Project memaksa orang paham predecessor, lag,
   constraint, task type. Di sini rantai antar-pekerjaan DITEBAK dari tanggal
   (`lib/chains.ts`) dan tidak pernah disimpan. Tidak ada istilah yang harus
   dipelajari.
3. **Rasanya seperti menggambar, bukan mengisi formulir.** Ini yang rusak.

Yang ketiga bisa dibuktikan, dan bukan soal selera. Setiap perubahan struktur
di sheet jalannya begini:

```
components/projects/ScheduleSheet.tsx:544-557   server action  ->  router.refresh()
components/projects/ScheduleSheet.tsx:614       structure(deleteRowAction(...))
components/projects/ScheduleSheet.tsx:662       structureUndoable(addRowAction(...))
```

`router.refresh()` merender ulang seluruh halaman server, lalu daftar yang
ter-virtualisasi (`windowed.map`, baris ditaruh pakai `index × ROW_H`, lihat
`ScheduleSheet.tsx:57` dan `:1052`) dibangun ulang. Akibatnya baris baru
**tidak pernah punya animasi masuk**: dia belum ada waktu tombolnya ditekan,
dan begitu ada, dia sudah selesai muncul. Tidak ada keadaan transisi untuk
dianimasikan.

Jadi "gerakanya kaku" adalah gejala. Penyakitnya: **sheet ini tidak punya
modelnya sendiri.** Semua kebenaran ada di server, dan klien cuma menampilkan
hasil render terakhir.

Tiga cara ditimbang, dan dua dibuang dengan alasan:

| Cara | Kenapa tidak |
|---|---|
| `useOptimistic` saja | Nilai optimistiknya DIBUANG begitu transition selesai, jadi barisnya tetap menyentak ulang waktu refresh server mendarat. Glitch-nya kembali di koneksi lambat, dan durasi terhadap finish tetap tidak bisa instan karena rollup ringkasan dihitung di server. |
| Tambah animasi ke yang sekarang | Jedanya tetap, jadi animasi "masuk" main kesiangan. Ngetik secepat Excel sama sekali tidak tersentuh. Ini yang sudah ditolak usernya waktu bilang "masih kaku". |

**Yang dipakai: sheet punya modelnya sendiri di klien.** Edit kena lokal dulu
(instan), server menyusul di belakang.

Dan di sini dua permintaan usernya saling menguatkan, bukan kebetulan: dengan
harga, bobot dan target keluar dari planner, model klien cuma perlu memegang
**nama, tanggal, durasi, urutan dan kedalaman**. Itu persis empat kolom yang
disisakan. Kalau Price dan Weight masih di sheet, model klien harus ikut
memegang penurunan bobot dari harga, dan perubahan ini jadi kebesaran untuk
dikerjakan. **Menyederhanakan kolom bukan cuma merapikan, dia yang membuat
bagian instannya bisa dikerjakan.**

## Tujuh keputusan

1. **Sheet 4 kolom.** `# · Task name · Duration · Start · Finish · aksi`.
   **Target**, **Price** dan **Weight** hilang dari planner.
2. **Harga per baris keluar dari planner. Nilai kontrak tetap.** Nilai kontrak
   adalah satu angka milik proyek dan sudah ditanya waktu proyek dibikin. Harga
   per SPK/pengerjaan adalah pekerjaan lain, dan tempatnya Data Overall.
3. **`ValueStrip` turun jadi nilai kontrak + currency.** Bar "seberapa jauh
   pricing-nya" dan tombol turunkan bobot pindah ke Data Overall. Alasannya:
   bar itu membaca harga per baris, dan kalau harganya tidak bisa diketik lagi
   di sini, dia akan selalu membaca 0% di proyek baru. Nol persen yang tidak
   bisa diapa-apakan terbaca RUSAK, bukan terbaca kosong.
4. **Alias: inisial tiap kata, selalu bisa ditimpa.** Ditanya waktu bikin
   proyek, di bawah nama. Dipakai sebagai label pendek di UI dan sebagai isian
   awal `docNoPrefix`.
5. **`ensureSchema()` waktu snapshot direstore.** Ini syarat supaya kolom
   `alias` hidup di deployment. Alasannya di bawah.
6. **Model klien instan**, bukan `useOptimistic`, bukan tambal animasi.
7. **Drag batang Gantt di luar lingkup.** Itu memuaskan, tapi itu gerakan ala
   Adobe (alat kuat untuk yang sudah ahli), bukan gerakan ala Canva (hilangnya
   gesekan untuk semua orang). Pekerjaan sendiri, nanti.

## Satu hal yang sudah dicek dan ternyata tidak perlu diapa-apakan

Durasi di workbook usernya adalah **hari KALENDER, inclusive**, persis
konvensi `inclusiveDays` yang sudah dipakai repo ini. Diuji pada tiga baris
dari PDF-nya:

```
29/12/25 -> 14/05/27   PDF: 502 days   inclusiveDays: 3 + 365 + 134 = 502   cocok
09/11/26 -> 08/03/27   PDF: 120 days   inclusiveDays: 120                   cocok
01/04/27 -> 05/04/27   PDF: 5 days     inclusiveDays: 5                     cocok
```

Kalau salah satu tidak cocok, `Duration` harus jadi hari kerja dan seluruh
`lib/plan-curve.ts` ikut berubah. Ternyata tidak. Dicatat di sini supaya tidak
ada yang mengira ulang.

## Bagian 1 — Alias

### Database

`projects.alias text` nullable, migration `0011`.

Jalurnya aman dan itu sudah dibuktikan: migration terakhir
(`data/migrations/0010_solid_shriek.sql`) isinya persis satu baris,
`ALTER TABLE projects ADD bar_preset text;`. Kolom nullable di tabel yang sudah
ada tidak menyentuh indeks unik, jadi `drizzle-kit generate` tidak jatuh ke
jalur build-new-table / copy / DROP TABLE / rename yang pernah menghapus 357
baris `doc_stages`. Kebiasaannya tetap dijalankan: `data/report.db` dikopi ke
`report.db.before-0011` sebelum migrate, dan baris anak dihitung sesudahnya.

### `lib/alias.ts`, murni

`deriveAlias(name)`:

1. Pecah nama pada spasi.
2. Buang kata sambung: `dan`, `di`, `ke`, `untuk`, `pada`, `and`, `of`, `the`,
   `for`, `in`, `on`, `at`.
3. Buang token angka-murni (`2` di "Relocation of 2 GTG units" bukan identitas).
4. Ambil huruf pertama tiap sisa token, huruf besar.
5. Potong di 12 karakter.

```
"Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah" -> JPICSPUCS
"Relocation of 2 GTG units"                                             -> RGU
"CPP Gundih"                                                            -> CG
```

Murni dan tanpa database, jadi bisa diuji langsung.

### Dialog

Field **Alias** persis di bawah **Project name** di
`components/projects/NewProjectDialog.tsx`.

Placeholder-nya **hidup**: begitu nama diketik, placeholder berubah jadi alias
tebakannya, jadi hasilnya kelihatan sebelum orang memutuskan mau menimpa atau
tidak. Dibiarkan kosong berarti tebakannya yang dipakai, diturunkan di
`createProjectAction` bukan di klien, supaya proyek yang dibikin lewat jalur
lain juga dapat alias. Tidak wajib, dan tidak pernah memblokir tombol Create.

### Dipakai di

- Label pendek: daftar proyek (`ProjectList.tsx`), kepala halaman proyek
  (`app/projects/[id]/page.tsx`), sidebar.
- `docNoPrefix` diisi DARI alias kalau masih kosong, dan **tidak pernah
  menimpa** yang sudah ada, jadi `PRGG-00-G0` milik Gundih tidak bergerak.

### Kenapa kolom baru adalah pertanyaan deploy

Deployment membangun skemanya dari **snapshot blob**, bukan dari migration.
Tidak ada yang menjalankan `drizzle-kit migrate` di Vercel: `instrumentation.ts`
cuma menarik berkasnya lewat `restoreDbSnapshot()`. Blob itu sekarang memegang
database tanpa kolom `alias`, dan dia **menang** waktu cold start, menimpa
berkas yang baru ikut ter-deploy. Jadi begitu kode baru naik, setiap query yang
menyebut `alias` mati dengan `no such column: alias`.

Tiga jalan keluar:

| Jalan | Putusan |
|---|---|
| Hapus objek blob-nya | Snapshot re-seed dari `seed.db` yang sudah ter-migrate. Semua proyek yang pernah dibuat di deployment hilang. Tidak. |
| Simpan alias di kolom lain | Utang yang lebih mahal daripada masalahnya. Tidak. |
| **`ensureSchema()` waktu restore** | Dipakai. |

`ensureSchema()` jalan di `lib/db-snapshot.ts` setelah snapshot mendarat dan
sebelum query pertama: baca `PRAGMA table_info(<tabel>)`, bandingkan dengan
daftar kolom yang diharapkan, jalankan `ALTER TABLE ... ADD COLUMN` untuk yang
belum ada. Idempoten, tidak menghapus apa pun, dan jalan juga untuk setiap
kolom baru sesudah ini.

Lingkupnya **kolom saja**. Tabel baru tetap pertanyaan terpisah, dan catatan di
AGENTS.md soal itu tetap berdiri. Yang dijawab dokumen ini adalah separuhnya
yang lebih kecil.

## Bagian 2 — Sembilan kolom jadi empat

### Yang dibuang

`components/projects/ScheduleSheet.tsx`: header `:974-979` dan selnya, untuk
**Target**, **Price**, **Weight**. Plus `GRID_SM` (`:109`) dan `GRID_LG`
(`:117`).

**Jebakan yang sudah pernah merugikan di berkas ini.** Jumlah anak grid harus
cocok dengan jumlah kolom yang dideklarasikan, karena anak grid yang
`display:none` **keluar dari grid** dan semua kolom bergeser satu ke kiri. Itu
yang dulu membuat "Task name" tergambar di sel garis warna 12px dan terbaca
"T..". Catatannya ada di `:961-966`. Setiap kolom yang dibuang harus dibuang
dari GRID_SM, GRID_LG, header, DAN baris, berbarengan.

### Yang ikut dirapikan

- `components/projects/RowMenu.tsx:181-186`: isian **Price** dibuang.
- `components/projects/ValueStrip.tsx`: turun jadi nilai kontrak + currency.
  `CurrencyPicker` tetap di sini.
- `app/projects/[id]/page.tsx:91`: fakta `"N priced"` / `"no prices yet"`
  dibuang dari baris fakta. Tidak ada artinya lagi di layar yang tidak punya
  pintu harga.
- Badge `"5d late"` di sebelah nama (`:1344`) dibuang, karena dia membaca
  `targetDate` dan tidak akan ada yang bisa membuat atau mengubahnya dari sini.
  Angka yang muncul tapi tidak bisa diapa-apakan adalah masalah yang sama
  dengan bar 0% di keputusan 3.

### Yang TIDAK disentuh

`targetDate`, `price` dan `bobot` tetap di database. `updateRowTargetAction`
dan jalur harga di `lib/sheet-actions.ts` tetap ada. Importer Gundih dan tempel
dari Excel tetap membaca harga. `syncDerivedWeights` tetap dipanggil
`renumber()`, jadi bobot tetap mengikuti harga untuk proyek yang memang punya
harga.

Yang ditutup cuma **pintu masuknya di planner**.

Konsekuensi yang disebut supaya tidak jadi kejutan: tombol yang mengunci
`weight_basis = 'boq'` ada di `ValueStrip`. Selama Data Overall belum jadi,
proyek baru tidak bisa dinyatakan value-based dari dalam aplikasi, dan bobotnya
rata. Itu sesuai aturan yang sudah ada ("Projects without a priced BOQ get
`evenWeights()` and must be labelled as not value-based"), dan pindahnya tombol
itu adalah pekerjaan Data Overall.

### Yang didapat, diukur

Kolom yang dibuang berjumlah 13rem (Target 4.25 + Price 5.25 + Weight 3.5).

```
sekarang   32.25rem kolom tetap + 8rem nama + 3rem celah + 1.5rem padding = 44.75rem = 716px
sesudah    19.25rem kolom tetap + 8rem nama + 1.875rem celah + 1.5rem padding = 30.625rem = 490px
```

Jadi `FULL_GRID` turun dari **716px ke 490px**, dan pada lebar pane yang sama
kolom **nama bertambah 226px** (perabotnya turun dari 588px ke 362px).
"Detail Engineering" berhenti terbaca "Detail…".

Dan ini yang pantas diverifikasi dengan gambar: di bawah 640px sheet sekarang
cuma memuat garis warna, nama, Days dan Finish. Dengan enam kolom
(`0.75 + 5 + 2.75 + 4.5 + 4.5 + 2.75` rem, celah 1.875, padding 1.5)
kebutuhannya **378px**, jadi **Start seharusnya muat di layar 390px**. Keempat
kolom yang diminta usernya muat utuh di HP. Itu klaim yang dihitung dari
deklarasi grid, dan harus dibuktikan dengan tangkapan gambar di 390px, bukan
dipercaya.

## Bagian 3 — Model instan dan gerakannya

### `lib/sheet-model.ts`, baru dan murni

Diangkat dari `lib/sheet-structure.ts`, yang baris pertamanya `'use server'`
sehingga klien tidak bisa menyentuhnya sama sekali. Fungsi murni di atas
`SheetRow[]`:

```
renumberRows      kode outline dari kedalaman + urutan saudara
rollupSummaries   tanggal ringkasan = rentang anak, dihitung bukan disimpan
insertAfter       baris baru sesudah id, atau sebagai anaknya
removeSubtree     baris beserta seluruh anaknya
indent / outdent  satu tingkat, dengan renumber
applyDates        durasi dan finish saling mengunci
```

**Server action ikut mengimpor dari sini.** Satu renumber, bukan dua yang
pelan-pelan berselisih. Itu juga yang membuat pemindahan ini perbaikan, bukan
duplikasi: aturan strukturnya jadi bisa diuji tanpa database.

`applyDates` adalah aturan yang sekarang tersebar: ketik durasi maka finish
bergeser; ketik finish maka durasi berubah; ketik start pada baris yang punya
durasi maka finish ikut. Ditulis sekali, di sini.

### Alur edit

`ScheduleSheet` memegang `rows` di state, di-seed dari props. Setiap edit:

```
fungsi murni lokal  ->  setState (langsung terpaint)  ->  action di transition belakang
```

Server tetap yang benar. Kalau salinannya berbeda dia yang menang, tapi hanya
kalau **benar-benar** berbeda: rekonsiliasi dibandingkan lewat satu hash
revisi, supaya `router.refresh()` yang mengembalikan isi yang sama tidak
memaksa remount dan membunuh animasi yang sedang jalan. Gagal berarti kembali
ke keadaan sebelumnya, dan dikatakan.

### Gerakan, yang baru sekarang mungkin

Karena barisnya ADA sebelum server menjawab, ada keadaan sebelum dan sesudah
untuk dianimasikan:

- **Tambah**: tinggi 0 ke 44 sambil naik dan fade, kursor langsung di kolom
  nama, yang di bawahnya bergeser dengan `transform` bukan lompat reflow.
- **Hapus**: barisnya fade dan menyusut ke 0 DULU, baru sisanya naik halus.
- **Indent/outdent**: `paddingLeft` bertransisi, garis warna dan chevron ikut.
- **Collapse/expand**: subtree-nya keluar/masuk, dan offset semua yang di
  bawahnya ikut berjalan.

**Ongkos jujurnya.** Virtualizer sekarang menaruh baris dengan `index × ROW_H`
plus div penyangga di atas dan di bawah (`ScheduleSheet.tsx:1052`, `:1076`).
Supaya offset-nya bisa dianimasikan, itu harus jadi penempatan `translateY`.
Itu kerjaan sebenarnya di bagian ini, dan itu juga alasan "tambah animasi saja"
tidak mungkin jalan.

`ROW_H` tetap 44 dan tetap tepat, karena batang Gantt ditempatkan dengan angka
yang sama. Baris yang tingginya bukan 44 membuat setiap batang di bawahnya
makin melenceng.

Angkanya tetap satu tempat: `MOTION` di `lib/design.ts`, satu kurva satu durasi
untuk seluruh aplikasi. Gerakan di sini dipicu state setelah halaman hidup,
jadi framer-motion, bukan keyframe CSS. Animasi masuk saat halaman dimuat tetap
keyframe CSS, aturan itu tidak berubah.

### Papan tombol, yang ikut gratis

Begitu edit jadi instan, ini tidak butuh apa-apa lagi:

```
Enter          baris baru di bawah
Tab            indent          Shift+Tab   outdent
naik / turun   pindah sel
Ctrl+Z         undo (tumpukan 49 langkah yang sudah ada)
```

Ini yang membuat orang beralih, dan ini yang tidak bisa dikerjakan selama
setiap Enter menunggu server.

## Urutan: dua langkah

**Langkah 1** = Bagian 1 + Bagian 2 + verifikasinya. Kecil, kelihatan hasilnya
hari itu, dan berdiri sendiri kalau Langkah 2 molor.

**Langkah 2** = Bagian 3.

## Verifikasi

Artefaknya adalah layar, jadi yang diuji layar.

- `data/report.db` dikopi ke `report.db.before-0011` SEBELUM migrate, lalu
  baris anak dihitung sebelum dan sesudah.
- `scripts/shoot.mjs <url> <out.png> [w] [h]` di desktop DAN 390px, dan
  **gambarnya dilihat**, bukan teksnya diekstrak. Teks menunjukkan isi, bukan
  komposisi.
- Klaim 378px dari Bagian 2 dibuktikan di 390px: keempat kolom muat, tidak ada
  yang terpotong, tidak ada scroll horizontal.
- Gundih dibuka: 285 baris masih terbaca dan **batang Gantt masih lurus**
  dengan barisnya. Itu yang paling mudah patah.
- Rencana dari `Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500
  Samberah REV1.pdf` ditempel jadi proyek baru, dan durasinya keluar
  **502 / 120 / 5** persis seperti workbook-nya.
- `deriveAlias` diuji pada tiga nama di Bagian 1, dan pada nama kosong.
- `npx tsc` dengan tsconfig tersaring, dan `next build` **ke berkas lalu
  `echo $?`**, tidak lewat pipe. `next build | grep` melaporkan exit code milik
  grep.

## Di luar lingkup

- Drag batang Gantt.
- Data Overall itu sendiri (papan 12), tempat harga per baris, bobot, dan
  tombol pengunci `weight_basis` akan bermuara.
- Tabel baru mana pun. `ensureSchema()` menangani kolom, bukan tabel.

## Pertanyaan terbuka

- Alias belum ditampilkan di `/print/*`. Laporan cetak adalah dokumen milik
  klien dalam format klien, jadi alias masuk ke sana hanya kalau diminta.
- Proyek yang sudah ada `alias`-nya null. Mereka jatuh ke nama panjangnya, dan
  tidak ada backfill: menurunkan alias untuk proyek yang sudah jalan adalah
  keputusan orangnya, bukan efek samping sebuah migration.
