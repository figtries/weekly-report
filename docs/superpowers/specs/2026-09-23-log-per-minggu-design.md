# Log per minggu di panel aktivitas — desain

Tanggal: 23 September 2026 · Cabang: `main` · Di bawah papan 12 (Data Overall)

Dokumen ini menjawab kalimat penggunanya:

> "aku mau ada data tiap weeknya yg start dari pertama dia ngisi or based on plan
> yg sudah ada … kalo ternyata pas udh weeknya plan nya dan blm juga 100% tolong
> di remind … org g perlu nginput data satu satu update tiap week gonta ganti
> gitu, cukup klik dari detail data overallnya"

dan kalimat yang menjelaskan isi cepatnya:

> "kek misal dia mau rata 20% selama 4 minggu gitu … or misal dia mau 8% selama
> 10 minggu … jgn sampai maksain juga, ttp kita perhatikan estetika dan
> kelancarannya"

**Masalahnya bukan data, tapi jalan masuknya.** `leaf_progress` sudah menyimpan
satu baris per minggu per leaf sejak papan 01. Yang tidak ada adalah cara melihat
dan mengisi riwayat SATU aktivitas di satu tempat: mengisi mundur tiga minggu hari
ini berarti ganti minggu di week bar, buka aktivitasnya, isi, tutup, ganti minggu
lagi — tiga kali.

## Keputusan yang dikunci (sesi 23 Sep 2026)

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | Minggu mana yang bisa diisi | Minggu dalam rentang log (lihat Aturan 1) |
| 2 | Minggu yang belum datang | Tampil, terkunci; ditekan → satu pertanyaan "Open it anyway?", tanpa pengaman lain |
| 3 | Di mana pengingat | Chip di baris map · kotak di panel + baris log · dua tombol filter di atas map |
| 4 | Angka minggu lampau melewati minggu sesudahnya | Minggu sesudahnya IKUT NAIK (dan sebaliknya ikut turun), disebut sebelum Save |
| 5 | Minggu yang sudah di-approve | Terkunci, dibuka dengan satu pertanyaan |
| 6 | Bentuk | A: daftar minggu; pill persen di kanan baris adalah tombolnya; editor terbuka DI BARIS ITU |
| 7 | Isi cepat | "Repeat weekly": *Add [8]% [each week / in total] for [10] weeks from W45*, pratinjau langsung di bar |
| 8 | Kapan mengingatkan | 3 minggu terakhir plan (*due soon*), lalu setelahnya (*late*) sampai 100% |
| 9 | Due soon untuk siapa | Semua yang belum 100%, termasuk yang on track |
| 10 | Gundih (db.json) | Log dan pengingat tampil; minggu lampau tidak bisa diubah dari log |

Mockup yang disetujui: bentuk A dengan editor di baris (interaktif) dan mockup
pengingat, keduanya dari sesi brainstorming yang sama.

## Aturan (kebenaran, bukan selera)

**1. Rentang log.** Dari `min(minggu mulai plan, minggu pertama ada catatan)`
sampai `max(minggu selesai plan, minggu ini bila belum 100%)`. Aktivitas yang
belum dijadwalkan: dari minggu pertama ada catatan sampai minggu ini; kalau belum
ada catatan juga, log tidak tampil dan panelnya tetap seperti sekarang.
"Minggu ini" = `currentWeekOf(db)` — satu aturan untuk setiap proyek.

**2. Nilai tiap minggu = catatan terakhir di minggu itu atau sebelumnya.** Itu
aturan carry-forward yang sudah dipegang `lib/progress-sqlite.ts`. Baris yang
punya catatan sendiri digambar biru penuh; baris yang mewarisi, biru pucat
dengan angka abu-abu. Plan tiap minggu diambil dari kurva yang sama dengan
laporan (`targetWF / bobot`), jadi tick merah di log = angka plan di laporan.

**3. `lib/progress.ts` tetap satu-satunya yang memutuskan persen.** Log membaca
dan menulis lewat jalur yang sama dengan panel hari ini. Untuk `qty` dan
`milestone` yang disimpan adalah buktinya (quantity, stages yang dicapai);
persennya diturunkan dari situ.

**4. Ikut naik / ikut turun = MENYALIN BUKTI, bukan menyalin angka.** Mengisi
W44 dengan nilai yang melewati catatan W45 membuat W45 menerima entri yang sama
dengan W44 (quantity yang sama, stages yang sama, atau persen ketik yang sama).
Menurunkan W45 di bawah catatan W44 menurunkan W44 dengan cara yang sama. Hanya
minggu yang PUNYA catatan sendiri yang bergeser; minggu yang mewarisi sudah
ikut dengan sendirinya. Kurva aktual tidak pernah turun.

**5. Satu fungsi murni untuk pratinjau dan server.** `lib/week-log.ts` menghitung
rentang, geseran (Aturan 4) dan isi cepat. Layar memakainya untuk pratinjau,
server memakainya lagi saat menyimpan — polanya sama dengan `changeFor` di
`lib/work-kind-apply.ts`. Kalimat "W45 will also move to 35.0%" tidak boleh
berjanji sesuatu yang tidak ditulis server.

**6. Banyak minggu, satu transaksi, satu Undo.** Isi cepat 10 minggu adalah
satu Save. Aksi tulis mengembalikan keadaan SEBELUM (baris `leaf_progress` dan
`milestone_progress` tiap minggu yang disentuh, atau "tidak ada" untuk minggu
yang tadinya kosong). Undo menulis keadaan itu kembali — termasuk MENGHAPUS
baris yang tadinya tidak ada, karena baris kosong dan baris berisi 0% tidak sama
di bawah carry-forward.

**7. Kunci.**
- Minggu setelah minggu ini: dikunci di layar saja. Pertanyaan: *"W56 hasn't
  started yet. Open it anyway?"*. Tidak disimpan; menutup panel mengunci lagi.
- Minggu yang punya baris `approvals`: dikunci di layar DAN di server. Server
  menolak menulis minggu bertanda tangan kecuali permintaannya membawa
  konfirmasi, karena tanda tangan yang diam-diam mengikuti angka baru tidak
  bernilai dalam sengketa. Pertanyaan: *"W44 is signed. Change it anyway?"*.
  Geseran (Aturan 4) yang menyentuh minggu bertanda tangan menanyakan hal yang
  sama sebelum Save. Panel approval sudah menunjukkan selisihnya.

**8. Isi cepat hanya untuk `lumpsum` (persen) dan `qty`.** Mulai dari nilai
minggu sebelum minggu pertama rentang; "each week" menambah X tiap minggu,
"in total" membagi X rata ke N minggu. Berhenti di 100% (atau quantity total),
dan kalimat hasilnya menyebut minggu 100% tercapai. Untuk `qty`, satuannya
satuan aktivitas itu (*Add [5] m each week…*). Stages dan one-off hanya punya
"This week" — tahapan dicentang di minggu tercapainya, bukan dibagi rata.
Sumber (`source`) baris hasil isi cepat ditulis `manual` untuk persen dan `qty`
untuk quantity, sama seperti isian tangan.

**9. Pengingat dihitung di `lib/worklist.ts`, bukan di layar.**
- *late* = minggu selesai plan < minggu yang dibuka, dan belum 100%. Ini `stuck`
  yang sudah ada — tidak ada daftar kedua.
- *due soon* = minggu selesai plan ∈ [minggu yang dibuka, +2], belum 100%.
  Konstanta `DUE_SOON_WEEKS = 3` (plan selesai W48 → W46, W47, W48).
- "Belum 100%" memakai `isComplete` (≥ 99.995) yang sudah ada.
- Diukur terhadap minggu yang DIBUKA, sama seperti `stuck` dan antrean minggu
  ini, supaya map satu minggu bicara tentang satu minggu.

`buildOverallMap` hanya membaca: leaf mendapat `lateBy` / `dueIn`, setiap cabang
mendapat `lateCount` / `soonCount`, dan peta mendapat total `soon` di samping
`stuck` yang sudah ada.

**10. Gundih.** Riwayat dibaca dari `db.weeks` (snapshot per minggu). Pill
minggunya tampil tapi tidak bisa ditekan; minggu yang sedang dibuka tetap diisi
lewat angka besar seperti sekarang. Aksi tulis log menolak proyek
`legacyJsonId` dengan pesan, bukan diam-diam. Alasannya: riwayat Gundih cocok
dengan PDF bertanda tangan sampai papan 08 merekonsiliasinya.

## Layar

### Panel aktivitas (`ActivityPanel`)

Urutan dari atas: kepala → kartu angka besar (tidak berubah) → **kotak
pengingat** (bila ada) → **Week by week** → Price and weight → Schedule → tombol
bawah (tidak berubah).

**Kotak pengingat**
- Late (kuning, `warn` / `warn-soft`): judul *"2 weeks late"*, isi *"Plan ended
  W48. Still 20% to go."*
- Due soon (biru, `chart-1`): judul *"Ends in 2 weeks"* / *"Ends this week"*, isi
  *"Plan ends W48. 40% to go."*

**Week by week**
- Judul kiri *"Week by week"*, kanan *"Tap a figure to change it"*.
- Baris ≥ 44px: kiri nomor minggu + tanggal akhir minggu (`en-GB`, "20 Oct"),
  minggu ini diberi titik biru; tengah bar 6px (aktual biru, tick plan merah);
  kanan PILL persen (tinted `primary/7`, solid biru di bawah pointer — pola yang
  sama dengan "Change").
- Baris minggu selesai plan: label kecil *"Plan ends"* di bawah nomornya. Baris
  setelahnya (late): latar `warn-soft`, label *"Late"*.
- Terkunci: pill abu-abu dengan ikon gembok.
- Panjang > 10 baris: tampil 8 minggu yang berakhir dua minggu setelah minggu
  ini (supaya dua minggu terkunci berikutnya tetap kelihatan sebagai konteks),
  plus tombol *"Show all N weeks"*. Baris late dan baris yang sedang diedit
  selalu tampil.
- Pill di baris minggu yang sedang dibuka TIDAK membuka editor kedua: ia
  menggulir ke angka besar dan memfokuskannya. Satu minggu, satu tempat edit.

**Editor di baris** — satu saja yang terbuka pada satu waktu, dibuka dengan
`Expand`, di bawah baris yang ditekan:
- Segmen *This week* / *Repeat weekly* (Repeat tidak ada untuk stages/one-off).
- *This week*: −/+ dan angka tanpa kotak dengan garis di bawahnya (bahasa yang
  sama dengan angka besar); untuk qty/stages, `ProgressEntry` yang sudah ada.
  Baris kecil *"Plan W45 · 21.4%"*. Geseran: *"W45 will also move to 35.0%"*
  di pita kuning. Tombol *Cancel* / *Save W44*.
- *Repeat weekly*: kalimat *Add [8]% [each week] for [10] weeks from W45*;
  "each week" adalah pill yang bergantian dengan "in total". Hasil:
  *"W45 → W54 · ends at 90.0%"*, bila perlu *"Reaches 100% in W52"*. Rentang
  yang masuk minggu depan: *"W56 hasn't started. Apply will ask to open it."*
  Tombol *Cancel* / *Apply to 10 weeks*.
- Pratinjau: bar memanjang dengan biru muda, pill bergaris putus-putus.
- Galat input di tempat: *"Enter an amount above 0"*, *"Enter at least 1 week"*,
  *"Enter a figure from 0 to 100"*.
- Setelah simpan: toast *"Filled W45–W54"* / *"Saved W44"* dengan *Undo*,
  beberapa detik. `onSaved(id, pctMingguYangDibuka)` dipanggil supaya bar map
  ikut bergerak (`withOptimistic`), lalu refresh.

### Map (`OverallMap`)

- Kalimat *"N activities are past their finish week… See them on Check"*
  diganti DUA tombol filter, pola `lens` yang sama dengan *Show only these*:
  *"12 late"* (kuning) dan *"5 ending soon"* (biru), di bawahnya *"Press one to show
  only those on the map"*. Tombol hanya muncul bila jumlahnya > 0. Halaman Check
  tidak disentuh.
- Leaf: chip *"Late 2 wks"* / *"Ends in 2 wks"* / *"Ends this week"* di bawah nama.
  Bukan "Due": map sudah punya chip biru *"Due this week"* yang artinya
  terjadwal minggu ini, dan dua chip "due" dengan arti berbeda di satu baris
  adalah satu baris yang membuat dua pernyataan.
- Cabang: *"3 late"* · *"2 ending soon"* di bawah nama, supaya ketemu walau
  tertutup.
- Sudah 100%: tanpa chip.

Semua teks bahasa Inggris, tanpa em dash. Nomor minggu memakai en dash
(`W45–W54`) seperti yang sudah dipakai panel.

## Kode

| Berkas | Isi |
|---|---|
| `lib/week-log.ts` *(baru)* | `logRange`, `cascade` (Aturan 4), `repeatFill` (Aturan 8). Murni, tanpa I/O |
| `lib/worklist.ts` | `soon: SoonEntry[]`, `DUE_SOON_WEEKS` |
| `lib/overall-map.ts` | `lateBy`, `dueIn`, `lateCount`, `soonCount`, `OverallMap.soon` |
| `lib/progress-sqlite.ts` | baca riwayat satu leaf; tulis banyak minggu dalam satu transaksi; pulihkan (Undo) |
| `lib/actions.ts` | `getLeafWeeksAction`, `saveLeafWeeksAction`, `restoreLeafWeeksAction` — `projectId` dioper eksplisit seperti aksi panel lainnya |
| `components/weekly/WeekLog.tsx` *(baru)* | daftar, pill, satu editor, pertanyaan kunci, toast |
| `components/weekly/ActivityPanel.tsx` | kotak pengingat + `WeekLog` |
| `components/weekly/OverallMap.tsx` | dua tombol filter, chip baris |
| `scripts/verify-week-log.ts` *(baru)* | lihat Verifikasi |

Batasan dari AGENTS.md yang berlaku di sini:
- Baris log bisa 60+ → elemen native dengan kelas shadcn, tanpa Radix per baris.
- Riwayat dimuat saat panel dibuka, untuk satu leaf; payload map tidak membesar.
- Gerak yang dipicu state memakai framer-motion dengan `MOTION`; bar memakai
  transisi CSS dengan kurva yang sama.
- Tidak ada tabel atau kolom baru → tidak ada pertanyaan deployment.
- Tidak menyentuh `/print/*`.

## Verifikasi

1. `scripts/verify-week-log.ts` di atas fixture (`copyDbFixture`):
   - rentang: mulai lebih awal dari plan; lanjut setelah plan bila belum 100%;
     berhenti di plan bila sudah 100%; tanpa jadwal
   - geseran naik dan turun, untuk persen, quantity dan stages; minggu yang
     mewarisi tidak ditulis
   - isi cepat 8% × 10, total 20% ÷ 4, batas 100%, quantity
   - Undo: keadaan setelah pulih == keadaan sebelum, termasuk baris yang dihapus
   - minggu bertanda tangan ditolak tanpa konfirmasi, diterima dengan konfirmasi
   - proyek `legacyJsonId` ditolak menulis
2. Jumlah late / due soon PHSS Samberah di satu minggu dihitung dari data dan
   dicocokkan dengan yang ditampilkan map.
3. `next build` ke file, lalu `echo $?`.
4. `scripts/shoot.mjs` di desktop dan 390px, DENGAN MENEKAN: pill → Repeat →
   ubah angka → Apply → Undo; angka "Actual now" dan bar map dicek sebelum dan
   sesudah.
5. Push, tunggu deploy Vercel, buka URL-nya, baru dinyatakan selesai.

## Di luar lingkup

- Notifikasi di luar aplikasi (email, push) — butuh login, papan 22.
- Menulis riwayat Gundih — menunggu papan 08.
- Mengubah halaman Check.
- Grafik kurva per aktivitas di panel (varian D) — tidak dipilih.

## Revisi setelah dicoba di production (23 Sep 2026, sore)

Dicoba pada RTC, "PO Material Solar" (stages, plan W1–W1, proyek di-pin W23,
diisi di W36). Empat hal dikoreksi, masing-masing ditanyakan satu per satu:

1. **Gembok mengikuti TANGGAL hari ini, bukan pin "Current".** `LeafWeekLog`
   membawa `todayWeek` (minggu terakhir yang sudah mulai menurut tanggal).
   Versi pertama memakai `currentWeekOf`, sehingga semua minggu setelah pin W23
   dianggap belum datang, dan 100% yang diisi di W36 tersembunyi.
2. **Gembok tidak pernah menyembunyikan angka.** Gembok hanya mencegah edit; bar
   dan persen setiap minggu selalu tampil.
3. **"Fill several weeks" jadi tombol yang selalu terlihat di atas log**, dengan
   dua mode: *Up to a week* (from W.. to W.., each week / in total) dan
   *Until 100%* (minggu terakhir hanya dapat sisanya). Isi cepat di dalam baris
   dihapus: satu jalan saja. Berlaku juga untuk aktivitas stages, sebagai persen
   ketik (`source: 'manual'`), dengan centang stage yang sudah ada dibawa serta.
4. **Tombol "N late" / "N ending soon" membuka DAFTAR**, bukan menyaring map:
   nama, *"Plan ended W1 · 0.0% done · 22 weeks late"*, dan *Open* langsung ke
   panelnya. Baris late di log tidak lagi berlatar kuning dan ikut lipatan
   biasa, karena 22 minggu terlambat menjadi dinding 34 baris kuning.

`rows` di `LeafWeekLog` kini berisi SEMUA minggu proyek, dengan `range` sebagai
rentang yang ditampilkan, supaya pratinjau isi cepat juga tergambar di minggu
di luar rentang.
