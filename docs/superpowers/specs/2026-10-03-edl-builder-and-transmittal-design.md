# Pembuat EDL baru dan transmittal sekaligus banyak dokumen: desain

Tanggal: 3 Oktober 2026 · Cabang: `main` · Lanjutan nomor 15 (Document Control)

## Tujuan

Dua keluhan dari sesi brainstorming hari ini, dari orang yang akan memakainya:

1. **Membuat EDL pertama kali "pusing banget, ribet, nggak rapi".** Keempat
   sebabnya dia pilih sendiri: penomoran ditanya di depan sebelum ada satu
   dokumen pun; daftar seksi template A, B.1, B.1.1 yang kosong semua dan
   sampai dobel (PROCESS muncul sebagai B.1 dan C di Merbau); harus buka satu
   seksi, isi, "Done", buka seksi berikutnya; dan tempel dari Excel cuma tautan
   kecil di bawah.
2. **Satu surat transmittal mengirim banyak dokumen**, dan sekarang tiap
   dokumen harus diisi tanggal dan nomor surat satu per satu.

Yang menyusun EDL adalah engineer, dari nol, sambil melihat acuan (EDL proyek
sebelumnya atau standar).

## Sudah selesai sebelum desain ini (commit `0dc0ed7`)

Summary dan layar Data dirapikan; satu aturan `openStateOf` di
`lib/register.ts` memutuskan apa yang outstanding; tanggal plan bisa diketik
per tahap di editor dokumen. Desain ini dibangun di atas itu dan tidak
mengubahnya.

## Keputusan yang dikunci hari ini

1. **Bentuk A**: satu halaman, kartu bertumpuk, tanpa bolak-balik.
2. **Judul besar bebas, bukan "disiplin".** Aplikasi menyarankan judul EPC dari
   template yang sudah ada (`lib/register-template.ts`, diturunkan dari EDL
   Petrogas asli: GENERAL, PROCESS, CIVIL, MECHANICAL, PIPING, ELECTRICAL,
   INSTRUMENT), orang mencentang yang dipakai dan menambah judul sendiri.
3. **Sub-judul opsional** di dalam judul besar, lewat "+ Sub-heading", dengan
   saran dari template atau ketik sendiri.
4. **Tidak ada gerbang penomoran.** Nomor langsung jadi; aturannya diubah lewat
   satu tautan "Change".
5. **Tiga cara mulai, terlihat di awal**: salin dari proyek lain, tempel dari
   Excel, mulai kosong.
6. **Transmittal bentuk A**: mulai dari suratnya (tombol "Record transmittal"),
   bukan centang di daftar Outstanding. Bentuk B mirip alur "centang lalu pilih
   mode" yang pernah dibuang karena membingungkan.
7. **Tampilan dan gerak ikut Lucille**: lihat bagian "Tampilan dan gerak".

## 1 · Pembuat EDL

### Langkah 1: mulai dari mana

Tiga kartu berdampingan, satu ditekan:

- **Copy from another project**: daftar proyek lain yang punya register yang
  sama (nama proyek, jumlah dokumen, jumlah judul). Memilih satu mengisi
  langkah 2 dengan judul besar, sub-judul, judul dokumen dan jenisnya dari
  proyek itu, semua tercentang. Tanggal, surat dan status TIDAK ikut.
- **Paste from Excel**: kotak tempel (dan "From an Excel file") memakai parser
  yang sudah ada (`parseRegisterPaste`, `readRegisterFile`). Pemetaan kolom
  hanya ditanyakan bila tebakannya ragu. Hasilnya mengisi langkah 2.
- **Start empty**: langsung ke langkah 2 tanpa isi.

Register yang sudah berisi ("Add EDL" di layar Data) langsung masuk langkah 2:
judul besar yang ada tampil tercentang dan terkunci, kartunya menyebut "N
existing documents", dan yang diketik menjadi tambahan.

### Langkah 2: mengisi

- **"What goes in this EDL?"**: chip judul besar dari template, plus kotak
  "+ Your own heading". Mencentang menambah satu kartu di bawah; melepas
  centang judul yang sudah berisi ketikan meminta konfirmasi dulu.
- **Satu kartu per judul besar**: nama judul, jumlah dokumen, menu ⋯ (ganti
  nama, hapus). Baris dokumen: Title · Doc/Dwg · Number · Plan IFR. Baris dari
  "Copy" punya kotak centang di depan; baris yang diketik tidak.
- **Menambah**: kotak "Type a title and press Enter, or paste several lines";
  tiap baris tempelan jadi satu dokumen (perilaku yang sudah ada).
- **Sub-judul**: "+ Sub-heading" dengan saran template untuk judul itu dan
  "Your own". Aturannya: **sebuah judul besar berisi dokumen ATAU sub-judul,
  tidak keduanya**, karena layar Data hanya menampilkan simpul daun sebagai
  grup. Jadi sub-judul pertama yang ditambahkan ke judul yang sudah berisi
  dokumen MENERIMA dokumen-dokumen itu, dan kotak tambah pindah ke tiap
  sub-judul.
- **Nomor**: `nextNumber(rule, judulBesar, subJudul ?? judulDokumen, kind,
  taken)` dari `lib/register-numbering.ts`, jadi jenis dibaca dari sub-judul
  kalau ada, kalau tidak dari judul dokumen (`typeFor` sudah memakai pola
  "datasheet", "layout", "plan" dan seterusnya). Nomor yang diketik tangan
  berhenti dihitung ulang (perilaku yang sudah ada).
- **Aturan penomoran**: awalan diambil dari nomor yang sudah ada, lalu inisial
  proyek (`projects.alias`, mis. JPI), lalu `docNoPrefix`. Baris "Numbers:
  JPI-GN-DRE-001 · Change" membuka dialog kecil berisi awalan dan kode tiap
  judul (isi layar penomoran yang sekarang, dipindah ke dialog). Aturan
  disimpan bersama register saat Save.
- **Plan IFR**: tanggal opsional per baris, disimpan sebagai `doc_stages` IFR
  `plan_submit_date` (tidak menandai terkirim). Tahap lain diisi di EDL Data.
- **Nama kedua pihak**: kartu "Who are the two sides?" hanya muncul bila
  `clientName` atau `contractorName` proyek masih kosong.
- **Bilah bawah (sticky)**: "14 documents under 3 headings" dan "Save to the
  register". Kembali ke layar Data setelah tersimpan.

### Penyimpanan

`addFromDraft` / `writeDraft` (`lib/register-seed.ts`) yang sudah ada, dengan
`DraftGroup.documents` diperluas: `kind` ('Doc' | 'Dwg') dan `planIfr` (ISO atau
null). Judul besar = kategori kedalaman 1, sub-judul = kedalaman 2, persis
struktur yang sudah dibaca semua layar. Aturan penomoran ditulis lewat
`saveNumbering` dalam aksi yang sama. Tidak ada tabel atau kolom baru.

Sumber "Copy": `getRegisterOutline(projectId, register)` baru di
`lib/register.ts`, mengembalikan judul, sub-judul dan dokumen (judul, jenis);
`getRegisterSources(currentProjectId, register)` untuk daftar proyeknya.

### VDRL

Komponen yang sama. Judul besar = paket vendor, tidak ada saran template
(template VDRL memang kosong), teksnya "+ Package".

## 2 · Transmittal (bentuk A)

- **Masuk**: tombol "Record transmittal" di baris alat layar Data, di samping
  Add EDL dan Export. Dialog dimuat lewat `next/dynamic` dengan `<Suspense>`
  sendiri (pelajaran pop-up Export: tanpa itu baris di belakangnya berkedip ke
  skeleton saat tekan pertama).
- **Pertanyaan pertama**: dua pilihan besar, "We sent documents" / "Documents
  came back". Lalu Date (default hari ini, bisa diubah) dan Letter (wajib).
- **Daftar dokumen** (dengan Search):
  - *Sent*: dokumen yang bolanya di kita, diurut seperti kartu Outstanding
    (telat, komentar, jatuh tempo), lalu sisanya yang masih punya tahap
    berikutnya. Tiap baris: centang, pil alasan (sama dengan Outstanding),
    judul, dan pilihan tahap yang terisi sendiri dengan tahap berikutnya.
  - *Came back*: dokumen yang sedang di pihak lain, terlama dulu. Tiap baris:
    centang, "N days out", judul, tahap yang sedang di luar, pilihan kode
    (APP / AWC / RWC).
- **Tahap berikutnya dan "sedang di luar" dihitung SEKALI di server**:
  `DocumentCard` mendapat `next` dan `out` dari `openStateOf`, supaya dialog
  tidak punya aturan kedua yang bisa berbeda.
- **Simpan**: `recordTransmittal({ projectId, register, direction, date,
  letter, items: [{ documentId, stage, code? }] })` di `lib/doc-actions.ts`,
  satu transaksi. Sent: `submittedAt`, transmittal keluar, `submitted`. Came
  back: `returnedAt`, transmittal masuk, `returnCode`; ditolak bila tahap itu
  belum pernah keluar. Penulisan tahap dibagi dengan `saveStage` (satu fungsi
  penulis, bukan salinan).
- Bilah bawah dialog: "4 documents in this letter" · Cancel · Save.

## 3 · Tampilan dan gerak

- Kartu, chip, pil, tipografi dan warna dari komponen yang sudah ada (`Card`,
  token `bad`/`warn`/`ok`, `TYPE`), pil satu ukuran, label kapital di awal,
  tanpa tanda pisah panjang di teks, target sentuh ≥ 44px, benar di 390px dan
  desktop.
- **Masuk halaman**: keyframe CSS (`.animate-enter`, `stagger-*`), bukan
  framer-motion (aturan AGENTS.md: markup tersembunyi sampai hidrasi).
- **Gerak setelah halaman hidup: framer-motion**, angka dari `MOTION`
  (`lib/design.ts`), kurva `--ease-ios`:
  - kartu judul muncul/hilang saat chip dicentang: tinggi + opacity
    (`AnimatePresence initial={false}`, pola `Panel.tsx`, `contain: layout
    paint`);
  - baris baru: opacity + naik 8px pada baris itu saja, tanpa kaskade;
  - chip dan Doc/Dwg: transisi warna 200ms;
  - jumlah di bilah bawah: `AnimatedNumber`;
  - langkah 1 ke langkah 2: framer-motion `AnimatePresence mode="wait"`,
    opacity dengan geser kecil, durasi dan kurva dari `MOTION` (diminta
    eksplisit: transisi lembut lewat framer-motion).
- Dialog transmittal: `.dialog-soft` / `.scrim-soft`, fokus otomatis Radix
  ditunda dua frame (sama dengan Export Excel).
- Diukur, bukan dikira: rekam CDP pada 390px dengan CPU 4x saat mencentang
  judul dan menambah baris; tidak ada frame lebih dari 33ms.

## 4 · Berkas

- `components/dokumen/RegisterBuilder.tsx`: ditulis ulang sebagai pembuat
  baru (langkah 1, langkah 2); potongan yang bisa dipakai ulang (kotak nama
  dua pihak, pembaca file) dipertahankan.
- Komponen baru kecil: `BuilderHeadingCard.tsx` (satu kartu), 
  `NumberingDialog.tsx`, `TransmittalDialog.tsx`.
- `lib/register-seed.ts`: `DraftGroup` + kind, planIfr.
- `lib/register.ts`: `getRegisterOutline`, `getRegisterSources`, `next`/`out`
  di kartu dokumen.
- `lib/doc-actions.ts`: `recordTransmittal`, penulis tahap bersama.
- `RegisterTools.tsx`: tombol Record transmittal.

## 5 · Verifikasi

- `scripts/verify-edl-builder.ts` pada salinan basis data
  (`copyDbFixture`): judul besar tanpa sub-judul, dengan sub-judul, dokumen
  pindah ke sub-judul pertama, nomor sesuai `nextNumber`, plan IFR tersimpan
  tanpa `submitted`, register yang sudah berisi tidak berubah selain
  tambahannya.
- `scripts/verify-transmittal.ts`: sent dan came back untuk beberapa
  dokumen, satu transmittal per surat, penolakan "came back" untuk tahap yang
  belum keluar, dan Outstanding/Summary berubah sesuai.
- Ditekan sungguhan di 1440 dan 390 (memilih cara mulai, centang judul, ketik,
  tempel beberapa baris, sub-judul, Save; transmittal kirim dan kembali), dan
  dilihat lewat `scripts/shoot.mjs`.
- `tsc`, `eslint`, `next build`.

## Di luar cakupan

- Sambungan EDL ke Data Overall per disiplin (keputusannya sudah ada: per
  disiplin, kredit saat dikirim, plan dari EDL). Desain sendiri berikutnya.
- `REPLY_DAYS` per proyek (perlu kolom baru lewat `ensureSchema`).
- Impor/ekspor Excel penuh (papan 20).
