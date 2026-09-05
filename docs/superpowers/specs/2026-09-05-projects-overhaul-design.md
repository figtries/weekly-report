# Projects — desain

Tanggal: 5 September 2026 · Cabang: `v2-foundation` · Papan 16 + 17

## Draf pertama ditolak — ini alasannya, supaya tidak diulang

Draf pertama hari ini merancang `/projects` sebagai daftar proyek dengan dua
tampilan: Kartu dan **Angka** — tabel lintas-proyek berisi Rencana · Aktual ·
Deviasi · Tertunda · Perkiraan selesai · Status. Ditolak penggunanya dengan
kalimat yang tepat sasaran: *"kek beda bgt, portofolio la apa la, g usah."*

Ia benar. Tabel itu warisan `/portfolio`, dan `/portfolio` adalah laporan
**tentang** proyek. Model mentalnya bukan itu. Model mentalnya **Microsoft
Project**: layar pertama berisi proyek-proyekmu, ada tombol tambah, dan
proyeknya **dibangun di situ juga**. Tidak ada dasbor portofolio di MS Project,
dan tidak ada di sini.

Konsekuensinya: analitik lintas-proyek dibuang seluruhnya dari pekerjaan ini,
dan papan 16 (project management) bergabung dengan papan 17 (planner) — karena
"tambah proyek lalu bangun proyeknya di situ" **adalah** planner. Pagar
pekerjaannya digeser, bukan dihapus; lihat bagian terakhir.

## Bentuk sheet MS Project

Penggunanya menunjukkan sebuah ekspor Microsoft Project **sebagai gambaran, bukan
sebagai bahan**. Tidak ada datanya yang masuk ke aplikasi ini, tidak ada bagiannya
yang jadi syarat lulus, dan tidak ada proyeknya yang perlu bisa dibuat ulang. Yang
diambil cuma bentuknya — dan bentuk itu sudah jadi milik MS Project sejak lama:

- **Sheet-nya lima kolom**: `ID · Task Name · Duration · Start · Finish`. Tidak
  ada bobot, tidak ada harga, tidak ada persen. Itu seluruh papan tulisnya.
- **Outline bertingkat** — `1` → `1.1` → `1.1.1` → `1.1.1.1` — dan kodenya
  dihasilkan dari tingkat dan urutan, bukan diketik.
- **`0 days` berarti milestone.**
- **Baris induk dihitung, bukan diketik** — durasinya bentangan anak-anaknya.
- **Durasi ditulis campur satuan** (`days` di sebelah `mons`), dan itu salah satu
  sumber kebingungan yang dibuang di sini; lihat perbaikan nomor 4.
- **Hubungan antar-pekerjaan terlihat sebagai tanggal yang menempel** — satu baris
  selesai, baris berikutnya mulai besoknya. Tapi tidak semuanya begitu: sebagian
  mulai berbarengan, sebagian punya jeda yang disengaja. Penebak rantai harus bisa
  membedakan ketiganya, dan ini bukti kedua — di luar Gundih — bahwa rantainya
  memang ada, hanya tidak pernah dituliskan sebagai hubungan.

Satu hal teknis ikut terbukti sambil membacanya: durasi MS Project adalah **hari
kalender dengan kedua ujung ikut dihitung**, yang persis rumus `inclusiveDays()`
di `lib/plan-curve.ts:23`. Jadi tidak ada konvensi waktu baru yang perlu
dikarang.

## Konsepnya: otak MS Project, muka kita sendiri

Ditetapkan pengguna 5 September 2026: *"kek ms project tapi jangan look-nya
sama, kita bikin versi kita, ambil dari shadcn, animasi semuanya framer-motion,
dan kita benahin apa yang MS Project jelek dan susah dipakai."*

Sebelas hal yang diperbaiki. Nomor 1–6 adalah keputusan; 7–11 sudah jadi aturan
repo dan hanya ditegakkan di sini.

1. **Toggle "Auto vs Manually Scheduled" tidak ada.** Ini sakelar paling
   membingungkan di MS Project: dua baris yang kelihatan sama berperilaku
   berbeda, dan tidak ada di layar yang mengatakan kenapa. Kita tidak punya
   mode. Semua baris berlaku sama.
2. **Baris ringkasan selalu dihitung, tidak pernah bisa diketik.** Di MS Project
   kamu bisa mengetik durasi pada baris ringkasan; ia diam-diam berhenti
   menjumlahkan anaknya, dan sejak itu jadwalnya berbohong. Di sini sel
   ringkasan bukan input — ia teks hasil hitungan.
3. **Milestone adalah sakelar, bukan "ketik 0 hari".** `0 days` adalah cara MS
   Project menuliskannya, bukan cara orang memikirkannya. Barisnya punya tombol
   Milestone; durasinya jadi nol karena ia milestone, bukan sebaliknya.
4. **Satu satuan durasi: hari kalender.** MS Project mencampur `days`, `wks` dan
   `mons` dalam satu kolom, dan "hari" di sana bisa berarti hari KERJA tergantung
   kalender proyek — dua ladang ranjau bertumpuk. Kita simpan hari kalender,
   selalu. Mengetik "10 bulan" diterima dan langsung diterjemahkan jadi 300 hari
   **di depan mata**, bukan disimpan sebagai satuan lain.
5. **Menautkan pekerjaan tidak digambar tangan.** Aplikasi menebak dari tanggal
   yang sudah ada dan bertanya dengan kalimat: *"Pengiriman sepertinya menunggu
   Fabrikasi. Betul?"* → Iya / Bukan. Tidak ada panah yang ditarik, tidak ada
   dialog Predecessors/Lag/Type. Penebak harus membedakan tiga hal: **menyambung**
   (satu selesai, berikutnya mulai besoknya), **berbarengan** (beberapa baris
   mulai di hari yang sama), dan **jeda yang disengaja** (ada hari kosong di
   antaranya). Yang ketiga tidak boleh dipaksa jadi rapat.
6. **Tidak ada yang bergeser diam-diam.** Setiap pergeseran menampilkan
   akibatnya lebih dulu — *"6 pekerjaan ikut mundur. Selesai proyek 15 Des → 24
   Des"* — lalu Terapkan atau Batal, dan bisa dibatalkan sesudahnya.
7. **Baris setinggi ≥44px dan benar di 390px.** MS Project tidak punya versi
   ponsel sama sekali.
8. **Indent/outdent di Tab / Shift+Tab**, dengan tombol yang kelihatan di
   sampingnya — bukan disembunyikan di ribbon.
9. **Elemen dari shadcn, gerak dari framer-motion.** Dengan satu pengecualian
   yang sudah dibuktikan: **animasi masuk saat halaman dimuat adalah keyframe
   CSS**, karena `motion.div` menuliskan `initial` ke HTML dari server dan
   layarnya kosong sampai hidrasi selesai (diukur 30 Agustus 2026). Di layar ini
   pengecualian itu nyaris tidak menggigit — hampir semua gerak di sheet dipicu
   state setelah halaman hidup: baris berpindah tingkat, batang Gantt memanjang,
   panel pratinjau masuk.
10. **Radix per layar, bukan per baris.** Sheet ini persis perulangan yang bisa
    melebihi 20 baris — 285 di Gundih. Di dalam baris:
    `<input>` / `<select>` native berbaju kelas shadcn. Satu DropdownMenu untuk
    seluruh sheet, disetir id baris yang sedang aktif.
11. **Kalender kerja, hari libur, resource leveling, dan levelling delay tidak
    dibangun.** Itu setengah kerumitan MS Project dan nyaris tidak dipakai di
    proyek EPC seukuran ini.

## Pembagian yang menjelaskan seluruh spec ini

Kalimat penggunanya, 5 September 2026, dan ia lebih tajam daripada apa pun yang
ditulis sebelumnya di dokumen ini:

> *"planing itu kan rencana kita, pasti di projects ini kita planing kan. nah di
> data overall baru kita input yg actual."*

**Projects adalah tempat merencanakan. Data Overall adalah tempat memasukkan
kenyataan.** Sheet di layar ini tidak pernah menerima satu angka progress pun —
ia menerima pekerjaan, durasi, tanggal dan harga. Itu juga yang menjawab kenapa
kolom di sheet ada enam dan bukan tujuh: kolom progress tidak berada di sini.

## Dua belas keputusan

Disetujui pengguna satu per satu, 5 September 2026.

**1. Layar pertama adalah daftar proyek, dan tidak ada analitik di sana.** Tidak
ada Rencana/Aktual/Deviasi/Tertunda/Perkiraan/Status. Yang ada: judul, tombol
**Proyek baru**, kotak cari, dan kartu-kartu.

**2. Kartu proyek menggambar garis waktunya sendiri.** Nama, klien, dan sebuah
**mini-Gantt**: bentangan proyek digambar kecil dengan garis "hari ini"
melintasinya. Sekali lihat: mana yang belum mulai, mana yang berjalan, mana yang
seharusnya sudah selesai. MS Project tidak punya ini — di sana proyek hanyalah
nama berkas. Tanggalnya toh sudah ada, jadi ini keuntungan besar dengan usaha
kecil.

Yang ditolak: kartu berisi persentase progress — proyek yang baru dibuat tampil
0% dan terlihat rusak padahal hanya kosong, dan itu persis cacat yang membuat
draf pertama ditolak.

**3. Membuat proyek adalah dialog empat isian, lalu langsung masuk sheet.** Nama
· Klien · Tanggal mulai · Tanggal selesai. Tidak lebih.

Tanggal selesai diminta — dan itu koreksi terhadap draf sebelumnya, yang
menghitungnya dari pekerjaan terjauh. Alasannya praktis, dari penggunanya:
*"biar enak pas bikin."* Yang dibelinya nyata: Gantt punya bentangan sejak baris
pertama diketik alih-alih tumbuh dari nol, baris-baris `weeks` bisa langsung
dibangkitkan, dan setiap pekerjaan yang melewati tanggal selesai proyek bisa
ditandai saat itu juga.

Yang dihitung sekarang bukan tanggal selesainya, melainkan **selisihnya**:
"pekerjaan terjauh selesai 24 Mei, target kontrak 14 Mei — lewat 10 hari." Itu
kalimat yang berguna; sebuah tanggal yang muncul sendiri tanpa pembanding tidak.

**4. Sheet-nya enam kolom, plus satu yang muncul belakangan.**

```
#         Nama pekerjaan     Durasi     Mulai       Selesai     Harga  [Bobot %]
1         Proyek             502 hari   29/12/2025  14/05/2027  —      —
1.1         Pengadaan        449 hari   29/12/2025  22/03/2027  —      —
1.1.1.1       Terbit PO      milestone  29/12/2025  29/12/2025  —      —
```

`#` adalah kode outline, dihasilkan dari tingkat dan urutan — tidak diketik.
Nama pekerjaan menempel (pinned) saat sheet digeser mendatar. **Bobot tidak
muncul sampai ada satu harga terisi**, dan Harga boleh kosong selamanya tanpa
peringatan apa pun: menyusun jadwal dan memberi harga adalah dua pekerjaan, dan
kolom kosong yang diberi tanda seru terbaca sebagai "kamu belum selesai".

**Nilai kontrak tidak punya kotak isian sendiri.** Ia jumlah seluruh harga baris,
dan Bobot adalah `harga baris ÷ jumlah itu × 100` — persis `lib/setup.ts` hari
ini. Itulah yang membuat bobot tutup di 100 karena konstruksi, bukan karena
keberuntungan, dan itu sebabnya `applySetup` di `lib/mutations.ts` menghitung
ulang alih-alih menerima bobot dari klien.

**5. Durasi, Mulai dan Selesai ketiganya bisa diketik; yang terakhir diketik
menang.** Isi Mulai + Durasi → Selesai dihitung. Ubah Selesai → Durasi dihitung.
Sel yang ikut berubah **berkedip sekali** supaya terlihat aplikasi melakukan apa.
Alasannya: orang lapangan berpikir "ini 5 hari", orang kontrak berpikir "ini
harus kelar 30 April", dan keduanya benar. Memaksa satu arah membuat separuh
pengguna menghitung sendiri di kepala sebelum mengetik.

Yang ditolak: hanya tanggal yang bisa diketik (durasi jadi angka mati, padahal
begitulah orang menyusun jadwal), dan hanya durasi (cara MS Project asli —
tetapi sebelum rantainya ada, baris baru tidak punya tempat di kalender sama
sekali, dan itu justru menghancurkan menit pertama).

**6. Gantt menempel di kanan sheet, dipisah garis yang bisa ditarik.** Baris dan
batangnya sebaris, jadi mengetik durasi langsung terlihat memanjangkan batangnya.
Di 390px pembelahan itu mustahil, jadi di ponsel ia jatuh menjadi dua tab:
**Daftar** dan **Jadwal**. Lebar pemisahnya diingat di `localStorage` —
kenyamanan per-orang, bukan keadaan yang harus bertahan.

**7. Baris masuk dengan diketik atau ditempel dari Excel.** Menempel satu blok:
aplikasi membaca kode WBS di kolom pertama dan menyusun tingkatannya sendiri.
Jalur ini sudah terbukti di repo — register dokumen dibangun persis begitu 4
September (`lib/register-paste.ts`), dan itulah yang membuat 132 dokumen masuk
sekali duduk. Tanpa jalur tempel, 285 baris Gundih tidak akan pernah bisa diuji
di layar ini.

Yang ditunda: "salin dari proyek lain". Ia pintu yang paling sering dipakai
perusahaan dengan pekerjaan berulang, tapi ia pekerjaan sendiri — menyalin
pohon, bobot dan jadwal sambil membuang progress dan dokumennya.

**8. SQLite jadi sumber tunggal daftar proyek.** Ini satu-satunya keputusan draf
pertama yang bertahan utuh, karena ia dipaksa data dan bukan oleh cara
memandang: `WbsItem` di `db.json` (`lib/types.ts:19`) berisi kode, deskripsi,
bobot, volume, satuan, urutan — **dan tidak satu pun tanggal**. Sheet dan Gantt
mustahil di atasnya. Tanggal hanya ada di `node_schedules` (570 baris).

Ikutannya: penunjuk proyek aktif pindah ke tabel baru `app_state` dan dibaca
lewat satu fungsi `getActiveProjectId()`; `PROJECT_ID = 'gundih'` yang ditulis
tangan di empat berkas dicabut, sehingga **Document Control ikut berpindah
proyek** — itu cacat yang tayang hari ini. Empat tujuan lainnya menyusul lewat
penerjemah; lihat bagian "Seluruh aplikasi ikut berpindah proyek".

Yang ditolak, dengan alasannya: **cookie per-browser** (bacaan dinamis; di bawah
`cacheComponents: true` ia memaksa `<Suspense>` mengelilingi setiap bacaan di
aplikasi — tembok yang sudah ditabrak dua kali, lihat `AGENTS.md`; dan tanpa
login "per orang" belum berarti apa-apa), dan **id proyek pada semua rute**
(`/p/[id]/weekly/…` — paling benar dan paling ramah cache, tapi mengganti nama
tiap rute di aplikasi). Menaruh bacaannya di satu fungsi membuat perpindahan itu,
kalau nanti diambil, menyentuh satu berkas dan bukan empat puluh halaman.

**9. Sheet mengedit rencana AKTIF; yang Kontraktual tidak bisa disentuh dari
sini.** Keduanya rencana — bedanya siapa yang boleh mengubah. Kontraktual adalah
yang ditandatangani di kontrak, beku, dan ia bahan pembuktian perpanjangan waktu;
sebuah garis klaim yang bisa diedit dari layar penyuntingan tidak bernilai apa
pun. Aktif adalah revisi terakhir yang disepakati, dan itulah yang dipakai
bekerja.

Di Gundih keduanya hampir identik — **satu baris dari 285** yang berbeda,
`1.4.4.4 Overhaul Centaur 40 at NTP`: Kontraktual 3 Agu → 30 Okt 2026, Aktif
18 Jun → 30 Okt 2026, dimajukan 46 hari dengan tanggal selesai yang sama. Kecil,
tapi persis jenis perbedaan yang jadi isi berkas klaim.

Tidak ada sakelar Kontraktual/Aktif di layar ini. Melihat keduanya berdampingan,
dan memindahkan Aktif menjadi Kontraktual baru ketika klien menyetujui revisi,
adalah papan 18.

**10. Sheet menyimpan sendiri, dan punya Undo.** Sel yang diubah tersimpan
~1 detik setelah orang berhenti mengetik — pola yang sudah dipakai Data Overall
(autosave 1200ms, lihat `AGENTS.md`), dan satu layar yang berperilaku beda
sendiri justru yang membuat orang kehilangan pekerjaannya, karena kebiasaan dari
layar sebelah terbawa ke sini. Kegagalan menyimpan menandai barisnya, tidak
melempar dialog — dialog yang gagal berulang akan berputar selamanya.

Undo wajib, bukan tambahan: keputusan 6 membuat satu tindakan menyentuh puluhan
baris sekaligus, dan tanpa undo satu-satunya jalan pulang adalah menyunting
puluhan baris lagi.

**11. Kelima kotak angka di kepala halaman dibuang.** `Projects` · `Contract
value` · `Earned so far` · `Deferred` · `Reports held` — kelimanya analitik
lintas-proyek, tiga di antaranya sedang menampilkan "—". Jumlah kartu di layar
sudah mengatakan ada berapa proyek.

**12. Wizard `/setup` hilang dari layar; sheet ini penggantinya.** Tab Setup
dihapus dan `/setup` tidak ditautkan dari mana pun. Sheet mengerjakan WBS, harga
dan jadwal sekaligus di satu tempat alih-alih lima langkah. Kodenya
(`SetupWizard.tsx` 668 baris, `PlanCurvePreview.tsx` 120 baris) **dibiarkan dulu,
belum dihapus** — kalau ternyata ada yang belum tercakup, ia masih bisa dibaca.
Menghapusnya adalah pekerjaan terpisah setelah sheet terbukti.

Yang ditolak: menyimpannya sebagai tautan cadangan dari halaman proyek. Dua jalan
untuk pekerjaan yang sama, dan yang satu menulis ke `db.json` sementara yang lain
ke SQLite — itu cara tercepat membuat dua tempat menyimpan angka yang berbeda.

## Keputusan kecil yang diambil sendiri

Dinyatakan supaya bisa dibantah, bukan supaya dianggap final.

| | |
|---|---|
| Sisip/hapus baris di tengah | kode `#` di bawahnya dinomori ulang otomatis — kode itu hasil, bukan ketikan |
| Memindahkan baris | tarik pegangan di kiri baris, atau `Alt+↑/↓` |
| Membuat induk | sebuah baris menjadi induk ketika baris di bawahnya di-indent, persis MS Project |
| Tombol Milestone | di menu `⋯` baris, bukan kolom sendiri — kolom ketujuh yang kosong 95% waktu adalah pemborosan lebar |
| Warna batang Gantt | abu-abu gelap netral. Biru dan merah sudah punya arti tetap (aktual vs rencana); memakainya di planner, yang belum punya aktual, merusak arti itu ketika laporan mingguan tersambung |
| Baris yang melewati tanggal selesai proyek | batangnya ditandai, tidak diblokir — jadwal boleh salah dulu, orang yang membetulkan |

## Bentuk layar

### `/projects` — layar pertama

Judul · tombol **Proyek baru** · kotak cari (nama, klien) · kartu-kartu.

Kartu: nama utuh · klien · mini-Gantt dengan garis hari ini · rentang tanggal ·
menu `⋯` (Ganti nama · Arsipkan · Hapus). Proyek yang sedang jadi proyek aktif
aplikasi ditandai jelas. Arsip disembunyikan di balik tautan `Arsip (n)`
(`projects.archived_at` sudah ada, tinggal dipakai).

Belum ada proyek sama sekali → satu kartu besar "Bikin proyek pertama".

### `/projects/[id]` — sheet + Gantt

Kepala tipis: nama proyek · rentang tanggal (dihitung) · jumlah baris · tombol
**Jadikan proyek aktif** kalau ia belum aktif.

Tombol itu ada — dan sengaja kecil — karena penunjuknya global dan belum ada
login: kalau sekadar membuka proyek tetangga ikut memindahkan konteks orang yang
sedang mengisi laporan, itu jebakan. Membuka adalah menyunting jadwalnya;
menjadikannya aktif adalah mengarahkan sisa aplikasi ke sana.

Badan: sheet di kiri, Gantt di kanan, pemisah yang bisa ditarik. Di bawah 768px:
tab **Daftar** / **Jadwal**.

Baris punya tiga rupa: **pekerjaan** (leaf, semua sel bisa diketik),
**ringkasan** (punya anak — durasi/mulai/selesai jadi teks hasil hitungan, tebal),
dan **milestone** (durasi nol, digambar wajik di Gantt).

Sebuah baris ringkasan juga bisa ditandai **unit pelaporan** — SPK / Paket / Lot
/ Area, labelnya kata si klien. Ini bukan tambahan yang dikarang: `isReportingUnit`
sudah ada di `lib/schema.ts:95`, empat baris Gundih memakainya (`1.2` SPK-002,
`1.3` SPK-003, `1.4` SPK-004, `1.4.4` SPK-007), dan seluruh mesin laporan
berdiri di atasnya — menandai sebuah node menormalkan subtree-nya ke 100 dan
memberinya bagiannya sendiri di PDF. Sheet yang tidak bisa menandainya akan
menghasilkan proyek yang **tidak akan pernah bisa** mencetak laporan Pertamina,
jadi ia bagian dari kelengkapan layar ini, bukan perluasannya. Bentuknya sama
dengan Milestone: satu sakelar pada baris, plus satu kotak label.

Unit bisa bersarang — SPK-007 duduk di `1.4.4` di dalam cabang `1.4` milik
SPK-004, dan keduanya tetap berdiri sendiri di laporan. Aturannya sudah tertulis
di `AGENTS.md`: bobot sebuah unit adalah subtree-nya **dikurangi** unit mana pun
di dalamnya; tanpa pengurangan itu totalnya mencapai 114%.

### Panel pratinjau pergeseran

Muncul saat sebuah pergeseran menyentuh baris lain. Isinya kalimat, bukan tabel:
berapa pekerjaan ikut bergeser, tanggal selesai proyek dari-ke, dan daftar yang
terpengaruh (dibatasi enam, sisanya dihitung). Dua tombol: Terapkan · Batal.

## Perubahan data

Jenis migrasi yang aman — satu tabel baru dan kolom-kolom nullable, yang di
SQLite menjadi `CREATE TABLE` dan `ALTER TABLE ADD COLUMN`. Yang berbahaya adalah
migrasi yang **membangun ulang** tabel yang sudah ada; itu yang menyeret 357
baris `doc_stages` ikut terhapus pada Agustus 2026. Tetap salin `data/report.db`
sebelum `drizzle-kit migrate`, dan hitung baris anaknya sesudahnya.

```ts
// tabel baru — satu baris, penunjuk proyek aktif aplikasi
export const appState = sqliteTable('app_state', {
  id: text('id').primaryKey().default('singleton'),
  activeProjectId: text('active_project_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  updatedAt: now(),
});

// projects bertambah dua kolom
updatedAt:    text('updated_at'),      // urutan "terakhir disentuh"
legacyJsonId: text('legacy_json_id'),  // SEMENTARA — mati saat papan 08-14 selesai

// wbs_nodes bertambah satu
isMilestone: integer('is_milestone', { mode: 'boolean' }).notNull().default(false),

// projects juga menampung kepala laporan yang dituntut ProjectInfo — lubang 2
// yang ditemukan spike. Semuanya teks, semuanya nullable.
workLocation:     text('work_location'),
documentNoWeekly: text('document_no_weekly'),
documentNoDaily:  text('document_no_daily'),
signatureLeft:    text('signature_left'),   // JSON {company,name}
signatureRight:   text('signature_right'),
```

`isMilestone` dibutuhkan karena keputusan 3: milestone adalah sifat baris, bukan
akibat durasi nol. Tanpa kolom itu, satu pekerjaan yang kebetulan berdurasi satu
hari tidak bisa dibedakan dari sebuah titik.

`onDelete: 'set null'` disengaja: menghapus proyek aktif membuat penunjuknya
kosong, dan `getActiveProjectId()` jatuh ke proyek pertama yang tidak terarsip —
persis perilaku `activeProject()` di `lib/workspace.ts:52` hari ini, yang menolak
membiarkan aplikasi jadi kosong.

Backfill sekali jalan: `gundih.legacy_json_id = 'p-utama'` dan
`app_state.active_project_id = 'gundih'`. Proyek `"adasd"` di `db.json` (0 baris
WBS, 0 minggu, sisa uji coba) **tidak dibawa**; datanya tetap utuh di sana, ia
hanya tidak ikut pindah.

## Seluruh aplikasi ikut berpindah proyek — lewat satu penerjemah

Ini yang diminta pengguna, dan kalimatnya menentukan bentuk seluruh bagian ini:
proyek dibuat di Projects, lalu **Dashboard, Weekly Progress (beserta Data
Overall), Daily, Reports dan Document Control semuanya membaca proyek itu.**
Ganti proyek, kelimanya ikut pindah.

Halangannya: dari kelima itu hanya Document Control yang sudah di SQLite. Empat
sisanya membaca `db.json` — **24 berkas**, 21 di antaranya halaman atau layout,
di atas **2.561 baris** lib yang berbicara dalam bentuk data lama (`analysis`
1015 · `mutations` 500 · `actions` 300 · `rollup` 289 · `types` 287 · `progress`
124 · `scurve` 46).

**Penyelesaiannya satu fungsi, bukan dua puluh satu halaman.** Sebuah penerjemah
menyusun bentuk `Database` yang lama dari SQLite untuk proyek mana pun. Setiap
halaman dan setiap baris lib itu berjalan apa adanya — mereka tidak perlu tahu
datanya sekarang datang dari mana. `readDb()` yang memanggilnya, jadi titik
sentuhnya satu.

### Ini sudah dibuktikan, bukan diperkirakan

Sebuah spike menyusun `wbsItems` dan `weeks[].leafData` dari SQLite, lalu
menjalankannya lewat `computeRollup` + `promoteNestedSpkContracts` +
`computeGrandTotal` — mesin yang sama persis yang dipakai halaman-halaman itu:

```
W43 lewat penerjemah        tercatat benar di AGENTS.md
aktual        80,0365   →   80,04     cocok
target        75,3686   →   75,37     cocok
deviasi       +4,6678   →   +4,67     cocok
bobot        100,0000   →   100,000   cocok
285 baris WBS · 60 minggu, keduanya utuh
```

### Dan penerjemah ini memperbaiki angka yang sedang tayang

Perbandingan yang sama terhadap `db.json` meleset jauh — dan yang keliru adalah
`db.json`:

```
minggu    SQLite    db.json
    30    60,6358   60,2570
    36    68,1985   70,1389   ← yang tampil di aplikasi hari ini
    37    68,5129   67,1913   ← TURUN dari 70,14; progress mundur
    43    80,0365   67,1913   ← beku tujuh minggu
```

`db.json` berhenti di minggu 36 dan ekornya tidak koheren: minggu 37 lebih kecil
daripada minggu 36. Itu mustahil, ia sudah ada di sana sekarang, dan ia hilang
sendiri begitu Gundih dibaca lewat penerjemah.

### Empat lubang yang ditemukan spike, dan penambalannya

1. **`progressMethod: 'linked'` tidak ada di bentuk lama.** Dipetakan ke
   `lumpsum` — benar secara makna: angkanya sudah dihitung register dokumen, dan
   bentuk lama memang tinggal membacanya.
2. **`ProjectInfo` menuntut kolom yang tidak dipunyai `projects`** —
   `workLocation`, `documentNoWeekly`, `documentNoDaily`, `signatureLeft`,
   `signatureRight`, `weekAnchorEndDate`. Semuanya teks kepala laporan.
   Ditambahkan sebagai kolom nullable; `weekAnchorEndDate` diturunkan dari
   `weeks` kalau kosong.
3. **`daily`, `catalogs` dan `photoMeta` belum punya tabel di SQLite.** Diambil
   dari kembaran JSON lewat `legacy_json_id` selama ada, dan **kosong** untuk
   proyek baru — yang memang jawaban benar buat proyek yang belum pernah punya
   laporan harian. Ini utang yang jatuh tempo di papan 14.
4. **`targetWF` harus diturunkan per leaf per minggu.** Versi spike memanggil
   `planCurve` di dalam perulangan, yang O(n²); yang asli menghitung deret tiap
   leaf sekali lalu membacanya per minggu.

### Utangnya disebut terang-terangan

Penerjemah adalah lapisan yang bisa berbohong: kalau ia salah sedikit, setiap
halaman salah sedikit. Karena itu ia dijaga oleh satu uji yang keras —
angka Gundih lewat penerjemah harus tetap 80,0365 / 75,3686 / 100,0000 — dan ia
**dirancang untuk mati**. Halaman dipindahkan ke SQLite satu per satu di papan
08–14; ketika yang terakhir pindah, penerjemah dan `legacy_json_id` dihapus
bersama-sama.

## Urutan membangun

Papan 16 dan 17 memang bergabung, dan itu lebih besar dari satu nomor. Supaya
tetap ada yang bisa dipegang di tiap titik berhenti:

1. **Fondasi** — `app_state`, `getActiveProjectId()`, empat `PROJECT_ID` dicabut,
   `/portfolio` dialihkan ke `/projects`. Titik berhenti: Document Control ikut
   berpindah proyek.
2. **Penerjemah** — satu fungsi, dipanggil `readDb()`, dijaga uji 80,0365 /
   75,3686 / 100,0000. Titik berhenti: kelima tujuan ikut berpindah proyek, dan
   ekor `db.json` yang tidak koheren di minggu 37+ hilang dengan sendirinya.
3. **Layar pertama** — `/projects`, kartu + mini-Gantt, cari, arsip, dialog
   proyek baru. Titik berhenti: proyek bisa dibuat dan dilihat.
4. **Sheet** — enam kolom, tiga rupa baris, Tab/Shift+Tab, segitiga
   durasi/mulai/selesai. Titik berhenti: sebuah proyek empat tingkat berisi
   pekerjaan dan milestone bisa diketik utuh dari nol, dan durasinya benar.
5. **Gantt** — batang sebaris dengan barisnya, pemisah yang bisa ditarik, tab di
   ponsel. Titik berhenti: Gundih 285 baris tergambar.
6. **Tempel dari Excel.** Titik berhenti: 285 baris masuk sekali duduk.
7. **Penebak rantai + pratinjau pergeseran.** Titik berhenti: keputusan 5 dan 6
   berjalan.

## Yang TIDAK dibangun

- **Analitik lintas-proyek** — Rencana/Aktual/Deviasi/Tertunda/Perkiraan/Status.
  Dibuang dari pekerjaan ini seluruhnya. Tempatnya nanti di papan 19.
- **Baseline berversi** (Kontraktual terkunci vs Aktif) — papan 18.
- **Login, tim dan peran** — papan 22. Tidak ada autentikasi untuk dibangun di
  atasnya: tidak ada `next-auth`, tidak ada session, `users` dan `memberships`
  sama-sama 0 baris.
- **"Salin dari proyek lain"** — keputusan 7.
- **Kalender kerja, hari libur, resource leveling** — nomor 11 di daftar
  perbaikan.
- **Wizard `/setup` tidak ditulis ulang.** Ia dibiarkan utuh dan masih menulis ke
  `db.json`; ia berhenti jadi tab tingkat atas. Penggantinya adalah sheet ini.
- **Halaman v1 tidak ditulis ulang di atas SQLite.** Mereka tetap membaca bentuk
  data lama; yang berubah cuma dari mana bentuk itu datang. Menulis ulangnya
  adalah papan 08–14, dan itulah yang nanti membunuh penerjemah.
- **Tabel `daily`, `catalogs` dan `photoMeta` tidak dibuat di SQLite.** Selama
  belum ada, keduanya diambil dari kembaran JSON dan kosong untuk proyek baru.
  Jatuh tempo di papan 14.

## Verifikasi

1. **`next build` hijau**, ditulis ke berkas lalu `echo $?` — jangan pernah lewat
   pipe, karena `next build | grep` melaporkan exit code grep. `app/layout.tsx`
   membaca daftar proyek, jadi jalur baca yang baru **harus** tetap ter-cache
   atau setiap rute gagal build di `/_not-found`.
2. **Hitung baris anak sesudah migrasi**: `doc_stages` 512 · `documents` 454 ·
   `leaf_progress` 7.568 · `node_schedules` 570 · `wbs_nodes` 285 · `weeks` 60.
   Sama sebelum dan sesudah, atau migrasinya dibatalkan.
3. **Sebuah proyek diketik dari nol** — empat tingkat outline, beberapa
   milestone, beberapa pekerjaan biasa — lalu durasi yang keluar diperiksa
   terhadap `inclusiveDays()`: mengetik Mulai + Durasi harus menghasilkan Selesai
   yang sama dengan mengetik Mulai + Selesai lalu membaca Durasi. Segitiga
   keputusan 5 harus tertutup dari ketiga arah.
4. **Penerjemah dijaga sebuah uji tetap** (`scripts/verify-adapter.ts`, dijalankan
   `node --import ./scripts/ts-resolve.mjs`): Gundih lewat penerjemah, masuk
   `computeRollup` + `promoteNestedSpkContracts` + `computeGrandTotal`, harus
   keluar **80,0365 aktual · 75,3686 target · +4,6678 deviasi · 100,0000 bobot**
   pada W43, dengan 285 baris dan 60 minggu utuh. Ini pagar terpenting seluruh
   pekerjaan: penerjemah yang meleset sedikit membuat setiap halaman meleset
   sedikit, diam-diam.
5. **Gambar, bukan teks** — `scripts/shoot.mjs` pada `/projects`,
   `/projects/gundih` (sheet + Gantt), dialog proyek baru, dan Dashboard proyek
   baru; desktop dan 390px; lalu benar-benar dilihat. Browser pane di lingkungan
   ini tidak pernah melakukan komposit, jadi `computer{action:"screenshot"}`
   selalu gagal.
6. **Kelima tujuan benar-benar ikut berpindah** — jadikan proyek kedua aktif,
   lalu buka Dashboard, Weekly Progress, Daily, Reports dan Document Control satu
   per satu. Kelimanya harus menunjukkan proyek itu (atau keadaan kosongnya),
   tidak satu pun boleh menampilkan angka atau dokumen Gundih.
7. **Menghapus proyek aktif tidak mengosongkan aplikasi** — penunjuknya jatuh ke
   proyek berikutnya.
8. **Angka Gundih di layar naik, bukan bergerak liar.** Sebelum: minggu 36
   berbunyi 70,14% lalu minggu 37 turun ke 67,19%. Sesudah: deret naik monoton
   sampai 80,04% di minggu 43. Perubahan ini disengaja — catat, jangan
   diperlakukan sebagai regresi.

## Dokumen yang ikut diperbarui — setelah spec ini disetujui

Keputusan papan nomor 15, *"Planner has NO dependencies"*, **dicabut**. Ia
dikunci 27 Agustus 2026 karena jadwal Gundih tidak memakai satu pun relasi FS/SS.
Benar sebagai pembacaan kolom, salah sebagai kesimpulan: relasinya ada sebagai
**tanggal yang menempel** — dan pola itu muncul lagi di ekspor MS Project mana
pun yang dibaca, bukan cuma di Gundih.

`AGENTS.md`, memori blueprint, dan artefak rencana
`https://claude.ai/code/artifact/d3dfeed6-8a05-4ba8-87f5-2affe3da7c47`
diperbarui setelah spec ini disetujui — bukan sebelum, supaya aturan repo tidak
terlanjur berubah kalau desainnya masih direvisi. Artefak diterbitkan dengan URL
itu sebagai `url`, atau yang tercipta duplikat.
