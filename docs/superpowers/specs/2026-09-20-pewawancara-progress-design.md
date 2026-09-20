# Pewawancara progress — desain

Tanggal: 20 September 2026 · Cabang: `main` · Papan baru, di bawah 12 (Data Overall)

Dokumen ini menjawab satu kalimat penggunanya:

> "jujur aku terkadang bingung itu ngitung percentage itu nambah atau kurangnya
> gimana, caranya ngitungnya gimana nambahnya"

dan kalimat yang menjelaskan kenapa itu bukan soal matematika:

> "kalo aku bikin kek construction pasti aku bingung apa yg mau kuisi, toh aku
> g di lapangan. tanya org lapangan, mereka pun bingung. kalo dah ditanya brp
> persen ya bingung. begitu juga procurement, commissioning."

**Gundih dipakai sebagai bahan belajar, bukan sebagai sasaran.** Angka-angka di
bawah ini ada untuk membuktikan bentuk masalahnya, bukan untuk melahirkan daftar
jenis pekerjaan khas satu proyek. Yang dibangun berlaku untuk setiap proyek yang
dibuat siapa pun di aplikasi ini.

## Buktinya ada di datanya sendiri

**Orang tidak mengisi persen. Mereka membalik baris.**

```
Gundih, minggu 60, 218 leaf
  85 baris di 0%
 108 baris di 100%
  25 baris di antaranya
```

193 dari 218 baris hanya pernah punya dua nilai. Itu bukan kemalasan. Itu
jawaban yang wajar ketika sebuah alat menanyakan pendapat kepada orang yang
hanya punya fakta.

**Dan alat itu memang hanya menanyakan pendapat.**

```
lib/progress.ts   tiga metode: qty, milestone, lumpsum
data              215 dari 218 leaf Gundih memakai lumpsum
                   13 dari  13 leaf Samberah memakai lumpsum
```

`lib/progress.ts` menulis maksudnya sendiri di komentar kepala berkasnya:
berhenti menanyakan *berapa persen* dan tanyakan *sudah selesai berapa*. Metode
untuk itu sudah ada sejak lama. Tidak ada satu layar pun yang pernah mengajak
orang memakainya, jadi setiap baris lahir sebagai lumpsum dan mati sebagai
lumpsum.

**Bukti yang sudah dikumpulkan pun tidak pernah dibaca.**

```
documents       454 baris  (143 EDL, 311 VDRL)
doc_stages      512 baris  lengkap dengan tanggal submit dan transmittal
                188 dokumen sudah berstatus
wbs_nodes         3 leaf yang progress_method = 'linked'

lib/progress-sqlite.ts:38
  "'linked' resolves elsewhere; for measurement it behaves as lumpsum"
```

512 kejadian nyata tercatat. Minggu berikutnya aplikasi bertanya "engineering
berapa persen" seolah catatan itu tidak pernah ada. Pekerjaan yang sama diukur
dua kali, dan yang kedua mutunya lebih rendah daripada yang pertama.

## Yang diputuskan

### 1. Pertanyaannya "ini pekerjaan apa", bukan "berapa persen"

Sebuah baris ditanya **sekali**, saat pertama kali hendak diisi: ini pekerjaan
bidang apa. Di EPC bidangnya memang terbatas, dan itulah yang membuat pertanyaan
ini bisa dijawab siapa pun tanpa pelatihan.

Empat bidang bawaan: **Engineering, Procurement, Construction, Commissioning.**

Daftar ini **tidak dikunci**. Proyek boleh menambah bidangnya sendiri. Empat itu
bawaan karena itu yang berulang di setiap kontrak EPC, bukan karena kode
melarang yang lain.

### 2. Bidang membawa langkah siap pakai

| bidang | langkah | bobot |
|---|---|---|
| Engineering | IFR · IFA · AFC | 50 / 30 / 20 |
| Procurement | PO terbit · Fabrikasi · Siap kirim · Sampai di lokasi | 20 / 40 / 15 / 25 |
| Construction | Material siap · Pemasangan · Sambungan · Inspeksi QC | 15 / 50 / 25 / 10 |
| Commissioning | Pre-comm · Energize & function test · Start up · Running test | 25 / 35 / 20 / 20 |

Bobot Engineering bukan karangan: `doc_stage_weights` sudah menyimpan persis
50/30/20 untuk register VDRL. Bobot Construction dipilih penggunanya sendiri
dalam sesi ini. Dua sisanya usulan.

**Langkah selalu boleh diubah.** Yang disediakan aplikasi adalah titik berangkat,
bukan aturan. Sebuah proyek yang langkah pemasangannya berbeda menuliskannya
sendiri sekali, dan tidak pernah ditanya lagi.

### 3. Tiga bentuk pengukuran, dan bidang yang memilihkan

Setiap baris jatuh ke salah satu dari tiga bentuk. Ini pelajaran yang dibawa
pulang dari Gundih, dan berlaku di luar Gundih:

**Sekali jadi.** Jawabannya sudah atau belum, ditambah tanggalnya. PO terbit,
izin keluar, dokumen approved, material sampai. Tidak ada 40% material on site.
Persennya 0 atau 100. Di Gundih bentuk ini saja sudah 110 dari 218 baris, yang
menjelaskan seluruh sebaran 85/108/25 di atas.

**Bertahap.** Ada langkahnya, dan langkahnya datang dari bidang. Yang ditanya
"sudah sampai mana", bukan "berapa persen". Persennya dijumlahkan dari bobot
langkah yang sudah tercapai.

**Dikutip.** Angkanya milik orang lain, biasanya vendor. Yang ditanya "laporan
terakhir tanggal berapa, isinya berapa". Yang tersimpan sebuah kutipan lengkap
dengan tanggal dan sumbernya, bukan sebuah taksiran.

### 4. Ditanya sekali, dipakai seterusnya

Setelah bidangnya dijawab, pengisian mingguan tidak pernah lagi menanyakan
persen. Yang muncul hanya pertanyaan sesuai bentuknya: satu ketukan untuk yang
sekali jadi, centang sampai mana untuk yang bertahap, satu angka plus tanggal
untuk yang dikutip.

### 5. Aplikasi mengingat, supaya makin jarang bertanya

Begitu sebuah baris diberi bidang dan langkah, **baris lain dengan nama serupa
di proyek yang sama langsung ditawari yang sama.** Tawaran itu ditampilkan untuk
dibenarkan, tidak pernah dipakai diam-diam.

Ini yang membuat penyiapan berhenti terasa seperti pekerjaan. Nama baris di
sebuah WBS memang berulang: di Gundih "PO Unprice" muncul 18 kali, "Material On
Site" 18 kali, "Process PO" 17 kali, "RTS" 17 kali. Satu koreksi membereskan
delapan belas baris.

Ingatannya **per proyek** dulu. Lintas proyek adalah pertanyaan tersendiri, sebab
dua perusahaan bisa memakai kata yang sama untuk hal yang berbeda, dan tidak
dijawab di sini.

### 6. Setiap jawaban langsung diterjemahkan ke rencana

Begitu dijawab, panelnya menyebutkan akibatnya, karena angka tanpa akibat tidak
memberi tahu siapa pun apa-apa:

```
Naik 7,5 poin jadi 57,5%
Rencana minggu ini 62,5. Tertinggal 7,5.
Baris ini menyumbang 0,31 poin ke total proyek.
```

Ketiga bahannya sudah sampai di panel hari ini juga: `actualPct`, `planPct` dan
`weekPct` di `lib/overall-map.ts:216`. Minggu lalu adalah `actualPct - weekPct`.
Tidak ada query baru, tidak ada plumbing.

### 7. Setiap angka membawa asal-usulnya

Yang tersimpan bersama angka: jawaban apa yang menghasilkannya, tanggalnya, dan
siapa yang mencatat. Pertanyaan "kenapa minggu 32 naik segitu" dijawab di tempat
angkanya berdiri, tiga bulan kemudian, tanpa siapa pun harus mengingat.

Ini bagian yang membuat angkanya **bisa dipertanggungjawabkan**, yang adalah
seluruh alasan fitur ini ada.

### 8. Mengisi manual tidak pernah ditutup

Pewawancara adalah jalan yang dimudahkan, bukan pagar. Di setiap baris, apa pun
bidangnya dan apa pun bentuknya, mengetik persen langsung selalu tersedia.

Alasannya bukan kompromi. Ada keadaan yang tidak akan pernah muat di daftar
langkah mana pun: pekerjaan yang berhenti di tengah karena satu hal di luar
urutan, angka yang sudah disepakati di rapat dan harus dipakai apa adanya,
baris yang langkahnya belum sempat disusun sementara laporan harus terbit besok.
Sebuah alat yang menolak keadaan-keadaan itu akan ditinggalkan, dan yang
ditinggalkan tidak melindungi apa pun.

Yang berlaku: **angka yang diketik tangan disimpan sebagai angka yang diketik
tangan.** Ia tidak menyamar sebagai hasil hitungan. Di layar Check ia terbaca
apa adanya, sehingga sebuah laporan yang separuh isinya diketik tangan
mengatakan itu sendiri sebelum siapa pun menandatanganinya.

Dilaporkan, tidak dilarang. Itu pendirian yang sama dengan cara aplikasi ini
memperlakukan heading yang kelebihan alokasi.

## Yang TIDAK dikerjakan

- **Daftar jenis pekerjaan khas Gundih.** Sempat dirancang dan ditolak
  penggunanya dengan tepat: Gundih bahan belajar, bukan sasaran.
- **Termin penagihan di kartu SPK.** Dibahas, dinilai berlebihan untuk sekarang.
- **Mode kuantitas.** Ada di kode, tidak disentuh, tidak dipakai kontrak ini.
- **Lampiran laporan vendor.** Yang dikutip cukup angkanya, tanggalnya dan
  sumbernya.

## Yang sudah diverifikasi di kode

| | |
|---|---|
| `milestones` (id, node_id, label, weight, sort_order) | ada, **0 baris** |
| `milestone_progress` (week_id, milestone_id, achieved, recorded_by, recorded_at) | ada, per minggu |
| `leaf_progress.note` / `.recorded_by` / `.recorded_at` | ada, **tidak ada satu kode pun yang menyentuhnya** |
| `applyProgressMethod` (`lib/mutations.ts:372`) | sudah memindahkan progress melintasi perubahan metode, dan tidak pernah lebih murah hati daripada angka asalnya |
| `actualPct` / `planPct` / `weekPct` | sudah ada di `MapNode` |
| bidang pekerjaan | **satu kolom** di `wbs_nodes`, lewat `EXPECTED_COLUMNS` di `lib/db-snapshot.ts` |

**Tidak ada tabel baru.** Itu penting: AGENTS.md mencatat tabel baru sebagai
pertanyaan deployment sebelum jadi pertanyaan kode, karena sebuah deployment
memulihkan skemanya dari snapshot blob dan bukan dari migrasi. Kolom baru punya
jalur yang sudah terbukti; tabel baru tidak.

## Dampaknya ke angka yang sudah tercatat

Mengubah cara mengukur tidak boleh mengubah apa yang sudah diukur. Aturan
`applyProgressMethod` memberikan langkah secara berurutan sampai sebelum
melewati angka yang sudah dilaporkan, jadi sebuah baris di 57,5% dengan tangga
50/30/20 turun ke 50%. Itu pergeseran nyata dan harus diukur, bukan diandaikan.

Disimulasikan ke Gundih minggu 60 dengan seluruh keputusan di atas:

```
TOTAL PROYEK   67,19  ->  66,18     bergeser 1,01 poin
baris bergeser 25 dari 218
```

Kecil karena 193 baris sudah berada di 0 atau 100 dan tidak ke mana-mana. Tetapi
bukan nol, jadi **pemasangan tangga selalu menampilkan akibatnya lebih dulu**
("proyek turun 1,01 poin, 25 baris bergeser") sebelum dijalankan. Dilaporkan,
tidak dikoreksi diam-diam, sama seperti cara aplikasi ini memperlakukan heading
yang kelebihan alokasi.

### Satu cacat yang ditemukan sambil mengukur ini

`applyProgressMethod` di `lib/mutations.ts:419` bermaksud memberikan anak tangga
**berurutan sampai** yang berikutnya melewati angka yang sudah dilaporkan.
Komentarnya mengatakan itu. Kodenya tidak: perulangannya tidak pernah berhenti,
jadi setelah satu anak tangga terlewat ia tetap memeriksa anak tangga
sesudahnya, dan memberikan yang kebetulan lebih murah.

Pada tangga 15/50/25/10 sebuah baris di 57,5% menjadi *material ✓, sambungan ✓,
inspeksi QC ✓, pemasangan ✗* — inspeksi mutu yang lulus pada barang yang belum
dipasang. Itu persis "angka yang tidak bisa dijelaskan siapa pun" yang menjadi
alasan aturan itu ditulis.

Belum pernah terlihat karena tabel `milestones` masih nol baris, jadi fungsi ini
belum pernah dijalankan sungguhan. Ia harus diperbaiki sebelum baris pertama
masuk, dan selisih 0,54 versus 1,01 poin di atas adalah ukuran persis dari cacat
itu.

## Urutan pengerjaan

1. Kolom bidang di `wbs_nodes`, dan daftar bidang bawaan yang bisa ditambah
   proyek.
2. Pertanyaan sekali per baris, dengan tawaran dari baris bernama serupa.
3. Tiga bentuk pengisian di `ActivityPanel`: ketukan, centang langkah, kutipan.
4. Terjemahan ke rencana di panel yang sama.
5. Penyimpanan asal-usul di `leaf_progress.note` dan pasangannya di db.json.
6. Pemasangan massal dengan pratinjau dampak.

Butir 1 sampai 4 adalah yang membuat pengisian mingguan berhenti membingungkan.
Butir 5 dan 6 yang membuat angkanya bisa dipertanggungjawabkan.
