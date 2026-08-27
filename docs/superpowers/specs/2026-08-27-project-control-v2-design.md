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

Lulus bila total bobot = 100,00% dan Ringkasan W43 keluar `75,15% / 80,04% / +4,89%`
— persis PDF `PRGG-00-G0-RPT-002 W43`.

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
