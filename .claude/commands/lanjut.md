---
description: Lanjutkan papan kerja Report v2 — sebutkan nomornya, mis. /lanjut 06
---

Kamu melanjutkan pekerjaan Report v2. Nomor yang diminta: **$ARGUMENTS**

## Langkah wajib, berurutan

1. **Baca dulu, jangan menebak.** Buka
   `docs/superpowers/specs/2026-08-27-project-control-v2-design.md` — di situ ada
   papan kerja 7 fase, alasan tiap urutan, sembilan cacat pada berkas sumber
   beserta nomor papan yang menutup masing-masing, dan struktur ketiga workbook
   Gundih sebagai rujukan importer. Papan ringkasnya juga ada di `AGENTS.md`.
2. **Kalau `$ARGUMENTS` kosong**, jangan mulai apa pun. Laporkan nomor mana yang
   sudah selesai dan mana yang berikutnya menurut papan, lalu tanya nomor berapa
   yang mau dikerjakan. Berhenti di situ.
3. **Kalau nomornya disebut**, kerjakan **hanya** nomor itu. Jangan menyerempet
   nomor tetangga — penyebaran fokus itulah yang papan ini ada untuk mencegahnya.
4. **Tanya dulu sebelum memutuskan.** Untuk tiap pilihan yang mengubah hasil
   (pendekatan, cakupan, bentuk tampilan), tanyakan ke user pakai AskUserQuestion
   dan tunggu jawabannya. Hal remeh yang defaultnya jelas boleh langsung jalan.
   Presentasikan rencana singkat, dapatkan persetujuan, baru menulis kode.
5. **Selesaikan sampai terbukti, lalu berhenti.** Jangan lanjut ke nomor
   berikutnya tanpa diminta.

## Aturan yang tidak bisa ditawar

- **Diff minimal.** Ubah hanya yang diminta oleh nomor itu.
- **Semua elemen dari shadcn-ui**, semua animasi dan transisi dari
  **framer-motion** — satu kurva, satu durasi untuk seluruh aplikasi.
- **Responsif di semua device**: iPhone, Android, Windows, desktop.
- **Verifikasi dengan gambar, bukan teks.** `node scripts/shoot.mjs <url> <out.png>
  [w] [h]` lalu benar-benar lihat gambarnya — desktop dan 390px. Browser pane
  tidak pernah bisa memotret di lingkungan ini.
- **Jangan verifikasi build lewat pipe.** `next build | grep` melaporkan exit code
  grep, bukan build. Tulis ke berkas lalu cek `$?`.
- Dua pengecualian tampilan, keduanya soal kebenaran: baris tabel yang bisa
  melebihi ~20 memakai kelas shadcn dengan elemen native di dalamnya, dan
  `/print/*` tidak memakai framer-motion karena Puppeteer memotret tanpa
  menunggu animasi.
- **Bahasa jawaban: Indonesia.** Komentar kode dan nama variabel: Inggris.
- Kerja di branch `v2-foundation`. `main` tidak disentuh.

## Kalau papan kerjanya berubah

Perbarui tiga tempat sekaligus supaya tidak ada yang basi: `AGENTS.md`, spec di
`docs/superpowers/specs/`, dan artifact
<https://claude.ai/code/artifact/d3dfeed6-8a05-4ba8-87f5-2affe3da7c47> —
terbitkan dengan URL itu sebagai `url`, kalau tidak yang tercipta justru artifact
duplikat. Salinan lokal `docs/blueprint.html` dan `docs/blueprint.pdf` dibuat
ulang dari artifact yang sudah diperbarui.
