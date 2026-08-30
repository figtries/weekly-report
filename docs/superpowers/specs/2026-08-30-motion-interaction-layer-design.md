# Lapis interaksi — framer-motion di seluruh aplikasi

Tanggal: 30 Agustus 2026 · Cabang: `v2-foundation` · Papan: bagian dari item 07

## Tujuan

Setiap elemen penting di aplikasi ini bergerak ketika seseorang menyentuhnya,
dan gerakannya halus, lembut, tidak pernah tersendat, dan terasa mahal.

Yang **tidak** dimaksud: mengganti animasi masuk halaman. Itu sudah selesai dan
sudah dibuktikan salah sekali. Lihat "Yang tidak disentuh" di bawah.

## Keadaan sebelum

Aplikasi ini sudah dianimasikan di semua halaman, tapi hampir seluruhnya lewat
CSS keyframe untuk **kedatangan**: `Reveal`, `ScrollReveal`, `CountUp`,
`RouteTransition`, dan sekitar dua puluh kelas `.animate-*` di `globals.css`.
framer-motion hanya dipakai di empat komponen (`LogScreen`, `RegisterCurve`,
`RegisterWorkbench`, `EngineeringSource`).

Akibatnya: halaman **datang** dengan indah lalu **berhenti hidup**. Menekan
tombol, berpindah tab, membuka baris, menyaring daftar, menelusuri workbench —
semua itu terjadi seketika tanpa gerak, atau lewat keyframe CSS yang hanya bisa
menganimasikan yang masuk dan tidak pernah yang keluar.

Lubang itulah yang diisi dokumen ini. framer-motion masuk untuk **gerak yang
dipicu aksi setelah halaman hidup** — tempat dia memang menang, dan tempat tidak
ada apa pun yang disembunyikan menunggu hidrasi.

## Empat keputusan yang dikunci 30 Agustus 2026

1. **Satu kurva, satu spring, satu durasi.** Aturan 2 di `lib/design.ts`
   bertambah satu suku. Kurva `ease-out-expo` untuk yang **berubah tampilan**
   (pudar, warna, skala kecil); spring untuk yang **berpindah tempat** (level
   menggeser, pil tab meluncur, panel membuka). Keduanya ditulis sekali, di
   `MOTION`, dan tidak boleh ditulis di tempat lain.
2. **`strict` menyala, DAN ada aturan lint di sebelahnya.** `LazyMotion`
   dipasang dengan `strict`, yang membuat `motion.*` melempar error dan memaksa
   `m.*`. Tanpa penjaga ini "satu kurva" mati pelan-pelan: enam bulan lagi ada
   tiga durasi berbeda dan tidak ada yang tahu mana yang benar. Itu persis
   penyakit yang `lib/design.ts` dibuat untuk mencegah.

   **Tapi `strict` hanya berlaku di development.** Guard-nya di
   `node_modules/framer-motion/dist/es/motion/index.mjs:89` dibungkus
   `process.env.NODE_ENV !== "production"`. Dibuktikan 30 Agustus 2026 dengan
   membangun aplikasi ini sambil menyisipkan `motion.div` yang disengaja:
   `next build` keluar dengan status **0**. Jadi build tidak akan pernah
   menangkapnya, dan yang ikut lolos bukan cuma disiplinnya — seluruh pustaka
   ikut terkirim, bukan irisan yang sudah di-tree-shake.

   Karena itu `eslint.config.mjs` melarang impor `motion` dari `framer-motion`
   lewat `no-restricted-imports`. Itu separuh yang berjalan di CI dan separuh
   yang menggagalkan pull request. `strict` menangkapnya lebih cepat, saat
   mengetik; lint menangkapnya lebih pasti.
3. **Masuk halaman tetap CSS.** Tidak ada pengecualian, tidak ada perkecualian
   kecil. Alasannya sudah dibayar tiga kali dan ditulis panjang di
   `components/motion/Reveal.tsx`.
4. **framer-motion per layar, tidak pernah per baris.** Cerminan persis dari
   aturan Radix di AGENTS.md, dengan alasan yang sama: biayanya ada pada jumlah
   instance yang ter-mount, bukan pada pustakanya.

## Token

`MOTION` di `lib/design.ts` bertambah satu entri:

```ts
spring: { type: 'spring', stiffness: 300, damping: 30, mass: 0.9 }
```

Rasio redam ζ = 30 / (2·√(300 × 0,9)) ≈ **0,91**, tepat di bawah kritis. Artinya
gerakan mendarat dengan satu penyelesaian yang nyaris tak terlihat, bukan
memantul. Itu yang membedakan "lembut" dari "mainan": pantulan yang terbaca
sebagai pantulan pada tombol yang ditekan empat puluh kali sehari berubah dari
menyenangkan menjadi melelahkan dalam seminggu.

Angka ini **tidak** dicerminkan ke `globals.css`. Spring tidak punya padanan CSS
— itu justru alasan dia ada di sini dan bukan di sana. Kurva dan durasi tetap
punya dua sisi yang harus dijaga sejalan; spring hanya punya satu.

## Lima primitif

Semuanya di `components/motion/`, semuanya memakai `m.*`.

### `MotionRoot.tsx`

`'use client'`, membungkus **seluruh isi `<body>`** di `app/layout.tsx`:

```tsx
<LazyMotion features={domMax} strict>
  <MotionConfig reducedMotion="user" transition={{ duration: MOTION.duration, ease: MOTION.ease }}>
```

- **Seluruh isi `<body>`, bukan hanya `<main>`.** `Sidebar` dan `StorageWarning`
  adalah saudara `<main>`, bukan anaknya. Membungkus `<main>` saja meninggalkan
  sidebar — enam handler dan navigasi utama aplikasi — di luar provider, tempat
  `m.*` merender tanpa fitur dan diam saja. Kegagalannya senyap, jadi batasnya
  harus benar sejak awal.
- **Default `transition` ini hanya berlaku untuk animasi properti.** `layout` dan
  `layoutId` punya transisi bawaannya sendiri dan **tidak** membacanya, jadi
  `Swap` dan `SlideTab` harus menuliskan `transition={MOTION.spring}` secara
  eksplisit. Ini satu-satunya tempat spring boleh muncul di luar `lib/design.ts`,
  dan bentuknya selalu rujukan ke token, tidak pernah angka.
- **Tanpa satu hook pun.** Tidak membaca pathname, tidak membaca apa-apa. Percobaan
  sebelumnya di berkas ini membaca `usePathname()` dan mematikan build di
  `/print/daily/[date]`, karena di bawah `cacheComponents` pathname adalah bacaan
  tak-ter-cache dan membacanya di root layout memblokir setiap rute. `children`
  yang dioper dari server tetap dirender di server.
- **`domMax`, bukan `domAnimation`.** Selisihnya ±13kb dan yang dibeli adalah
  `layoutId` — satu-satunya fitur di daftar ini yang benar-benar tidak bisa
  ditiru dengan cara lain.
- **`reducedMotion="user"`** menangani `prefers-reduced-motion` untuk seluruh
  framer-motion di satu tempat, jadi tidak ada komponen yang perlu punya
  pendapat sendiri. Blok `@media (prefers-reduced-motion: reduce)` di
  `globals.css` tetap mengurus sisi CSS-nya.

### `Press.tsx`

`whileTap` dan `whileHover` untuk tombol dan kartu yang bisa diklik.

Skala tekan **0,97**, sama dengan `active:scale-[0.97]` yang sudah tersebar di
app — nilainya tidak berubah, tempatnya yang jadi satu. Hover menaikkan bayangan,
bukan memindahkan benda: memindahkan sesuatu saat kursor lewat membuat daftar
panjang terasa gelisah.

**Kelas `active:scale-[0.97]` dan `transition-all` di elemen yang dibungkus
`Press` harus DIHAPUS.** Dua sistem yang menskalakan benda yang sama saling
menimpa: CSS menulis `transform` lewat kelas, framer-motion menulisnya lewat
gaya inline, dan yang terlihat adalah tekanan yang tersendat di tengah jalan.
Satu benda, satu yang menggerakkan.

Hover **tidak pernah membawa informasi** — aturan itu dari AGENTS.md dan tetap
berlaku. Ini dekorasi, dan di layar sentuh ia memang tidak pernah terjadi.

### `Expand.tsx`

Buka-tutup dengan tinggi `auto`, lewat `AnimatePresence` + `initial={false}`.

CSS **tidak bisa** mentransisikan ke `height: auto`, dan setiap akal-akalan
`max-height` yang dipakai untuk menirunya menghasilkan jeda kosong di ujung
animasi ketika isinya lebih pendek dari tebakan. Ini pemakaian framer-motion
yang paling jelas benar di seluruh dokumen ini.

Batasnya: `height` adalah properti **layout**, bukan compositor. Karena itu
`Expand` hanya untuk panel — sesuatu yang dibuka satu per satu oleh seseorang —
dan tidak pernah di dalam `.map()`. Lihat "Anti-lag".

### `Swap.tsx`

Satu level drill-down yang datang dari arah asalnya dan yang lama **pergi**.

Menggantikan `.animate-level-fwd` / `.animate-level-back` di
`WbsTreeVisual.tsx:177` dan `DataOverallWorkbench.tsx:1175`.

**`initial={false}` adalah izin masuknya.** Komentar di kedua berkas itu menolak
framer-motion karena `motion.div` menuliskan prop `initial`-nya ke HTML server
dan seluruh level terkirim `opacity: 0`. `initial={false}` tidak menulis apa pun
ke HTML server — mount pertama muncul apa adanya, tanpa animasi, di cat pertama.
Keberatan itu terjawab pada sumbernya, bukan disiasati.

Yang didapat sebagai gantinya: level lama sekarang punya animasi keluar. CSS
keyframe tidak akan pernah bisa, karena elemennya sudah dilepas React sebelum
keyframe apa pun sempat berjalan. Dua level bergeser bersama, bukan satu hilang
lalu satu muncul.

Geraknya pakai `MOTION.spring` — ini benda besar yang berpindah tempat.

### `SlideTab.tsx`

Pil aktif yang meluncur antar tab, lewat `layoutId`.

Sebuah `m.span` berposisi absolut di belakang label, dirender hanya di trigger
yang aktif. React melepasnya dari satu trigger dan memasangnya di trigger lain;
`layoutId` yang sama membuat framer-motion menganimasikan perpindahannya.

`layoutId` harus **berbeda per baris tab**: `'section-tab'` untuk `SectionTabs`,
`'week-tab'` untuk `WeekTabs`. Dua baris dengan id yang sama akan saling menarik
pilnya melintasi halaman.

Di `SectionTabs` ini masuk ke dalam `TabsTrigger` shadcn lewat `asChild` yang
sudah ada — Radix tetap mengurus roving tab order, panah, dan aria; `layoutId`
hanya menumpang di latar. `activationMode="manual"` tidak boleh diubah.

## Peta penerapan

Dua puluh enam komponen klien. Yang mendapat apa:

| Primitif | Komponen |
|---|---|
| `SlideTab` | `SectionTabs`, `WeekTabs` |
| `Swap` | `WbsTreeVisual`, `DataOverallWorkbench` |
| `Expand` | `ApprovalPanel`, `CatalogEditor`, `DocumentEditor`, `EngineeringSource` |
| `layout` + `AnimatePresence` | `DailyReportsView`, `RegisterWorkbench`, `PhotoUploadGrid`, `LogScreen` |
| `Press` | semua tombol dan kartu yang bisa diklik |

Berkas baru: 5. Berkas berubah: `lib/design.ts`, `app/layout.tsx`, dan komponen
di tabel atas.

Empat komponen yang **sudah** memakai framer-motion (`LogScreen`,
`RegisterCurve`, `RegisterWorkbench`, `EngineeringSource`) harus ikut dipindah ke
`m.*`, karena `strict` akan menolak `motion.*` di mana pun. Itu bukan pekerjaan
tambahan — itu bukti bahwa penjaganya bekerja.

## Anti-lag

Ini persyaratan, bukan harapan. Empat aturan, masing-masing punya biaya nyata
kalau dilanggar.

1. **Hanya `transform` dan `opacity`,** kecuali `Expand` yang memang harus
   menyentuh `height` dan karena itu dibatasi ke panel tunggal. Keduanya berjalan
   di compositor dan tidak memicu layout.
2. **Tidak ada instance motion di dalam `.map()` yang bisa lewat ~20 baris.**
   `WbsTreeTable` membuka semua parent secara bawaan dan dapat merender 285 leaf
   sekaligus; `m.tr` di dalam loop itu berarti 285 instance dengan ref, effect
   dan langganan frame masing-masing. Di sana: CSS.
3. **Prop `layout` hanya pada daftar pendek.** `layout` mengukur setiap elemen
   yang memakainya di setiap perubahan; empat daftar di tabel di atas adalah
   daftar yang disaring, bukan tabel WBS.
4. **Tanpa `will-change` yang dipasang tangan.** framer-motion memasang dan
   melepasnya sendiri di sekitar animasi. Yang dipasang permanen justru menahan
   layer di memori GPU sepanjang umur halaman — pada telepon murah itu berbalik
   jadi penyebab tersendat, bukan obatnya.

## Yang tidak disentuh

- `Reveal`, `ScrollReveal`, `CountUp`, `RouteTransition` — seluruh kedatangan
  halaman tetap CSS keyframe.
- `HeroGauge` dan sapuan cincinnya di `WbsTreeVisual`, `PlanBar`, `SCurveClient`,
  `RegisterCurve` — semua animasi yang berjalan saat halaman dimuat. **Yang
  berubah di sana hanya impornya**, `motion` → `m`, karena `strict` menolak yang
  lama. Nilai, kurva, durasi dan bentuk geraknya tidak boleh bergeser satu pun;
  `RegisterCurve` khususnya sudah punya catatan sendiri soal `pathLength` yang
  merusak garis ber-`strokeDasharray`, dan catatan itu tetap berlaku.
- `/print/*` — nol motion, seperti sebelumnya. Puppeteer memotret tanpa menunggu,
  dan portal framer-motion merender di luar `.print-sheet-a4` tempat aturan
  geometri tidak sampai.
- `--ease-ios` dan pekerjaannya (hover, tekan, transisi shadcn) tetap.

## Verifikasi

1. **Penjaga HTML server, otomatis.** Skrip baru yang mengambil HTML terender
   server untuk setiap rute dan **gagal** kalau menemukan `opacity:0` atau
   `transform` sebagai gaya inline di dalamnya. Bug itu sudah dibayar tiga kali
   di repo ini — `Reveal`, `CountUp`, dan cincin di `WbsTreeVisual` — dan setiap
   kali ditemukan oleh manusia yang kebetulan melihat. Sekali ditulis, dia tidak
   akan terjadi keempat kalinya.
2. **`scripts/shoot.mjs`** di desktop dan 390px, dan gambarnya benar-benar
   dilihat. Teks terekstrak menunjukkan isi, tidak pernah komposisi.
3. **`next build` ditulis ke berkas, lalu `echo $?`.** Tidak pernah lewat pipe:
   `next build | grep` melaporkan status keluar grep.
4. **Jejak CDP + screencast** pada satu bundle untuk mengukur, bukan menghitung
   `requestAnimationFrame`.

## Yang sengaja tidak dikerjakan

- **Tanpa `Reorder` yang bisa ditarik.** Tidak ada satu pun daftar di app ini
  yang urutannya milik pengguna.
- **Tanpa transisi elemen bersama antar rute.** `RouteTransition` sudah memudar
  dengan benar dan tidak membaca apa pun; menambahkan `layoutId` lintas rute
  berarti membawanya kembali ke ranah yang sudah mematikan build sekali.
- **Tanpa spring kedua.** Kalau nanti ternyata satu spring tidak cukup, itu
  temuan yang harus ditulis, bukan nilai yang ditambahkan diam-diam.
