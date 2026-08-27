# Project control v2 — rencana kerja

Tanggal: 27 Agustus 2026 · Cabang: `v2-foundation`

## Tujuan

Satu aplikasi tempat sebuah proyek EPC direncanakan, diukur, dan dilaporkan —
dipakai oleh anak magang, tapi keluarannya setara project control 20 tahun.
Excel yang sekarang dipakai (3 workbook, 454 kolom di satu sheet) bukan
pembanding yang harus ditiru; dia daftar penyakit yang harus disembuhkan.

## Yang menggantikan apa

```
BOQ berharga  ──→ bobot ──→ WBS ──→ kurva rencana (diturunkan, tidak disimpan)
                                        │
Form Harian ──(aktual)──→  satu sumber angka  ──→ Ringkasan · Kurva S · Detail · Foto ──→ PDF
                                        │
Document Control ──(IFR 0,5 · IFA 0,3 · AFC 0,2)──┘   leaf engineering, tertaut
```

Korelasi yang sudah dibuktikan terhadap data Gundih: leaf engineering di WBS
(`1.2.1.2.x` → IFR/IFA/AFC dengan workstep 0,5/0,3/0,2) menghasilkan angka yang
sama dengan hitungan EDL Summary dari jumlah dokumen per tahap. Document Control
karena itu bukan modul terpisah — dia sumber progress engineering.

## Empat keputusan yang dikunci 27 Agustus 2026

1. **Planner tanpa dependency.** WBS + bobot (dari harga BOQ) + start/finish.
   Kurva rencana lahir dari situ. Gantt hanya untuk dilihat, tidak ditarik.
   Data Gundih tidak memakai satu pun relasi FS/SS, jadi scheduling engine
   adalah biaya tanpa pembeli.
2. **Satu format laporan dulu.** Bentuk Pertamina/Indoturbine (cover, revision
   table, ringkasan, kurva S, detail, foto) dibuat sempurna lebih dulu.
   Penyusun blok per klien menyusul setelah format ini terbukti.
3. **EDL satu-satunya sumber progress engineering.** Leaf engineering tidak bisa
   diketik manual. Ini yang menutup dua angka yang sudah mulai berbeda di file
   asli (WBS "General/IFR" W4 = 46,67% vs EDL Summary = 63,33%).
4. **Login menyusul.** Peran dikerjakan setelah isinya jadi, bukan sebelum.

## Aturan tampilan (menang atas preferensi lain)

- **Semua elemen dari shadcn-ui.** Tidak ada komponen yang mengarang gaya sendiri.
- **Semua animasi dan transisi dari framer-motion**, lembut dan halus — satu kurva
  dan satu durasi untuk seluruh aplikasi.
- **Responsif di semua device**: iPhone/iPad, Android, Windows, desktop.
  Diverifikasi minimal pada 390px dan desktop, dengan gambar, bukan teks.
- **Bisa dipakai umur 22–60**: kontras tinggi, target sentuh ≥44px, angka besar,
  tidak ada informasi yang hanya muncul saat hover.

Dua pengecualian, keduanya soal kebenaran dan bukan selera:

- **Baris tabel yang bisa lebih dari ~20** memakai kelas shadcn tetapi elemen
  native di dalamnya. Radix Select/Popover di dalam `.map()` 285 baris berarti 285
  context, ref, effect, dan portal. Terlihatnya sama; yang berbeda hanya apakah
  iPhone tersendat.
- **`/print/*` tanpa framer-motion.** Puppeteer memotret tanpa menunggu animasi,
  jadi sheet bisa terpotret setengah jalan.

## Urutan kerja

Satu nomor = satu sesi. Dikerjakan satu, selesai, berhenti. Detail tiap nomor
dibahas saat gilirannya, tidak diputuskan di muka.

### Fase 0 — pondasi (selesai)

| | | |
|---|---|---|
| 01 | Fondasi database | 17 tabel · Drizzle · SQLite |
| 02 | Kurva rencana diturunkan | 30/30 cocok Gundih |
| 03 | Navigasi 12 → 6 | sidebar 488→268 |
| 04 | Dashboard halaman depan | |
| 05 | Visual dashboard | per kontrak · sebaran · laju |

### Fase 1 — data nyata masuk

| | | |
|---|---|---|
| 06 | **Importer Gundih** | 3 workbook → database: 285 WBS · 4 SPK · 60 minggu · 142 dokumen · 415 hari |

**Hasil (27 Agustus 2026): selesai.** `scripts/import-gundih.ts` +
`scripts/verify-import.ts`. Yang dibandingkan dengan PDF `PRGG-00-G0-RPT-002 W43`
halaman 8, semuanya cocok sampai dua desimal:

| | SPK-002 | SPK-003 | SPK-004 | SPK-007 | total |
|---|---|---|---|---|---|
| bobot | 7,07 | 47,65 | 31,04 | 14,24 | **100,00** |
| progress | 100,00 | 97,56 | 67,42 | 39,00 | |
| WF kumulatif | 7,07 | 46,49 | 20,93 | 5,55 | **80,04** |

Satu angka sengaja tidak sama: **target 75,37% terhadap 75,15% di PDF** — lihat
temuan 10. Deviasi karenanya +4,67%, bukan +4,89%. Bobot menutup di
100,000000% dengan unit bersarang tidak terhitung dua kali.

**Register EDL ikut masuk** (`scripts/import-edl.ts`, `scripts/verify-edl.ts`):
28 kategori, 143 dokumen, 102 transmittal, 357 catatan tahap. **20 dari 21
kategori daun cocok persis** dengan "EDL Summary" — jumlah per tahap maupun
persennya. Yang satu lagi adalah cacat di berkas klien, tercatat sebagai temuan
12.

Leaf engineering di WBS **belum ditautkan** ke register itu. Registernya
bertanggal 15 Januari 2026 (W13) sementara laporan mingguannya W43 di bulan
Agustus — tiga puluh minggu terpaut. Menautkannya sekarang akan menarik mundur
progress engineering ke Januari dan merusak total W43 yang barusan cocok.
Penautan adalah pekerjaan 15, dengan register yang seumuran.

Korelasi W13 antara register dan leaf engineering WBS, per disiplin dan tahap:
sepuluh dari lima belas pasangan cocok sampai dua desimal. Yang tidak: General
+3,33 di ketiga tahap (tepat satu dokumen, yaitu `PR-011` dari temuan 12),
Electrical IFR −1,75, dan **Instrument AFC −13,33** — WBS mengaku enam dokumen
lebih banyak sudah AFC daripada yang tercatat di register. Selisih terakhir itu
temuan 8 yang terlihat langsung angkanya.

Satu fakta yang menentukan seberapa besar modul Document Control berpengaruh
pada angka: seluruh leaf engineering di WBS ini bobotnya **0,5709% dari proyek**.
Register menggerakkan angka sekecil itu — tapi dokumen yang tertahan menahan
konstruksi yang bobotnya jauh lebih besar, dan itulah nilai sebenarnya.

Setelah 06, dashboard yang sudah ada menjadi nyata dengan sendirinya; dia sudah
membaca database.

### Fase 2 — bahasa visual

| | | |
|---|---|---|
| 07 | **Design system** | token shadcn + satu kurva gerak framer-motion, dikunci di satu file dan satu halaman contoh |

### Fase 3 — laporan mingguan

| | | |
|---|---|---|
| 08 | Halaman Ringkasan | tabel unit pelaporan + total |
| 09 | Halaman Kurva S | plan · actual · deviasi, per unit dan keseluruhan |
| 10 | Halaman Detail Progress | pohon WBS 285 baris |
| 11 | Halaman Dokumentasi | foto berhalaman |
| 12 | Data Overall workbench | tempat mengolah datanya |
| 13 | **PDF format Pertamina** | cover · revision table · seluruh isi di atas jadi satu berkas |

### Fase 4 — yang mengisi laporan

| | | |
|---|---|---|
| 14 | Form Harian + peran barunya | daily menyusun draft ringkasan mingguan |
| 15 | **Modul Document Control** | EDL/VDRL · transmittal · return code → menggerakkan leaf engineering |

### Fase 5 — membuat proyek dari nol

| | | |
|---|---|---|
| 16 | Project management | membuat dan memilih proyek, wizard setup |
| 17 | Planner | WBS editor · bobot dari BOQ · start/finish · Gantt lihat-saja |
| 18 | Baseline berversi | Kontraktual (terkunci, untuk klaim) vs Aktif (revisi terakhir) |

### Fase 6 — dashboard yang berpikir

| | | |
|---|---|---|
| 19 | Dashboard bulanan | *ahead* · *outstanding* · *warning* · *problem*, beserta dampaknya |

Dashboard berada di belakang karena dia membaca dari laporan mingguan. Dibangun
lebih dulu, dia hanya hiasan yang nanti dibongkar.

### Fase 7 — setelah isinya terbukti

| | | |
|---|---|---|
| 20 | Impor dan ekspor Excel | dua arah, generik |
| 21 | Penyusun blok laporan | format klien lain |
| 22 | Login dan peran | Project Control · Site · Doc Control · viewer klien |

## Temuan pada data sumber (27 Agustus 2026)

Diperiksa langsung terhadap `W43 (Overall).xlsx`, PDF-nya, daily 4 Juni 2026, dan
Engineering Drawing List R2. Dicatat karena tiap barisnya adalah fitur yang harus
membuatnya mustahil terulang.

| # | Temuan | Bukti | Ditutup oleh |
|---|---|---|---|
| 1 | Sampul PDF salah periode | sampul "14 July 2026", isi "14 August 2026" | 13 |
| 2 | Jumlah halaman tidak konsisten | "1 Of 7" vs "Hal 2 of 6" pada PDF 42 halaman | 13 |
| 3 | Header "Data Overall" basi sembilan minggu | DATE 46185 = 12 Jun 2026, 67,96/63,91/−4,05 — sementara Ringkasan W43 75,15/80,04/+4,89 | 06, 12 |
| 4 | Template daily membawa nomor proyek lama | `RUSGTG-00-G0-RPT-001`, lokasi "FIELD TANJUNG", padahal pekerjaan di Gundih | 14 |
| 5 | "Hari ke-" berisi `44236` (serial 9 Feb 2021) | rumus rusak | 14 |
| 6 | Referensi rusak di EDL | `=COUNTA(M10:M202)/#REF!` | 15 |
| 7 | Seluruh kurva `HLOOKUP` ke range mati | `'Data Overall'!$P$7:$FO$299` — sisip satu baris, semua kurva bergeser diam-diam | 06, 09 |
| 8 | Dua sumber kebenaran engineering sudah berbeda | WBS General/IFR W4 = 46,67% vs EDL Summary = 63,33% | 15 |
| 9 | Baseline tidak lagi menggambarkan lapangan | SPK-004 target 14,83% vs aktual 20,93% (+6,10%) | 18 |
| 10 | **Blok PLAN bertentangan dengan kolom tanggal di sebelahnya** | 126 dari 176 leaf, 88,38% bobot proyek. `1.4.3.2` naik rata 1/16 per minggu selama 16 minggu; tanggalnya 105 hari = 15 minggu. `1.4.4.2` melompat 0→100% dalam satu minggu padahal tanggalnya 165 hari | 06, 17 |
| 11 | **Pengiriman tanpa tanggal ditandai `1`** | `QAQC-004/-008/-009/-010/-011` berstatus "APPROVED FOR CONSTRUCTION" dengan `1` di semua kolom tanggal. Membaca tanggal saja membuat A.2.2 terhitung 5 dari 10, bukan 10 | 15 |
| 12 | **Jangkauan `COUNTIF` di EDL Summary basi** | A.2.1 berisi 11 dokumen tetapi ringkasannya menghitung `EDL!$O19:$O28` saja — `PRGG-00-G0-PR-011` di baris 29 tidak pernah ikut terhitung | 15 |
| 13 | **Register 30 minggu lebih tua dari laporannya** | EDL `R2` bertanggal 15 Jan 2026 (~W13); laporan mingguan W43 bertanggal 20 Agu 2026 | 15 |

## Ketika tanggal dan kurva bertentangan, tanggal yang menang

Dikunci 27 Agustus 2026, dan ini keputusan yang paling menentukan bentuk angka
di seluruh aplikasi.

Workbook Gundih menyimpan dua model rencana sekaligus. Sebagian leaf memang
tersebar linier per hari — `1.2.1.2.1.1` (IFR, 45 hari) naik 4/45, 11/45, 18/45
di tiga minggu pertamanya, dan turunan kita cocok dengannya sampai 1e-9. Tapi
126 leaf lain kolom PLAN-nya diketik tangan: `1.4.3.2` naik rata 0,0625 per
minggu selama 16 minggu, sementara kolom tanggalnya menyebut 16 Jun → 28 Sep,
yaitu 105 hari alias 15 minggu. Jendelanya meleset satu minggu di kedua ujung.
`1.4.4.2` lebih parah: melompat 0→100% dalam satu minggu padahal tanggalnya
membentang 165 hari.

Bukan turunan kita yang salah — workbooknya yang bertentangan dengan dirinya
sendiri, penyakit yang sama dengan `#REF!` di register dokumen dan `HLOOKUP` ke
range mati. Karena itu **tanggal yang menang**, dan blok PLAN dibaca hanya
sebagai alat uji. `import-gundih.ts` mencetak daftar leaf yang bertentangan
supaya planner punya bahan untuk merapikan salah satunya.

Harganya jujur: target W43 kita 75,37%, PDF yang sudah ditandatangani menulis
75,15%. Selisihnya 0,22 poin, terbesar +4,49 poin di W16, dan **nol di W60** —
kedua model mendarat tepat di 100%. Yang tidak bergeser sama sekali: bobot,
progress, dan WF kumulatif, yang cocok sampai dua desimal.

## Struktur data sumber, sebagai rujukan importer

`W43 (Overall).xlsx` — 23 sheet:

- **Data Overall** (305 × 454) — empat blok mendatar berdampingan:
  `PLAN` (kolom 16–171, kurva tiap leaf, W1–W60) · `DATA PLAN` (174–233, plan × WF)
  · `DATA ACTUAL` (236–295) · `ACTUAL` (298+, harian).
  Kolom kiri: WBS · Task Name · WF per SPK · WF Overall · Price · Workstep ·
  Duration · Baseline-1 (dur/start/finish) · Re-Baseline (dur/start/finish).
- **Summary Overall** — NO · DESKRIPSI · BOBOT · MINGGU LALU · MINGGU INI ·
  CUMM. MINGGU INI · TARGET · VARIANCE, empat unit pelaporan + total.
- **S-Curve Overall** — lima blok (Overall + SPK002/003/004/007), tiap blok
  PLAN · CUM. PLAN · ACTUAL · CUM. ACTUAL · DEVIATION.
- **Detail Overall** (332 baris) dan Detail/S-Curve per SPK · Photo · Cov0–Cov5.

`DAILY PROGRESS REPORT 04062026.xlsx` — satu sheet, tujuh bagian: Man Hours (POB
previous/today/total per perusahaan) · Permit to Work · HSE Input (Fatality, LTI,
NLTI, Unsafe, Near Miss, Medical Treatment) · Daily Activities (hari ini / besok)
· Area of Concern · Progress Summary · Progress Photograph. Ditambah cuaca per
slot waktu, jam kerja tidak efektif per sebab, dan tanda tangan dibuat/disetujui.

`Engineering Drawing List R2.xlsx` — EDL · EDL Summary · Vdrl · Doc Submit · Pic.
Tiap dokumen menempuh IFR → RE-IFR → IFA → RE-IFA → AFC → RE-AFC1/2 → AS-BUILT,
masing-masing dengan Plan Submitted · Date Submitted · Transmittal PTI · Receive
Date · Transmittal PEP · Return Code (APP/AWC/REPLACE). EDL Summary menimbang
jumlah dokumen per tahap dengan 0,5 / 0,3 / 0,2 — angka inilah yang harus
mengaliri leaf engineering di WBS.
