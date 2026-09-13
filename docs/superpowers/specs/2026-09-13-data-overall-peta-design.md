# Data Overall sebagai PETA, bukan lembar kerja

13 September 2026. Papan 12, percobaan ketiga — dua yang pertama ditolak pada
hari yang sama: *"masih g suka, terlalu pusing dan g enak dipakai"*.

## Kenapa dua yang pertama gagal

Keduanya dirancang keluar dari **struktur berkas Excel**-nya: kolom, blok,
rumus. Angkanya cocok sampai dua desimal tiap kali, dan rasanya tetap
spreadsheet yang garisnya dihapus. Yang tidak pernah jadi titik awal adalah
**apa yang dikerjakan seseorang Jumat sore**.

Brief 13 Sep 2026 menjawab tiga hal yang selama ini ditebak:

1. **Angka datang dari empat arah sekaligus** — kiriman orang lapangan, laporan
   harian di app, penilaian rapat mingguan, dan hitungan kuantitas fisik.
   Artinya layar tidak boleh memaksa satu bentuk isian: yang menentukan bentuk
   adalah ITEM-nya (meter / langkah / persen), bukan sumbernya. Mesinnya sudah
   begitu (`lib/progress.ts`); wadahnya yang salah.
2. **Yang dibutuhkan pertama adalah PETA PENUH**, bukan antrian. "Semua
   pekerjaan per SPK, bisa buka-tutup." Antrian mingguan yang sudah terbukti
   (`lib/worklist.ts`, rata-rata 8,8 item/minggu) tetap dipakai — tapi turun
   pangkat jadi LENSA di atas peta, bukan layar tersendiri.
3. **Mengisi terjadi di panel geser**, bukan di baris. iPhone dulu: mengetik di
   baris berarti kolom sempit dan keyboard menutupi peta.

## Keputusan

**Satu layar, bukan tiga.** Data Overall sekarang terpecah tiga: *Fill in*
(progres), *Activities* (harga, bobot, cara ukur), *Check* (boleh terbit?).
Orang harus hafal field mana ada di layar mana — itu sendiri sumber pusing.
Harga, bobot, cara ukur dan jadwal satu baris pindah ke DALAM panel baris itu.
*Check* tetap: ia menjawab pertanyaan lain.

`/weekly/[week]/weights` **tetap hidup sebagai alat borongan** dan hanya
ditautkan dari kartu panduan ketika proyek memang belum berbobot. Mengetik 200
harga lewat panel satu-satu adalah sore yang hilang; itu kemampuan nyata dan
tidak boleh ikut terbuang bersama layarnya.

**Peta, bukan tabel.** SPK → kelompok → item, buka-tutup di tempat, tidak pernah
pindah halaman. TIDAK ADA header kolom di mana pun — itu yang membuat sesuatu
"terasa Excel". Tiap baris memuat tiga hal: nama utuh, satu batang, satu angka.
Batang biru `--chart-1` (aktual) dengan penanda merah `--chart-2` (rencana),
pasangan warna yang sama dengan Kurva S. Default terbuka hanya tingkat SPK.

**Warna menandakan STATUS, bukan identitas.** Rel kiri tiap baris memakai
`verdictFill` dari `lib/design.ts` (`--ok` / `--bad` / netral). Identitas paket
dibawa `CodeChip` yang sudah ada. Ini menghindari palet kedua — aturan "one
token source" di `AGENTS.md`.

**Antrian jadi lensa.** Satu baris di atas peta: "This week · 3 of 9 filled in"
dengan batang tipis, dan tombol *Show only these* yang menyaring peta di tempat.
Baris yang jatuh tempo minggu ini memakai chip; yang sudah diisi memakai centang.

**Upahnya harus terlihat.** Setelah Simpan, panel menutup dan batang induk
sampai ke SPK IKUT NAIK dengan animasi (`AnimatedNumber` + lebar batang
bertransisi). Mengisi sembilan item selama ini terasa seperti menyetor ke lubang;
ini yang mengubahnya jadi terasa maju. Ini satu-satunya bagian rancangan yang
belum pernah ada di dua percobaan sebelumnya, dan ia yang menjawab "enak
dipakai".

## Bentuk

```
lib/overall-map.ts        model murni: RollupNode + snapshot + worklist → MapNode[]
components/weekly/OverallMap.tsx     peta + lensa + pencarian (client)
components/weekly/ActivityPanel.tsx  panel geser, satu instans per layar
app/weekly/[week]/overall/page.tsx   perakitan
scripts/verify-overall-map.ts        pembuktian model tanpa database
```

`buildOverallMap` tidak menghitung ulang apa pun. Persentase datang dari
`lib/rollup.ts`, jatuh tempo dan "sudah diisi" datang dari `lib/worklist.ts`,
cara ukur dari `lib/progress.ts`. Satu asal untuk tiap angka, seperti sebelumnya.

## Batasan yang dipatuhi

- **Tidak ada action baru.** `saveFieldProgressAction`, `saveWeekUpdatesAction`,
  `markNoProgressAction` dan `setProgressMethodAction` sudah ada dan sudah
  bercabang ke SQLite.
- **Radix per layar, bukan per baris.** Panel satu instans, dikemudikan id baris
  aktif. Elemen dalam `.map()` native.
- **Masuk halaman tetap keyframe CSS** (`Reveal`, `.animate-enter`);
  framer-motion hanya untuk gerak yang dipicu state sesudah halaman hidup —
  panel, buka-tutup, tekan.
- **Satu kurva, satu durasi**: `MOTION` di `lib/design.ts`. Panel bergerak dari
  tempat ke tempat, jadi ia memakai `MOTION.spring`; buka-tutup memakai
  `Expand` yang sudah ada (tinggi tidak boleh pakai spring).
- `/print/*` tidak tersentuh.

## Pembuktian

`scripts/verify-overall-map.ts` (tanpa database), tangkapan layar 390px dan
desktop lewat `scripts/shoot.mjs` yang benar-benar dilihat, lalu `next build`.
