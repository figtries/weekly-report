# Projects — desain, ditulis ulang

Tanggal: 6 September 2026 · Cabang: `v2-foundation` · Papan 16 + 17
Menggantikan `2026-09-05-projects-overhaul-design.md`, yang ditulis sebelum
separuh masalah di bawah ini kelihatan.

## Kenapa ditulis ulang

Sembilan commit dan sekitar 4.500 baris sudah dikirim: layar Projects, sheet
enam kolom dengan segitiga durasi/mulai/selesai, tambah–indent–hapus baris,
rumus uang, mata uang bisa dipilih, warna per paket, Gantt yang muat di layar.

Penggunanya tetap tidak puas, dan kalimatnya tepat: *"ada hal-hal yang saklek,
logicnya juga masih kadang bagus kadang enggak, terus pewarnaannya juga."*

Itu bukan soal selera. Dibaca ulang, kodenya memang memuat **tiga kontradiksi
yang bisa dibuktikan** dan sederet aturan yang tidak pernah diputuskan — mereka
jatuh begitu saja dari urutan menulisnya. Dokumen ini membereskan akarnya, bukan
gejalanya.

## Tiga kontradiksi, dengan buktinya

**1. Nilai kontrak punya dua sumber yang bisa berselisih.**

```
components/projects/ProjectList.tsx:129   money(p.contractValue, …)      kolom tersimpan
app/projects/[id]/page.tsx:53             formatMoney(weights.contractValue, …)  hasil rumus
```

Di Gundih keduanya kebetulan sama. Di proyek mana pun yang berbeda, daftar dan
halaman menampilkan dua angka berlainan untuk proyek yang sama.

**2. Penulisnya melarang persis apa yang pembacanya andaikan.**

```
lib/sheet-actions.ts:74   throw new Error('A summary row is priced by its children')
lib/weights.ts            "harga pada cabang adalah nilai seluruh subtree"
data Gundih               27 dari 37 node berharga ADALAH cabang
```

Rumus uang menangani harga di cabang. Sheet menolak mengetiknya. Data melakukan­
nya. Tiga jawaban untuk satu pertanyaan.

**3. `weightBasis` dihitung, disimpan, dan tidak pernah dibaca.** Nol dari 120
komponen menyentuhnya.

## Gejala lain, yang semuanya berhilir ke lima pertanyaan di bawah

| | |
|---|---|
| Undo separuh | sel bisa dibatalkan; tambah/hapus/indent tidak — satu Ctrl+Z, dua perilaku |
| Tiga rasa respons | nama & harga instan · tanggal menunggu server · struktur me-refresh halaman |
| Warna punya tiga aturan | per unit → per cabang teratas → netral. Skemanya berubah sendiri seiring proyek tumbuh |
| Kolom Durasi punya tiga wajah | "—" milestone · angka mati ringkasan · angka bisa diketik |
| Unit bisa dinamai, tidak bisa dinilai | padahal rumus nilai kontrak berdiri di atas `unitContractValue`, yang nol UI |
| Bobot dihitung, tak pernah terlihat per baris | |
| Satu baris dua identitas | `wbsCode` tersimpan vs kode outline yang dihasilkan |
| `updateProjectFieldAction` kode mati | ditulis, tidak pernah dipanggil — kontraktor, no. kontrak, lokasi, prefix dokumen tidak punya UI |

## Lima keputusan

Diambil bersama pengguna, satu per satu, 6 September 2026.

### ① Sebuah baris adalah satu pekerjaan, dan tiap larangan harus punya sebab

Model lama menumpuk tipe: ringkasan, milestone, unit pelaporan, tertaut,
berharga. Dua dari lima aturannya tidak pernah diputuskan.

Yang berlaku sekarang:

- **"Ringkasan" bukan pilihan, ia akibat.** Sebuah baris jadi ringkasan karena
  punya anak — persis MS Project, di mana kamu tidak pernah "membuat summary",
  kamu meng-indent sesuatu ke bawahnya.
- **Milestone adalah sifat**, dan **baris beranak tidak bisa memilikinya** — ia
  membentang anak-anaknya, dan sebuah titik tidak bisa membentang. Ini
  satu-satunya larangan yang bertahan, karena ia satu-satunya yang punya sebab.
- **Unit pelaporan boleh di baris mana pun.** Gundih kebetulan menaruhnya di
  empat cabang; satu SPK yang isinya satu pekerjaan tetap masuk akal. Larangan
  "hanya ringkasan" dicabut.
- **Harga boleh di baris mana pun.** Data membuktikannya, dan larangan lama
  bertentangan dengan rumus uang aplikasi ini sendiri.
- **`tertaut`** — leaf teknik yang membaca persentasenya dari register dokumen —
  adalah **cara mengukur**, dan pengukuran tinggal di Data Overall. Ia tidak
  muncul di sheet sama sekali.

### ② Nilai kontrak DIKETIK di awal; alokasinya yang dihitung

Model lama menurunkan nilai kontrak dari jumlah harga baris. Itu salah, dan
penggunanya yang menunjukkannya: **kontrak sudah ditandatangani sebelum satu
baris WBS pun ada.** Nilainya diketahui hari pertama.

Membalikkannya menghapus satu-satunya pemeriksaan yang paling berguna:

```
NILAI KONTRAK   ditandatangani, diketik di awal    5.920.000   ← fakta
TERALOKASI      jumlah harga yang sudah diisi      4.800.000   ← hasil
SELISIH                                            1.120.000 belum dialokasikan
```

Dua angka itu bukan duplikat; gunanya justru **dibandingkan**. Model lama
menghapus yang pertama, jadi selisihnya tidak pernah bisa muncul — dan bobot
tutup di 100 terhadap "apa pun yang kebetulan diketik" alih-alih terhadap nilai
yang ditandatangani.

**Jumlah SPK tidak ditanyakan di awal.** Yang ada di kontrak adalah totalnya.
SPK ditambahkan sambil menyusun WBS — tandai baris sebagai unit, beri nilainya —
dan aplikasi menjaga dua persamaan terus-menerus:

```
jumlah nilai SPK          = total kontrak
jumlah harga di dalam SPK = nilai SPK itu
```

Selisih keduanya ditampilkan sebagai angka, bukan disembunyikan. Gundih memenuhi
yang pertama sampai enam desimal: 418.400 + 2.821.067,281925 + 1.837.809 +
842.723,72448 = 5.920.000,006405.

### ③ Bar styles: daftar aturan berurutan, ada bawaan, yang pertama cocok menang

Warna tidak bisa sekaligus berarti "paket" dan menjadi mesin yang bisa diatur.
Salah satu harus mengalah, dan yang mengalah adalah makna tetapnya: **"warna =
paket" menjadi ATURAN BAWAAN, bukan hukum.**

Sebuah aturan berkata: *batang yang memenuhi kondisi ini digambar begini.*
Daftarnya berurutan dan **yang pertama cocok yang menang** — jadi "lewat target"
ditaruh di atas "warna SPK" kalau keterlambatan lebih penting daripada paket.
MS Project menumpuk batang; ini tidak, karena hasil yang bisa ditebak lebih
berharga daripada hasil yang bisa ditumpuk.

Kondisi yang bisa dipakai **hari ini**, dari data yang benar-benar ada:

```
jenis baris   pekerjaan · ringkasan · milestone
keanggotaan   di dalam SPK tertentu
waktu         lewat tanggal target · belum berjadwal · sedang berjalan
uang          belum berharga · bobot di atas/bawah ambang
```

Yang **belum punya datanya**, dan karena itu belum jadi kondisi: `Critical`
(butuh mesin rantai) dan `Progress` (tinggal di Data Overall menurut keputusan
kita sendiri). Legenda MS Project yang dikirim pengguna memuat 21 entri; empat
sumbunya adalah jenis baris, mode penjadwalan, asal, dan keadaan. Mode
penjadwalan sengaja kita buang, dan "asal" (External Tasks) tidak ada di sini.

Aturan disimpan **per proyek**, disemai dari satu set bawaan, sehingga proyek
baru langsung terbaca tanpa siapa pun mengatur apa pun.

### ④ Jadwal boleh diubah kapan saja; aplikasi menyebutkan minggu mana yang goyah

Kurva rencana **diturunkan dari tanggal** — keputusan lama, supaya revisi jadwal
cukup mengubah tanggal alih-alih kembali ke Excel. Konsekuensinya tajam: menggeser
satu tanggal hari ini mengubah kurva rencana minggu 20 yang sudah ditandatangani
bulan lalu.

Sheet **tidak pernah menolak suntingan** — jadwal berubah karena lapangan
berubah, dan aplikasi yang melarangnya akan dilewati orang lewat Excel. Tetapi
begitu suntingan menyentuh periode yang sudah dilaporkan, ia berkata: *"ini
mengubah kurva rencana minggu 18–20; minggu 18 dan 19 sudah disetujui dan akan
menunjukkan penyimpangan."*

Minggu yang sudah disetujui tetap memegang potretnya. Yang berubah hanya angka
hari ini, dan **selisihnya menjadi terlihat, bukan tersembunyi** — aturan yang
sudah berlaku di panel persetujuan: sebuah tanda tangan yang diam-diam mengikuti
angka yang ia tandatangani tidak bernilai apa pun dalam sengketa.

### ⑤ Sebuah baris memiliki faktanya sendiri; apa pun yang menggambarkan subtree diturunkan

| | |
|---|---|
| Nama | diketik, selalu |
| Harga | diketik, di baris mana pun *(dari ①)* |
| Durasi · Mulai · Selesai | diketik di leaf · **diturunkan** di baris beranak |
| **Tanggal target** | diketik, di baris mana pun, **tidak pernah menimpa bentangan** |
| Bobot % | selalu diturunkan — dan **ditampilkan per baris** |
| Kode outline | selalu diturunkan |
| Nilai kontrak | **diketik** *(dari ②)*; yang diturunkan adalah alokasinya |

Ada ketidaksimetrisan yang disengaja: **harga di cabang diketik, durasi di cabang
diturunkan.** Sebabnya nyata —

> **Uang dibagi dari atas, waktu diamati dari bawah.**
> Kontrak berkata "paket ini seharga X" dan pekerjaan di dalamnya membagi X.
> Tidak ada yang berkata "paket ini 90 hari" lalu memaksa tugasnya muat; tugas
> memakan waktu yang ia makan, dan paketnya membentang mereka.

**Ringkasan tidak pernah bisa diketik tanggalnya**, dan itu satu-satunya perilaku
MS Project yang paling tegas kita buang: di sana kamu bisa mengetik durasi ke
ringkasan, ia diam-diam berhenti menjumlahkan anaknya, dan sejak itu jadwalnya
berbohong. Kalau ringkasan tidak bisa diketik, kebohongan itu mustahil secara
konstruksi.

**Tanggal target** adalah `Deadline` di legenda MS Project, dimasukkan tanpa
membiarkan siapa pun menimpa perhitungan: ia garis terpisah yang berkata
"seharusnya kelar sebelum ini", dan baris yang melewatinya ditandai di sheet dan
di Gantt. Ini juga rumah bagi tanggal selesai kontrak tiap SPK, yang sampai
sekarang tidak punya tempat sama sekali.

## Yang sudah ada, dan yang belum

**Sudah:** layar Projects (kartu, mini-Gantt, cari, arsip, bikin/ganti nama/hapus)
· proyek aktif di SQLite dan seluruh aplikasi mengikutinya · sheet enam kolom
dengan segitiga durasi/mulai/selesai, autosave, Undo sel · tambah/indent/outdent/
geser/hapus baris · milestone dan unit pelaporan · rumus uang dengan pratinjau
hitung-ulang · mata uang bisa dipilih · warna per paket · Gantt sejajar baris,
pemisah bisa ditarik, tab di ponsel.

**Belum, dan ini yang menghalangi orang memakainya:**

| | |
|---|---|
| **Tempel dari Excel** | 285 baris mustahil diketik; proyek nyata tidak bisa masuk |
| **Identitas proyek** | kontraktor, no. kontrak, lokasi, prefix nomor dokumen — nol UI |
| **Nilai kontrak & nilai SPK** | tidak bisa diisi di mana pun; seluruh ② berdiri di atasnya |
| **Penebak rantai** | tesis produknya, nol baris kode |
| **Pratinjau pergeseran** | idem |
| **Bar styles** | keputusan ③ |
| **Bobot per baris** | dihitung, tidak terlihat |
| **Virtualisasi** | 285 baris = 6.773 elemen DOM, 1.807 tombol |

Terukur pada build produksi, Gundih 285 baris:

```
CPU 1x   tergambar 1.474 ms   Collapse all    64 ms
CPU 4x   tergambar 4.642 ms   Collapse all 2.721 ms   ← setara HP kelas menengah
```

Bukan rusak, tapi 4,6 detik membuka sebuah proyek di HP itu terasa.

**Ditunda sadar:** baseline berversi (papan 18) · salin dari proyek lain ·
penerjemah supaya Dashboard/Weekly/Reports ikut proyek (papan 08–14) · login dan
peran (papan 22) · impor-ekspor Excel dua arah (papan 20).

## Urutan membangun

Disusun supaya tiap titik berhenti meninggalkan sesuatu yang bisa dipegang.

1. **Bereskan kontradiksinya.** Satu sumber nilai kontrak; harga boleh di cabang;
   `weightBasis` dibaca atau dihapus; bobot ditampilkan per baris. Titik berhenti:
   tidak ada dua layar yang menampilkan angka berbeda untuk hal yang sama.
2. **Uang bisa diisi.** Nilai kontrak di dialog proyek baru; nilai SPK di baris
   unit; kedua persamaan ② dijaga dan selisihnya ditampilkan. Titik berhenti:
   sebuah proyek baru bisa punya nilai kontrak yang benar.
3. **Identitas proyek bisa diisi.** Kontraktor, no. kontrak, lokasi, prefix
   dokumen — `updateProjectFieldAction` berhenti jadi kode mati. Titik berhenti:
   Document Control proyek baru bisa menomori dokumennya.
4. **Tanggal target** sebagai kolom sendiri, dengan penandaan yang melewatinya.
5. **Tempel dari Excel.** Titik berhenti: 285 baris Gundih masuk sekali duduk.
6. **Bar styles.** Mesin aturan, set bawaan, penyunting daftar.
7. **Virtualisasi + pencarian di sheet.**
8. **Penebak rantai + pratinjau pergeseran**, dan bersamanya kondisi `Critical`
   di bar styles serta peringatan minggu terdampak dari ④.

## Verifikasi

1. **`next build` hijau**, ditulis ke berkas lalu `echo $?` — jangan lewat pipe.
2. **`scripts/verify-weights.ts` tetap lulus seluruhnya**, dan bertambah: jumlah
   nilai SPK harus sama dengan nilai kontrak yang diketik, dan selisih alokasi
   harus dilaporkan apa adanya alih-alih dibulatkan jadi nol.
3. **Angka Gundih tidak bergerak**: 285 baris, 60 minggu, bobot tersimpan tutup
   di 100,000000, nilai kontrak 5.920.000,006405 USD.
4. **Tidak ada dua layar yang berselisih**: nilai kontrak di kartu `/projects`
   dan di `/projects/[id]` dibaca dari sumber yang sama.
5. **Gambar, bukan teks** — `scripts/shoot.mjs` pada 390px, 1240px dan 1920px,
   lalu benar-benar dilihat. Browser pane tidak pernah melakukan komposit di
   lingkungan ini.
6. **Setelah virtualisasi**, ukur ulang di build produksi dengan CPU ditahan 4×;
   tergambar harus turun di bawah satu detik.
