---
description: Kerjakan satu tugas berikutnya dari rencana yang sedang jalan, lalu berhenti
---

Kamu melanjutkan sebuah rencana implementasi yang sudah ditulis dan disetujui.
Tidak perlu ada nomor yang disebut: **rencananya sendiri yang mengingat sudah
sampai mana.**

Kalau **$ARGUMENTS** terisi, itu nomor tugas yang diminta secara khusus —
kerjakan nomor itu, bukan yang berikutnya.

## Langkah wajib, berurutan

1. **Cari rencananya.** Berkas di `docs/superpowers/plans/` yang masih punya
   `- [ ]`. Kalau ada lebih dari satu, sebutkan mana saja dan tanya yang mana —
   jangan menebak. Kalau tidak ada satu pun, laporkan bahwa semua rencana sudah
   habis dan tanya apa berikutnya. Berhenti di situ.
2. **Baca seluruh rencananya, plus spec yang ditunjuk header-nya.** Bagian
   "Global Constraints" berlaku untuk setiap tugas, bukan hanya tugas pertama.
   Baca juga `AGENTS.md`.
3. **Ambil tugas pertama yang centangnya belum penuh.** Satu tugas. Bukan dua
   karena kelihatan kecil, bukan setengah karena kelihatan besar.
4. **Ikuti langkahnya persis, termasuk urutannya.** Kalau langkahnya bilang
   tulis ujinya dulu dan jalankan sampai gagal, jalankan sampai gagal — melihat
   uji gagal lebih dulu itulah yang membuktikan ujinya menguji sesuatu.
5. **Jangan pernah mengubah angka di uji supaya cocok dengan hasil.** Kalau
   sebuah harapan meleset, yang salah bisa jadi kodenya, bisa jadi rencananya.
   Selidiki, dan kalau ternyata rencananya yang keliru: **berhenti, katakan apa
   yang kamu temukan, perbaiki rencananya**, baru lanjut. Rencana yang
   menyesatkan lebih mahal daripada satu tugas yang tertunda.
6. **Verifikasi seperti yang diminta tugas itu**, lalu centang langkah-langkahnya
   di berkas rencana dan commit — kode dan centangnya boleh satu commit.
7. **Berhenti dan lapor.** Sebutkan apa yang terbukti (angka, bukan kesan), apa
   yang berubah dari rencana kalau ada, dan apa isi tugas berikutnya beserta
   risikonya. **Jangan mulai tugas berikutnya tanpa diminta.**

## Kalau tersandung

Berhenti dan tanya. Jangan menerka. Yang membuat cara kerja ini bernilai adalah
tiap tugas berdiri di atas tugas sebelumnya yang sudah terbukti — sekali satu
tugas lolos dengan tebakan, sisanya dibangun di atas tebakan itu.

Hal remeh yang defaultnya jelas boleh langsung jalan. Tiap pilihan yang mengubah
hasil — pendekatan, cakupan, bentuk tampilan — tanyakan pakai AskUserQuestion
dan tunggu jawabannya.

## Aturan yang tidak bisa ditawar

- **Diff minimal.** Ubah hanya yang diminta tugas itu.
- **Semua elemen dari shadcn-ui**, semua animasi dan transisi dari
  **framer-motion** — satu kurva, satu durasi untuk seluruh aplikasi. Animasi
  masuk saat halaman dimuat adalah keyframe CSS, bukan framer-motion.
- **Responsif di semua device**: iPhone, Android, Windows, desktop.
- **Verifikasi dengan gambar, bukan teks.** `node scripts/shoot.mjs <url> <out.png>
  [w] [h]` lalu benar-benar lihat gambarnya — desktop dan 390px. Browser pane
  tidak pernah bisa memotret di lingkungan ini, dan teks yang diekstrak
  menunjukkan isi, tidak pernah komposisi.
- **Jangan verifikasi build lewat pipe.** `next build | grep` melaporkan exit code
  grep, bukan build. Tulis ke berkas lalu cek `$?`.
- **Sebelum `drizzle-kit migrate`**: salin `data/report.db`, baca isi SQL-nya, dan
  hitung baris anaknya sesudahnya. Migrasi yang membangun ulang tabel di dalam
  transaksi pernah menghapus 357 baris `doc_stages` di repo ini.
- **Bahasa jawaban: Indonesia.** Teks di layar, komentar kode dan nama variabel:
  Inggris.
- Kerja di branch `v2-foundation`. `main` tidak disentuh.

## Bedanya dengan `/lanjut`

`/lanjut` mengambil **nomor dari papan kerja** di `AGENTS.md` — sebuah pekerjaan
yang belum punya rencana dan biasanya dimulai dengan bertanya dan merancang.
`/tugas` menjalankan **rencana yang sudah ada**, satu tugas per giliran.
